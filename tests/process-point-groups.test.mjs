import test from 'node:test';
import assert from 'node:assert/strict';
import {newProcessEntry,ensureProcessLayers,processPasses,updateProcessFeaturePoint,updateProcessPass,addProcessLayer,addProcessPass,effectiveProcessEntry,validateProcessEntry,upsertProcessEntry,copyProcessEntry} from '../src/processParameterModel.mjs';
import {processFeaturePoints} from '../src/processFeaturePoints.mjs';
import {mergeProcessLibrary} from '../src/processLibraryTransfer.mjs';

function recipe(mode='job'){
 const p=newProcessEntry();Object.assign(p,{name:'分组点位测试',leg:6,position:'PB · 横角焊',machineMode:mode});p.applicability.welderModel='测试焊机';
 p.start={job:1,current:180,voltage:24,correction:0,time:0};p.weld={job:2,current:190,voltage:25,correction:1,speed:300};p.end={job:3,current:170,voltage:23,correction:0,time:0};return ensureProcessLayers(p);
}
test('内外角和包角逐点摆弧独立复制导入并进入应用快照',()=>{
 let p=recipe(),id=processPasses(p)[0].pass.id;
 const cases=[['inner',0,'sine',1.1],['outer',2,'triangle',2.2],['wrap',6,'l',3.3]];
 for(const [kind,index,pattern,amplitude] of cases)p=updateProcessFeaturePoint(p,id,kind,index,{enabled:true,job:11,time:1.23,weave:{enabled:true,pattern,amplitude,frequency:1.2,dwellLeft:.1,dwellRight:.2,centerOffset:.3}});
 assert.deepEqual(validateProcessEntry(p),[]);
 const saved=upsertProcessEntry([],p)[0],copy=copyProcessEntry(saved),imported=mergeProcessLibrary([],JSON.parse(JSON.stringify({entries:[saved]})))[0],snapshot=effectiveProcessEntry(saved);
 for(const source of [saved,copy,imported,snapshot])for(const [kind,index,pattern,amplitude] of cases){const value=processFeaturePoints(processPasses(source)[0].pass,kind)[index];assert.equal(value.weave.pattern,pattern);assert.equal(value.weave.amplitude,amplitude);}
 assert.equal(processPasses(snapshot)[0].pass.weave.enabled,false);
 const pass=processPasses(p)[0].pass;const bad=updateProcessFeaturePoint(p,id,'wrap',6,{weave:{...pass.wrapParameters[6].weave,frequency:null}});assert.ok(validateProcessEntry(bad).some(message=>message.includes('包角点7摆弧')));
});
test('新工艺默认内外角各三点、包角七点，各点和各道相互独立',()=>{
 let p=recipe(),first=processPasses(p)[0].pass;assert.equal(first.cornerParameters.inner.length,3);assert.equal(first.cornerParameters.outer.length,3);assert.equal(first.wrapParameters.length,7);assert.ok([...first.cornerParameters.inner,...first.cornerParameters.outer,...first.wrapParameters].every(point=>!point.enabled&&point.current===null));
 const original=structuredClone(p);p=updateProcessFeaturePoint(p,first.id,'inner',2,{enabled:true,job:8,time:1});p=updateProcessFeaturePoint(p,first.id,'outer',0,{enabled:true,job:9,time:2});p=updateProcessFeaturePoint(p,first.id,'wrap',6,{enabled:true,job:10,time:3});assert.equal(original.processLayers[0].passes[0].cornerParameters.inner[2].job,null);
 p=addProcessPass(p,p.processLayers[0].id,first.id);p=addProcessLayer(p,first.id);const second=processPasses(p)[1].pass.id;p=updateProcessFeaturePoint(p,second,'wrap',6,{job:11});assert.equal(processPasses(p)[0].pass.wrapParameters[6].job,10);assert.equal(processPasses(p)[1].pass.wrapParameters[6].job,11);assert.equal(processPasses(p)[2].pass.wrapParameters[6].job,10);assert.equal(p.weld.job,2);
});
test('保存、复制和JSON导入保留分组点位，应用快照保留固定点序号并过滤模式参数',()=>{
 for(const mode of ['job','separate','synergic']){let p=recipe(mode),id=processPasses(p)[0].pass.id;for(const [kind,index] of [['inner',2],['outer',1],['wrap',6]])p=updateProcessFeaturePoint(p,id,kind,index,{enabled:true,job:12,current:210,voltage:26,correction:2,time:1});assert.deepEqual(validateProcessEntry(p),[]);
 const saved=upsertProcessEntry([],p)[0],copy=copyProcessEntry(saved),imported=mergeProcessLibrary([],JSON.parse(JSON.stringify({entries:[saved]})))[0];assert.deepEqual(processPasses(imported)[0].pass.wrapParameters,processPasses(saved)[0].pass.wrapParameters);assert.notEqual(copy.processLayers[0].passes[0].id,id);
 const result=processPasses(effectiveProcessEntry(saved))[0].pass;assert.deepEqual(result.cornerParameters.inner[0],{enabled:false});assert.equal(result.cornerParameters.inner.length,3);assert.equal(result.cornerParameters.outer.length,3);assert.equal(result.wrapParameters.length,7);assert.equal(result.wrapParameters[6].enabled,true);const point=result.wrapParameters[6];assert.equal(point.time,1);if(mode==='job')assert.deepEqual(point,{enabled:true,job:12,time:1});else{assert.equal(point.current,210);assert.ok(!('job' in point));assert.equal(point[mode==='separate'?'voltage':'correction'],mode==='separate'?26:2);assert.ok(!((mode==='separate'?'correction':'voltage') in point));}}
});
test('启用点严格校验、禁用点允许留空，组长度和点位置不能越界',()=>{
 let p=recipe(),id=processPasses(p)[0].pass.id;p=updateProcessFeaturePoint(p,id,'outer',2,{enabled:true,job:null,time:-1});assert.ok(validateProcessEntry(p).some(v=>v.includes('外角点3JOB')));assert.ok(validateProcessEntry(p).some(v=>v.includes('外角点3动作时间')));p=updateProcessFeaturePoint(p,id,'outer',2,{enabled:false});assert.deepEqual(validateProcessEntry(p),[]);
 p=updateProcessPass(p,id,{wrapParameters:[]});assert.ok(validateProcessEntry(p).some(v=>v.includes('包角点必须包含7个点')));for(const [kind,index] of [['inner',3],['outer',-1],['wrap',7],['missing',0]])assert.throws(()=>updateProcessFeaturePoint(p,id,kind,index,{}));
});
test('旧平铺拐角只在显式分组编辑时迁移，保留完整原数组备份',()=>{
 let p=recipe(),id=processPasses(p)[0].pass.id;const legacy=Array.from({length:8},(_,i)=>({enabled:true,job:i,time:0}));p=updateProcessPass(p,id,{cornerParameters:legacy});const before=structuredClone(p);assert.equal(processFeaturePoints(processPasses(p)[0].pass,'inner')[0].job,0);assert.equal(processFeaturePoints(processPasses(p)[0].pass,'outer')[2].job,5);assert.deepEqual(p,before);assert.deepEqual(validateProcessEntry(p),[]);
 const next=updateProcessFeaturePoint(p,id,'outer',1,{job:20}),pass=processPasses(next)[0].pass;assert.deepEqual(pass.legacyCornerParameters,legacy);assert.equal(pass.cornerParameters.inner[2].job,2);assert.equal(pass.cornerParameters.outer[1].job,20);assert.deepEqual(p,before);
});
