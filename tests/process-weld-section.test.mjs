import test from 'node:test';
import assert from 'node:assert/strict';
import {newProcessEntry,ensureProcessLayers,addProcessLayer,addProcessPass,updateProcessPass,removeProcessPass} from '../src/processParameterModel.mjs';
import {processWeldSection} from '../src/processWeldSectionModel.mjs';
const entry=()=>ensureProcessLayers({...newProcessEntry(),name:'截面测试',leg:6});
test('截面焊道与各层实际道数一一对应，新增与删除实时更新且不修改数据',()=>{
 let p=entry();p=addProcessPass(p,p.processLayers[0].id);p=addProcessLayer(p);p=addProcessPass(p,p.processLayers[1].id);p=addProcessPass(p,p.processLayers[1].id);const before=structuredClone(p),model=processWeldSection(p);
 assert.equal(model.layerCount,2);assert.equal(model.passCount,5);assert.deepEqual([0,1].map(index=>model.beads.filter(b=>b.layerIndex===index).length),[2,3]);assert.equal(new Set(model.beads.map(b=>b.id)).size,5);assert.deepEqual(p,before);
 const removed=removeProcessPass(p,p.processLayers[1].id,p.processLayers[1].passes[1].id);assert.equal(processWeldSection(removed).beads.length,4);
});
test('工作角驱动对应焊道的焊丝方向，等比坐标确保正负角度显示准确',()=>{
 for(const angle of [0,30,45,90,135,180,-45,270,450]){
  let p=entry();const id=p.processLayers[0].passes[0].id;p=updateProcessPass(p,id,{angles:{pushPull:24,pitch:angle}});const model=processWeldSection(p,id),[dx,dy]=model.wire.to.map((v,i)=>v-model.wire.from[i]);assert.ok(Math.abs(dx-Math.cos(angle*Math.PI/180)*16)<1e-8);assert.ok(Math.abs(dy-Math.sin(angle*Math.PI/180)*16)<1e-8);assert.equal(model.domain.x[1]-model.domain.x[0],model.domain.y[1]-model.domain.y[0]);assert.equal(model.angle,angle);
 }
});
test('选择和删除后的回退只影响预览，焊脚变化与适应视图不覆盖工艺值',()=>{
 let p=entry();p=addProcessPass(p,p.processLayers[0].id);const id=p.processLayers[0].passes[1].id;p=updateProcessPass(p,id,{angles:{pushPull:0,pitch:60}});const before=structuredClone(p),model=processWeldSection(p,id,true);assert.equal(model.active.pass.id,id);assert.equal(model.angle,60);assert.ok(model.domain.x[1]<100);assert.deepEqual(p,before);
 const larger=processWeldSection({...p,leg:12},id);assert.equal(larger.beads[0].outer,12);assert.notDeepEqual(larger.wire.from,model.wire.from);assert.equal(processWeldSection(p,'不存在').active.pass.id,p.processLayers[0].passes[0].id);
 const missing=processWeldSection({...p,leg:null});assert.equal(missing.beads.length,0);assert.equal(missing.wire,null);
});
test('未填写工作角不虚构焊丝方向，保存往返后截面坐标保持一致',()=>{
 let p=entry();const id=p.processLayers[0].passes[0].id;p=updateProcessPass(p,id,{angles:{pushPull:0,pitch:null}});assert.equal(processWeldSection(p,id).wire,null);assert.equal(processWeldSection(p,id).angle,null);
 p=updateProcessPass(p,id,{angles:{pushPull:0,pitch:45}});assert.deepEqual(processWeldSection(JSON.parse(JSON.stringify(p)),id),processWeldSection(p,id));
});
