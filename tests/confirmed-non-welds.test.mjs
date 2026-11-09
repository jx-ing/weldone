import test from 'node:test';import assert from 'node:assert/strict';
import {excludeConfirmedNonWelds,repairConfirmedNonWeldStorage} from '../src/confirmedNonWelds.mjs';
const sha='c85056ed9022210cd93e48bc4d09b97615c57a70235f4f55d986e6a2bdec4fc8';
test('源几何复现按模型指纹排除，无关人工记录不受影响，完整备份且不重排其余编号',()=>{
 const a={id:'W99999',source:'extracted',sourceSha256:sha,processingKey:'unit:W0002|1',segments:[{pathPoints:[[0,0,0],[1,1,1]]}]};
 const b={id:'W90011',source:'manual',processingKey:'unit:W0002|1'};
 const c={id:'W90034',source:'extracted',sourceSha256:'another-model',processingKey:'unit:W0079|0'};
 const d={model:'111.step',welds:[a,b,c],selected:a.id,templates:[{id:'t'}],processLibrary:[{id:'p'}]};
 const out=excludeConfirmedNonWelds(d);assert.deepEqual(out.welds,[b,c]);assert.equal(out.selected,b.id);
 assert.strictEqual(out.templates,d.templates);assert.strictEqual(out.processLibrary,d.processLibrary);
 assert.deepEqual(out.rejectedGeometryWelds[0].segments,a.segments);assert.equal(out.rejectedGeometryWelds[0].id,a.id);
 assert.equal(d.welds.length,3);assert.strictEqual(excludeConfirmedNonWelds(out),out);
 const restored=excludeConfirmedNonWelds({...out,welds:[...out.welds,a]});assert.equal(restored.rejectedGeometryWelds.length,1);
 assert.strictEqual(excludeConfirmedNonWelds({...d,model:'other.step'}).welds,d.welds);
});

test('迁移写回已保存草稿，重开后四条不再出现，备份完整且无关保存内容不变',()=>{
 const keys=['merge:W0034|0;W0035|0','unit:W0002|1','unit:W0002|2','unit:W0079|0'];
 const rejected=keys.map((processingKey,i)=>({id:['W10001','W10011','W10012','W10034'][i],source:'extracted',sourceSha256:sha,processingKey,segments:[{length:i+100}]}));
 const keep={id:'W10002',source:'extracted',sourceSha256:sha,processingKey:'keep',name:'原保存名称'};
 const saved={model:'111.step',welds:[...rejected,keep],selected:'W10011',project:'已保存项目',templates:[{id:'t'}],processLibrary:[{id:'p'}]};
 let json=JSON.stringify(saved),writes=0;
 const storage={getItem:()=>json,setItem:(key,value)=>{json=value;writes++;}};
 const live={...saved,project:'另一个尚未保存的项目名'};
 assert.equal(repairConfirmedNonWeldStorage(storage),true);
 const reopened=JSON.parse(json);assert.deepEqual(reopened.welds,[keep]);assert.equal(reopened.rejectedGeometryWelds.length,4);
 assert.equal(reopened.project,'已保存项目');assert.equal(live.project,'另一个尚未保存的项目名');
 assert.deepEqual(reopened.templates,saved.templates);assert.deepEqual(reopened.processLibrary,saved.processLibrary);
 assert.equal(repairConfirmedNonWeldStorage(storage),false);assert.equal(writes,1);
 assert.deepEqual(excludeConfirmedNonWelds(live).welds,[keep]);
});
test('保存失败向调用方报告，原草稿不被清空',()=>{
 const json=JSON.stringify({model:'111.step',welds:[{id:'W10011',source:'extracted',sourceSha256:sha,processingKey:'unit:W0002|1'}]});
 const storage={getItem:()=>json,setItem:()=>{throw Error('quota');}};
 assert.throws(()=>repairConfirmedNonWeldStorage(storage),/quota/);assert.equal(JSON.parse(json).welds.length,1);
 assert.equal(repairConfirmedNonWeldStorage({getItem:()=>null}),false);
});

test('明确指定的四个编号在旧记录缺少指纹、来源键或人工合并状态下仍移除，每条单独备份',()=>{
 const rejected=[{id:'W10001'},{id:'W10011',source:'manual'},{id:'W10012',source:'manual-merge',mergedInto:'W004'},{id:'W10034',sourceSha256:'legacy'}];
 const keep={id:'W10035',source:'manual'};
 const draft={model:'111.step',welds:[...rejected,keep],selected:'W10034'};
 const repaired=excludeConfirmedNonWelds(draft);assert.deepEqual(repaired.welds,[keep]);assert.equal(repaired.selected,'W10035');
 assert.equal(repaired.rejectedGeometryWelds.length,4);assert.deepEqual(repaired.rejectedGeometryWelds.map(w=>w.id),rejected.map(w=>w.id));
 assert.equal(draft.welds.length,5);assert.strictEqual(excludeConfirmedNonWelds({...draft,model:'other.step'}).welds,draft.welds);
});

test('同一111模型的路径名称和大小写仍执行指定编号清理，其他模型保持原样',()=>{
 const welds=[{id:'W10011'},{id:'W10035'}];
 assert.deepEqual(excludeConfirmedNonWelds({model:'C:/models/111.STEP',welds}).welds,[welds[1]]);
 assert.deepEqual(excludeConfirmedNonWelds({model:'旧模型名称',geometryProcessing:{sourceSha256:sha},welds}).welds,[welds[1]]);
 assert.strictEqual(excludeConfirmedNonWelds({model:'222.step',welds}).welds,welds);
});
