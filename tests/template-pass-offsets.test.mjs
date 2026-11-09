import test from 'node:test';import assert from 'node:assert/strict';
import {PASS_OFFSET_FIELDS,passOffsetValues,resolvePassPoint,validPassOffsets} from '../src/templatePassOffsets.mjs';
import {newWholeTemplateFromWeld,point,applyTemplateToWeld,validateTemplate} from '../src/templateModel.mjs';
import {updatePass,addPass,addLayer} from '../src/templateLayers.mjs';
import {templateProcessNodes,moveTemplateProcessPoint} from '../src/templateProcessPointGeometry.mjs';
const source={id:'W001',name:'源焊缝',completeStart:true,completeEnd:true,closure:'open',leg:6,segments:[{geometry:'直线',length:100,pathPoints:[[0,0,0],[100,0,0]],referenceNormal:[0,0,1],joint:'T 形接头',position:'PB · 横角焊'}],cornerAngles:[],cornerReferenceNormal:[0,0,1],groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false};
const make=()=>({...newWholeTemplateFromWeld('111.step',[source],source.id),name:'偏移测试',cornerReferenceNormal:[0,0,1]});
const near=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-6,`${a} vs ${b}`));
test('完整八项偏移兼容旧道，独立持久化并拒绝无效数值',()=>{
 const legacy={y:1,z:2};assert.equal(PASS_OFFSET_FIELDS.length,8);assert.deepEqual(passOffsetValues(legacy),{y:1,z:2,start:0,end:0,wire:0,advance:0,work:0,rotation:0});assert.deepEqual(legacy,{y:1,z:2});
 let t=make(),id=t.layers[0].passes[0].id;const offset={y:3,z:4,start:5,end:-7,wire:10,advance:0,work:45,rotation:30};t=updatePass(t,id,{offset});assert.deepEqual(validateTemplate(t),[]);
 const saved=JSON.parse(JSON.stringify(t));assert.deepEqual(saved.layers[0].passes[0].offset,offset);
 t=addPass(t,t.layers[0].id,id);assert.deepEqual(t.layers[0].passes[0].offset,offset);assert.equal(passOffsetValues(t.layers[0].passes[1].offset).wire,0);
 assert.equal(validPassOffsets({...offset,wire:NaN}),false);assert.equal(validPassOffsets({...offset,advance:361}),false);assert.equal(validPassOffsets({...offset,start:-20.5}),true);
 assert.ok(validateTemplate(updatePass(saved,id,{offset:{...offset,end:''}})).length);
});
test('起收弧沿焊缝调整，基准点带动人工点，角度叠加并沿有效焊枪轴移动',()=>{
 let t=make();const control={...point('control',1,0,'人工点'),referenceId:t.points[0].id,offset:{x:20,y:0,z:0}};t.points.push(control);t.layers[0].passes[0].points=t.points;
 const offset={y:3,z:4,start:5,end:-7,wire:10,advance:0,work:45,rotation:30};
 const start=resolvePassPoint(t,t.points[0],t.points,offset,2),end=resolvePassPoint(t,t.points[1],t.points,offset,2),manual=resolvePassPoint(t,control,t.points,offset,2);
 near(start.position,[5,3,16]);near(end.position,[93,3,16]);near(manual.position,[25,3,16]);near(start.wireAxis,[0,0,1]);assert.deepEqual(start.angles,{advance:0,work:90,rotation:30});assert.deepEqual(t.points[0].angles,{advance:0,work:45,rotation:0});
});
test('三维显示、坐标反算和应用快照共用偏移结果，多层每道互不改写',()=>{
 let t=make(),pass=t.layers[0].passes[0];const offset={y:3,z:4,start:5,end:-7,wire:10,advance:0,work:45,rotation:30};t=updatePass(t,pass.id,{offset});t={...t,layers:t.layers.map(l=>({...l,height:2}))};
 const preview={...t,passOffset:{...offset,z:6}},nodes=templateProcessNodes(preview),applied=applyTemplateToWeld(source,t);near(nodes[0].position,Object.values(applied.controlPoints[0].position));assert.deepEqual(applied.controlPoints[0].angles,{advance:0,rotation:30,work:90});
 const moved=moveTemplateProcessPoint(preview,0,[15,3,16]);near(templateProcessNodes(moved)[0].position,[15,3,16]);assert.ok(Math.abs(moved.points[0].offset.x-10)<1e-5);assert.deepEqual(moved.passOffset,preview.passOffset);
 const saved=JSON.stringify(t.layers[0].passes[0]);t=addLayer(t,pass.id);assert.equal(JSON.stringify(t.layers[0].passes[0]),saved);assert.equal(passOffsetValues(t.layers[1].passes[0].offset).start,0);
});
