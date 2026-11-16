import test from 'node:test';import assert from 'node:assert/strict';
import {newTemplate,resizeSegments,matchTemplate,targetFromWeld} from '../src/templateModel.mjs';
import {localTemplateDiagnostics,analyzeWeldMatch} from '../src/weldMatching.mjs';
const target=t=>({id:'W001',enabled:true,closure:t.closure,leg:t.leg,segments:structuredClone(t.segments),cornerAngles:t.corners.map(c=>c.standard),groove:structuredClone(t.groove),completeStart:true,completeEnd:true,startHole:false,endHole:false});
test('整道失败指出具体属性及期望和实际值，坡口和起终点逐项区分',()=>{
 const t={...newTemplate('whole'),name:'属性诊断',mode:'exact',groove:{type:'V 形',angle:60,depth:5}},w=target(t);w.closure='closed';w.leg=8;w.completeEnd=false;w.startHole=true;w.groove={type:'V 形',angle:61,depth:7};Object.assign(w.segments[0],{position:'PF · 立向上焊',joint:'搭接接头',geometry:'曲线',length:125});
 const r=matchTemplate(t,w);assert.equal(r.ok,false);for(const label of ['开放／闭合','焊脚','完整终点','第 1 段焊接位置','第 1 段几何类型','第 1 段长度','坡口角度','坡口深度','起点过焊孔'])assert.ok(r.reasons.some(v=>v.includes(label)),label);assert.ok(r.reasons.some(v=>v.includes('模板 6 mm / 焊道 8 mm')));assert.ok(r.reasons.some(v=>v.includes('125 mm')&&v.includes('±10')));assert.ok(r.reasons.every(v=>!v.includes('undefined')));
 const d=analyzeWeldMatch(w,[t],[]);assert.equal(d.templateFailures[0].name,t.name);assert.deepEqual(d.templateFailures[0].reasons,r.reasons);
});
test('转角失败包含转角编号标准容差及实际角度',()=>{const t={...newTemplate('local'),name:'角度诊断'},w=target(t);w.cornerAngles=[110];const d=localTemplateDiagnostics(t,w);assert.equal(d.ok,false);assert.ok(d.reasons.some(v=>v.includes('转角 1')&&v.includes('90° ±5°')&&v.includes('110°')));});
test('局部失败查找最少不匹配项组合，并用焊道实际段号表示失败属性',()=>{
 const t={...resizeSegments({...newTemplate('local'),name:'单段局部'},1),cornerCount:0,corners:[]},w=target(t);w.segments=[{...w.segments[0],position:'PF · 立向上焊',geometry:'曲线'},{...w.segments[0],position:'PF · 立向上焊',geometry:'曲线'},{...w.segments[0],length:20,geometry:'圆弧'}];w.cornerAngles=[90,90];const d=localTemplateDiagnostics(t,w);assert.equal(d.ok,false);assert.deepEqual(d.segmentIndices,[2]);assert.ok(d.reasons[0].includes('第 3 段'));assert.ok(d.reasons.some(v=>v.includes('第 3 段几何类型')&&v.includes('圆弧')));
});
test('段数不足或缺失属性说明具体缺项；完整匹配不带失败提示',()=>{const t={...newTemplate('local'),name:'诊断'},w=target(t);w.segments=w.segments.slice(0,1);assert.match(localTemplateDiagnostics(t,w).reasons[0],/模板 2 段.*焊道 1 段/);const matched=localTemplateDiagnostics(t,target(t));assert.equal(matched.ok,true);assert.deepEqual(matched.reasons,[]);const absent=target(t);absent.leg=null;assert.match(matchTemplate(t,absent).reasons[0],/焊脚.*未提供/);});
