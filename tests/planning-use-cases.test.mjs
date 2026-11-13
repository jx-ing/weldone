import test from 'node:test';
import assert from 'node:assert/strict';
import {MIXED_SCAN_FIELDS,settingsDefaults,serializeSettings,SETTINGS_TABS,updateProjectPlanning,useCaseSettingsErrors,useCaseSettingsIssues,wrapChoice,resolveEndpointPose} from '../src/planningSettingsModel.mjs';
import {planningSettingsErrors,planningSettingsIssues,geometryOptionsForPlanning} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,convertGeometryPlan,mergeFeatureWithinSize} from '../src/geometryProcessingModel.mjs';

test('工艺规划设置可保存并兼容旧项目配置',()=>{
 assert.deepEqual(SETTINGS_TABS.map(v=>v[1]),["全局焊脚设置","拓扑调整","路径设置","跟踪设置","测量参数设置"]);
 const baseline={intermittentParameters:{enabled:true},splitParameters:{enabled:true,length:100,gapThreshold:25},visionParameters:{twoFaceSpeed:123},samplingAvoidance:{enabled:false,step:7},custom:'保留'};
 const draft=settingsDefaults(baseline);draft.wrapParameters.flatEnabled=false;
 const saved=serializeSettings(draft);
 assert.equal('intermittentParameters' in saved,false);
 assert.deepEqual(saved.splitParameters,{gapThreshold:25,edgeThreshold:null,autoDeleteUnavoidable:true,rulesVersion:3});
 assert.equal(saved.visionParameters,undefined);
 assert.equal(saved.samplingAvoidance,undefined);
 assert.equal(saved.custom,'保留');
 assert.equal(saved.wrapParameters.flatEnabled,false);
 assert.deepEqual(baseline.visionParameters,{twoFaceSpeed:123});
});
test('从表单提交的参数按数值保存并传给几何处理，旧偏移仍可回退',()=>{
 const draft=settingsDefaults({actionParameters:{liftHeight:125},precisionParameters:{laserPose:{x:-1}}});
 assert.equal(draft.actionParameters.safeTransitionOffset.z,125);
 Object.assign(draft.actionParameters,{lineStep:'7',arcStep:'3',edgeSearchDistance:'19'});
 draft.actionParameters.safeTransitionOffset.y='55';
 draft.precisionParameters.laserPose.advance='-24.5';
 draft.precisionParameters.arcSweepSpeed='72.5';
 draft.mergeParameters.countEnabled=true;
 draft.mergeParameters.count='4';
 draft.sequenceParameters={scanDirection:['-1','2','0']};
 draft.localMatchDistance='86.5';
 const saved=serializeSettings(draft);
 assert.deepEqual(useCaseSettingsErrors(saved),[]);
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);
 assert.deepEqual(options.actionParameters.safeTransitionOffset,{x:0,y:55,z:125});
 assert.deepEqual([options.actionParameters.lineStep,options.actionParameters.arcStep,options.actionParameters.edgeSearchDistance,options.maxMergeCount],[7,3,19,4]);
 assert.deepEqual([saved.precisionParameters.laserPose.x,saved.precisionParameters.laserPose.advance,saved.precisionParameters.arcSweepSpeed],[-1,-24.5,72.5]);
 assert.deepEqual(saved.sequenceParameters.scanDirection,[-1,2,0]);
 assert.equal(saved.localMatchDistance,86.5);
 draft.sequenceParameters.scanDirection=['','1',''];
 assert.match(useCaseSettingsErrors(serializeSettings(draft)).join(''),/扫描方向/);
});
test('混合焊缝扫描五项按项目保存，保留旧配置的其他字段',()=>{
 const draft=settingsDefaults({precisionParameters:{mixedScan:{custom:42}}});
 const scan=draft.precisionParameters.mixedScan;
 draft.precisionParameters.structuredLightMixedScan.scanDistance='9.25';
 for(const [index,[key]] of MIXED_SCAN_FIELDS.entries())scan[key]=String(index+0.5);
 const settings=serializeSettings(draft);
 assert.deepEqual(settings.precisionParameters.mixedScan,{custom:42,arcPointDistance:.5,linePointDistance:1.5,endClearance:2.5,minWeldLength:3.5,scanDistance:4.5});
 assert.deepEqual(useCaseSettingsErrors(settings),[]);
 assert.equal(settings.precisionParameters.structuredLightMixedScan.scanDistance,9.25);
 const workspace={project:'项目A',planningSettings:{},welds:[]};
 const updated=updateProjectPlanning(workspace,{planningSettings:settings});
 assert.deepEqual(updated.projectPlanning['项目A'].planningSettings.precisionParameters.mixedScan,settings.precisionParameters.mixedScan);
 scan.scanDistance='';
 assert.equal(serializeSettings(draft).precisionParameters.mixedScan.scanDistance,null);
 scan.scanDistance='-1';
 assert.match(useCaseSettingsErrors(serializeSettings(draft)).join(''),/扫描距离/);
});
test('用例默认值和空值回退，设备默认已配置，明确无配置时关闭跟踪',()=>{
 const d=serializeSettings(settingsDefaults());
 assert.deepEqual(d.actionParameters.safeTransitionOffset,{x:0,y:50,z:100});assert.deepEqual(d.actionParameters.safeApproachOffset,{x:0,y:20,z:40});assert.equal(d.actionParameters.lineStep,5);assert.equal(d.actionParameters.arcStep,2);assert.equal(d.precisionParameters.lineSweepSpeed,150);assert.equal(d.precisionParameters.arcSweepSpeed,70);
 assert.equal(d.actionParameters.liftHeight,100);assert.equal(d.actionParameters.externalAxisLength,1500);
 assert.equal(d.wrapParameters.independentLength,30);assert.equal(d.wrapParameters.passHoleThreshold,35);assert.equal(d.wrapParameters.gapThreshold,350);
 assert.equal(d.mergeParameters.angleMin,60);assert.equal(d.mergeParameters.angleMax,120);assert.equal(d.mergeParameters.passHoleSize,15);assert.equal(d.mergeParameters.maxLength,1500);assert.equal(d.intermittentParameters,undefined);
 assert.deepEqual(d.trackingParameters,{laserEnabled:true,arcEnabled:true,minLineLength:160,minArcDiameter:160,minEdgeWidth:10,rulesVersion:2});
 assert.equal(d.visionParameters,undefined);assert.equal(d.splitParameters.gapThreshold,null);
 d.wrapParameters.independentLength='';d.interferenceEndParameters.startDistance='';d.interferenceEndParameters.startAngle='';
 const saved=serializeSettings(d);assert.equal(saved.wrapParameters.independentLength,30);assert.equal(saved.interferenceEndParameters.startDistance,35);assert.equal(saved.interferenceEndParameters.startAngle,38);
 const absent=settingsDefaults({}, {laserTracking:false,arcTracking:false});assert.equal(absent.trackingParameters.laserEnabled,false);assert.equal(absent.trackingParameters.arcEnabled,false);
 assert.deepEqual([...planningSettingsErrors(saved),...useCaseSettingsErrors(saved)],[]);
});
test('项目参数独立持久化，新建项目不复制当前参数，返回和重命名后恢复原设置',()=>{
 const source={project:'项目A',templateProjects:['项目A','项目B'],workpieceType:'小组立',planningSettings:{actionParameters:{liftHeight:123}},welds:[{id:'W001',planned:true}]},copy=structuredClone(source);
 let next=updateProjectPlanning(source,{project:'项目B'});assert.deepEqual(next.planningSettings,{});assert.equal(next.workpieceType,'');assert.equal(next.welds[0].planned,false);
 next=updateProjectPlanning(next,{planningSettings:{actionParameters:{liftHeight:234}},workpieceType:'中组立'});
 next=updateProjectPlanning(next,{project:'项目A'});assert.equal(next.planningSettings.actionParameters.liftHeight,123);assert.equal(next.workpieceType,'小组立');
 next=updateProjectPlanning(next,{project:'项目A改名',templateProjects:['项目A改名','项目B']});assert.equal(next.planningSettings.actionParameters.liftHeight,123);
 next=updateProjectPlanning(JSON.parse(JSON.stringify(next)),{project:'项目B'});assert.equal(next.planningSettings.actionParameters.liftHeight,234);assert.equal(next.workpieceType,'中组立');assert.deepEqual(source,copy);
});
test('严格校验新用例整数、一位小数和范围，合并数量不设旧30条上限',()=>{
 for(const mutate of [d=>d.actionParameters.lineStep=0,d=>d.actionParameters.externalAxisLength=1.2,d=>d.wrapParameters.independentLength=1.23,d=>d.wrapParameters.passHoleThreshold=3.5,d=>d.splitParameters.gapThreshold=0,d=>d.interferenceEndParameters.startDistance=-1,d=>d.trackingParameters.minEdgeWidth=1.23,d=>d.mergeParameters.passHoleSize=0,d=>{d.mergeParameters.countEnabled=true;d.mergeParameters.count=1;}]){const d=serializeSettings(settingsDefaults());mutate(d);assert.ok(useCaseSettingsErrors(d).length);}
 const draft=settingsDefaults();draft.mergeParameters={...draft.mergeParameters,countEnabled:true,count:100,angleMin:0,angleMax:360,angleDefinition:'included',lengthEnabled:false,maxLength:-1};
 const saved=serializeSettings(draft);assert.deepEqual([...planningSettingsErrors(saved),...useCaseSettingsErrors(saved)],[]);const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);assert.equal(options.maxMergeCount,100);assert.equal(options.maxMergeLength,undefined);
});
test('合并过焊孔按严格小于阈值，等于15不合并；长度开关独立传递',()=>{
 const saved=serializeSettings(settingsDefaults());saved.mergeParameters.lengthEnabled=true;
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);assert.equal(options.maxMergeLength,1500);assert.equal(options.mergePassHoleInclusive,false);
 const hole={特征类型:'圆',圆类型:'凹圆弧',L1:15,L2:12};assert.equal(mergeFeatureWithinSize(hole,15,false),false);assert.equal(mergeFeatureWithinSize({...hole,L1:14.9},15,false),true);
});
test('包角决策覆盖三面交、两面交、30mm独立焊缝长度和350mm包角间隙',()=>{
 const p=settingsDefaults().wrapParameters,three={position:'PB',junctionType:'三面交',hasHole:true,holeSize:35,plateThickness:29.9},two={...three,junctionType:'两面交',gap:351};
 assert.equal(wrapChoice(three,p),'L形包角');assert.equal(wrapChoice({...three,hasHole:false},p),'不包角');assert.equal(wrapChoice({...three,holeSize:34.9},p),'不包角');assert.equal(wrapChoice({...three,plateThickness:30},p),'不包角');
 assert.equal(wrapChoice(two,p),'U形包角');assert.equal(wrapChoice({...two,plateThickness:36},p),'U形包角');assert.equal(wrapChoice({...two,hasHole:false},p),'U形包角');assert.equal(wrapChoice({...two,gap:349.9},p),'L形包角');assert.equal(wrapChoice({...two,holeSize:34},p),'不包角');
 for(const breakReason of ['间隙打断','过焊孔打断','长度打断','对称打断','避障打断','边缘打断'])assert.equal(wrapChoice({...two,breakReason},p),'不包角');
 assert.equal(wrapChoice(three,{...p,flatEnabled:false}),'不包角');assert.equal(wrapChoice({...three,position:'PB · 平角焊'},{...p,flatEnabled:false}),'不包角');
});
test('干涉端使用单一角度，距离和有符号线偏移可独立保存',()=>{
 const d=settingsDefaults({interferenceEndParameters:{startPose:{advance:15,work:35},endAngle:38.1}});d.actionParameters.flatPose={advance:10,work:45,rotation:0};d.actionParameters.verticalPose={advance:20,work:35,rotation:5};d.interferenceEndParameters.startLineOffset='-2.5';d.interferenceEndParameters.endLineOffset='1.5';d.interferenceEndParameters.startDistance='35';
 assert.deepEqual(resolveEndpointPose(d,'start','PB'),{advance:15,work:45,rotation:0});assert.deepEqual(resolveEndpointPose(d,'end','PF'),{advance:38.1,work:35,rotation:5});
 const values=serializeSettings(d).interferenceEndParameters;
 assert.deepEqual(values,{startAngle:15,endAngle:38.1,startDistance:35,endDistance:35,verticalStartDistance:20,startLineOffset:-2.5,endLineOffset:1.5});
 assert.deepEqual(planningSettingsErrors({interferenceEndParameters:values}),[]);
 assert.match(planningSettingsErrors({interferenceEndParameters:{...values,endAngle:361}}).join(''),/终点姿态/);
});

test('转角合并必须有有效交点，间隙与延长距离按独立条件检查',()=>{
 const member=(id,points)=>({key:id,id,weldId:id,subIndex:0,weldingPosition:'PB',points,length:10,焊脚:6});
 const a=member('A',[[0,0,0],[10,0,0]]),b=member('B',[[12,3,0],[12,13,0]]);
 const draft=settingsDefaults({topologyVersion:1,mergeParameters:{angleMin:80,angleMax:100,gapThreshold:3.1}});
 const rows=(right,changes={})=>{
  const members=[a,right];
  const data={weldsData:{welds:members.map(item=>({id:item.id,properties:{坡口:{类型:'无坡口'}}}))}};
  const plan={splits:new Map(),merges:{units:members,mergedUnitKeys:new Set(['A','B']),groups:[{id:'M1',members,totalLength:20,closed:false,connections:[]}]}};
  const settings=serializeSettings({...draft,mergeParameters:{...draft.mergeParameters,...changes}});
  return convertGeometryPlan(data,plan,geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,settings));
 };
 assert.equal(rows(b)[0].topology,'corner');
 assert.equal(rows(b,{gapThreshold:3}).length,2);
 assert.equal(rows(b,{gapThreshold:3,grooveEnabled:false}).length,1);
 assert.equal(rows(b,{flatContactGap:4}).length,2);
 assert.equal(rows(b,{angleMin:100,angleMax:120}).length,2);
 assert.equal(rows(member('B',[[12,3,1],[12,13,1]]),{grooveEnabled:false}).length,2);
});

test('设置校验定位跨页字段，逐项修正或停用规则后清除对应错误',()=>{
 const draft=settingsDefaults({topologyVersion:1});
 const validate=()=>{
  const settings=serializeSettings(draft);
  return [...planningSettingsIssues(settings),...useCaseSettingsIssues(settings)].map(issue=>issue.field);
 };
 draft.mergeParameters.angleMin=130;
 draft.actionParameters.lineStep=0;
 draft.wrapParameters.flatLPose.advance=361;
 assert.deepEqual(validate(),['mergeParameters.angleMin','actionParameters.lineStep','wrapParameters.flatLPose.advance']);
 draft.mergeParameters.enabled=false;
 draft.wrapParameters.flatEnabled=false;
 assert.deepEqual(validate(),['actionParameters.lineStep']);
 assert.equal(serializeSettings(draft).mergeParameters.angleMin,130);
 assert.equal(serializeSettings(draft).wrapParameters.flatLPose.advance,361);
 draft.actionParameters.lineStep=6;
 assert.deepEqual(validate(),[]);
 draft.mergeParameters.enabled=true;
 assert.deepEqual(validate(),['mergeParameters.angleMin']);
});
