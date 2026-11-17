import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {weldTorchAxis} from '../src/templatePassOffsets.mjs';
import {newTemplate,newWholeTemplateFromWeld,matchTemplate,migrateDraft,POSITIONS} from '../src/templateModel.mjs';
import {geometryRulesFromWeld,shortSegmentRange} from '../src/templateGeometryRules.mjs';
import {ensureProcessLayers,newProcessEntry,addProcessPass,updateProcessPass,validateProcessEntry} from '../src/processParameterModel.mjs';
import {sharedCornerPoint,sharedCornerPointChanges} from '../src/processFeaturePoints.mjs';
import {analyzeWeldMatch,planWorkspace,canPreviewWeld} from '../src/weldMatching.mjs';
import {defaultWeldPosePreview,generateStrategyPlan} from '../src/strategyPlanning.mjs';
import {settingsDefaults,serializeSettings,updateProjectPlanning} from '../src/planningSettingsModel.mjs';
import {excludeVerifiedCollision,prepareStrategyGeometry} from '../src/strategyGeometry.mjs';
import {planeSplitStations,multiSplitPreview,splitWeldPreview} from '../src/manualSplitModel.mjs';
import {recipeConflicts,deviceLibraryUpdates,restoreDeviceLibrary,clearRemovedProcess} from '../src/processDeviceLibraries.mjs';
import {weldLayerLayout,weldLayerTreeGroups,weldLayerPassPaths,updateWeldLayoutPoint,weldPointPlacement,copyWeldLayersToTemplate} from '../src/weldLayerLayout.mjs';

import {directedWeld} from '../src/weldDirectionGeometry.mjs';

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

test('没匹配工艺参数时可用当前设置预览平角焊和立焊的实际机头姿态',()=>{
 const flat=source();
 const verticalPosition='PF · 立向上焊';
 const upright={...source('PF01'),position:verticalPosition,segments:[{
  ...segment(0,100),position:verticalPosition,pathPoints:[[0,0,0],[0,0,100]],referenceNormal:[1,0,0]
 }]};
 const settings={...config,topologyVersion:1,actionParameters:{
  flatPose:{advance:8,work:30,rotation:15},verticalPose:{advance:-6,work:54,rotation:9}
 }};
 for(const [weld,key] of [[flat,'flatPose'],[upright,'verticalPose']]){
  const expected=settings.actionParameters[key];
  const decision=analyzeWeldMatch(weld,[],[],settings);
  assert.equal(decision.ready,false);
  const layout=weldLayerLayout(weld,decision,[],[],settings);
  const preview=defaultWeldPosePreview(weld,settings);
  const [path]=weldLayerPassPaths({...weld,speed:300},layout,preview,undefined,null);
  const [pose]=path.posesAt(50);
  assert.deepEqual(pose.angles,expected);
  assert.equal(path.speedAt(50),null);
  assert.deepEqual(weldLayerTreeGroups(weld,layout,null,preview)[0].points.at(-1).pose,expected);
  const changed=defaultWeldPosePreview(weld,{...settings,actionParameters:{
   ...settings.actionParameters,[key]:{...expected,work:expected.work+10}
  }});
  const [updated]=weldLayerPassPaths(weld,layout,changed);
  assert.notDeepEqual(updated.posesAt(50)[0].head.quaternion,pose.head.quaternion);
  const [planned]=planWorkspace([weld],[],[],settings);
  assert.equal(planned.strategyPlan.settingsOnly,true);
  assert.equal(planned.matchPlan.ready,false);
  assert.equal(canPreviewWeld(planned),true);
  assert.equal(planned.planned,false);
  assert.deepEqual(planned.strategyPlan.passes,preview.passes);
 }
});

test('立焊起点只取平角焊工作角，过渡内保持立焊前进角和旋转角',()=>{
 const position='PF · 立向上焊';
 const weld={...source(),position,segments:[{
  ...segment(0,100),position,pathPoints:[[0,0,0],[0,0,100]],referenceNormal:[1,0,0]
 }]};
 const flatPose={advance:12,work:32,rotation:90};
 const verticalPose={advance:-8,work:65,rotation:35};
 const settings={...config,topologyVersion:1,actionParameters:{flatPose,verticalPose,lineStep:5},
  interferenceEndParameters:{verticalStartDistance:22}};
 const process={...recipe(),position};
 const [planned]=planWorkspace([weld],[],[process],settings);
 const points=planned.strategyPlan.passes[0].points;
 for(const point of points.filter(point=>point.distance<=22)){
  const work=32+33*point.distance/22;
  assert.deepEqual(point.pose,{...verticalPose,work});
 }
 assert.equal(points.find(point=>point.distance===22).pose.work,65);
 const layout=weldLayerLayout(planned,undefined,[],[process],settings);
 const [path]=weldLayerPassPaths(planned,layout,planned.strategyPlan,undefined,planned.processParameters);
 assert.deepEqual(path.posesAt(0)[0].angles,{...verticalPose,work:32});
 assert.deepEqual(path.posesAt(10)[0].angles,{...verticalPose,work:47});
 assert.deepEqual(path.posesAt(50)[0].angles,verticalPose);
 const unset={...settings,actionParameters:{...settings.actionParameters,flatPose:{...flatPose,work:null}}};
 assert.deepEqual(generateStrategyPlan(weld,process,unset).passes[0].points[0].pose,verticalPose);
 assert.deepEqual(defaultWeldPosePreview(weld,unset).passes[0].points[0].pose,verticalPose);
 const custom={...settings,interferenceEndParameters:{verticalStartDistance:20,
  verticalStartPose:{advance:12,work:25,rotation:-25}}};
 const [withCustomStart]=planWorkspace([weld],[],[process],custom);
 const [previewPath]=weldLayerPassPaths(withCustomStart,weldLayerLayout(withCustomStart,undefined,[],[process],custom),
  withCustomStart.strategyPlan,undefined,withCustomStart.processParameters);
 assert.deepEqual(previewPath.posesAt(0)[0].angles,{advance:12,work:25,rotation:-25});
 assert.deepEqual(previewPath.posesAt(10)[0].angles,{advance:2,work:45,rotation:5});
 assert.deepEqual(previewPath.posesAt(20)[0].angles,verticalPose);
 assert.deepEqual(defaultWeldPosePreview(weld,custom).passes[0].points[0].pose,{advance:12,work:25,rotation:-25});
});

test('工艺设置先生成 L 形包角，匹配整道模板后保留路径并覆盖模板点位和姿态',()=>{
 const main={...segment(0,100),endWrapKind:'L'};
 const wrap={...segment(0,6),pathPoints:[[100,0,0],[100,6,0]],length:6,
  strategyRole:'wrap',strategyWrapKind:'L',startWrapKind:'L'};
 const weld={...source(),segments:[main,wrap],length:106,cornerAngles:[90],topology:'L'};
 const options={...config,topologyVersion:1,weldPreprocessing:{},actionParameters:{lineStep:5,flatPose:{advance:8,work:30,rotation:15}}};
 const [base]=planWorkspace([weld],[],[],options);
 assert.ok(base.strategyPlan.passes[0].points.some(point=>point.kind==='wrap'));
 const template={...newWholeTemplateFromWeld('111.step',[weld],weld.id),name:'L 形包角覆盖'};
 const start=template.layers[0].passes[0].points[0];
 start.offset.z=2;
 start.angles={advance:13,work:44,rotation:19};
 const [covered]=planWorkspace([weld],[template],[],options);
 assert.equal(covered.matchPlan.route,'whole',JSON.stringify(analyzeWeldMatch(weld,[template],[],options).templateFailures));
 const geometry=w=>w.segments.map(s=>[s.pathPoints,s.strategyWrapKind]);
 assert.deepEqual(geometry(covered),geometry(base));
 assert.deepEqual(covered.strategyPlan.passes,base.strategyPlan.passes);
 const layout=weldLayerLayout(covered,undefined,[template],[],options);
 const [pass]=weldLayerPassPaths(covered,layout,covered.strategyPlan);
 assert.deepEqual(pass.posesAt(pass.startStation)[0].position,[0,0,2]);
 assert.deepEqual(pass.posesAt(pass.startStation)[0].angles,start.angles);
 assert.ok(pass.sampleStations.length>2);
});

test('匹配工艺中的每道 Y/Z 偏移直接用于工艺规划界面，并保留本地点位修改',()=>{
 const w=source();
 let p=recipe();
 const layerId=p.processLayers[0].id;
 p=addProcessPass(p,layerId);
 const [first,second]=p.processLayers[0].passes;
 p=updateProcessPass(p,first.id,{offset:{y:2,z:3}});
 p=updateProcessPass(p,second.id,{offset:{y:-4,z:7}});
 const decision=analyzeWeldMatch(w,[],[p],config);
 assert.equal(decision.process.id,p.id);
 const previous=weldLayerLayout(w,{ready:false},[],[],config);
 const [base]=previous[0].passes;
 w.pointLayout=updateWeldLayoutPoint(previous,base.id,{id:base.points[0].id,offset:{x:5,y:0,z:0}});
 const layout=weldLayerLayout(w,decision,[],[p],config);
 const groups=weldLayerTreeGroups(w,layout,p);
 assert.deepEqual(groups.map(group=>[group.passOffset.y,group.passOffset.z]),[[2,3],[-4,7]]);
 assert.deepEqual(groups.map(group=>group.points[0].position),[[5,2,3],[5,-4,7]]);
 assert.deepEqual(weldLayerPassPaths(w,layout).map(pass=>pass.positions[0]),[[5,2,3],[5,-4,7]]);
 assert.deepEqual(weldLayerLayout({...w,pointLayout:layout},decision,[],[p],config),layout);
});

test('点位显示轨迹姿态并叠加本道和点位偏移',()=>{
 const w={...source(),endpointFacts:{start:{junctionType:'三面交',hasHole:false}}};
 let p=recipe();
 p=addProcessPass(p,p.processLayers[0].id);
 const [first,second]=p.processLayers[0].passes;
 p=updateProcessPass(p,first.id,{angles:{...first.angles,pushPull:12,pitch:38},offset:{y:0,z:0,work:2,wire:5}});
 p=updateProcessPass(p,second.id,{angles:{...second.angles,pushPull:8,pitch:55},offset:{y:0,z:0,advance:3,wire:5}});
 const options={...config,actionParameters:{flatPose:{rotation:7}},interferenceEndParameters:{startAngle:25,startDistance:20}};
 const decision=analyzeWeldMatch(w,[],[p],options);
 const layout=weldLayerLayout(w,decision,[],[p],options);
 const plan=generateStrategyPlan(w,p,options);
 const groups=weldLayerTreeGroups(w,layout,p,plan);
 assert.deepEqual(groups.map(group=>group.points[0].pose),[
  {advance:25,work:40,rotation:7},{advance:28,work:55,rotation:7}
 ]);
 assert.deepEqual(groups.map(group=>group.points.at(-1).pose),[
  {advance:12,work:40,rotation:7},{advance:11,work:55,rotation:7}
 ]);
 const [group]=groups,[point]=group.points;
 const preview=updateWeldLayoutPoint(layout,group.id,{id:point.raw.id,offset:{x:10,y:0,z:0},poseOffset:{advance:6,work:0,rotation:20}});
 const placement=weldPointPlacement(w,preview,group.id,point.raw.id,false,plan);
 assert.deepEqual(placement.angles,{advance:24.5,work:40,rotation:27});
 assert.deepEqual(weldLayerTreeGroups(w,preview,p,plan)[0].points[0].pose,placement.angles);
 assert.deepEqual(weldLayerPassPaths(w,preview,plan)[0].positions[0],placement.position);
 assert.deepEqual(copyWeldLayersToTemplate({},preview,w,p,plan).points[0].angles,placement.angles);
});

test('一键规划按焊接位置应用标准姿态，轨迹与点位使用同一个 TCP 轴',()=>{
 const flat=source();
 const verticalPosition='PF · 立向上焊';
 const upright={...source('W002'),position:verticalPosition,segments:[{
  ...segment(0,100),position:verticalPosition,pathPoints:[[0,0,0],[0,0,100]],referenceNormal:[1,0,0]
 }]};
 const flatPose={advance:0,work:34,rotation:20},verticalPose={advance:-8,work:62,rotation:35};
 const options={...config,topologyVersion:1,actionParameters:{flatPose,verticalPose,lineStep:5}};
 const recipeWithAngles=recipe();
 const first=recipeWithAngles.processLayers[0].passes[0];
 const p=updateProcessPass(recipeWithAngles,first.id,{angles:{pushPull:15,pitch:50}});
 const recipes=[p,{...p,id:'upright',position:verticalPosition}];
 const planned=planWorkspace([flat,upright],[],recipes,options);
 for(const [w,expected] of [[planned[0],flatPose],[planned[1],verticalPose]]){
  const [pass]=w.strategyPlan.passes;
  const end=pass.points.at(-1);
  assert.deepEqual(end.pose,expected);
  assert.deepEqual(pass.points.find(point=>point.distance===50).pose,expected);
  const layout=weldLayerLayout(w,undefined,[],recipes,options);
  const point=weldLayerTreeGroups(w,layout,w.processParameters)[0].points.at(-1);
  assert.deepEqual(point.pose,expected);
  const axis=new Vector3(0,0,1).applyQuaternion(new Quaternion(...end.orientation));
  assert.ok(axis.distanceTo(new Vector3(...weldTorchAxis(point.tangent,point.normal,point.pose)))<1e-9);
  const rollChanged=generateStrategyPlan(w,w.processParameters,{...options,actionParameters:{
   ...options.actionParameters,flatPose:{...flatPose,rotation:0},verticalPose:{...verticalPose,rotation:0}
  }}).passes[0].points.at(-1);
  assert.deepEqual(rollChanged.position,end.position);
  assert.notDeepEqual(rollChanged.orientation,end.orientation);
  assert.ok(axis.distanceTo(new Vector3(0,0,1).applyQuaternion(new Quaternion(...rollChanged.orientation)))<1e-9);
 }
});

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
 assert.match(templateOnly.reason,/需匹配焊接模板覆盖工艺/);
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
 assert.equal(parts[0].endpointFacts.end.type,null);
 assert.equal(parts[0].endpointFacts.end.breakReason,'避障打断');
});

test('U 形包角只连接两条具有同一板件和成对边缘证据的焊缝',()=>{
 const facts=side=>({junctionType:'两面交',gap:55,plateThickness:6,offsetDirection:[0,side,0]});
 const a={...source('W001',0),endpointFacts:{end:facts(1)}},b={...source('W002',6),endpointFacts:{end:facts(-1)}};
 const result=prepareStrategyGeometry([a,b],{wrapParameters:{gapThreshold:50}});
 assert.equal(result.length,1);
 assert.equal(result[0].segments[1].strategyRole,'wrap');
 assert.deepEqual(result[0].segments[1].pathPoints,[[100,0,0],[100,6,0]]);
 const split=splitWeldPreview(result[0],103);
 assert.deepEqual([split.pieces[0].at(-1).strategyWrapKind,split.pieces[1][0].strategyWrapKind],['L','L']);
 assert.equal(prepareStrategyGeometry([a,{...b,machineCount:2}],{wrapParameters:{gapThreshold:50}}).length,2);
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

test('旧填充设置和配方不会在新轨迹生成填充点位',()=>{
 const vertical='PF · 立向上焊';
 const weld={...source(),position:vertical,segments:[{...segment(0,100),position:vertical,pathPoints:[[0,0,0],[0,0,100]],referenceNormal:[1,0,0]}],
  endpointFacts:{start:{type:'三面交过焊孔',holeSize:6,offsetDirection:[1,0,0]}}};
 const settings={...config,wrapParameters:{fillEnabled:true,fillHoleSize:10,fillOffset:3}};
 const p={...recipe(),position:vertical};
 const id=p.processLayers[0].passes[0].id;
 const legacy=updateProcessPass(p,id,{crater:{enabled:true,distance:10},holeFill:{current:230,speed:250,time:1.25}});
 const [result]=planWorkspace([weld],[],[legacy],settings);
 const [pass]=result.strategyPlan.passes;
 assert.equal(pass.points[0].kind,'start');
 assert.deepEqual(pass.points[0].parameters,{current:210,voltage:24,time:.5});
 assert.equal(pass.points.at(-1).kind,'end');
 assert.ok(!pass.points.some(point=>['crater','holeFill'].includes(point.kind)));
 assert.ok(!Object.hasOwn(pass,'crater'));
 assert.ok(!Object.hasOwn(result.processParameters,'holeFill'));
 assert.ok(!Object.hasOwn(result.processParameters,'crater'));
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
 const revised=updateProcessPass(mixed,id,{...sharedCornerPointChanges(pass,'inner',{...sharedCornerPoint(pass,'inner'),current:220}),cornerOffsets:{inner:2,outer:null}});
 assert.deepEqual(revised.cornerParameters.outer,points);
 const [updated]=planWorkspace([weld],[],[revised],config);
 assert.deepEqual(cornerCurrents(updated),[220,220,220]);
 const cornerPoint=updated.strategyPlan.passes[0].points.find(point=>point.kind==='corner'&&point.distance===100);
 assert.ok(Math.abs(cornerPoint.position[0]-(100+Math.SQRT2))<1e-6);
 assert.ok(Math.abs(cornerPoint.position[1]+Math.SQRT2)<1e-6);
});

test('激光跟踪在边缘距离不足的区间内关闭并在区间后恢复',()=>{
 const w=source();
 w.segments[0].laserTrackingClearance={threshold:10,blocked:[[[30,0,0],[60,0,0]]]};
 const [planned]=planWorkspace([w],[],[recipe()],{...config,trackingParameters:{laserEnabled:true,arcEnabled:false,minLineLength:50,minEdgeWidth:10}});
 const points=planned.strategyPlan.passes[0].points;
 assert.equal(points.find(point=>point.distance===30).tracking,'无跟踪');
 assert.equal(points.find(point=>point.distance>60).tracking,'激光跟踪');
});

test('自由板端按所在焊缝段长度与间隙过滤，外角最小空间不比较边缘距离',()=>{
 const a={...source('W001'),length:20,segments:[segment(0,20)],endpointFacts:{end:{boundaryKind:'free-edge',junctionType:'两面交',gap:12,mainEdgeDistance:9,plateThickness:6,offsetDirection:[0,1,0]}}};
 const p=recipe(), settings={topologyVersion:1,wrapParameters:{independentLength:20,outerClearance:9}};
 assert.equal(generateStrategyPlan(a,p,settings).endpointActions[1],'L');
 assert.equal(generateStrategyPlan({...a,length:120,segments:[segment(0,100),segment(100,120)]},p,settings).endpointActions[1],'L');
 assert.equal(generateStrategyPlan({...a,length:120.1,segments:[segment(0,100),segment(100,120.1)]},p,settings).endpointActions[1],'none');
 assert.equal(generateStrategyPlan(a,p,{...settings,wrapParameters:{...settings.wrapParameters,outerClearance:12}}).endpointActions[1],'L');
 assert.equal(generateStrategyPlan(a,p,{...settings,wrapParameters:{...settings.wrapParameters,outerClearance:12.01}}).endpointActions[1],'none');
 assert.equal(generateStrategyPlan(a,p,{...settings,wrapParameters:{...settings.wrapParameters,flatEnabled:false}}).endpointActions[1],'none');
 const upright='PF · 立向上焊';
 const vertical={...a,position:upright,segments:[{...a.segments[0],position:upright,pathPoints:[[0,0,0],[0,0,20]],referenceNormal:[1,0,0]}]};
 const plan=generateStrategyPlan(vertical,p,{...settings,wrapParameters:{verticalDistance:8}});
 assert.deepEqual(plan.passes[0].points.find(point=>point.name==='立焊上包角').position,[0,6,20]);
 const custom=generateStrategyPlan(vertical,p,{...settings,wrapParameters:{verticalDistanceCustomRatio:.5,verticalDistanceOffset:1}});
 assert.deepEqual(custom.passes[0].points.find(point=>point.name==='立焊上包角').position,[0,4,20]);
});

test('旧立向下焊草稿迁移为立向上焊，只在高端生成包角',()=>{
 const low=[0,0,0],high=[0,0,100],down='PG · 立向下焊',up='PF · 立向上焊';
 const edge={boundaryKind:'free-edge',junctionType:'两面交',mainEdgeDistance:9,plateThickness:6,offsetDirection:[0,1,0]};
 const segmentDown={...segment(0,100),position:down,pathPoints:[high,low],referenceNormal:[1,0,0],
  startWrapMode:'half',endWrapMode:'full'};
 const legacy={...source(),position:down,direction:'正向',segments:[segmentDown],startWrapMode:'half',endWrapMode:'full',
  endpointFacts:{start:{...edge,label:'高端'},end:{...edge,label:'低端'}},strategyPlan:{passes:[]},planned:true};
 const p={...recipe(),position:down},template=newTemplate('whole',{position:down});
 const migrated=migrateDraft({model:'111.step',welds:[legacy],templates:[template],processLibrary:[p]});
 const [w]=migrated.welds,[process]=migrated.processLibrary;
 assert.equal(POSITIONS.some(value=>value.startsWith('PG')),false);
 assert.equal(w.position,up);
 assert.equal(process.position,up);
 assert.equal(migrated.templates[0].segments[0].position,up);
 assert.equal(w.planned,false);
 const directed=directedWeld(w);
 assert.deepEqual(directed.segments[0].pathPoints,[low,high]);
 assert.equal(directed.endpointFacts.start.label,'低端');
 assert.equal(directed.segments[0].startWrapMode,'none');
 assert.equal(directed.segments[0].endWrapMode,'half');
 const plan=generateStrategyPlan(w,process,{topologyVersion:1,wrapParameters:{verticalDistance:8}});
 assert.deepEqual(plan.endpointActions,['none','vertical']);
 const points=plan.passes[0].points;
 assert.deepEqual(points.find(point=>point.kind==='start').position,low);
 assert.ok(points.filter(point=>point.kind==='wrap').every(point=>point.distance>0));
 assert.deepEqual(points.find(point=>point.name==='立焊上包角').position,[0,6,100]);
 const shortPlan=generateStrategyPlan({...w,length:10,segments:[{...w.segments[0],length:10,pathPoints:[[0,0,10],low]}]},process,{topologyVersion:1});
 assert.ok(shortPlan.passes[0].points.filter(point=>point.kind==='wrap').every(point=>point.distance>0));
});

test('转角默认距离和偏移参与路径，单道显式数值优先',()=>{
 const a=segment(0,100),b={...a,pathPoints:[[100,0,0],[100,100,0]]};
 const weld={...source(),length:200,segments:[a,b]};
 const settings={topologyVersion:1,cornerPathParameters:{before:16,after:13,offset:4}};
 const process=recipe();
 const pass=process.processLayers[0].passes[0];
 const points=generateStrategyPlan(weld,process,settings).passes[0].points;
 const corners=points.filter(point=>point.kind==='corner');
 assert.deepEqual(corners.map(point=>point.distance),[84,100,113]);
 assert.ok(Math.abs(Math.hypot(corners[1].position[0]-100,corners[1].position[1])-4)<1e-6);
 pass.cornerDistances={inner:{before:7,after:null},outer:{before:7,after:null}};
 pass.cornerOffsets={inner:0,outer:0};
 const override=generateStrategyPlan(weld,process,settings).passes[0].points.filter(point=>point.kind==='corner');
 assert.deepEqual(override.map(point=>point.distance),[93,100,113]);
 assert.deepEqual(override[1].position,[100,0,0]);
 const closed={...weld,closure:'closed',length:400,segments:[a,b,{...a,pathPoints:[[100,100,0],[0,100,0]]},{...a,pathPoints:[[0,100,0],[0,0,0]]}]};
 assert.equal(generateStrategyPlan(closed,process,settings).passes[0].points.filter(point=>point.kind==='corner').length,12);
});

test('内角和外角分别保存和使用转角参数，旧共用参数作为初值',()=>{
 const a=segment(0,100),b={...a,pathPoints:[[100,0,0],[100,100,0]]};
 const weld={...source(),length:200,segments:[a,b]};
 const legacy={topologyVersion:1,cornerPathParameters:{before:16,after:13,offset:4}};
 const draft=settingsDefaults(legacy);
 assert.deepEqual(draft.cornerPathParameters.inner,draft.cornerPathParameters.outer);
 draft.cornerPathParameters.outer={before:'9',after:'21',offset:'2'};
 const settings=serializeSettings(draft);
 const planned=side=>generateStrategyPlan(weld,recipe(),{...settings,measureTemplateNeighborhood:{measureCorner:()=>side}})
  .passes[0].points.filter(point=>point.kind==='corner');
 for(const [side,distances,offset] of [['inner',[84,100,113],4],['outer',[91,100,121],2]]){
  const points=planned(side);
  assert.deepEqual(points.map(point=>point.distance),distances);
  assert.ok(Math.abs(Math.hypot(points[1].position[0]-100,points[1].position[1])-offset)<1e-6);
 }
});

test('保存路径步长保留已有规划，重新规划时按新步长生成焊接点',()=>{
 const parameters={...config,topologyVersion:1,actionParameters:{lineStep:5}};
 const process=recipe();
 const welds=planWorkspace([source()],[],[process],parameters);
 const distances=entry=>entry.strategyPlan.passes[0].points.filter(point=>point.kind==='weld').map(point=>point.distance);
 const before=distances(welds[0]);
 assert.ok(before.includes(5));
 const draft=settingsDefaults({topologyVersion:1,actionParameters:{lineStep:20}});
 const saved=updateProjectPlanning({welds,planningSettings:parameters},{planningSettings:serializeSettings(draft)});
 assert.deepEqual(distances(saved.welds[0]),before);
 const [replanned]=planWorkspace([source()],[],[process],{...saved.planningSettings,...config});
 const after=distances(replanned);
 assert.ok(after.includes(20)&&!after.includes(5));
 assert.ok(after.length<before.length);
});

test('禁用直线步长时直线只生成两端，圆弧仍按其步长采样',()=>{
 const settings=serializeSettings(settingsDefaults({topologyVersion:1,actionParameters:{lineStepEnabled:false,lineStep:6,arcStep:10}}));
 assert.equal(settings.actionParameters.lineStepEnabled,false);
 assert.equal(settings.actionParameters.lineStep,6);
 const straight=source();
 straight.endpointFacts={start:{junctionType:'三面交'},end:{junctionType:'三面交'}};
 const points=generateStrategyPlan(straight,recipe(),settings).passes[0].points;
 assert.deepEqual(points.map(point=>[point.kind,point.distance]),[['start',0],['end',100]]);
 const curved={...source(),segments:[{...segment(0,100),geometry:'曲线',pathPoints:[[0,0,0],[50,30,0],[100,0,0]]}]};
 const arc=generateStrategyPlan(curved,recipe(),settings).passes[0].points;
 assert.ok(arc.some(point=>point.kind==='weld'&&point.distance>0&&point.distance<100));
});
