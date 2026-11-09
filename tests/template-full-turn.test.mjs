import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,addTemplateCorner,validateTemplate,matchTemplate,resizeSegments,resizeCorners} from '../src/templateModel.mjs';
import {previewPath,previewCorner,previewPoint,movePreviewPoint} from '../src/templatePreviewGeometry.mjs';
const make=()=>addTemplateCorner({...newTemplate(),name:'整道转角'});
const target=t=>({leg:t.leg,segments:t.segments,cornerAngles:t.corners.map(c=>c.standard),completeStart:true,completeEnd:true,groove:t.groove,startHole:false,endHole:false});
test('整道模板从单段直接新增转角，自动补段并保留已有点位和角度',()=>{
  let t=make();assert.equal(t.type,'whole');assert.equal(t.segments.length,2);assert.equal(t.cornerCount,1);assert.equal(t.points.find(p=>p.kind==='end').segment,2);
  t.corners[0]={standard:270,tolerance:12};t=addTemplateCorner(t);assert.equal(t.segments.length,3);assert.deepEqual(t.corners,[{standard:270,tolerance:12},{standard:90,tolerance:5}]);assert.deepEqual(validateTemplate(t),[]);
  const alreadySegmented=resizeCorners(resizeSegments({...newTemplate(),name:'已有多段'},4),0);assert.equal(addTemplateCorner(alreadySegmented).segments.length,4);
});
test('局部模板新增第二个转角自动补第三段，且仍限制三段',()=>{
  const t=addTemplateCorner({...newTemplate('local'),name:'局部'});assert.equal(t.cornerCount,2);assert.equal(t.segments.length,3);assert.equal(addTemplateCorner(t),t);
});
test('标准角度和容差允许 0–360 含两端，拒绝超出范围和非有限数值',()=>{
  const t=make();for(const standard of [0,180,181,270,359.9,360]){t.corners=[{standard,tolerance:0}];assert.deepEqual(validateTemplate(t),[]);assert.equal(matchTemplate(t,target(t)).ok,true);}
  for(const tolerance of [0,180,270,360]){t.corners=[{standard:270,tolerance}];assert.deepEqual(validateTemplate(t),[]);}
  for(const standard of [-.1,360.01,NaN,Infinity]){t.corners=[{standard,tolerance:5}];assert.ok(validateTemplate(t).length);}
  for(const tolerance of [-1,360.01,Infinity]){t.corners=[{standard:270,tolerance}];assert.ok(validateTemplate(t).length);}
});
test('大于 180 的转角逐个匹配容差，实测角度必须落在合法范围内',()=>{
  const t=make();t.corners=[{standard:270,tolerance:10}];const w=target(t);
  for(const a of [260,270,280])assert.equal(matchTemplate(t,{...w,cornerAngles:[a]}).ok,true);
  for(const a of [259.99,280.01,-1,361])assert.equal(matchTemplate(t,{...w,cornerAngles:[a]}).ok,false);
  t.corners=[{standard:350,tolerance:20}];assert.equal(matchTemplate(t,{...w,cornerAngles:[360]}).ok,true);assert.equal(matchTemplate(t,{...w,cornerAngles:[370]}).ok,false);
});
test('270 度采用优角大圆弧，360 度用两段圆弧完整绘制',()=>{
  const segments=[{length:100},{length:100}];
  const reflex=previewPath(segments,'xy',[{standard:270}]);assert.ok(reflex.vertices[2].y>99);assert.ok(Math.abs(reflex.vertices[2].x-100)<1e-7);
  const arc=previewCorner(reflex,0,10);assert.equal(arc.angle,270);assert.match(arc.d,/A10,10 0 1 /);
  const full=previewCorner(previewPath(segments,'xy',[{standard:360}]),0,10);assert.equal(full.angle,360);assert.equal((full.d.match(/A/g)||[]).length,2);assert.ok(Number.isFinite(full.label.x)&&Number.isFinite(full.label.y));
});
test('优角焊缝段的点位及拖拽坐标跟随实际新方向',()=>{
  const t=make();t.corners=[{standard:270,tolerance:5}];const path=previewPath(t.segments,'xy',t.corners),p={...t.points.find(p=>p.kind==='end'),kind:'control',percent:50};const f=path.frames[1];
  const moved=movePreviewPoint(p,f,{x:0,y:15},'along');assert.equal(moved.offset.x,15);const a=previewPoint(p,path).position,b=previewPoint(moved,path).position;assert.ok(Math.abs(b.x-a.x)<1e-7);assert.ok(Math.abs(b.y-a.y-15)<1e-7);
});
