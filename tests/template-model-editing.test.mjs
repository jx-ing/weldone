import test from 'node:test';
import assert from 'node:assert/strict';
import {newWholeTemplateFromWeld} from '../src/templateModel.mjs';
import {templatePathNodes,moveTemplatePathNode,templateGeometrySnapshot,restoreTemplateGeometry} from '../src/templateModelEditing.mjs';
import {addPass,updatePass} from '../src/templateLayers.mjs';

function source(closed=false){const points=closed?[[[0,0,0],[100,0,0]],[[100,0,0],[100,100,0]],[[100,100,0],[0,0,0]]]:[[[0,0,0],[100,0,0]],[[100,0,0],[100,100,0]]];return {id:'W001',name:'三维源焊缝',completeStart:true,completeEnd:true,closure:closed?'closed':'open',leg:6,segments:points.map(pathPoints=>({pathPoints,length:Math.hypot(...pathPoints[1].map((v,i)=>v-pathPoints[0][i])),geometry:'直线',position:'PB · 横角焊',joint:'T 形接头'})),cornerAngles:closed?[90,45]:[90],groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false};}
const template=closed=>newWholeTemplateFromWeld('111.step',[source(closed)],'W001');
test('三维移动共用连接点同时修改相邻段并保留原焊缝和工艺点',()=>{
 const original=template(false),before=structuredClone(original);original.points[0].overrides={current:220};const moved=moveTemplatePathNode(original,1,[110,10,20]);
 assert.deepEqual(moved.segments[0].pathPoints.at(-1),[110,10,20]);assert.deepEqual(moved.segments[1].pathPoints[0],[110,10,20]);assert.deepEqual(original.segments,before.segments);
 assert.notEqual(moved.segments[0].length,100);assert.deepEqual(moved.points.map(p=>p.id),original.points.map(p=>p.id));assert.equal(moved.points[0].overrides.current,220);assert.equal(moved.sourceWeld.id,'W001');
 const restored=JSON.parse(JSON.stringify(moved));assert.deepEqual(templatePathNodes(restored)[1].position,[110,10,20]);
});
test('闭合节点编辑保持首尾相接，撤销仅恢复几何而保留名称更改',()=>{
 const original=template(true),snapshot=templateGeometrySnapshot(original),moved=moveTemplatePathNode(original,0,[5,10,15]);
 assert.deepEqual(moved.segments[0].pathPoints[0],[5,10,15]);assert.deepEqual(moved.segments.at(-1).pathPoints.at(-1),[5,10,15]);assert.equal(templatePathNodes(moved).length,3);
 const restored=restoreTemplateGeometry({...moved,name:'新名称'},snapshot);assert.equal(restored.name,'新名称');assert.deepEqual(restored.segments,original.segments);
});
test('禁止三维点无效坐标、越界和零长度焊缝',()=>{
 const value=template(false);assert.throws(()=>moveTemplatePathNode(value,9,[0,0,0]));assert.throws(()=>moveTemplatePathNode(value,0,[NaN,0,0]));assert.throws(()=>moveTemplatePathNode(value,0,[100,0,0]),/长度/);
});
test('修改模板几何保留其他道的工艺点参数和独立位置偏移',()=>{
 let t=template(false);t=addPass(t,t.layers[0].id,t.layers[0].passes[0].id);const second=t.layers[0].passes[1];t=updatePass(t,second.id,{offset:{y:3,z:4},points:second.points.map(p=>({...p,overrides:{current:225},offset:{x:1,y:2,z:3}}))});
 const original=structuredClone(t.layers[0].passes[1]),changed=moveTemplatePathNode(t,1,[110,5,20]);assert.deepEqual(changed.layers[0].passes[1],original);
});
test('开放曲线编辑不能悄然变成闭合路径',()=>{
 const t=template(false);t.segments=[{...t.segments[0],pathPoints:[[0,0,0],[50,20,0],[100,0,0]],geometry:'曲线'}];t.corners=[];t.cornerCount=0;
 assert.throws(()=>moveTemplatePathNode(t,0,[100,0,0]),/不能重合/);
});
