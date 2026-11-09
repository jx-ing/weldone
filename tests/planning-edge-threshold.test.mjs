import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsDefaults,serializeSettings,updateProjectPlanning} from '../src/planningSettingsModel.mjs';
import {geometryOptionsForPlanning,planningSettingsErrors} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS} from '../src/geometryProcessingModel.mjs';
import {resolveEdgeBreakThreshold,withPlanningEdgeThresholds} from '../src/planningEdgeThreshold.mjs';
import {computeAllSplitsAsync} from '../src/vendor/geometry-engine.mjs';

test('边缘阈值允许空值或正整数，拒绝0、负数、小数和无穷大；保存不固定动态默认值',()=>{
 for(const value of [0,-1,1.5,Infinity,NaN,'12'])assert.ok(planningSettingsErrors({splitParameters:{edgeThreshold:value}}).some(error=>error.includes('边缘打断阈值')));
 for(const value of [null,undefined,'',1,35])assert.deepEqual(planningSettingsErrors({splitParameters:{edgeThreshold:value}}),[]);
 const draft=settingsDefaults();assert.equal(draft.splitParameters.edgeThreshold,null);draft.splitParameters.edgeThreshold='12';
 const saved=serializeSettings(draft,{},'operation');assert.equal(saved.splitParameters.edgeThreshold,12);
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);assert.equal(options.splitParameters.edgeThreshold,12);assert.equal(options.offsetThreshold,DEFAULT_GEOMETRY_OPTIONS.offsetThreshold);assert.equal(options.extendThreshold,DEFAULT_GEOMETRY_OPTIONS.extendThreshold);
 draft.splitParameters.edgeThreshold='';assert.equal(serializeSettings(draft).splitParameters.edgeThreshold,null);
});
test('空值对每条焊缝动态取自身焊脚，允许实际焊脚为小数，不将未知值猜成固定默认值',()=>{
 assert.equal(resolveEdgeBreakThreshold({}, {leg:6}),6);assert.equal(resolveEdgeBreakThreshold({edgeThreshold:null},{leg:8.5}),8.5);
 assert.equal(resolveEdgeBreakThreshold({edgeThreshold:15},{leg:6}),15);assert.equal(resolveEdgeBreakThreshold({}, {properties:{焊脚:9}}),9);
 for(const leg of [0,-1,null,undefined,NaN])assert.equal(resolveEdgeBreakThreshold({}, {leg}),null);
 assert.throws(()=>resolveEdgeBreakThreshold({edgeThreshold:1.5},{leg:6}),/正整数|大于0的整数/);
});
test('项目边缘阈值独立恢复；新项目沿用自动焊脚规则，保存草稿不改原数据',()=>{
 const original={project:'A',templateProjects:['A','B'],welds:[],planningSettings:{splitParameters:{edgeThreshold:12,gapThreshold:50,length:100,enabled:true}}};
 const next=updateProjectPlanning(original,{project:'B'});assert.equal(settingsDefaults(next.planningSettings).splitParameters.edgeThreshold,null);
 const restored=updateProjectPlanning(next,{project:'A'});assert.deepEqual(restored.planningSettings,original.planningSettings);assert.equal(original.project,'A');
});
test('每个源焊缝收到独立边缘阈值且源几何不被改写，旧配置保持原处理输入',()=>{
 const input={welds:[{id:'a'},{id:'b'}]},prepared=[{id:'a',properties:{焊脚:6}},{id:'b',properties:{焊脚:8.5}}];
 assert.equal(withPlanningEdgeThresholds(input,prepared,{}),input);
 const next=withPlanningEdgeThresholds(input,prepared,{edgeThreshold:null});assert.deepEqual(next.welds.map(w=>w.planningEdgeBreakThreshold),[6,8.5]);assert.deepEqual(input,{welds:[{id:'a'},{id:'b'}]});
 assert.deepEqual(withPlanningEdgeThresholds(input,prepared,{edgeThreshold:12}).welds.map(w=>w.planningEdgeBreakThreshold),[12,12]);
});
test('真实边界分支独立使用边缘阈值，间隙阈值保持不变，批次中焊脚不同得到不同打断结果',async()=>{
 const base={id:'a',start:[0,0,0],end:[100,0,0],length:100,closed:false,mainPartId:'p',subPartId:'q',mainFaceIndex:0,subFaceIndex:0,properties:{},segments:[{index:0,type:'line',points:[[0,0,0],[100,0,0]]}]};
 const input=withPlanningEdgeThresholds({welds:[base,{...base,id:'b'}]},[{id:'a',properties:{焊脚:4}},{id:'b',properties:{焊脚:8}}],{edgeThreshold:null});
 const edges={boundaryRecognitionVersion:1,edges:[{partId:'p',faceIndex:0,edgeIndex:0,boundaryId:'e',wireIndex:0,wire:'inner',points:[[30,0,6],[70,0,6]]}]};
 const splits=await computeAllSplitsAsync([input,new Float32Array(),{parts:[]},edges,new Set(),50,null,1],{yieldControl:async()=>{}});
 assert.equal(splits.get('a').splitPoints.length,0);assert.ok(splits.get('b').splitPoints.length>=2);
 assert.deepEqual(splits.get('b').subWelds[0].points[0],[0,0,0]);
 const forced=withPlanningEdgeThresholds({welds:[base]},[],{edgeThreshold:10});
 const forcedResult=await computeAllSplitsAsync([forced,new Float32Array(),{parts:[]},edges,new Set(),50,null,1],{yieldControl:async()=>{}});assert.ok(forcedResult.get('a').splitPoints.length>=2);
});
