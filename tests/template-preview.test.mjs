import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPath, previewPoint, movePreviewPoint, previewBounds } from '../src/templatePreviewGeometry.mjs';
import { newTemplate, point, fixedLayout, reuseLayout, validateTemplate, validateFixed } from '../src/templateModel.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('XYZ 数值改变对应视图坐标，Z 在 XZ 视图中上移',()=>{
  const p=point();p.offset={x:12,y:8,z:20};
  const xy=previewPoint(p,previewPath([{length:100}]),'xy');
  assert.deepEqual(xy.base,{x:50,y:0});assert.deepEqual(xy.position,{x:62,y:-8});
  const xz=previewPoint(p,previewPath([{length:100}],'xz'),'xz');assert.deepEqual(xz.position,{x:62,y:-20});
});
test('沿焊道和垂直拖拽按所选段局部坐标约束，切向与法向互不污染',()=>{
  const path=previewPath([{length:100},{length:200}]),p=point('control',2,50),frame=path.frames[1];
  const delta={x:frame.tangent.x*15+frame.normal.x*9,y:frame.tangent.y*15+frame.normal.y*9};
  const along=movePreviewPoint(p,frame,delta,'along');assert.deepEqual(along.offset,{x:15,y:0,z:0});
  const normal=movePreviewPoint(p,frame,delta,'normal');assert.deepEqual(normal.offset,{x:0,y:9,z:0});
  const rendered=previewPoint({...p,offset:{x:15,y:9,z:0}},path);
  near(rendered.position.x-rendered.base.x,delta.x);near(rendered.position.y-rendered.base.y,delta.y);
});
test('XZ 拖拽更新 X/Z，保留 Y；负向拖拽、非整数增量和已有偏移可累计',()=>{
  const p=point();p.offset={x:3,y:7,z:-2};const frame=previewPath([{length:100}],'xz').frames[0];
  assert.deepEqual(movePreviewPoint(p,frame,{x:1.234,y:80},'along','xz').offset,{x:4.23,y:7,z:-2});
  assert.deepEqual(movePreviewPoint(p,frame,{x:50,y:4.567},'normal','xz').offset,{x:3,y:7,z:-6.57});
  assert.deepEqual(p.offset,{x:3,y:7,z:-2});
});
test('固定模板拖拽按基准点增加沿向距离，自动基准点沿向保持锚定',()=>{
  const f=previewPath([{length:200}]).frames[0],p=point();
  assert.equal(movePreviewPoint(p,f,{x:20,y:0},'along','xy',true).location.along,20);
  assert.equal(movePreviewPoint(p,f,{x:9999,y:0},'along','xy',true).location.along,9999);
  assert.equal(movePreviewPoint(p,f,{x:-9999,y:0},'along','xy',true).location.along,-9999);
  const start=point('start',1,0,'起点');assert.deepEqual(movePreviewPoint(start,f,{x:20,y:0},'along','xy',true),start);
  const moved=movePreviewPoint(p,f,{x:0,y:-9},'normal','xy',true);assert.deepEqual(moved.location,{normal:9,height:0});assert.deepEqual(moved.offset,p.offset);
});
test('固定模板保存及复用保留横向、高度位置，同时不复制工艺偏移',()=>{
  const t={...newTemplate('local'),name:'拖动后的骨架'};t.points.push({...point(),referenceId:t.points[0].id});const manual=t.points.find(p=>p.kind==='control');manual.location={normal:13,height:-4};manual.offset={x:11,y:22,z:33};
  const fixed=fixedLayout(t);assert.deepEqual(validateFixed(fixed),[]);assert.deepEqual(fixed.points.find(p=>p.kind==='control').location,{normal:13,height:-4});assert.equal('offset' in fixed.points.find(p=>p.kind==='control'),false);
  const reused=reuseLayout({...newTemplate('local'),name:'复用'},fixed);assert.deepEqual(reused.points.find(p=>p.kind==='control').offset,{x:0,y:13,z:-4});assert.deepEqual(validateTemplate(reused),[]);
  reused.points.find(p=>p.kind==='control').offset.y=30;assert.equal(fixed.points.find(p=>p.kind==='control').location.normal,13);
});
test('大幅偏移时视图范围包含每个点位，空白输入预览仍为有限数值',()=>{
  const path=previewPath([{length:100}]),p=point();p.offset={x:1000,y:-2000,z:3};
  const rendered=previewPoint(p,path),b=previewBounds(path,[rendered]);
  for(const pos of [rendered.position,rendered.base,...path.vertices])assert.ok(pos.x>=b.x&&pos.x<=b.x+b.width&&pos.y>=b.y&&pos.y<=b.y+b.height);
  p.offset={x:'',y:'',z:''};const empty=previewPoint(p,path);assert.ok(Number.isFinite(empty.position.x)&&Number.isFinite(empty.position.y));
});
