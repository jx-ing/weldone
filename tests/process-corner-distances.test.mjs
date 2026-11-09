import test from 'node:test';
import assert from 'node:assert/strict';
import {newProcessEntry,ensureProcessLayers,processPasses,updateProcessPass,addProcessPass,validateProcessEntry,upsertProcessEntry,copyProcessEntry,applyProcessEntry} from '../src/processParameterModel.mjs';
import {mergeProcessLibrary} from '../src/processLibraryTransfer.mjs';
import {processNumberError} from '../src/processNumberRules.mjs';
const distances={inner:{before:10,after:20},outer:{before:30,after:40}};
function recipe(mode='job'){
 const p=newProcessEntry();Object.assign(p,{name:'拐角距离验证',leg:6,position:'PB · 横角焊',machineMode:mode});p.applicability.welderModel='测试焊机';
 p.start={job:1,current:180,voltage:24,correction:0,time:1};p.weld={job:2,current:190,voltage:25,correction:1,speed:300};p.end={job:3,current:170,voltage:23,correction:0,time:1};return ensureProcessLayers(p);
}
test('内外角前后距离按道独立，保存复制导入及不同模式的焊缝快照完整保留',()=>{
 for(const mode of ['job','separate','synergic']){
  let p=recipe(mode),id=processPasses(p)[0].pass.id;p=updateProcessPass(p,id,{cornerDistances:structuredClone(distances)});p=addProcessPass(p,p.processLayers[0].id,id);
  const second=processPasses(p)[1].pass;p=updateProcessPass(p,second.id,{cornerDistances:{...second.cornerDistances,outer:{...second.cornerDistances.outer,before:0}}});
  assert.deepEqual(processPasses(p)[0].pass.cornerDistances,distances);assert.equal(processPasses(p)[1].pass.cornerDistances.outer.before,0);
  const saved=upsertProcessEntry([],p)[0],copied=copyProcessEntry(saved),imported=mergeProcessLibrary([],JSON.parse(JSON.stringify({entries:[saved]})))[0];
  const applied=applyProcessEntry({leg:6,position:p.position,joint:p.joint,groove:p.groove},saved);
  for(const result of [saved,copied,imported,applied.processParameters]){assert.deepEqual(processPasses(result)[0].pass.cornerDistances,distances);assert.equal(processPasses(result)[1].pass.cornerDistances.outer.before,0);}
  saved.processLayers[0].passes[0].cornerDistances.inner.before=999;assert.equal(applied.processParameters.processLayers[0].passes[0].cornerDistances.inner.before,10);
 }
});
test('空白距离兼容旧工艺且不补写已有记录，四项距离均拒绝非法负数和非数值',()=>{
 const p=recipe(),pass=p.processLayers[0].passes[0];assert.deepEqual(pass.cornerDistances,{inner:{before:null,after:null},outer:{before:null,after:null}});
 delete pass.cornerDistances;delete p.cornerDistances;const before=structuredClone(p);assert.deepEqual(validateProcessEntry(p),[]);assert.deepEqual(p,before);
 for(const kind of ['inner','outer'])for(const key of ['before','after'])for(const value of [-1,NaN,Infinity,'10']){const invalid=structuredClone(p);invalid.processLayers[0].passes[0].cornerDistances={[kind]:{[key]:value}};assert.ok(validateProcessEntry(invalid).some(e=>e.includes('拐角')&&e.includes('距离')));}
});
test('拐角距离允许零和小数，空白可选且负数不能保存',()=>{
 assert.equal(processNumberError('0','distance'), '');assert.equal(processNumberError('1.25','distance'),'');assert.equal(processNumberError('','distance'),'');assert.ok(processNumberError('-1','distance'));assert.ok(processNumberError('bad','distance'));
});
