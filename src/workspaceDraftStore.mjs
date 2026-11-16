import {retainSavedStepWorkspace} from './stepModelStore.mjs';

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

export const saveWorkspaceDraft=draft=>accessDraft('readwrite',store=>{
 if(draft.model)return store.put(draft,'current');
 const saved=store.get('current');
 saved.onsuccess=()=>store.put(retainSavedStepWorkspace(draft,saved.result??legacyDraft()),'current');
 return saved;
});
