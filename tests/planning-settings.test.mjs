import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeIncludedAngleRange,planningSettingsErrors,geometryOptionsForPlanning} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,convertGeometryPlan,mergeFeatureWithinSize} from '../src/geometryProcessingModel.mjs';
import {mergeWeldPreview} from '../src/manualMergeModel.mjs';
import {settingsDefaults,serializeSettings} from '../src/planningSettingsModel.mjs';
test('旧转角换算为内夹角，明确新内夹角原值传给提取规则，数量禁用不再限组',()=>{
 assert.deepEqual(mergeIncludedAngleRange({angleMin:30,angleMax:75}),{angleMin:105,angleMax:150});
 assert.deepEqual(mergeIncludedAngleRange({angle:45}),{angleMin:135,angleMax:180});
 const mergeParameters={angleDefinition:'included',angleMin:100,angleMax:160,count:2,countEnabled:false,enabled:false,continuousOnly:true};
 assert.deepEqual(mergeIncludedAngleRange(mergeParameters),{angleMin:100,angleMax:160});
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters});
 assert.equal(options.mergeParams.夹角阈值下限,100);assert.equal(options.mergeParams.夹角阈值上限,160);assert.equal(options.maxMergeCount,undefined);assert.equal(options.automaticMerge,false);assert.equal(options.continuousOnly,true);
});
test('旧草稿的间断焊与长度打断配置不影响提取，保留间隙和边缘阈值',()=>{
 const legacy={intermittentParameters:{enabled:true,position:'PF',weldLength:-1},splitParameters:{enabled:true,length:0,gapThreshold:45,edgeThreshold:12}};
 assert.deepEqual(planningSettingsErrors(legacy),[]);
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,legacy);
 assert.equal(options.intermittentParameters,undefined);
 assert.deepEqual(options.splitParameters,{gapThreshold:45,edgeThreshold:12});
 assert.equal(options.offsetThreshold,45);
 for(const settings of [{wrapParameters:{independentLength:-1}},{mergeParameters:{countEnabled:true,count:null}}])assert.ok(planningSettingsErrors(settings).length);
});
test('禁用自动合并保留每条源焊缝，连续性检查禁止延长线跨空白合并',()=>{
 const members=[{key:'a',id:'a',weldId:'a',points:[[0,0,0],[100,0,0]],length:100,weldingPosition:'PB',焊脚:6},{key:'b',id:'b',weldId:'b',points:[[105,0,0],[200,0,0]],length:95,weldingPosition:'PB',焊脚:6}],data={weldsData:{welds:members.map(m=>({id:m.id,properties:{坡口:{类型:'无坡口'}}}))}},plan={merges:{groups:[{id:'group',members,totalLength:195,connections:[]}],units:members,mergedUnitKeys:new Set(['a','b'])},splits:new Map()};
 for(const options of [{automaticMerge:false},{continuousOnly:true}]){const result=convertGeometryPlan(data,plan,options);assert.equal(result.length,2);assert.equal(result.reduce((sum,w)=>sum+w.length,0),195);}
 const weld=convertGeometryPlan(data,plan,{automaticMerge:false})[0];
 for(const [input,expected,count] of [[undefined,10,1],['5',5,1],['4.9',4.9,2],['0',0,2]]){
  const settings=serializeSettings({mergeParameters:{gapThreshold:input}});
  const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,settings);
  assert.equal(settings.mergeParameters.gapThreshold,expected);
  assert.equal(options.mergeGapCheck,true);
  assert.equal(options.mergeParams.最大合并距离,expected);
  assert.equal(convertGeometryPlan(data,plan,options).length,count);
 }
 assert.equal(settingsDefaults().mergeParameters.gapThreshold,10);
 assert.match(planningSettingsErrors({mergeParameters:{gapThreshold:-1}}).join(''),/合并间隙阈值/);
 const other=convertGeometryPlan(data,plan,{automaticMerge:false})[1];assert.match(mergeWeldPreview([weld,other],[weld.id,other.id]).errors.join(),/不允许非连续焊缝合并/);
});
test('过焊孔最大尺寸与间隙阈值独立保存和传入，留空保持原规则',()=>{
 const saved=JSON.parse(JSON.stringify({mergeParameters:{passHoleSize:30},splitParameters:{enabled:false,length:null,gapThreshold:80}}));
 assert.deepEqual(planningSettingsErrors(saved),[]);
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);
 assert.equal(options.mergePassHoleSize,30);assert.equal(options.mergeParams.最长通过距离,30);assert.equal(options.mergeParams.最小通过高度,30);
 assert.equal(options.offsetThreshold,80);assert.equal(options.offset,80);assert.equal(options.extendThreshold,DEFAULT_GEOMETRY_OPTIONS.extendThreshold);
 assert.deepEqual(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters:{passHoleSize:null},splitParameters:{gapThreshold:null}}),{...DEFAULT_GEOMETRY_OPTIONS,splitParameters:{gapThreshold:null}});
 for(const value of [-1,Infinity,NaN,'bad']){assert.ok(planningSettingsErrors({mergeParameters:{passHoleSize:value}}).length);assert.ok(planningSettingsErrors({splitParameters:{gapThreshold:value}}).length);}
 assert.deepEqual(planningSettingsErrors({mergeParameters:{passHoleSize:0},splitParameters:{gapThreshold:0}}),[]);
});
test('过焊孔尺寸边界包含，过大或未确认的孔阻止自动合并且保留源路径',()=>{
 const hole={特征类型:'圆',圆类型:'凹圆弧',L1:30,L2:12};
 assert.equal(mergeFeatureWithinSize(hole,30),true);assert.equal(mergeFeatureWithinSize({...hole,L1:30.01},30),false);assert.equal(mergeFeatureWithinSize({...hole,尺寸待确认:true},30),false);assert.equal(mergeFeatureWithinSize({...hole,L2:null},30),false);
 const members=[{key:'a',id:'a',weldId:'a',points:[[0,0,0],[100,0,0]],length:100,weldingPosition:'PB',焊脚:6,endFeatureProp:hole},{key:'b',id:'b',weldId:'b',points:[[100,0,0],[200,0,0]],length:100,weldingPosition:'PB',焊脚:6}],data={weldsData:{welds:members.map(m=>({id:m.id,properties:{坡口:{类型:'无坡口'}}}))}},plan={merges:{groups:[{id:'group',members,totalLength:200,connections:[]}],units:members,mergedUnitKeys:new Set(['a','b'])},splits:new Map()};
 assert.equal(convertGeometryPlan(data,plan,{mergePassHoleSize:30}).length,1);
 const rejected=convertGeometryPlan(data,plan,{mergePassHoleSize:29.99});assert.equal(rejected.length,2);assert.equal(rejected.reduce((n,w)=>n+w.length,0),200);assert.match(rejected[0].sourceEvidence.rejectedMergeReason,/过焊孔尺寸/);assert.equal(members[0].endFeatureProp.L1,30);
});
