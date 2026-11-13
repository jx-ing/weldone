import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';
import {processDemoGeometry} from '../src/geometryProcessing.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,validExtractedWeld,installGeometryResult,removePlanningWelds,restoreGeometryResult} from '../src/geometryProcessingModel.mjs';
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
test('真实几何处理保留短焊缝和实际路径，只排除有遮挡证据的段',async()=>{
 result=await processDemoGeometry({...DEFAULT_GEOMETRY_OPTIONS,mergeGapCheck:true,splitParameters:{enabled:true,length:100},intermittentParameters:{enabled:true,weldLength:25,gapLength:15}});const s=result.summary;
 assert.equal(s.cadCandidateCount,224);assert.equal(s.extractedWeldCount,210);assert.equal(s.subWeldCount,433);assert.equal(s.survivingUnitCount,201);assert.equal(s.deletedGroupCount,0);assert.equal(s.processedWeldCount,result.welds.length);assert.ok(result.welds.some(w=>w.length===1));
 assert.ok(result.welds.every(w=>validExtractedWeld(w)&&validWeldProcessParameters(w)));assert.ok(result.welds.every(w=>w.weldType&&!Object.hasOwn(w,'joint')&&w.segments.every(segment=>!Object.hasOwn(segment,'joint'))));assert.ok(s.unknownPositionCount>0);
 for(const w of result.welds){assert.equal(w.current,null);assert.equal(w.voltage,null);assert.equal(w.speed,null);assert.ok(Math.abs(w.length-pathLength(w.segments.flatMap(s=>s.pathPoints)))<.001);}
 assert.equal(result.welds.flatMap(w=>w.segments).filter(s=>s.connectionGap).length,0);
});
test('安装和撤销几何结果不覆盖人工焊道或模板工艺库，重复处理保持编号和屏蔽状态',()=>{
 const manual={id:'W001',source:'manual',name:'保留人工道'},d={model:'111.step',welds:[manual],templates:[{id:'t'}],processLibrary:[{id:'p'}],selected:'W001'};
 const installed=installGeometryResult(d,result);assert.equal(installed.welds.length,result.welds.length+1-installed.rejectedGeometryWelds.length);assert.equal(installed.welds[0],manual);assert.equal(installed.processLibrary,d.processLibrary);assert.equal(installed.templates,d.templates);
 const id=installed.welds[2].id;installed.welds[2].enabled=false;const again=installGeometryResult(installed,result);assert.equal(again.welds[2].id,id);assert.equal(again.welds[2].enabled,false);assert.deepEqual(restoreGeometryResult(again).welds,installed.welds);assert.deepEqual(restoreGeometryResult(installed).welds,[manual]);
});

test('多选删除生效于本地任务，重新提取时不恢复已删除的同一焊道',()=>{
 const manual={id:'W001',source:'manual'},workspace=installGeometryResult({model:'111.step',welds:[manual],selected:'W001'},result);
 const first=workspace.welds.find(weld=>weld.source==='extracted');
 const next=removePlanningWelds(workspace,[manual.id,first.id]);
 assert.equal(next.welds.length,workspace.welds.length-2);
 assert.equal(next.selected,next.welds[0].id);
 assert(next.rejectedGeometryWelds.some(weld=>weld.id===first.id&&weld.rejectionReason==='用户删除'));
 const rerun=installGeometryResult(next,result);
 assert(!rerun.welds.some(weld=>weld.processingKey===first.processingKey||weld.id===manual.id));
 assert(!restoreGeometryResult(rerun).welds.some(weld=>weld.id===first.id));
});

test('导入 STEP 的提取结果按自身指纹安装，不继承示例焊道的排除编号',()=>{
 const model='异形接头.step',sourceSha256='a'.repeat(64);
 const workspace={model,stepModel:{sourceSha256},welds:[],selected:''};
 const importResult={...result,sourceSha256,welds:result.welds.slice(0,2).map(weld=>({...weld,model,sourceSha256}))};
 const extracted=installGeometryResult(workspace,importResult);
 assert.equal(extracted.welds.length,2);
 assert.equal(extracted.welds[0].id,'W10001');
 assert(extracted.welds.every(weld=>validExtractedWeld(weld,workspace)));
 assert.throws(()=>installGeometryResult(workspace,result),/指纹不一致/);
 const removed=removePlanningWelds(extracted,['W10001']);
 assert.deepEqual(installGeometryResult(removed,importResult).welds.map(weld=>weld.id),['W10002']);
});

test('真实模型按合并后的长度与数量上限分组，所有源段均保留',async()=>{
 const limited=await processDemoGeometry({...DEFAULT_GEOMETRY_OPTIONS,mergeGapCheck:true,maxMergeLength:1000,maxMergeCount:3});
 assert.equal(limited.config.maxMergeLength,1000);assert.ok(limited.welds.every(validExtractedWeld));
 for(const weld of limited.welds)if(weld.sourceEvidence.unitKeys.length>1){assert.ok(weld.length<=1000+1e-9);assert.ok(weld.sourceEvidence.unitKeys.length<=3);}
 assert.deepEqual(limited.welds.flatMap(w=>w.sourceEvidence.unitKeys).sort(),result.welds.flatMap(w=>w.sourceEvidence.unitKeys).sort());
});

test('重新提取与撤销处理都保留人工合并和其原焊道记录',async()=>{
 const {mergeSelectedWelds,undoManualMerge}=await import('../src/manualMergeModel.mjs');
 const d=installGeometryResult({model:'111.step',welds:[],selected:''},result);
 const pair=['merge:W0001|0;W0002|0;W0003|0','unit:W0004|0'].map(key=>d.welds.find(w=>w.processingKey===key));
 const merged=mergeSelectedWelds(d,pair.map(w=>w.id)),mergedId=merged.selected,reprocessed=installGeometryResult(merged,result);
 assert.ok(reprocessed.welds.some(w=>w.id===mergedId&&w.source==='manual-merge'));
 for(const member of pair){
  assert.ok(reprocessed.welds.some(w=>w.id===member.id&&w.mergedInto===mergedId&&!w.enabled));
  assert.equal(reprocessed.welds.filter(w=>w.processingKey===member.processingKey).length,1);
 }
 const undo=restoreGeometryResult(reprocessed);
 assert.ok(undo.welds.some(w=>w.id===mergedId));
 assert.equal(undoManualMerge(undo,mergedId).welds.length,d.welds.length);
});

test('自动合并关闭间隙阈值后仍验证真实交点，不能相交的分组保留成员',async()=>{const r=await processDemoGeometry(DEFAULT_GEOMETRY_OPTIONS);assert.equal(r.config.mergeGapCheck,false);assert.ok(r.welds.every(validExtractedWeld));assert.equal(r.welds.some(w=>w.segments.some(s=>s.connectionGap)),false);assert.equal(r.summary.processedWeldCount,r.welds.length);assert.ok(r.summary.rejectedMergeGroupCount>0);assert.ok(r.welds.some(w=>w.sourceEvidence.rejectedMergeReason));assert.equal(JSON.stringify(r).includes('Infinity'),false);});

test('板端、非板端短焊缝和原先低于板厚阈值的焊缝均保留，旧长度配置不再过滤',async()=>{
 const options={...DEFAULT_GEOMETRY_OPTIONS,planningRevision:3,automaticMerge:false};
 const extracted=await processDemoGeometry({...options,minimumWeldLength:1e6,retainPlateEndWelds:false});
 const draft={model:'111.step',welds:[],selected:''},installed=installGeometryResult(draft,extracted);
 assert.ok(installed.welds.some(w=>w.processingKey==='unit:W0005|0'&&w.length===12));
 assert.ok(installed.welds.some(w=>w.processingKey==='unit:W0215|1'&&w.length===1));
 assert.ok(installed.welds.some(w=>w.processingKey==='unit:W0114|0'&&w.length===2));
 assert.equal(installed.welds.length,extracted.summary.survivingUnitCount-installed.rejectedGeometryWelds.length);
 const rerun=installGeometryResult(installed,extracted);
 assert.deepEqual(rerun.welds.map(w=>[w.id,w.processingKey]),installed.welds.map(w=>[w.id,w.processingKey]));
 assert.deepEqual(rerun.rejectedGeometryWelds,installed.rejectedGeometryWelds);
});

test('短于 0.1 mm 的有效路径可验证，零长度路径仍无效',()=>{
 const weld=result.welds[0],segment={...weld.segments[0],pathPoints:[[0,0,0],[0.04,0,0]],length:.04};
 assert.equal(validExtractedWeld({...weld,segments:[segment],length:.04}),true);
 assert.equal(validExtractedWeld({...weld,segments:[{...segment,pathPoints:[[0,0,0],[0,0,0]],length:0}],length:0}),false);
});
