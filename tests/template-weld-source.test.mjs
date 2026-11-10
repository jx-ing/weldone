import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,newWholeTemplateFromWeld,wholeWeldSourceIssues,reconcileTemplateGeometry,changeTemplateSegment,migrateTemplate,migrateDraft,validateTemplate,matchTemplate,segmentLengthTolerance} from '../src/templateModel.mjs';
import {addLayer,addPass,updatePass} from '../src/templateLayers.mjs';

const source=()=>({id:'W001',name:'两段提取焊道',completeStart:true,completeEnd:true,closure:'open',leg:6.5,segments:[{position:'PB · 横角焊',joint:'T 形接头',geometry:'直线',length:180},{position:'PF · 立向上焊',joint:'角接接头',geometry:'曲线',length:90,shape:{bend:25,direction:'left'}}],cornerAngles:[120],groove:{type:'V 形',angle:60,depth:4},startHole:true,endHole:false});
const make=w=>({...newWholeTemplateFromWeld('已提取模型',[w],w.id),name:'来源整道模板'});

test('整道新建必须选择当前模型的有效完整焊道，不能使用空白或列表外的焊道',()=>{
  const w=source();assert.deepEqual(wholeWeldSourceIssues('已提取模型',w),[]);
  assert.throws(()=>newWholeTemplateFromWeld('',[w],w.id),/加载模型/);
  assert.throws(()=>newWholeTemplateFromWeld('已提取模型',[],w.id),/提取焊道或选择已有焊道/);
  assert.throws(()=>newWholeTemplateFromWeld('已提取模型',[w],'W999'),/提取焊道或选择已有焊道/);
  for(const [key,value] of [['completeStart',false],['completeEnd',false],['segments',undefined],['segments',[null]],['segments','invalid'],['cornerAngles',undefined],['closure',undefined],['groove',undefined],['startHole',undefined],['leg',6.1]])assert.throws(()=>make({...w,[key]:value}));
  assert.ok(wholeWeldSourceIssues('已提取模型',{...w,closure:'closed',segments:[null]}).length);
});

test('自动逐项带入模型焊道的条件和几何，不携带原焊道工艺覆盖',()=>{
  const w=source(),t=make(w);assert.deepEqual(validateTemplate(t),[]);
  assert.deepEqual(t.sourceWeld,{model:'已提取模型',id:'W001',name:w.name});assert.equal(t.mode,'exact');
  for(const k of ['leg','closure','groove','startHole','endHole'])assert.deepEqual(t[k],w[k]);
  assert.equal(t.cornerCount,1);assert.deepEqual(t.corners,[{standard:120,tolerance:5,angleSide:'inner'}]);
  assert.deepEqual(t.segments,w.segments.map(({joint,...s})=>({...s,lengthTolerance:10})));assert.equal(t.points.filter(p=>p.kind==='junction').length,1);
  assert.deepEqual(t.points[0].overrides,{});assert.equal(matchTemplate(t,w).ok,true);
  w.segments[0].length=999;assert.equal(t.segments[0].length,180);
});

test('每段使用各自的长度容差，精确模式包含边界，普通模式保留但不应用长度容差',()=>{
  const w=source(),t=make(w);t.segments[0].lengthTolerance=2;t.segments[1].lengthTolerance=15;
  w.segments[0].length=182;w.segments[1].length=75;assert.equal(matchTemplate(t,w).ok,true);
  w.segments[0].length=182.01;assert.match(matchTemplate(t,w).reasons.join('；'),/第 1 段长度超出 ±2 mm/);
  w.segments[0].length=180;w.segments[1].length=74.99;assert.match(matchTemplate(t,w).reasons.join('；'),/第 2 段长度超出 ±15 mm/);
  t.segments[0].lengthTolerance=0;w.segments[0].length=180.01;assert.equal(matchTemplate(t,w).ok,false);
  t.mode='standard';assert.equal(matchTemplate(t,w).ok,true);assert.equal(t.segments[1].lengthTolerance,15);
  for(const lengthTolerance of [-1,'',NaN,Infinity]){t.segments[0].lengthTolerance=lengthTolerance;assert.ok(validateTemplate(t).some(e=>e.includes('第 1 段长度容差')));}
});

test('闭合来源几何不会重新推导覆盖模型尺寸或标准角，多层与持久化完整保留条件及逐段容差',()=>{
  const w={...source(),closure:'closed',segments:[...source().segments,{position:'PB · 横角焊',joint:'T 形接头',geometry:'圆弧',length:115.12,shape:{radius:55,arcAngle:120,direction:'left'}}],cornerAngles:[110,145]};
  let t=make(w);t.corners[1].tolerance=12;t.segments[0].lengthTolerance=3;t.segments[1].lengthTolerance=7;t.segments[2].lengthTolerance=1;
  const conditions=structuredClone({segments:t.segments,corners:t.corners,sourceWeld:t.sourceWeld});
  t=addLayer(t);t=addPass(t,t.layers[0].id);t=updatePass(t,t.layers[0].passes[1].id,{offset:{y:2,z:4}});t=reconcileTemplateGeometry(t);
  t=migrateTemplate(JSON.parse(JSON.stringify(t)));assert.deepEqual({segments:t.segments,corners:t.corners,sourceWeld:t.sourceWeld},conditions);assert.equal(t.layers.length,2);assert.deepEqual(validateTemplate(t),[]);
});

test('旧共享容差迁移到每一段，逐段已有值优先保留，局部匹配不受长度容差影响',()=>{
  let old={...newTemplate(),name:'旧模板',tolerance:6};old.segments.push({...old.segments[0],lengthTolerance:2});old=migrateTemplate(old);
  assert.deepEqual(old.segments.map(s=>s.lengthTolerance),[6,2]);assert.equal(segmentLengthTolerance(old,old.segments[0]),6);
  const local={...newTemplate('local'),name:'局部保持'};assert.deepEqual(validateTemplate(local),[]);
});

test('复制整道仍需重新选择模型焊道，条件取自来源，工艺与点位独立复制',()=>{
  const w=source(),original=make(w);original.points[0].overrides={current:240};
  const different={...source(),id:'W002',leg:8,cornerAngles:[90]};const copy=newWholeTemplateFromWeld('已提取模型',[different],different.id,original);
  assert.notEqual(copy.id,original.id);assert.equal(copy.sourceWeld.id,'W002');assert.equal(copy.leg,8);assert.equal(copy.corners[0].standard,90);assert.equal(copy.points[0].overrides.current,240);
  copy.points[0].overrides.current=999;assert.equal(original.points[0].overrides.current,240);
});

test('旧版示例焊道补充明确段数据，未知模型缺失提取数据时禁止新建整道',()=>{
  const simple={id:'W001',name:'旧版示例',length:100,position:'PB · 横角焊',joint:'T 形接头',leg:6};
  const sample=migrateDraft({model:'肋板组件 A',welds:[simple],templates:[]});assert.deepEqual(wholeWeldSourceIssues(sample.model,sample.welds[0]),[]);
  const unknown=migrateDraft({model:'未知模型',welds:[simple],templates:[]});assert.ok(wholeWeldSourceIssues(unknown.model,unknown.welds[0]).length);
});
