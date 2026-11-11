import test from 'node:test';import assert from 'node:assert/strict';
import {groupWeaveState,groupWeaveChanges} from '../src/processGroupWeave.mjs';import {processFeaturePoints} from '../src/processFeaturePoints.mjs';
import {newProcessEntry,ensureProcessLayers,processPasses,updateProcessPass,addProcessPass,copyProcessEntry,effectiveProcessEntry,validateProcessEntry} from '../src/processParameterModel.mjs';
const v={enabled:true,pattern:'triangle',amplitude:1.1,frequency:1.2,dwellLeft:.1,dwellRight:.2,centerOffset:.3};
function recipe(){let p=newProcessEntry();Object.assign(p,{name:'共用摆弧',leg:6,position:'PB · 横角焊',machineMode:'job'});p.applicability.welderModel='测试焊机';p.start={job:1,time:0};p.weld={job:2,speed:300};p.end={job:3,time:0};return ensureProcessLayers(p);}
test('拐角和包角按道统一摆弧，内外角/包角所有点同步且不改写工艺和其他道',()=>{
 let p=recipe(),pass=processPasses(p)[0].pass,id=pass.id;p=addProcessPass(p,p.processLayers[0].id,id);const other=structuredClone(processPasses(p)[1].pass),before=structuredClone(p);
 p=updateProcessPass(p,id,groupWeaveChanges(pass,'arc',v));pass=processPasses(p)[0].pass;
 assert.deepEqual(pass.cornerWeave,v);assert.ok([...processFeaturePoints(pass,'inner'),...processFeaturePoints(pass,'outer')].every(point=>JSON.stringify(point.weave)===JSON.stringify(v)&&!point.enabled));assert.deepEqual(processPasses(p)[1].pass,other);assert.deepEqual(p.weave,before.weave);
 p=updateProcessPass(p,id,groupWeaveChanges(pass,'wrap',{...v,pattern:'l',amplitude:2.2}));assert.equal(groupWeaveState(processPasses(p)[0].pass,'wrap').value.amplitude,2.2);assert.equal(processPasses(p)[0].pass.cornerWeave.amplitude,1.1);assert.deepEqual(validateProcessEntry(p),[]);
 for(const saved of [JSON.parse(JSON.stringify(p)),copyProcessEntry(p),effectiveProcessEntry(p)]){const pass=processPasses(saved)[0].pass;assert.equal(pass.cornerWeave.pattern,'triangle');assert.equal(pass.wrapWeave.pattern,'l');}
 const bad=updateProcessPass(p,id,{cornerWeave:{...v,frequency:null}});assert.ok(validateProcessEntry(bad).some(e=>e.includes('拐角摆弧')));
});
test('历史逐点摆弧只读兼容，不一致时提示统一，不任意取一个点或覆盖原数据',()=>{
 const pass=processPasses(recipe())[0].pass;pass.cornerParameters.inner[0].weave=v;pass.cornerParameters.outer[0].weave={...v,amplitude:2.2};const saved=structuredClone(pass);
 assert.equal(groupWeaveState(pass,'arc').mixed,true);assert.equal(groupWeaveState(pass,'arc').value.enabled,false);assert.deepEqual(pass,saved);
 for(const point of [...pass.cornerParameters.inner,...pass.cornerParameters.outer])point.weave=v;assert.deepEqual(groupWeaveState(pass,'arc').value,v);
});

test('一个旧点有摆弧而其他点未设置时不能冒充全组统一值',()=>{const pass=processPasses(recipe())[0].pass;pass.wrapParameters[0].weave=v;assert.equal(groupWeaveState(pass,'wrap').mixed,true);const next={...pass,...groupWeaveChanges(pass,'wrap',{...v,enabled:false})};assert.equal(groupWeaveState(next,'wrap').mixed,false);assert.equal(groupWeaveState(next,'wrap').value.enabled,false);});
