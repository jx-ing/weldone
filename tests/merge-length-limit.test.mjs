import test from 'node:test';
import assert from 'node:assert/strict';
import {convertGeometryPlan,DEFAULT_GEOMETRY_OPTIONS,validateGeometryOptions} from '../src/geometryProcessingModel.mjs';
import {geometryOptionsForPlanning,mergeParameterErrors} from '../src/planningConfiguration.mjs';
import {pathLength} from '../src/manualWeldModel.mjs';

function fixture(paths,closed=false){
 const members=paths.map((points,index)=>({id:'a'+index,key:'a'+index,weldId:'a'+index,points,length:pathLength(points),焊脚:6,weldingPosition:'PB',jointType:'T接'}));
 return {data:{weldsData:{welds:members.map(member=>({id:member.id,properties:{坡口:{类型:'无坡口'}}}))}},plan:{merges:{groups:[{id:'group',members,closed,totalLength:members.reduce((sum,member)=>sum+member.length,0),connections:[]}],units:members,mergedUnitKeys:new Set(members.map(member=>member.key))},splits:new Map()},members};
}
const run=(value,options)=>convertGeometryPlan(value.data,value.plan,options);
const linePaths=(count,length=10)=>Array.from({length:count},(_,i)=>[[i*length,0,0],[(i+1)*length,0,0]]);

test('限制合并后的总长度，边界包含，连续分组保留全部来源且数量限制共同生效',()=>{
 const value=fixture(linePaths(5)),before=structuredClone(value);
 for(const options of [{maxMergeLength:20},{maxMergeLength:25,maxMergeCount:3}]){const result=run(value,options);assert.deepEqual(result.map(w=>w.length),[20,20,10]);assert.deepEqual(result.flatMap(w=>w.sourceEvidence.unitKeys),value.members.map(member=>member.key));}
 assert.deepEqual(run(value,{maxMergeLength:50}).map(w=>w.length),[50]);assert.deepEqual(run(value,{maxMergeLength:19}).map(w=>w.length),[10,10,10,10,10]);assert.deepEqual(run(value,{maxMergeCount:2}).map(w=>w.length),[20,20,10]);assert.deepEqual(value,before);
});

test('原本超长的单条焊缝保留原路径，不合并也不裁短，禁用自动合并保持单条',()=>{
 const value=fixture([[[0,0,0],[30,0,0]],[[30,0,0],[40,0,0]],[[40,0,0],[50,0,0]]]);
 assert.deepEqual(run(value,{maxMergeLength:20}).map(w=>w.length),[30,20]);assert.deepEqual(run(value,{automaticMerge:false,maxMergeLength:20}).map(w=>w.length),[30,10,10]);assert.deepEqual(run(value,{}).map(w=>w.length),[50]);
});

test('使用真实曲线路径和交点延伸后的长度，不使用弦长或源记录的长度数值',()=>{
 const curved=fixture([[[0,0,0],[5,5,0],[10,0,0]],[[10,0,0],[20,0,0]]]);assert.equal(run(curved,{maxMergeLength:22}).length,2);assert.equal(run(curved,{maxMergeLength:24.1421}).length,1);
 const extended=fixture([[[0,0,0],[10,0,0]],[[15,5,0],[15,15,0]]]);assert.equal(run(extended,{maxMergeLength:25}).length,2);assert.equal(run(extended,{maxMergeLength:30})[0].length,30);
 const metadata=fixture(linePaths(3));metadata.members.forEach(member=>member.length=9999);metadata.plan.merges.groups[0].totalLength=99999;assert.deepEqual(run(metadata,{maxMergeLength:20}).map(w=>w.length),[20,10]);
});

test('闭合合并达到总长上限时保留闭合，超出后分组且不丢失边',()=>{
 const value=fixture([[[0,0,0],[10,0,0]],[[10,0,0],[10,10,0]],[[10,10,0],[0,10,0]],[[0,10,0],[0,0,0]]],true);
 const kept=run(value,{maxMergeLength:40});assert.equal(kept.length,1);assert.equal(kept[0].closure,'closed');assert.equal(kept[0].length,40);
 const chunks=run(value,{maxMergeLength:25});assert.deepEqual(chunks.map(w=>w.length),[20,20]);assert.equal(chunks.flatMap(w=>w.sourceEvidence.unitKeys).length,4);assert.ok(chunks.every(w=>w.closure==='open'));
});

test('参数保存传递、正数校验和留空不限制；不改写按单条长度筛选的旧规则',()=>{
 const saved=JSON.parse(JSON.stringify({mergeParameters:{maxLength:250}})),options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);assert.equal(options.maxMergeLength,250);assert.deepEqual(options.mergeParams,DEFAULT_GEOMETRY_OPTIONS.mergeParams);assert.deepEqual(validateGeometryOptions(options),[]);
 for(const maxLength of [0,-1,Infinity,NaN,'bad'])assert.ok(mergeParameterErrors({maxLength}).length);
 for(const maxLength of [null,undefined,''])assert.deepEqual(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters:{maxLength}}),DEFAULT_GEOMETRY_OPTIONS);
 assert.ok(validateGeometryOptions({...DEFAULT_GEOMETRY_OPTIONS,maxMergeLength:0}).length);
});
