import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,point,reuseLayout,changeTemplateSegment,changeTemplateClosure,resizeSegments,resizeCorners,validateTemplate,migrateDraft} from '../src/templateModel.mjs';
import {fixedTemplateRecord} from '../src/fixedTemplateModel.mjs';
import {addLayer,addPass} from '../src/templateLayers.mjs';
import {previewPath,previewPoint} from '../src/templatePreviewGeometry.mjs';
const make=()=>({...newTemplate('local'),name:'形状复用验证'});
const path=t=>previewPath(t.segments,'xy',t.corners,t.closure);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function samePreview(a,b){
  const ap=path(a),bp=path(b);assert.deepEqual(ap.vertices,bp.vertices);assert.deepEqual(ap.frames.map(f=>f.d),bp.frames.map(f=>f.d));
  for(let i=0;i<a.layers.length;i++)for(let j=0;j<a.layers[i].passes.length;j++){
    const aa=a.layers[i].passes[j].points,bb=b.layers[i].passes[j].points;assert.equal(aa.length,bb.length);
    aa.forEach((p,k)=>{const x=previewPoint(p,ap,'xy',false,aa),y=previewPoint(bb[k],bp,'xy',false,bb);near(x.position.x,y.position.x);near(x.position.y,y.position.y);near(x.height,y.height);assert.notEqual(p.id,bb[k].id);});
  }
}
test('非默认曲线、段长、转角及各层道点位复用后与固定模板显示一致',()=>{
  let source=changeTemplateSegment(make(),0,{geometry:'曲线',length:180,shape:{bend:65,direction:'right'}});source=changeTemplateSegment(source,1,{length:240});source.corners=[{standard:120,tolerance:8}];
  source.points[0].offset={x:5,y:3,z:2};source.points.push({...point('control',1,100,'基准偏移点'),referenceId:source.points[0].id,offset:{x:18,y:-4,z:5}});
  source=addPass(source,source.layers[0].id);source=addLayer(source);source.layers[1].height=6;
  const fixed=fixedTemplateRecord(source),dest=make();dest.leg=9;dest.groove={type:'V 形',angle:60,depth:4};dest.segments[0].position='PF · 立向上焊';
  const reused=reuseLayout(dest,fixed);samePreview(source,reused);assert.deepEqual(reused.corners,source.corners);assert.equal(reused.leg,9);assert.deepEqual(reused.groove,dest.groove);assert.equal(reused.segments[0].position,'PF · 立向上焊');assert.deepEqual(validateTemplate(reused),[]);
  reused.segments[0].shape.bend=1;assert.equal(fixed.definition.segments[0].shape.bend,65);
});
test('闭合圆弧及闭合曲线复用后仍闭合，不退回开放直线',()=>{
  for(const geometry of ['圆弧','曲线']){
    let source=resizeCorners(resizeSegments(make(),1),0);source=changeTemplateSegment(source,0,{geometry:'曲线',shape:{width:180,height:90}});source=changeTemplateClosure(source,'closed');
    if(geometry==='圆弧')source=changeTemplateSegment(source,0,{geometry,shape:{radius:65,direction:'right'}});
    const reused=reuseLayout(make(),fixedTemplateRecord(source));assert.equal(reused.closure,'closed');assert.equal(reused.segments[0].geometry,geometry);samePreview(source,reused);assert.deepEqual(validateTemplate(reused),[]);
  }
});
test('更换或重新套用固定模板时刷新几何，移除旧曲线数据并保留局部模板编号名称',()=>{
  let curved=changeTemplateSegment(make(),0,{geometry:'曲线',shape:{bend:70}}),straight=make();straight.segments[0].length=270;straight.corners[0].standard=45;
  const first=fixedTemplateRecord(curved),second=fixedTemplateRecord(straight);let draft={...make(),name:'已经保存的局部模板'};const id=draft.id;
  draft=reuseLayout(draft,first);draft=reuseLayout(draft,second);assert.equal(draft.id,id);assert.equal(draft.name,'已经保存的局部模板');assert.equal(draft.segments[0].geometry,'直线');assert.equal('shape' in draft.segments[0],false);assert.equal(draft.segments[0].length,270);assert.equal(draft.corners[0].standard,45);assert.equal(draft.reusedFromFixed.id,second.id);
  straight.segments[0].length=300;const changed=fixedTemplateRecord(straight);draft=reuseLayout(draft,changed);assert.equal(draft.segments[0].length,300);
  const restored=migrateDraft(JSON.parse(JSON.stringify({model:'111.step',welds:[],templates:[draft],fixedTemplates:[changed]})));assert.equal(restored.templates[0].reusedFromFixed.id,changed.id);samePreview(straight,restored.templates[0]);
});
