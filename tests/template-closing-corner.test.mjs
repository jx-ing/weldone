import test from 'node:test';
import assert from 'node:assert/strict';
import {newTemplate,changeTemplateClosure,changeTemplateSegment,reconcileTemplateGeometry,migrateTemplate,matchTemplate,validateTemplate} from '../src/templateModel.mjs';
import {previewPath,previewCorner} from '../src/templatePreviewGeometry.mjs';
import {addLayer} from '../src/templateLayers.mjs';

const make=()=>changeTemplateClosure({...newTemplate('whole'),name:'闭合整道角度'},'closed');
const pathOf=t=>previewPath(t.segments,'xy',t.corners,t.closure);
const target=t=>({...t,cornerAngles:t.corners.map(c=>c.standard),completeStart:true,completeEnd:true});

test('整道闭合最后一个角度可自定义，几何修改、多层和保存往返不覆盖输入',()=>{
  for(const standard of [0,90,120,180,270,360]){
    let t=make();t.corners.at(-1).standard=standard;t.corners.at(-1).tolerance=8;
    t=reconcileTemplateGeometry(t);t=changeTemplateSegment(t,0,{length:125});t=addLayer(t);t=migrateTemplate(JSON.parse(JSON.stringify(t)));
    assert.deepEqual(t.corners.at(-1),{standard,tolerance:8});assert.deepEqual(validateTemplate(t),[]);
    const path=pathOf(t);assert.deepEqual(path.vertices.at(-1),path.vertices[0]);
  }
});

test('闭合最后一个转角按自定义标准值和容差匹配，包含边界',()=>{
  let t=make();t.corners.at(-1).standard=120;t.corners.at(-1).tolerance=8;t=reconcileTemplateGeometry(t);
  for(const angle of [112,120,128]){const w=target(t);w.cornerAngles[w.cornerAngles.length-1]=angle;assert.equal(matchTemplate(t,w).ok,true);}
  for(const angle of [111.99,128.01]){const w=target(t);w.cornerAngles[w.cornerAngles.length-1]=angle;assert.equal(matchTemplate(t,w).ok,false);}
  t.corners.at(-1).standard='';assert.ok(validateTemplate(reconcileTemplateGeometry(t)).some(e=>e.includes('标准角度')));
});

test('闭合轮廓与标准角方向独立绘制，自定义角弧保持正确角度和有限坐标',()=>{
  const t=make(),path=pathOf(t),last=t.corners.length-1;
  const actual=previewCorner(path,last,15);
  assert.equal(actual.guide,null);
  for(const standard of [0,60,120,180,270,360]){
    const arc=previewCorner(path,last,15,standard);assert.ok(Math.abs(arc.angle-standard)<1e-8);
    const a={x:arc.start.x-arc.center.x,y:arc.start.y-arc.center.y},b={x:arc.end.x-arc.center.x,y:arc.end.y-arc.center.y};
    assert.ok(Math.abs((a.x*b.x+a.y*b.y)/225-Math.cos(standard*Math.PI/180))<1e-8);
    assert.equal(!!arc.guide,Math.abs(standard-actual.angle)>.05);assert.ok(!/NaN|Infinity/.test(arc.d));
  }
});
