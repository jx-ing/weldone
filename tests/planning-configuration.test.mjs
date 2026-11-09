import test from 'node:test';import assert from 'node:assert/strict';
import {geometryOptionsForPlanning,mergeParameterErrors,mergeAngleRange} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,convertGeometryPlan} from '../src/geometryProcessingModel.mjs';
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
