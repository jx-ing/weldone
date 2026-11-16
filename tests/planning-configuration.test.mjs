import test from 'node:test';import assert from 'node:assert/strict';
import {configuredWrapDistance,geometryOptionsForPlanning,mergeParameterErrors,mergeAngleRange,wrapParameterErrors} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,convertGeometryPlan} from '../src/geometryProcessingModel.mjs';
import {serializeSettings,settingsDefaults} from '../src/planningSettingsModel.mjs';

test('L 形包角调整偏移保存为非负一位小数，旧配置和空白默认零',()=>{
 const legacy=settingsDefaults({wrapParameters:{lDistanceRatio:'1/2'}});
 assert.equal(legacy.wrapParameters.lDistanceOffset,0);
 assert.equal(configuredWrapDistance(12,legacy.wrapParameters,'L'),6);
 assert.equal(serializeSettings({wrapParameters:{lDistanceOffset:''}}).wrapParameters.lDistanceOffset,0);
 const saved=serializeSettings({wrapParameters:{lDistanceRatio:'2/3',lDistanceOffset:'2.5'}});
 assert.equal(settingsDefaults(saved).wrapParameters.lDistanceOffset,2.5);
 assert.equal(configuredWrapDistance(12,saved.wrapParameters,'L'),10.5);
 assert.equal(configuredWrapDistance(12,saved.wrapParameters,'vertical'),8);
 assert.equal(wrapParameterErrors(saved.wrapParameters).length,0);
 for(const lDistanceOffset of [-0.1,1.25,NaN,Infinity])assert.ok(wrapParameterErrors({lDistanceOffset}).length);
});
test('L 形包角保存拖动比例，按板厚限长，并保留固定档偏移',()=>{
 const saved=serializeSettings({wrapParameters:{lDistanceRatio:'1/2',lDistanceOffset:'4.5',lDistanceCustomRatio:.735}});
 const wrap=settingsDefaults(saved).wrapParameters;
 assert.equal(wrap.lDistanceCustomRatio,.735);
 assert.equal(wrap.lDistanceOffset,4.5);
 assert.equal(configuredWrapDistance(20,wrap,'L'),14.7);
 assert.equal(configuredWrapDistance(12,wrap,'vertical'),6);
 assert.equal(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved).wrapDistanceRatio,.735);
 assert.equal(configuredWrapDistance(6,{...wrap,lDistanceCustomRatio:null},'L'),6);
 assert.equal(configuredWrapDistance(12,{...wrap,lDistanceCustomRatio:0},'L'),0);
 assert.equal(configuredWrapDistance(12,{...wrap,lDistanceCustomRatio:1},'L'),12);
 for(const lDistanceCustomRatio of [-.001,1.001])assert.ok(wrapParameterErrors({...wrap,lDistanceCustomRatio}).length);
});
test('立焊上包角独立保存板厚比例与毫米偏移，两者之和不超过板厚',()=>{
 const saved=serializeSettings({wrapParameters:{lDistanceRatio:'1/2',lDistanceCustomRatio:.8,verticalDistanceRatio:'2/3',verticalDistanceCustomRatio:.375,verticalDistanceOffset:'1.5'}});
 const wrap=settingsDefaults(saved).wrapParameters;
 assert.equal(wrap.verticalDistanceCustomRatio,.375);
 assert.equal(wrap.verticalDistanceOffset,1.5);
 assert.equal(configuredWrapDistance(8,wrap,'vertical'),4.5);
 assert.equal(configuredWrapDistance(2,wrap,'vertical'),2);
 assert.equal(configuredWrapDistance(8,{...wrap,verticalDistanceCustomRatio:null},'vertical'),8*(2/3)+1.5);
 assert.equal(configuredWrapDistance(8,wrap,'L'),6.4);
 assert.equal(configuredWrapDistance(6,{verticalDistance:8},'vertical'),6);
 assert.equal(configuredWrapDistance(12,{lDistanceRatio:'1/2'},'vertical'),6);
 assert.ok(wrapParameterErrors({...wrap,verticalDistanceOffset:-1}).length);
 assert.ok(wrapParameterErrors({...wrap,verticalDistanceCustomRatio:1.1}).length);
});
test('合并参数留空沿用原规则，明确角度转换为最大转角并限制每组合并个数',()=>{
 const defaults=structuredClone(DEFAULT_GEOMETRY_OPTIONS);assert.deepEqual(geometryOptionsForPlanning(defaults),defaults);
 const o=geometryOptionsForPlanning(defaults,{mergeParameters:{angle:45,count:3}});assert.equal(o.mergeParams.夹角阈值下限,135);assert.equal(o.mergeParams.夹角阈值上限,180);assert.equal(o.maxMergeCount,3);assert.deepEqual(defaults,DEFAULT_GEOMETRY_OPTIONS);
 for(const value of [{angle:-1},{angle:181},{count:1},{count:31},{count:2.5}])assert.ok(mergeParameterErrors(value).length);
});
test('合并转角范围映射到几何夹角上下界，兼容旧上限并拒绝不完整或倒置范围',()=>{
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters:{angleMin:30,angleMax:75,count:4}});assert.equal(options.mergeParams.夹角阈值下限,105);assert.equal(options.mergeParams.夹角阈值上限,150);
 assert.deepEqual(mergeAngleRange({angle:75}),{angleMin:0,angleMax:75});assert.deepEqual(mergeAngleRange({}),{angleMin:'',angleMax:''});
 for(const value of [{angleMin:30},{angleMax:75},{angleMin:76,angleMax:75},{angleMin:-1,angleMax:75},{angleMin:0,angleMax:181}])assert.ok(mergeParameterErrors(value).length);
 for(const value of [{angleMin:0,angleMax:0},{angleMin:180,angleMax:180},{angleMin:0,angleMax:180},{angleMin:null,angleMax:null}])assert.equal(mergeParameterErrors(value).length,0);
 assert.deepEqual(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters:{angleMin:null,angleMax:null}}),DEFAULT_GEOMETRY_OPTIONS);
});
test('自动合并结果按最大个数拆组，不丢失来源片段，真实长度守恒',()=>{
 const members=Array.from({length:5},(_,i)=>({id:'A'+i,key:'a'+i,weldId:'a'+i,points:[[i*10,0,0],[(i+1)*10,0,0]],length:10,焊脚:6,weldingPosition:'PB',jointType:'T接'})),data={weldsData:{welds:members.map(m=>({id:m.weldId,properties:{坡口:{类型:'无坡口'}}}))}},plan={merges:{groups:[{id:'group',members,closed:false,totalLength:50,connections:[]}],units:members,mergedUnitKeys:new Set(members.map(m=>m.key))},splits:new Map()};
 const result=convertGeometryPlan(data,plan,{maxMergeCount:2});assert.deepEqual(result.map(w=>w.segments.length),[2,2,1]);assert.equal(result.reduce((n,w)=>n+w.length,0),50);assert.deepEqual(result.flatMap(w=>w.sourceEvidence.unitKeys),members.map(m=>m.key));
});
