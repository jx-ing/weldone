import {retainSavedStepWorkspace} from './stepModelStore.mjs';
import {validProductionTaskSnapshot} from './planningTask.mjs';

const legacyKey='weldone.replica.draft.v1';

function openDraftStore(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('weldone.workspace',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}

async function accessDraft(mode,action){
 const db=await openDraftStore();
 try{
  return await new Promise((resolve,reject)=>{
   const transaction=db.transaction('drafts',mode);
   transaction.onabort=()=>reject(transaction.error??Error('本机保存已中断'));
   const request=action(transaction.objectStore('drafts'));
   transaction.oncomplete=()=>resolve(request.result);
  });
 }finally{db.close();}
}

function legacyDraft(){
 try{return JSON.parse(localStorage.getItem(legacyKey));}
 catch{return null;}
}

export async function loadWorkspaceDraft(){
 const saved=await accessDraft('readonly',store=>store.get('current'));
 return saved===undefined?legacyDraft():saved;
}

export function saveWorkspaceDraft(draft){
 return accessDraft('readwrite',store=>{
  if(draft.model)return store.put(draft,'current');
  const saved=store.get('current');
  saved.onsuccess=()=>store.put(retainSavedStepWorkspace(draft,saved.result??legacyDraft()),'current');
  return saved;
 });
}

export const loadWorkstationSceneFile=()=>accessDraft('readonly',store=>store.get('workstation-scene'));
export const saveWorkstationSceneFile=file=>accessDraft('readwrite',store=>store.put(file,'workstation-scene'));

const virtualCaptureIndex=taskKey=>'virtual-captures:'+taskKey;
const virtualCaptureKey=id=>'virtual-capture:'+id;
export const listVirtualCaptures=taskKey=>accessDraft('readonly',store=>store.get(virtualCaptureIndex(taskKey))).then(items=>items??[]);
export const loadVirtualCapture=id=>accessDraft('readonly',store=>store.get(virtualCaptureKey(id)));
export function saveVirtualCapture(taskKey,summary,points){
 return accessDraft('readwrite',store=>{
  const request=store.get(virtualCaptureIndex(taskKey));
  request.onsuccess=()=>{
   store.put([summary,...(request.result??[])],virtualCaptureIndex(taskKey));
   store.put(points,virtualCaptureKey(summary.id));
  };
  return request;
 });
}

export async function loadProductionTask(){
 const task=await accessDraft('readonly',store=>store.get('production-task'));
 return validProductionTaskSnapshot(task)?task:undefined;
}

export async function saveProductionTask(task){
 if(!validProductionTaskSnapshot(task))throw Error('生产执行任务数据无效');
 return accessDraft('readwrite',store=>store.put(task,'production-task'));
}
