import test from 'node:test';
import assert from 'node:assert/strict';
import { newTemplate, resizeSegments, resizeCorners, migrateTemplate, migrateDraft, validateTemplate, matchTemplate, fixedLayout, reuseLayout } from '../src/templateModel.mjs';
import { previewPath, previewCorner, previewPoint, movePreviewPoint } from '../src/templatePreviewGeometry.mjs';
const make = () => resizeCorners(resizeSegments({...newTemplate(),name:'逐转角'},3),2);
const measured = t => ({leg:t.leg,segments:structuredClone(t.segments),cornerAngles:t.corners.map(c=>c.standard),completeStart:true,completeEnd:true,groove:{...t.groove},startHole:false,endHole:false});
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('每增加一个转角增加一组独立的标准角度和容差，缩减不改变保留项',()=>{
  let t=resizeCorners(resizeSegments({...newTemplate(),name:'新增'},3),1);t.corners[0]={standard:65,tolerance:2.5};
  t=resizeCorners(t,2);assert.deepEqual(t.corners,[{standard:65,tolerance:2.5},{standard:90,tolerance:5}]);
  const smaller=resizeSegments(t,2);assert.equal(smaller.cornerCount,1);assert.deepEqual(smaller.corners,[{standard:65,tolerance:2.5}]);
  assert.deepEqual(validateTemplate(smaller),[]);assert.deepEqual(resizeCorners(smaller,0).corners,[]);
});

test('不同转角使用各自的标准与容差，包含边界且不能交换顺序',()=>{
  const t=make();t.corners=[{standard:60,tolerance:2},{standard:120,tolerance:10}];const w=measured(t);
  assert.equal(matchTemplate(t,w).ok,true);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[58,130]}).ok,true);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[62,110]}).ok,true);
  assert.match(matchTemplate(t,{...w,cornerAngles:[62.01,120]}).reasons.join(),/转角 1/);
  assert.match(matchTemplate(t,{...w,cornerAngles:[60,130.01]}).reasons.join(),/转角 2/);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[120,60]}).ok,false);
});

test('旧版共享范围转为每转角的中心值与半区间，迁移前后边界一致',()=>{
  const old=make();delete old.corners;old.angleMin=82.5;old.angleMax=97;
  const t=migrateTemplate(old);assert.deepEqual(t.corners,[{standard:89.75,tolerance:7.25},{standard:89.75,tolerance:7.25}]);
  assert.equal('angleMin' in t,false);assert.equal('angleMax' in t,false);
  const w=measured(t);assert.equal(matchTemplate(t,{...w,cornerAngles:[82.5,97]}).ok,true);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[82.49,97]}).ok,false);
  assert.deepEqual(migrateTemplate(t),t);
  const draft={templates:[old],welds:[],model:''};assert.deepEqual(migrateDraft(draft).templates[0].corners,t.corners);
});

test('拒绝缺组、空值、负容差及无效角度；零容差支持精确角度匹配',()=>{
  const t=make();t.corners=[{standard:90,tolerance:0},{standard:180,tolerance:0}];assert.deepEqual(validateTemplate(t),[]);
  const w=measured(t);assert.equal(matchTemplate(t,w).ok,true);assert.equal(matchTemplate(t,{...w,cornerAngles:[90.01,180]}).ok,false);
  for(const bad of [{standard:'',tolerance:5},{standard:361,tolerance:5},{standard:90,tolerance:-1},{standard:90,tolerance:Infinity}])assert.ok(validateTemplate({...t,corners:[bad,t.corners[1]]}).length);
  assert.ok(validateTemplate({...t,corners:t.corners.slice(1)}).length);
});

test('示意图夹角等于各自标准角度，容差变化不改变图形；XZ 保持展开',()=>{
  const segments=Array.from({length:3},()=>({length:100})),corners=[{standard:60,tolerance:5},{standard:120,tolerance:10}];
  const path=previewPath(segments,'xy',corners);
  corners.forEach((c,i)=>{const a=path.frames[i].tangent,b=path.frames[i+1].tangent;near(Math.acos(Math.max(-1,Math.min(1,-a.x*b.x-a.y*b.y)))*180/Math.PI,c.standard);const arc=previewCorner(path,i,10);near(Math.hypot(arc.start.x-arc.center.x,arc.start.y-arc.center.y),10);assert.ok(Number.isFinite(arc.label.x));});
  assert.deepEqual(previewPath(segments,'xy',corners.map(c=>({...c,tolerance:50}))),path);
  assert.deepEqual(previewPath(segments,'xz',corners).vertices,[{x:0,y:0},{x:100,y:0},{x:200,y:0},{x:300,y:0}]);
  const straight=previewPath(segments,'xy',[]);assert.ok(straight.vertices.every(v=>v.y===0));
});

test('0° 与 180° 标准夹角的示意保持有限，修改角度后的点位与拖拽使用新方向',()=>{
  for(const standard of [0,180]){const path=previewPath([{length:100},{length:100}],'xy',[{standard}]);const arc=previewCorner(path,0,10);assert.ok(Number.isFinite(arc.label.x)&&Number.isFinite(arc.label.y));}
  const t=make();t.points[1].segment=3;const path=previewPath(t.segments,'xy',[{standard:75},{standard:130}]);const p={...t.points[1],percent:50,kind:'control'},f=path.frames[2];
  const moved=movePreviewPoint(p,f,{x:f.tangent.x*20,y:f.tangent.y*20},'along');const original=previewPoint(p,path).position,newPosition=previewPoint(moved,path).position;
  near(newPosition.x-original.x,f.tangent.x*20);near(newPosition.y-original.y,f.tangent.y*20);
});

test('固定点位骨架复用保持新模板自己的角度条件',()=>{
  const source={...newTemplate('local'),name:'骨架'},dest={...newTemplate('local'),name:'局部',corners:[{standard:135,tolerance:3}]};
  const reused=reuseLayout(dest,fixedLayout(source));assert.deepEqual(reused.corners,dest.corners);assert.equal('corners' in fixedLayout(source),false);
});
