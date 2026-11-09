import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';
import {processDemoGeometry} from '../src/geometryProcessing.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,validExtractedWeld,installGeometryResult,restoreGeometryResult} from '../src/geometryProcessingModel.mjs';
import {DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG} from '../src/vendor/geometry-engine.mjs';
import {pathLength} from '../src/manualWeldModel.mjs';import {validWeldProcessParameters} from '../src/processParameterModel.mjs';
const root=new URL('../',import.meta.url);
globalThis.fetch=async input=>{try{return new Response(await fs.readFile(new URL('public'+new URL(String(input),'http://local').pathname,root)));}catch{return new Response('',{status:404});}};
let result;
test('迁移规则与当前示例指纹一致，规范化依据及源文件完整保留',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('src/vendor/planning-rules.manifest.json',root)));
 for(const f of manifest.files){const file=f.path.startsWith('scripts/')?'scripts/vendor-extraction/'+f.path.slice(8):'src/vendor/planning-rules/'+f.path.slice(4);assert.equal(crypto.createHash('sha256').update(await fs.readFile(new URL(file,root))).digest('hex'),f.sha256,file);}
 const canonical=JSON.parse(await fs.readFile(new URL('public/models/111-rules/planning-input.json',root)));
 for(const [name,hash] of Object.entries(canonical.inputs))assert.equal(crypto.createHash('sha256').update(await fs.readFile(new URL('public/models/111-rules/'+name,root))).digest('hex'),hash);
 assert.equal(canonical.weldsData.welds.length,210);assert.equal(canonical.compositeShellReferences.length,14);
 for(const [k,v] of Object.entries(DEFAULT_GEOMETRY_OPTIONS).filter(([k])=>k!=='mergeGapCheck'))assert.deepEqual(v,DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG[k]);assert.equal(DEFAULT_GEOMETRY_OPTIONS.mergeGapCheck,false);
});
test('真实几何完整处理得到105条焊道并保留未确认条件及实际路径',async()=>{
 result=await processDemoGeometry({...DEFAULT_GEOMETRY_OPTIONS,mergeGapCheck:true});const s=result.summary;
 assert.equal(s.cadCandidateCount,224);assert.equal(s.extractedWeldCount,210);assert.equal(s.subWeldCount,433);assert.equal(s.survivingUnitCount,114);assert.equal(s.mergedGroupCount,9);assert.equal(s.processedWeldCount,105);
 assert.ok(result.welds.every(w=>validExtractedWeld(w)&&validWeldProcessParameters(w)));assert.equal(s.unknownJointCount,7);assert.equal(s.unknownPositionCount,13);
 for(const w of result.welds){assert.equal(w.current,null);assert.equal(w.voltage,null);assert.equal(w.speed,null);assert.ok(Math.abs(w.length-pathLength(w.segments.flatMap(s=>s.pathPoints)))<.001);}
 assert.equal(result.welds.flatMap(w=>w.segments).filter(s=>s.connectionGap).length,0);
});
test('安装和撤销几何结果不覆盖人工焊道或模板工艺库，重复处理保持编号和屏蔽状态',()=>{
 const manual={id:'W001',source:'manual',name:'保留人工道'},d={model:'111.step',welds:[manual],templates:[{id:'t'}],processLibrary:[{id:'p'}],selected:'W001'};
 const installed=installGeometryResult(d,result);assert.equal(installed.welds.length,102);assert.equal(installed.welds[0],manual);assert.equal(installed.processLibrary,d.processLibrary);assert.equal(installed.templates,d.templates);
 const id=installed.welds[2].id;installed.welds[2].enabled=false;const again=installGeometryResult(installed,result);assert.equal(again.welds[2].id,id);assert.equal(again.welds[2].enabled,false);assert.deepEqual(restoreGeometryResult(again).welds,installed.welds);assert.deepEqual(restoreGeometryResult(installed).welds,[manual]);
});

test('真实模型按合并后的长度与数量上限分组，所有源段均保留',async()=>{
 const limited=await processDemoGeometry({...DEFAULT_GEOMETRY_OPTIONS,mergeGapCheck:true,maxMergeLength:1000,maxMergeCount:3});
 assert.equal(limited.config.maxMergeLength,1000);assert.ok(limited.welds.every(validExtractedWeld));
 for(const weld of limited.welds)if(weld.sourceEvidence.unitKeys.length>1){assert.ok(weld.length<=1000+1e-9);assert.ok(weld.sourceEvidence.unitKeys.length<=3);}
 assert.deepEqual(limited.welds.flatMap(w=>w.sourceEvidence.unitKeys).sort(),result.welds.flatMap(w=>w.sourceEvidence.unitKeys).sort());
});

test('重新提取与撤销处理都保留人工合并和其原焊道记录',async()=>{
 const {mergeSelectedWelds,undoManualMerge}=await import('../src/manualMergeModel.mjs');const d=installGeometryResult({model:'111.step',welds:[],selected:''},result),merged=mergeSelectedWelds(d,['W10016','W10017']),mergedId=merged.selected,reprocessed=installGeometryResult(merged,result);assert.ok(reprocessed.welds.some(w=>w.id===mergedId&&w.source==='manual-merge'));assert.ok(reprocessed.welds.some(w=>w.id==='W10016'&&w.mergedInto===mergedId&&!w.enabled));assert.equal(reprocessed.welds.filter(w=>w.processingKey==='unit:W0035|12').length,1);const undo=restoreGeometryResult(reprocessed);assert.ok(undo.welds.some(w=>w.id===mergedId));assert.equal(undoManualMerge(undo,mergedId).welds.length,101);
});

test('自动合并关闭间隙阈值后仍验证真实交点，不能相交的分组保留成员',async()=>{const r=await processDemoGeometry(DEFAULT_GEOMETRY_OPTIONS);assert.equal(r.config.mergeGapCheck,false);assert.ok(r.welds.every(validExtractedWeld));assert.equal(r.welds.some(w=>w.segments.some(s=>s.connectionGap)),false);assert.equal(r.summary.processedWeldCount,r.welds.length);assert.ok(r.summary.rejectedMergeGroupCount>0);assert.ok(r.welds.some(w=>w.sourceEvidence.rejectedMergeReason));assert.equal(JSON.stringify(r).includes('Infinity'),false);});
