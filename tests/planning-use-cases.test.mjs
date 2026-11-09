import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsDefaults,serializeSettings,visibleSettingsTabs,updateProjectPlanning,useCaseSettingsErrors,wrapChoice,resolveEndpointPose} from '../src/planningSettingsModel.mjs';
import {planningSettingsErrors,geometryOptionsForPlanning,samplingAvoidanceValues} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,mergeFeatureWithinSize} from '../src/geometryProcessingModel.mjs';
import {intermittentRanges,avoidIntermittentCornerBoundaries} from '../src/planningPathSettings.mjs';

test('操作模式仅有四类设置，调试模式有九类；保存操作参数不会覆盖隐藏参数',()=>{
 assert.deepEqual(visibleSettingsTabs('operation').map(v=>v[1]),['包角设置','间断焊设置','焊缝合并设置','焊缝打断设置']);
 assert.deepEqual(visibleSettingsTabs('debug').map(v=>v[1]),["全局焊接设置","包角设置","间断焊设置","端点变姿态设置","视觉设置","采样避障设置","焊缝合并设置","焊缝打断设置"]);
 const baseline={visionParameters:{twoFaceSpeed:123},samplingAvoidance:{enabled:false,step:7},custom:'保留'};
 const draft=settingsDefaults(baseline);draft.visionParameters.twoFaceSpeed=999;draft.wrapParameters.flatEnabled=false;
 const saved=serializeSettings(draft,baseline,'operation');
 assert.deepEqual(saved.visionParameters,baseline.visionParameters);assert.deepEqual(saved.samplingAvoidance,baseline.samplingAvoidance);assert.equal(saved.custom,'保留');assert.equal(saved.wrapParameters.flatEnabled,false);assert.deepEqual(baseline.visionParameters,{twoFaceSpeed:123});
});
test('用例默认值和空值回退，设备默认已配置，明确无配置时关闭跟踪',()=>{
 const d=serializeSettings(settingsDefaults());
 assert.equal(d.actionParameters.liftHeight,100);assert.equal(d.actionParameters.externalAxisLength,1500);
 assert.equal(d.wrapParameters.independentLength,30);assert.equal(d.wrapParameters.passHoleThreshold,35);assert.equal(d.wrapParameters.gapThreshold,null);
 assert.equal(d.mergeParameters.passHoleSize,15);assert.equal(d.mergeParameters.maxLength,1500);assert.equal(d.intermittentParameters.weldLength,0);assert.equal(d.intermittentParameters.gapLength,0);
 assert.deepEqual(d.trackingParameters,{laserEnabled:true,arcEnabled:true,minLineLength:160,minArcDiameter:160,minEdgeWidth:10,rulesVersion:2});
 assert.equal(d.visionParameters.twoFaceSpeed,null);assert.equal(d.splitParameters.gapThreshold,null);
 d.wrapParameters.independentLength='';d.interferenceEndParameters.startDistance='';d.interferenceEndParameters.startPose.advance='';
 const saved=serializeSettings(d);assert.equal(saved.wrapParameters.independentLength,30);assert.equal(saved.interferenceEndParameters.startDistance,0);assert.equal(saved.interferenceEndParameters.startPose.advance,null);
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
 for(const mutate of [d=>d.actionParameters.liftHeight=0,d=>d.actionParameters.externalAxisLength=1.2,d=>d.wrapParameters.independentLength=1.23,d=>d.wrapParameters.passHoleThreshold=3.5,d=>d.splitParameters.gapThreshold=0,d=>d.interferenceEndParameters.startDistance=-1,d=>d.trackingParameters.minEdgeWidth=1.23,d=>d.mergeParameters.passHoleSize=0,d=>{d.mergeParameters.countEnabled=true;d.mergeParameters.count=1;}]){const d=serializeSettings(settingsDefaults());mutate(d);assert.ok(useCaseSettingsErrors(d).length);}
 const draft=settingsDefaults();draft.mergeParameters={...draft.mergeParameters,countEnabled:true,count:100,angleMin:0,angleMax:360,angleDefinition:'included',lengthEnabled:false,maxLength:-1};
 const saved=serializeSettings(draft);assert.deepEqual([...planningSettingsErrors(saved),...useCaseSettingsErrors(saved)],[]);const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);assert.equal(options.maxMergeCount,100);assert.equal(options.maxMergeLength,undefined);
});
test('合并过焊孔按严格小于阈值，等于15不合并；长度开关独立传递',()=>{
 const saved=serializeSettings(settingsDefaults());saved.mergeParameters.lengthEnabled=true;
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);assert.equal(options.maxMergeLength,1500);assert.equal(options.mergePassHoleInclusive,false);
 const hole={特征类型:'圆',圆类型:'凹圆弧',L1:15,L2:12};assert.equal(mergeFeatureWithinSize(hole,15,false),false);assert.equal(mergeFeatureWithinSize({...hole,L1:14.9},15,false),true);
});
test('采样总开关和步长在子参数编辑后保留，禁用轴可保留原范围',()=>{
 const d=settingsDefaults();d.samplingAvoidance.enabled=false;d.samplingAvoidance.step=5;d.samplingAvoidance.advance.min=90;d.samplingAvoidance.advance.max=-90;
 const child=samplingAvoidanceValues(d.samplingAvoidance);assert.equal(child.enabled,false);assert.equal(child.step,5);
 const saved=serializeSettings(d);assert.deepEqual(planningSettingsErrors(saved),[]);saved.samplingAvoidance.enabled=true;assert.ok(planningSettingsErrors(saved).some(e=>e.includes('最小值')));
});
test('包角决策覆盖三面交、两面交、35mm板厚和50mm间隙的已确认阈值',()=>{
 const p=settingsDefaults().wrapParameters,three={position:'PB',junctionType:'三面交',hasHole:true,holeSize:35,plateThickness:35},two={...three,junctionType:'两面交',gap:51};
 assert.equal(wrapChoice(three,p),'L形包角');assert.equal(wrapChoice({...three,hasHole:false},p),'不包角');assert.equal(wrapChoice({...three,holeSize:34.9},p),'不包角');assert.equal(wrapChoice({...three,plateThickness:35.1},p),'不包角');
 assert.equal(wrapChoice(two,p),'U形包角');assert.equal(wrapChoice({...two,plateThickness:36},p),'U形包角');assert.equal(wrapChoice({...two,hasHole:false},p),'U形包角');assert.equal(wrapChoice({...two,gap:49.9},p),'L形包角');assert.equal(wrapChoice({...two,holeSize:34},p),'不包角');
 for(const breakReason of ['间隙打断','过焊孔打断','长度打断','对称打断'])assert.equal(wrapChoice({...two,breakReason},p),'不包角');
 assert.equal(wrapChoice(three,{...p,flatEnabled:false}),'不包角');assert.equal(wrapChoice({...three,position:'PB · 平角焊'},{...p,flatEnabled:false}),'不包角');
});
test('干涉端空姿态继承对应标准姿态，各轴覆盖和距离互不干扰',()=>{
 const d=settingsDefaults();d.actionParameters.flatPose={advance:10,work:45,rotation:0};d.actionParameters.verticalPose={advance:20,work:35,rotation:5};d.interferenceEndParameters.startPose.advance=15;
 assert.deepEqual(resolveEndpointPose(d,'start','PB'),{advance:15,work:45,rotation:0});assert.deepEqual(resolveEndpointPose(d,'end','PF'),{advance:20,work:35,rotation:5});
});
test('新版均分间断焊固定距离依次布置，不处理剩余尾段，零参数保留连续路径',()=>{
 const p={mode:'uniform',weldLength:50,gapLength:50,distributionVersion:2};
 assert.deepEqual(intermittentRanges(320,p),[[0,50],[100,150],[200,250]]);
 assert.deepEqual(intermittentRanges(320,{...p,weldLength:0}),[[0,320]]);assert.deepEqual(intermittentRanges(320,{...p,gapLength:0}),[[0,320]]);
 const ends=intermittentRanges(320,{...p,mode:'endWeld'});assert.deepEqual(ends[0],[0,50]);assert.deepEqual(ends.at(-1),[270,320]);
});
test('间断焊在真实拐角边界处合并，直线段连接处不额外合并',()=>{
 const seg=(a,b)=>({pathPoints:[a,b]});const ranges=[[0,100],[200,300]];
 assert.deepEqual(avoidIntermittentCornerBoundaries(ranges,[seg([0,0,0],[100,0,0]),seg([100,0,0],[100,200,0])]),[[0,300]]);
 assert.deepEqual(avoidIntermittentCornerBoundaries(ranges,[seg([0,0,0],[100,0,0]),seg([100,0,0],[300,0,0])]),ranges);assert.deepEqual(ranges,[[0,100],[200,300]]);
});
