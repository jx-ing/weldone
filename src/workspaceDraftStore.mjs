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

export function saveWorkspaceDraft(draft,projectChange){
 let projectInUse=false;
 return accessDraft('readwrite',store=>{
  function writeDraft(){
   if(draft.model)return store.put(draft,'current');
   const saved=store.get('current');
   saved.onsuccess=()=>store.put(retainSavedStepWorkspace(draft,saved.result??legacyDraft()),'current');
   return saved;
  }
  if(!projectChange)return writeDraft();
  const request=store.get(workpieceCatalogKey);
  request.onsuccess=()=>{
   const entries=request.result??[];
   if(!projectChange.to&&entries.some(item=>item.project===projectChange.from)){projectInUse=true;return;}
   if(projectChange.to)store.put(entries.map(item=>item.project===projectChange.from?{...item,project:projectChange.to}:item),
    workpieceCatalogKey);
   writeDraft();
  };
  return request;
 }).then(result=>{
  if(projectInUse)throw Object.assign(Error('该项目仍有工件模板，请先在工件库中处理这些模板'),{name:'WorkpieceProjectInUseError'});
  return result;
 });
}

export const loadWorkstationSceneFile=()=>accessDraft('readonly',store=>store.get('workstation-scene'));
export const saveWorkstationSceneFile=file=>accessDraft('readwrite',store=>store.put(file,'workstation-scene'));

const workpieceCatalogKey='workpiece-templates';
const workpieceKey=id=>'workpiece-template:'+id;

export const listWorkpieceTemplates=()=>accessDraft('readonly',store=>store.get(workpieceCatalogKey)).then(value=>value??[]);
export const loadWorkpieceTemplate=id=>accessDraft('readonly',store=>store.get(workpieceKey(id)));

export function saveWorkpieceTemplate({summary,snapshot}){
 let duplicate=false;
 return accessDraft('readwrite',store=>{
  const request=store.get(workpieceCatalogKey);
  request.onsuccess=()=>{
   const templates=request.result??[];
   if(templates.some(item=>item.id!==summary.id&&item.project===summary.project&&item.name===summary.name)){duplicate=true;return;}
   store.put([summary,...templates.filter(item=>item.id!==summary.id)],workpieceCatalogKey);
   store.put(snapshot,workpieceKey(summary.id));
  };
  return request;
 }).then(()=>{if(duplicate)throw Error('当前项目已有同名工件模板');});
}

export function removeWorkpieceTemplate(id){
 return accessDraft('readwrite',store=>{
  const request=store.get(workpieceCatalogKey);
  request.onsuccess=()=>{
   store.put((request.result??[]).filter(item=>item.id!==id),workpieceCatalogKey);
   store.delete(workpieceKey(id));
  };
  return request;
 });
}

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
