import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,matchTemplate} from '../src/templateModel.mjs';
import {geometryRulesFromWeld,shortSegmentRange} from '../src/templateGeometryRules.mjs';
import {ensureProcessLayers,newProcessEntry,addProcessPass,updateProcessPass,validateProcessEntry} from '../src/processParameterModel.mjs';
import {sharedCornerPoint,sharedCornerPointChanges} from '../src/processFeaturePoints.mjs';
import {analyzeWeldMatch,planWorkspace,canPreviewWeld} from '../src/weldMatching.mjs';
import {settingsDefaults} from '../src/planningSettingsModel.mjs';
import {excludeVerifiedCollision,strategyGeometryRows} from '../src/strategyGeometry.mjs';
import {planeSplitStations,multiSplitPreview,splitWeldPreview} from '../src/manualSplitModel.mjs';
import {recipeConflicts,deviceLibraryUpdates,restoreDeviceLibrary,clearRemovedProcess} from '../src/processDeviceLibraries.mjs';

const position='PB · 横角焊',joint='T 形接头';
const segment=(a,b,y=0)=>({position,joint,geometry:'直线',length:b-a,pathPoints:[[a,y,0],[b,y,0]],mainPartId:'base',subPartId:'rib',referenceNormal:[0,0,1]});
const source=(id='W001',y=0)=>({id,name:id,enabled:true,position,joint,leg:6,closure:'open',segments:[segment(0,100,y)],length:100,completeStart:true,completeEnd:true,cornerAngles:[],groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false,processingKey:id});
const device={id:'device-a',name:'设备A',enabled:true,applicability:{welderModel:'R450',robotModel:'M-20iD/25',material:'低碳钢',wireType:'实芯焊丝',wireDiameter:1.2,gas:'CO2',method:'MAG'}};
const recipe=()=>{
 const p=newProcessEntry();
 return ensureProcessLayers({...p,recipeRevision:3,leg:6,name:'6mm 平角焊',position,joint,joints:[joint],weldForms:['角焊缝'],arcTracking:false,
  applicability:{...device.applicability,deviceProfileId:device.id},start:{current:210,voltage:24,time:.5},weld:{current:200,voltage:24,speed:400},end:{current:180,voltage:20,time:.5}});
};
const config={planningRevision:3,activeDevice:device,trackingParameters:{laserEnabled:false,arcEnabled:false}};

test('短段区间±5 mm且上限30 mm，长段长度不限制，端点条件仍须匹配',()=>{
 for(const [length,accepted,rejected] of [[28,30,30.1],[30,500,null]]){
  const w={...source(),length,segments:[segment(0,length)],endpointFacts:{start:{type:'三面交',gap:12}}};
  const t={...newTemplate('whole',w),name:'模板',requirementsMatch:geometryRulesFromWeld(w),segments:w.segments.map(s=>({...s,...shortSegmentRange(s)}))};
  assert.equal(matchTemplate(t,{...w,segments:[segment(0,accepted)]}).ok,true);
  if(rejected!==null)assert.equal(matchTemplate(t,{...w,segments:[segment(0,rejected)]}).ok,false);
  assert.equal(matchTemplate(t,{...w,endpointFacts:{start:{type:'三面交',gap:11}}}).ok,false);
  const legacy={...newTemplate('whole',w),mode:'exact',name:'旧模板'};
  const decision=analyzeWeldMatch({...w,length:accepted,segments:[segment(0,accepted)]},[legacy],[],config);
  assert.equal(decision.route,'whole');
  assert.equal(planWorkspace([{...w,length:accepted,segments:[segment(0,accepted)]}],[legacy],[],config)[0].planned,true);
  if(rejected!==null)assert.equal(matchTemplate(legacy,{...w,segments:[segment(0,rejected)]},config).ok,false);
 }
});

test('启用设备匹配优先于其他库，单道优先，策略点按阶段分配有效参数并保持既有结果可预览',()=>{
 const p=recipe(), second=recipe(), multi=addProcessPass({...second,name:'多道'},second.processLayers[0].id);
 const other={...recipe(),applicability:{...p.applicability,deviceProfileId:'device-b'}};
 const decision=analyzeWeldMatch(source(),[],[other,multi,p],config);
 assert.equal(decision.process.id,p.id);
 const [result]=planWorkspace([source()],[],[p],config);
 assert.deepEqual(result.strategyPlan.passes[0].points.map(point=>[point.kind,point.parameters.current]),[['start',210],['weld',200],['end',180]]);
 assert.equal(result.strategyPlan.collisionStatus,'未验证');
 assert.equal(canPreviewWeld(result,[],[p],{...config,interferenceEndParameters:{startDistance:500}}),true);
 const templateOnly=analyzeWeldMatch(source(),[],[p],{...config,interferenceEndParameters:{startDistance:101}});
 assert.match(templateOnly.reason,/仅支持焊接模板/);
 assert.equal(templateOnly.creation,'template');
 assert.equal(analyzeWeldMatch(source(),[],[],config).creation,'template-or-process');
 assert.equal(analyzeWeldMatch({...source(),gapJoinError:'路径连接无效'},[],[],config).creation,undefined);
});

test('重新规划旧草稿使用整段焊缝，忽略旧间断区间',()=>{
 for(const intermittentRanges of [[],[[0,20],[30,50],[60,80]]]){
  const [result]=planWorkspace([{...source(),intermittentRanges}],[],[recipe()],config);
  assert.equal(result.planned,true);
  assert.deepEqual(result.strategyPlan.passes[0].points.map(point=>[point.kind,point.distance]),[['start',0],['weld',0],['end',100]]);
 }
});

test('只有已验证的避障失败区间会被拆除',()=>{
 const settings=settingsDefaults({samplingAvoidance:{enabled:true,autoDeleteUnavoidable:true}});
 const failed={...source(),collisionResult:{verified:false,unavoidableRanges:[[40,60]]}};
 let n=1;
 assert.deepEqual(excludeVerifiedCollision(failed,settings,()=>String(++n)),[failed]);
 const parts=excludeVerifiedCollision({...failed,collisionResult:{...failed.collisionResult,verified:true}},settings,()=>String(++n));
 assert.deepEqual(parts.map(value=>value.length),[40,40]);
 assert.equal(parts[0].endpointFacts.end.type,'避障打断');
});

test('U 形包角只连接两条具有同一板件和成对边缘证据的焊缝',()=>{
 const p=recipe(),facts=side=>({junctionType:'两面交',gap:55,plateThickness:6,offsetDirection:[0,side,0]});
 const a={...source('W001',0),endpointFacts:{end:facts(1)}},b={...source('W002',6),endpointFacts:{end:facts(-1)}};
 const decision={ready:true,route:'automatic',process:p,locals:[]};
 const rows=[{weld:a,decision},{weld:b,decision}];
 const result=strategyGeometryRows(rows,{wrapParameters:{gapThreshold:50}});
 assert.equal(result.length,1);
 assert.equal(result[0].weld.segments[1].strategyRole,'wrap');
 assert.deepEqual(result[0].weld.segments[1].pathPoints,[[100,0,0],[100,6,0]]);
 const split=splitWeldPreview(result[0].weld,103);
 assert.deepEqual([split.pieces[0].at(-1).strategyWrapKind,split.pieces[1][0].strategyWrapKind],['L','L']);
 assert.equal(strategyGeometryRows([rows[0],{...rows[1],weld:{...b,machineCount:2}}],{wrapParameters:{gapThreshold:50}}).length,2);
});

test('面打断使用真实交点，删除和恢复设备时同时移动其工艺库',()=>{
 const weld=source(),stations=planeSplitStations(weld,[37,0,0],[1,0,0]);
 assert.deepEqual(stations,[37]);
 assert.deepEqual(multiSplitPreview(weld,stations).lengths,[37,63]);
 const p=recipe(), workspace={processDeviceProfiles:[device],processLibrary:[p]};
 assert.equal(recipeConflicts([p],{...p,id:'duplicate',joint:'角接头',joints:['角接头']}).length,1);
 const deleted=deviceLibraryUpdates(workspace,{processDeviceProfiles:[]});
 assert.equal(deleted.processLibrary.length,0);
 assert.equal(clearRemovedProcess({...weld,processId:p.id,planned:true},new Set([p.id])).planned,false);
 const restored=restoreDeviceLibrary(deleted,device.id);
 assert.deepEqual(restored.processLibrary,[p]);
 assert.equal(restored.processDeviceProfiles[0].enabled,true);
});

test('立焊填充速度与起弧停留随工艺进入路径，停留只发生一次',()=>{
 const vertical='PF · 立向上焊';
 const weld={...source(),position:vertical,segments:[{...segment(0,100),position:vertical,pathPoints:[[0,0,0],[0,0,100]],referenceNormal:[1,0,0]}],
  endpointFacts:{start:{type:'三面交过焊孔',holeSize:6,offsetDirection:[1,0,0]}}};
 const settings={...config,wrapParameters:{fillEnabled:true,fillHoleSize:10,fillOffset:3}};
 const p={...recipe(),position:vertical};
 const id=p.processLayers[0].passes[0].id;
 const configured=updateProcessPass(p,id,{holeFill:{current:230,speed:250,time:1.25}});
 const [result]=planWorkspace([weld],[],[configured],settings);
 assert.deepEqual(result.processParameters.holeFill,{current:230,voltage:24,speed:250,time:1.25});
 const fill=result.strategyPlan.passes[0].points.filter(point=>point.kind==='holeFill');
 assert.deepEqual(fill.map(point=>point.position),[[3,0,0],[0,0,0]]);
 assert.deepEqual(fill.map(point=>[point.parameters.speed,point.parameters.time]),[[250,1.25],[250,undefined]]);
 const [legacy]=planWorkspace([weld],[],[p],settings);
 assert.deepEqual(legacy.strategyPlan.passes[0].points[0].parameters,{current:210,voltage:24,speed:400,time:.5});
 const [stationary]=planWorkspace([weld],[],[configured],{...settings,wrapParameters:{...settings.wrapParameters,fillOffset:0}});
 assert.equal(stationary.strategyPlan.passes[0].points.filter(point=>point.kind==='holeFill').length,1);
 assert.equal(stationary.strategyPlan.passes[0].points[0].parameters.time,1.25);
 const invalid=updateProcessPass(p,id,{holeFill:{speed:255,time:1.235}});
 assert.match(validateProcessEntry(invalid).join(' '),/过焊孔填充速度.*过焊孔填充起弧停留时间/);
});

test('同一内角的转角路径使用一组工艺，编辑时保留外角参数',()=>{
 const weld={...source(),length:200,cornerAngles:[90],segments:[segment(0,100),{...segment(0,100),pathPoints:[[100,0,0],[100,100,0]]}]};
 const p=recipe(),id=p.processLayers[0].passes[0].id;
 const points=[190,240,210].map(current=>({enabled:true,current,voltage:24,time:0}));
 const mixed=updateProcessPass(p,id,{cornerParameters:{inner:points,outer:points}});
 const [original]=planWorkspace([weld],[],[mixed],config);
 const cornerCurrents=planned=>planned.strategyPlan.passes[0].points.filter(point=>point.kind==='corner').map(point=>point.parameters.current);
 assert.deepEqual(cornerCurrents(original),[240,240,240]);
 const pass=mixed.processLayers[0].passes[0];
 const revised=updateProcessPass(mixed,id,sharedCornerPointChanges(pass,'inner',{...sharedCornerPoint(pass,'inner'),current:220}));
 assert.deepEqual(revised.cornerParameters.outer,points);
 const [updated]=planWorkspace([weld],[],[revised],config);
 assert.deepEqual(cornerCurrents(updated),[220,220,220]);
});
