import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {appendPickedEdge,appendPickedPoint,createManualWeld,pathGeometry,pathLength,validManualWeldPath,useStepExample} from '../src/manualWeldModel.mjs';
import {newWholeTemplateFromWeld,validateTemplate,matchTemplate,migrateDraft,applyTemplateToWeld} from '../src/templateModel.mjs';
import {previewPath,previewPoint} from '../src/templatePreviewGeometry.mjs';
const settings={name:'人工焊道',leg:6,position:'PB · 横角焊',joint:'T 形接头',groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false};
const edge=(id,points)=>({id,points});

test('111.step 预览确实来自指定源文件，包含33个真实零件和可点选边线',()=>{
  const source=fs.readFileSync(new URL('../public/models/111.step',import.meta.url)),model=JSON.parse(fs.readFileSync(new URL('../public/models/111.mesh.json',import.meta.url)));
  assert.equal(model.sourceSha256,crypto.createHash('sha256').update(source).digest('hex'));assert.equal(model.meshes.length,33);assert.equal(model.unit,'mm');assert.equal(model.size[1],10060);assert.ok(model.edges.length>100);
  for(const m of model.meshes){assert.equal(m.positions.length%3,0);assert.equal(m.indices.length%3,0);assert.ok(m.indices.every(i=>Number.isInteger(i)&&i>=0&&i<m.positions.length/3));assert.ok(m.positions.every(Number.isFinite));}
  for(const e of model.edges)assert.ok(e.points.length>=2&&pathLength(e.points)>.01);
});
test('加载新示例不自动生成焊道，旧示例数据保留备份，已有111人工焊道保留',()=>{
  const old={model:'肋板组件 A',welds:[{id:'W001'}],selected:'W001',templates:[{name:'保留模板'}]};const next=useStepExample(old);assert.equal(next.model,'111.step');assert.deepEqual(next.welds,[]);assert.deepEqual(next.templates,old.templates);assert.deepEqual(next.previousExample.welds,old.welds);assert.equal(useStepExample(next),next);
});
test('选边保留几何并按连接关系自动反向，拒绝不相接的边与超短段',()=>{
  let segs=appendPickedEdge([],edge('a',[[0,0,0],[10,0,0]]));segs=appendPickedEdge(segs,edge('b',[[10,20,0],[10,0,0]]));assert.deepEqual(segs[1].points,[[10,0,0],[10,20,0]]);
  assert.throws(()=>appendPickedEdge(segs,edge('c',[[100,100,0],[200,100,0]])),/相接/);assert.throws(()=>appendPickedEdge([],edge('short',[[0,0,0],[.01,0,0]])),/过短/);
});
test('表面依次取点生成真实毫米长度和连接夹角，并允许闭合',()=>{
  let draw=appendPickedPoint([], [0,0,0],null);assert.equal(draw.segments.length,0);draw=appendPickedPoint(draw.segments,[30,0,0],draw.start);draw=appendPickedPoint(draw.segments,[30,40,0],draw.start);
  const w=createManualWeld([],draw.segments,settings);assert.equal(w.id,'W001');assert.equal(w.length,70);assert.equal(w.cornerAngles[0],90);assert.equal(w.closure,'open');assert.ok(validManualWeldPath(w));
  draw=appendPickedPoint(draw.segments,[0,0,0],draw.start);const closed=createManualWeld([w],draw.segments,settings);assert.equal(closed.id,'W002');assert.equal(closed.closure,'closed');assert.equal(closed.length,120);
});
test('模型边曲线保留实际采样路径，闭合圆弧可建道，开放圆弧按曲线分类',()=>{
  const circle=Array.from({length:73},(_,i)=>[50*Math.cos(i/72*Math.PI*2),50*Math.sin(i/72*Math.PI*2),5]);assert.equal(pathGeometry(circle).geometry,'圆弧');
  const w=createManualWeld([],appendPickedEdge([],edge('circle',circle)),settings);assert.equal(w.closure,'closed');assert.equal(w.segments[0].geometry,'圆弧');assert.ok(Math.abs(w.length-100*Math.PI)<.2);
  const open=createManualWeld([],appendPickedEdge([],edge('arc',circle.slice(0,20))),settings);assert.equal(open.segments[0].geometry,'曲线');assert.deepEqual(open.segments[0].pathPoints,circle.slice(0,20));
});
test('人工焊道可直接创建来源整道模板，逐段条件与路径在草稿往返后保留',()=>{
  const segs=appendPickedEdge(appendPickedEdge([],edge('1',[[1000,2000,5],[1100,2000,5]])),edge('2',[[1100,2000,5],[1100,2040,5]]));segs[1].position='PF · 立向上焊';
  const w=createManualWeld([],segs,settings),t={...newWholeTemplateFromWeld('111.step',[w],w.id),name:'人工来源整道'};assert.deepEqual(validateTemplate(t),[]);assert.equal(matchTemplate(t,w).ok,true);assert.equal(t.segments[1].position,'PF · 立向上焊');
  const restored=migrateDraft(JSON.parse(JSON.stringify({model:'111.step',welds:[w],templates:[t],fixedTemplates:[]})));assert.deepEqual(restored.welds[0].segments,w.segments);assert.equal(matchTemplate(restored.templates[0],restored.welds[0]).ok,true);
  const path=previewPath(t.segments,'xy',t.corners,t.closure);assert.equal(path.totalLength,140);assert.deepEqual(path.vertices,[{x:0,y:0},{x:100,y:0},{x:100,y:-40}]);const pt=previewPoint(t.points.at(-1),path,'xy',false,t.points);assert.equal(pt.distance,140);
  const applied=applyTemplateToWeld(w,t);assert.deepEqual(applied.controlPoints[0].position,{x:1000,y:2000,z:5});assert.deepEqual(applied.controlPoints.at(-1).position,{x:1100,y:2040,z:5});
});
test('人工生成必须有路径和有效焊脚，损坏的点坐标不能作为合法草稿路径',()=>{
  assert.throws(()=>createManualWeld([],[],settings),/至少两个点/);assert.throws(()=>createManualWeld([], [{points:[[0,0,0],[10,0,0]]}],{...settings,leg:6.1}),/步长/);
  const w=createManualWeld([],[{points:[[0,0,0],[10,0,0]]}],settings);w.segments[0].pathPoints[0][0]=null;assert.equal(validManualWeldPath(w),false);
});
