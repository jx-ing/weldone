import test from 'node:test';
import assert from 'node:assert/strict';
import { newTemplate, point, resizeSegments, resizeCorners, validateTemplate, fixedLayout, validateFixed, reuseLayout, migrateDraft, matchTemplate, targetFromWeld, applyTemplateToWeld } from '../src/templateModel.mjs';

const whole = () => ({ ...newTemplate(), name: '整道测试' });
const target = t => ({ leg:t.leg, segments:structuredClone(t.segments), cornerAngles:Array.from({length:t.cornerCount}, () => 90), completeStart:true, completeEnd:true, atConnection:t.type === 'local', groove:structuredClone(t.groove), startHole:t.startHole, endHole:t.endHole });

test('整道只允许完整起终点，逐项匹配焊脚、数量、顺序、几何和过焊孔', () => {
  const t = resizeCorners(resizeSegments(whole(), 2),1); t.segments[1].position='PF · 立向上焊';
  const w = target(t); assert.equal(matchTemplate(t,w).ok,true);
  for (const key of ['completeStart','completeEnd']) assert.equal(matchTemplate(t,{...w,[key]:false}).ok,false);
  assert.equal(matchTemplate(t,{...w,leg:5.5}).ok,false);
  assert.equal(matchTemplate(t,{...w,segments:[...w.segments].reverse()}).ok,false);
  assert.equal(matchTemplate(t,{...w,segments:w.segments.slice(0,1)}).ok,false);
  assert.equal(matchTemplate(t,{...w,startHole:true}).ok,false);
  const legacy=structuredClone(w);legacy.segments[1].joint='搭接接头';assert.equal(matchTemplate(t,legacy).ok,true);
  for (const [key, value] of [['position','PA · 平焊'],['geometry','圆弧']]) { const changed=structuredClone(w);changed.segments[1][key]=value;assert.equal(matchTemplate(t,changed).ok,false); }
});

test('转角标准角度与容差逐个匹配，k=0 时无角度条件', () => {
  const t = resizeCorners(resizeSegments(whole(),3),2); t.corners=[{standard:90,tolerance:5},{standard:90,tolerance:5}];
  const w=target(t); assert.equal(matchTemplate(t,w).ok,true);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[85,95]}).ok,true);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[90,96]}).ok,false);
  assert.equal(matchTemplate(t,{...w,cornerAngles:[90]}).ok,false);
  t.cornerCount=0;t.corners=[];assert.deepEqual(validateTemplate(t),[]);
});

test('精确模式逐段长度误差默认 10 mm，边界包含且可调整', () => {
  const t=resizeSegments(whole(),2),w=target(t);w.segments[0].length=110;w.segments[1].length=90;t.mode='exact';
  assert.equal(t.tolerance,10);assert.equal(matchTemplate(t,w).ok,true);
  w.segments[1].length=89.9;assert.equal(matchTemplate(t,w).ok,false);
  t.tolerance=11;assert.equal(matchTemplate(t,w).ok,true);
  t.mode='standard';w.segments[0].length=10000;assert.equal(matchTemplate(t,w).ok,true);
});

test('坡口类型、角度、深度必须匹配', () => {
  const t=whole();t.groove={type:'V 形',angle:60,depth:5};const w=target(t);
  assert.equal(matchTemplate(t,w).ok,true);
  for(const [key,value] of [['type','X 形'],['angle',61],['depth',6]]) assert.equal(matchTemplate(t,{...w,groove:{...w.groove,[key]:value}}).ok,false);
});

test('局部最多三段，不要求连接点标记，每段不再受适用长度范围约束', () => {
  const t={...newTemplate('local'),name:'局部测试'},w=target(t);assert.equal(matchTemplate(t,w).ok,true);
  assert.equal(matchTemplate(t,{...w,atConnection:false}).ok,true);
  w.segments[1].length=20;assert.equal(matchTemplate(t,w).ok,true);
  w.segments[1].length=.1;assert.equal(matchTemplate(t,w).ok,true);w.segments[1].length=0;assert.equal(matchTemplate(t,w).ok,false);
  assert.ok(validateTemplate(resizeSegments(t,4)).length);
  assert.deepEqual(validateTemplate(resizeSegments(t,3)),[]);
});

test('点位增改、缩段后两端保持有效，拒绝无效数字和 0.5 以外焊脚步长', () => {
  let t=whole();t.points.push({...point(),referenceId:t.points[0].id});assert.deepEqual(validateTemplate(t),[]);
  t=resizeSegments(t,3);t.points[1].segment=3;t=resizeSegments(t,1);assert.deepEqual(validateTemplate(t),[]);
  t.leg=6.1;assert.ok(validateTemplate(t).length);t.leg=6.5;assert.deepEqual(validateTemplate(t),[]);
  t.points[0].offset.x='';assert.ok(validateTemplate(t).length);t.points[0].offset.x=0;
  t.points[0].overrides={speed:-1};assert.ok(validateTemplate(t).length);
  t.points[0].overrides={amplitude:0,frequency:1,dwellLeft:0,dwellRight:0};assert.deepEqual(validateTemplate(t),[]);
});

test('固定模板仅保存点位骨架；复用不得带入匹配条件、姿态、跟踪或工艺覆盖', () => {
  const original={...newTemplate('local'),name:'固定骨架',leg:8};original.points.push({...point('control',2,25,'控制点1'),referenceId:original.points[0].id});
  original.points[0].offset.x=12;original.points[0].tracking='激光跟踪';original.points[0].overrides={current:300};
  const f=fixedLayout(original);assert.deepEqual(validateFixed(f),[]);
  assert.deepEqual(Object.keys(f).sort(),['id','name','points','segmentCount']);
  assert.deepEqual(Object.keys(f.points[0]).sort(),['anchorRole','id','kind','name','percent','referenceId','segment']);
  const blank={...newTemplate('local'),name:'独立新模板',leg:5.5};const reused=reuseLayout(blank,f);
  assert.equal(reused.leg,5.5);assert.equal(reused.name,'独立新模板');assert.equal(reused.points.find(p=>p.kind==='control'&&!p.autoRole).percent,100);
  assert.equal(reused.points[0].offset.x,0);assert.equal(reused.points[0].tracking,'无跟踪');assert.deepEqual(reused.points[0].overrides,{});
  reused.points[0].percent=22;assert.equal(f.points[0].percent,100);assert.notEqual(reused.points[0].id,f.points[0].id);
});

test('应用时复制完整点位参数并解析位置，修改模板不影响已应用副本', () => {
  const t=whole();t.points.push({...point('control',1,0),referenceId:t.points[0].id,offset:{x:25,y:0,z:0}});t.points[2].tracking='电弧跟踪';t.points[2].overrides={current:220,amplitude:3};
  const w={...target(t),id:'W001',length:100,current:200,voltage:23,speed:300};const applied=applyTemplateToWeld(w,t);
  assert.deepEqual(applied.controlPoints.map(p => p.kind),['start','control','end']);
  assert.equal(applied.controlPoints[1].distance,25);assert.equal(applied.controlPoints[1].tracking,'电弧跟踪');
  t.points[2].overrides.current=999;assert.equal(applied.controlPoints[1].overrides.current,220);assert.equal(applied.current,200);
  assert.throws(()=>applyTemplateToWeld({...w,completeEnd:false},t),/完整/);
});

test('旧模板迁移保留参数，新旧草稿往返保留固定骨架和点位', () => {
  const old={model:'',project:'本地项目',selected:'',welds:[],templates:[{id:'legacy',name:'旧模板',leg:6,current:210,voltage:24.5,speed:340,joint:'T 形接头',position:'PB · 横角焊'}]};
  const migrated=migrateDraft(old);assert.deepEqual(validateTemplate(migrated.templates[0]),[]);assert.equal(migrated.templates[0].points[0].overrides.current,210);
  migrated.fixedTemplates.push(fixedLayout({...newTemplate('local'),name:'骨架'}));
  const restored=migrateDraft(JSON.parse(JSON.stringify(migrated)));assert.deepEqual(restored,migrated);
});

test('缺少完整性证据的焊道禁止整道匹配', () => {
  const t=whole(),w=targetFromWeld({leg:6,length:100,position:'PB · 横角焊',joint:'T 形接头'});
  assert.equal(matchTemplate(t,w).ok,false);assert.equal(matchTemplate(t,null).ok,false);
});
