import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,geometryOptions,changeTemplateClosure,changeTemplateSegment,reconcileTemplateGeometry,resizeSegments,addTemplateCorner,deleteTemplateCorner,point,validateTemplate,migrateTemplate,fixedLayout,reuseLayout,applyTemplateToWeld,matchTemplate} from '../src/templateModel.mjs';
import {previewPath,previewPoint,sampleFrame,previewBounds} from '../src/templatePreviewGeometry.mjs';
import {addLayer,addPass,updatePass,removeLayer,removePass,ensureLayers} from '../src/templateLayers.mjs';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const make=type=>({...newTemplate(type),name:'模板验证'});
const pathOf=t=>previewPath(t.segments,'xy',t.corners,t.closure);
const target=t=>({closure:t.closure,leg:t.leg,segments:t.segments,cornerAngles:t.corners.map(c=>c.standard),completeStart:true,completeEnd:true,atConnection:t.type==='local',groove:t.groove,startHole:t.startHole,endHole:t.endHole});

test('整道和局部均支持开放/闭合，开放排除圆弧，切换开放会将圆弧改为曲线',()=>{
  for(const type of ['whole','local']){let t=make(type);assert.equal(t.closure,'open');assert.deepEqual(geometryOptions(t.closure),['直线','曲线']);t=changeTemplateClosure(t,'closed');assert.deepEqual(geometryOptions(t.closure),['直线','曲线','圆弧']);assert.deepEqual(validateTemplate(t),[]);}
  let t=changeTemplateClosure(make(),'closed');t=changeTemplateSegment(t,0,{geometry:'圆弧',shape:{radius:50,arcAngle:120}});t=changeTemplateClosure(t,'open');assert.equal(t.segments[0].geometry,'曲线');assert.deepEqual(validateTemplate(t),[]);
  const w=target(t);assert.equal(matchTemplate(t,{...w,closure:'closed'}).ok,false);
});
test('曲线是真实二次曲线，弯曲程度可调，曲线上点位按弧长采样',()=>{
  let t=changeTemplateSegment(make(),0,{geometry:'曲线',shape:{bend:20,direction:'left'}}),path=pathOf(t);assert.match(path.frames[0].d,/ Q/);near(path.frames[0].length,100);
  const middle=sampleFrame(path.frames[0],50).position,lineMiddle={x:path.vertices[1].x/2,y:path.vertices[1].y/2};assert.ok(Math.hypot(middle.x-lineMiddle.x,middle.y-lineMiddle.y)>5);
  assert.ok(path.vertices[1].y<0);const right=pathOf(changeTemplateSegment(t,0,{shape:{bend:20,direction:'right'}}));assert.ok(right.vertices[1].y>0);
  const old=path.frames[0].d;t=changeTemplateSegment(t,0,{shape:{bend:70,direction:'left'}});path=pathOf(t);assert.notEqual(path.frames[0].d,old);
  const p={...point(),referenceId:t.points[0].id,segment:1,percent:0,offset:{x:50,y:0,z:0}};const shown=previewPoint(p,path,'xy',false,[...t.points,p]);const at=sampleFrame(path.frames[0],50);near(shown.position.x,at.position.x);near(shown.position.y,at.position.y);
});
test('单段闭合曲线按宽高生成闭合环，圆弧单段生成完整圆且可调半径',()=>{
  let t=changeTemplateSegment(make(),0,{geometry:'曲线',shape:{width:160,height:90}});t=changeTemplateClosure(t,'closed');let path=pathOf(t);assert.deepEqual(path.vertices[0],path.vertices.at(-1));assert.equal((path.frames[0].d.match(/C/g)||[]).length,4);
  const xs=path.frames[0].samples.map(p=>p.x),ys=path.frames[0].samples.map(p=>p.y);near(Math.max(...xs)-Math.min(...xs),160);near(Math.max(...ys)-Math.min(...ys),90);
  t=changeTemplateSegment(t,0,{geometry:'圆弧',shape:{radius:40}});path=pathOf(t);assert.deepEqual(path.vertices[0],path.vertices.at(-1));assert.equal((path.frames[0].d.match(/A/g)||[]).length,2);near(path.frames[0].length,80*Math.PI);
  const first=path.frames[0].d;t=changeTemplateSegment(t,0,{shape:{radius:60}});assert.notEqual(pathOf(t).frames[0].d,first);near(pathOf(t).frames[0].length,120*Math.PI);assert.deepEqual(validateTemplate(t),[]);
});
test('多段闭合轮廓收尾真正连接起点，曲线鼓出部分也参与视图范围',()=>{
  let t=changeTemplateClosure(make('local'),'closed');t=changeTemplateSegment(t,1,{geometry:'曲线',shape:{bend:70}});t=changeTemplateSegment(t,2,{geometry:'圆弧',shape:{arcAngle:150}});const path=pathOf(t);assert.deepEqual(path.vertices[0],path.vertices.at(-1));assert.ok(path.frames[2].radius>0);
  const bounds=previewBounds(path,[]);for(const f of path.frames)for(const p of f.samples)assert.ok(p.x>=bounds.x&&p.x<=bounds.x+bounds.width&&p.y>=bounds.y&&p.y<=bounds.y+bounds.height);assert.deepEqual(validateTemplate(t),[]);
});
test('局部初始均为段连接点，后续增段给每道补连接点，缩段清除失效引用',()=>{
  let t=make('local');assert.deepEqual(t.points.filter(p=>p.kind==='junction').map(p=>p.kind),['junction']);assert.deepEqual(t.points.filter(p=>p.kind==='junction').map(p=>p.name),['段连接点1']);const jointId=t.points[0].id;
  const p={...point(),referenceId:jointId,segment:1,percent:100};t.points.push(p);t=addPass(t,t.layers[0].id,t.layers[0].passes[0].id);t=resizeSegments(t,3);
  for(const pass of t.layers[0].passes)assert.equal(pass.points.filter(p=>p.kind==='junction').length,2);assert.equal(t.points.find(p=>p.id===jointId).segment,1);
  t=resizeSegments(t,1);assert.equal(t.points.find(p=>p.kind==='control'&&!p.autoRole).referenceId,'');assert.ok(validateTemplate(t).some(e=>e.includes('基准点')));
});
test('人工点必须引用自动基准点，XYZ 与所选段连接点和基准偏移同步',()=>{
  let t=addTemplateCorner(make());const joint=t.points.find(p=>p.kind==='junction');joint.offset={x:0,y:2,z:3};
  const p={...point(),referenceId:'',segment:1,percent:100,offset:{x:10,y:5,z:4}};t.points.push(p);assert.ok(validateTemplate(t).some(e=>e.includes('基准点')));p.referenceId=joint.id;assert.deepEqual(validateTemplate(t),[]);
  const path=pathOf(t),shown=previewPoint(p,path,'xy',false,t.points),expected=sampleFrame(path.frames[1],10);near(shown.position.x,expected.position.x+shown.frame.normal.x*7);near(shown.position.y,expected.position.y+shown.frame.normal.y*7);assert.equal(shown.height,7);
  p.referenceId=p.id;assert.ok(validateTemplate(t).length);
});
test('固定模板引用关系重新映射，只复用位置，不复用原工艺覆盖',()=>{
  const t=make('local'),anchor=t.points[0],p={...point(),referenceId:anchor.id,segment:1,percent:100,location:{along:15,normal:4,height:3},overrides:{current:999}};t.points.push(p);
  const f=fixedLayout(t),reused=reuseLayout(make('local'),f),manual=reused.points.find(p=>p.kind==='control'&&!p.autoRole);assert.notEqual(manual.referenceId,anchor.id);assert.ok(reused.points.some(a=>a.kind==='junction'&&a.id===manual.referenceId));assert.deepEqual(manual.offset,{x:15,y:4,z:3});assert.deepEqual(manual.overrides,{});assert.deepEqual(validateTemplate(reused),[]);
});
test('多层多道独立保存点位参数、层高和横向偏移，新增道的引用指向道内基准点',()=>{
  let t=make(),firstId=t.layers[0].passes[0].id;t=addPass(t,t.layers[0].id,firstId);const secondId=t.layers[0].passes[1].id;
  t=updatePass(t,secondId,{points:t.layers[0].passes[1].points.map(p=>({...p,overrides:{current:260}})),offset:{y:4,z:1}});t=addLayer(t,secondId);t.layers[1].height=3;
  assert.equal(t.layers[0].passes[0].points[0].overrides.current,undefined);assert.equal(t.layers[0].passes[1].points[0].overrides.current,260);assert.deepEqual(validateTemplate(t),[]);
  const applied=applyTemplateToWeld(target(t),t);assert.equal(applied.layers.length,2);assert.equal(applied.layers[0].passes.length,2);assert.equal(applied.layers[0].passes[1].controlPoints[0].position.z,1);assert.equal(applied.layers[1].passes[0].controlPoints[0].position.z,3);assert.equal(applied.layers[0].passes[1].controlPoints[0].position.y,-4);
  t.layers[0].passes[1].points[0].overrides.current=99;assert.equal(applied.layers[0].passes[1].controlPoints[0].overrides.current,260);
});
test('删除层和道至少保留一层一道，删除转角同步数量并保留其余角度',()=>{
  let t=make();assert.equal(removeLayer(t,t.layers[0].id),t);t=removePass(t,t.layers[0].id,t.layers[0].passes[0].id);assert.equal(t.layers[0].passes.length,1);
  t=addLayer(t);t=removeLayer(t,t.layers[0].id);assert.equal(t.layers.length,1);assert.equal(t.points,t.layers[0].passes[0].points);
  t=addTemplateCorner(addTemplateCorner(t));t.corners[1]={standard:120,tolerance:8};t=deleteTemplateCorner(t,0);assert.equal(t.cornerCount,1);assert.deepEqual(t.corners,[{standard:120,tolerance:8}]);t=deleteTemplateCorner(t,0);assert.equal(t.cornerCount,0);
});
test('旧模板迁移补充形式、连接点、引用和第一层第一道，序列化后保持全部道参数',()=>{
  let t=make('local');delete t.closure;delete t.layers;t.points=t.points.filter(p=>p.kind!=='junction');const p=point('control',2,30);delete p.referenceId;t.points.push(p);
  t=migrateTemplate(t);assert.equal(t.closure,'open');assert.equal(t.layers.length,1);const manual=t.points.find(p=>p.kind==='control'&&!p.autoRole);assert.equal(manual.referenceId,'');assert.ok(validateTemplate(t).some(e=>e.includes('基准点')));t.points.filter(p=>p.kind==='control').forEach(p=>p.referenceId=t.points[0].id);assert.deepEqual(validateTemplate(t),[]);
  t=addLayer(t);const restored=migrateTemplate(JSON.parse(JSON.stringify(t)));assert.deepEqual(validateTemplate(restored),[]);assert.equal(restored.layers.length,2);assert.equal(restored.layers[1].passes[0].points.length,t.layers[1].passes[0].points.length);
});
test('闭合曲线上沿向偏移超过一圈时仍沿真实闭合焊道定位',()=>{
  let t=changeTemplateSegment(make(),0,{geometry:'曲线',shape:{width:120,height:60}});t=changeTemplateClosure(t,'closed');const path=pathOf(t),p={...point('control',1,0),referenceId:t.points[0].id,offset:{x:path.totalLength+20,y:0,z:0}};
  const a=previewPoint(p,path,'xy',false,[...t.points,p]),b=sampleFrame(path.frames[0],20);near(a.position.x,b.position.x);near(a.position.y,b.position.y);
});
test('删除后再次新增层和道，名称保持唯一，非法形状数值不能保存',()=>{
  let t=addLayer(addLayer(make()));t=removeLayer(t,t.layers[1].id);t=addLayer(t);assert.equal(new Set(t.layers.map(l=>l.name)).size,t.layers.length);
  const layer=t.layers[0];t=addPass(addPass(t,layer.id),layer.id);t=removePass(t,layer.id,t.layers[0].passes[1].id);t=addPass(t,layer.id);assert.equal(new Set(t.layers[0].passes.map(p=>p.name)).size,t.layers[0].passes.length);
  t=changeTemplateSegment(t,0,{geometry:'曲线',shape:{bend:''}});assert.ok(validateTemplate(t).some(e=>e.includes('形状参数')));
});
test('多层多道和基准点引用经 JSON 往返后逐道完整恢复',()=>{
  let t=addTemplateCorner(make());const p={...point('control',1,100),referenceId:t.points.find(p=>p.kind==='junction').id,offset:{x:15,y:2,z:3}};t.points.push(p);t=addPass(t,t.layers[0].id);t=addLayer(t);t.layers[1].height=6;
  const restored=migrateTemplate(JSON.parse(JSON.stringify(t)));assert.deepEqual(restored.layers,t.layers);assert.deepEqual(validateTemplate(restored),[]);
  const expected=applyTemplateToWeld(target(t),t),actual=applyTemplateToWeld(target(restored),restored);assert.deepEqual(actual.layers,expected.layers);
});
