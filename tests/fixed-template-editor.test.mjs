import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,point,fixedLayout,reuseLayout,validateFixed,validateTemplate,migrateDraft,changeTemplateSegment} from '../src/templateModel.mjs';
import {fixedTemplateRecord,fixedTemplateDraft} from '../src/fixedTemplateModel.mjs';
import {addLayer,addPass} from '../src/templateLayers.mjs';
const make=()=>({...newTemplate('local'),name:'固定模板示例'});

test('固定模板保存局部模板同样的匹配条件、形状和多层道编辑内容，并提取位置骨架',()=>{
  let t=make();t=changeTemplateSegment(t,0,{geometry:'曲线',shape:{bend:60,direction:'right'}});t.leg=8;t.corners[0]={standard:120,tolerance:7};
  t.points[0].offset={x:5,y:3,z:2};t.points[0].overrides={current:260};t.points[0].tracking='激光跟踪';
  t=addPass(t,t.layers[0].id);t=addLayer(t);t.layers[1].height=3;t.layers[1].passes[0].offset={y:4,z:1};
  const f=fixedTemplateRecord(t);assert.equal(f.id,t.id);assert.deepEqual(validateFixed(f),[]);assert.deepEqual(f.definition,t);assert.equal(f.layers.length,2);assert.equal(f.layers[0].passes.length,2);
  assert.deepEqual(f.points[0].location,{along:5,normal:3,height:2});assert.equal('overrides' in f.points[0],false);assert.equal('tracking' in f.layers[1].passes[0].points[0],false);
});
test('固定模板再次编辑和保存保持编号，名称和点位修改经草稿往返完整保留',()=>{
  const f=fixedTemplateRecord(make()),draft=fixedTemplateDraft(f);draft.name='修改后的固定模板';draft.points[0].offset.x=13;draft.layers[0].passes[0].points=draft.points;
  const edited=fixedTemplateRecord(draft);assert.equal(edited.id,f.id);assert.equal(edited.points[0].location.along,13);assert.equal(edited.definition.name,edited.name);
  const restored=migrateDraft(JSON.parse(JSON.stringify({model:'111.step',welds:[],templates:[],fixedTemplates:[edited]}))).fixedTemplates[0];assert.deepEqual(validateFixed(restored),[]);assert.deepEqual(fixedTemplateDraft(restored),draft);
});
test('多层道固定模板复用带入定位形状和转角，保留焊脚等业务条件，清空姿态跟踪工艺',()=>{
  let source=make();source.leg=8;source.corners[0].standard=120;
  source.points.push({...point('control',1,0,'人工点'),referenceId:source.points[0].id,offset:{x:11,y:4,z:2},angles:{advance:20,rotation:30,work:70},tracking:'激光跟踪',overrides:{current:300}});
  source=addLayer(source);source.layers[1].height=6;source.layers[1].passes[0].offset={y:2,z:1};const fixed=fixedTemplateRecord(source);
  const dest=make();dest.name='新局部模板';dest.leg=5.5;dest.corners[0].standard=75;const reused=reuseLayout(dest,fixed);assert.equal(reused.leg,5.5);assert.equal(reused.corners[0].standard,120);assert.equal(reused.name,dest.name);assert.equal(reused.layers.length,2);assert.equal(reused.layers[1].height,6);assert.deepEqual(reused.layers[1].passes[0].offset,{y:2,z:1});
  for(const l of reused.layers)for(const pass of l.passes){const manual=pass.points.find(p=>p.kind==='control'&&!p.autoRole);assert.deepEqual(manual.offset,{x:11,y:4,z:2});assert.deepEqual(manual.overrides,{});assert.deepEqual(manual.angles,{advance:0,rotation:0,work:45});assert.equal(manual.tracking,'无跟踪');assert.ok(pass.points.some(p=>p.id===manual.referenceId));}
  assert.deepEqual(validateTemplate(reused),[]);reused.points[0].offset.x=999;assert.notEqual(fixed.points[0].location.along,999);
});
test('旧版点位固定骨架可直接打开为局部编辑器并升级保存，位置和引用不丢失',()=>{
  const t=make(),manual={...point(),referenceId:t.points[0].id,segment:1,percent:100,location:{along:15,normal:-3,height:4}};t.points.push(manual);
  const legacy=fixedLayout(t),draft=fixedTemplateDraft(legacy);assert.equal(draft.id,legacy.id);assert.equal(draft.name,legacy.name);assert.deepEqual(validateTemplate(draft),[]);assert.deepEqual(draft.points.find(p=>p.kind==='control'&&!p.autoRole).offset,{x:15,y:-3,z:4});
  const saved=fixedTemplateRecord(draft);assert.equal(saved.id,legacy.id);assert.deepEqual(validateFixed(saved),[]);assert.ok(saved.definition);
});
test('固定模板编辑内容、骨架层道和位置必须有效，不能保存失效引用',()=>{
  const f=fixedTemplateRecord(make());f.definition.name='不一致名称';assert.ok(validateFixed(f).length);f.definition.name=f.name;
  f.layers[0].passes[0].offset.y=NaN;assert.ok(validateFixed(f).length);f.layers[0].passes[0].offset.y=0;f.layers=[];assert.ok(validateFixed(f).length);
  const draft=make();draft.points.push(point());assert.ok(validateFixed(fixedTemplateRecord(draft)).some(e=>e.includes('基准点')));
});
