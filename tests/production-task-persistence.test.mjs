import test from 'node:test';
import assert from 'node:assert/strict';
import {planningTaskDocument,productionTaskSnapshot,readPlanningTask} from '../src/planningTask.mjs';
import {listWorkpieceTemplates,loadProductionTask,loadVirtualCapture,loadWorkpieceTemplate,loadWorkspaceDraft,removeWorkpieceTemplate,
 saveProductionTask,saveVirtualCapture,saveWorkspaceDraft,saveWorkpieceTemplate} from '../src/workspaceDraftStore.mjs';
import {workpieceWorkspace} from '../src/workpieceTemplateModel.mjs';
import {STARTUP_STEP_REFERENCE,workpiecePoseFor} from '../src/stepModelStore.mjs';
import {readExecutionRecords,saveSimulationRecord,sumExecutionMetrics} from '../src/productionStatisticsModel.mjs';

function memoryDrafts(){
 const entries=new Map();
 return {entries,indexedDB:{open(){
  const request={result:{close(){},transaction(){
   const transaction={objectStore:()=>({
    put(value,key){entries.set(key,structuredClone(value));return {result:key};},
    delete(key){entries.delete(key);return {};},
    get(key){
     const pending={result:structuredClone(entries.get(key))};
     queueMicrotask(()=>pending.onsuccess?.());
     return pending;
    }
   })};
   setImmediate(()=>transaction.oncomplete());
   return transaction;
  }}};
  queueMicrotask(()=>request.onsuccess());
  return request;
 }}};
}

test('工件模板保存模型、所有规划和封面，按项目重命名及原位编辑而不改发布任务',async()=>{
 const previous=globalThis.indexedDB;
 globalThis.indexedDB=memoryDrafts().indexedDB;
 try{
  const fingerprint=STARTUP_STEP_REFERENCE.sourceSha256;
  const summary={id:'item',name:'工件',project:'A',model:'a1a.step',fingerprint,cover:'data:image/jpeg;base64,cover'};
  const planning={model:summary.model,stepModel:STARTUP_STEP_REFERENCE,planningSettings:{precisionParameters:{distance:20}},
   welds:[{id:'W10007',enabled:false,strategyPlan:{passes:[{id:'pass'}]},scanSettings:{precisionMethod:'fixedPhoto'}}]};
  const snapshot={planning,templates:[],processes:[],mesh:{sourceSha256:fingerprint,sourceFile:new Blob(['STEP'])}};
  await saveWorkpieceTemplate({summary,snapshot});
  await assert.rejects(saveWorkpieceTemplate({summary:{...summary,id:'duplicate'},snapshot}),/同名/);
  await assert.rejects(saveWorkspaceDraft({model:'other.step'},{from:'A'}),/仍有工件模板/);
  await saveWorkspaceDraft({model:'other.step'},{from:'A',to:'B'});
  const [entry]=await listWorkpieceTemplates();
  assert.equal(entry.project,'B');
  assert.equal(entry.cover,summary.cover);
  const saved=await loadWorkpieceTemplate(entry.id);
  assert.equal(await saved.mesh.sourceFile.text(),'STEP');
  const next=workpieceWorkspace({model:'other.step',project:'B',welds:[],workstationSettings:{}},entry,saved);
  assert.deepEqual(next.welds,planning.welds);
  assert.deepEqual(next.planningSettings,planning.planningSettings);
  await saveWorkpieceTemplate({summary:{...entry,name:'工件修订'},snapshot});
  assert.deepEqual((await listWorkpieceTemplates()).map(item=>item.name),['工件修订']);
  await saveVirtualCapture('task',{id:'capture'},new Float32Array([1,2,3]));
  assert.deepEqual(await loadVirtualCapture('capture'),new Float32Array([1,2,3]));
  assert.equal(await loadProductionTask(),undefined);
  await removeWorkpieceTemplate(entry.id);
  assert.deepEqual(await listWorkpieceTemplates(),[]);
 }finally{globalThis.indexedDB=previous;}
});

test('任务发布单独持久化，重新读取及重新发布不改草稿，旧 PF 保留数据',async()=>{
 const previous=globalThis.indexedDB;
 const {entries,indexedDB}=memoryDrafts();
 globalThis.indexedDB=indexedDB;
 try{
  assert.equal(await loadProductionTask(),undefined);
  const workspace={model:'a1a.step',stepModel:STARTUP_STEP_REFERENCE,welds:[{id:'W10007',sourceEvidence:{unitKeys:['W0014']},manualControlPoints:[{x:12}]}],
   workstationSettings:{enabledRobotIds:['robot_01']}};
  await saveWorkspaceDraft(workspace);
  const first=productionTaskSnapshot(workspace,{measureTemplateNeighborhood:()=>{},activeDevice:{id:'recipe-device'}},'导出任务');
  await saveProductionTask(first);
  workspace.welds[0].manualControlPoints[0].x=24;
  assert.equal((await loadProductionTask()).workspace.welds[0].manualControlPoints[0].x,12);
  const pf=readPlanningTask('\ufeff'+JSON.stringify(planningTaskDocument(workspace)));
  assert.equal(pf.workstationSettings,undefined);
  assert.deepEqual(pf.welds[0].sourceEvidence.unitKeys,['W0014']);
  const next=productionTaskSnapshot(pf,{},'导入任务');
  await saveProductionTask(next);
  assert.equal((await loadWorkspaceDraft()).welds[0].manualControlPoints[0].x,12);
  assert.equal((await loadProductionTask()).workspace.welds[0].manualControlPoints[0].x,24);
  await assert.rejects(saveProductionTask({}),/数据无效/);
  assert.deepEqual(await loadProductionTask(),next);
  entries.set('production-task',{version:99});
  assert.equal(await loadProductionTask(),undefined);
  assert.throws(()=>readPlanningTask('{"format":"weldone-planning-task","version":2}'),/格式不受支持/);
 }finally{
  if(previous===undefined)delete globalThis.indexedDB;
  else globalThis.indexedDB=previous;
 }
});

test('同名外部工件沿用外部默认值，内置样件按指纹识别且手工摆放优先',()=>{
 assert.equal(workpiecePoseFor({model:'a1a.step',stepModel:{sourceSha256:'a'.repeat(64)}}),undefined);
 assert.deepEqual(workpiecePoseFor({model:'别名.STP',stepModel:STARTUP_STEP_REFERENCE}).quaternion,[1,0,0,0]);
 assert.deepEqual(workpiecePoseFor({model:'C:/models/111.STEP'}).quaternion,[1,0,0,0]);
 const explicit={position:[1,2,3],quaternion:[0,0,0,1]};
 assert.equal(workpiecePoseFor({model:'a1a.step',stepModel:STARTUP_STEP_REFERENCE,workpiecePose:explicit}),explicit);
});

test('仿真以独立预览记录保存，同一记录重写不增加真实焊接量',()=>{
 const entries=new Map(),storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
 const run={id:'run-1',modelName:'a1a.step',modelId:'a1a',startedAt:'2026-11-17T00:00:00Z',
  weldId:'W10007',weldLabel:'W10007',position:'PB',passId:'pass-1',passIndex:0,duration:5};
 saveSimulationRecord(run,{time:2,travelMm:30},'stopped',storage);
 saveSimulationRecord(run,{time:5,travelMm:80},'completed',storage);
 const records=readExecutionRecords(storage);
 assert.equal(records.length,1);
 assert.equal(records[0].simulation,true);
 assert.equal(records[0].arcEnabled,false);
 assert.equal(sumExecutionMetrics(records).weldMm,0);
 assert.equal(sumExecutionMetrics(records).travelMm,80);
});
