import {EXAMPLE_MODEL} from './manualWeldModel.mjs';

export const STARTUP_STEP_MODEL='a1a.step';
export const STARTUP_STEP_REFERENCE=Object.freeze({
 sourceSha256:'e3fa12d40ff8dbe3226efb4a51397be3ba0d9726810d2ab98240cfd0be693c07'
});
export const isBundledStartupStep=(name,reference)=>name===STARTUP_STEP_MODEL&&
 reference?.sourceSha256===STARTUP_STEP_REFERENCE.sourceSha256;

const modelFields=['model','stepModel','welds','selected','geometryProcessing','previousGeometryProcessing','rejectedGeometryWelds','manualEditHistory','manualSplitHistory','collisionOriginals','planningSettingsDirty'];
export const validStepModel=reference=>typeof reference?.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(reference.sourceSha256);
export const isDemoModel=workspace=>workspace.model===EXAMPLE_MODEL&&!workspace.stepModel;
export const stepModelKey=workspace=>workspace.stepModel?.sourceSha256??'built-in:'+workspace.model;

function openStore(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('weldone.step-models',2);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains('models'))db.createObjectStore('models',{keyPath:'sourceSha256'});
   db.createObjectStore('neighborhoods');
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}

async function access(store,mode,action){
 const db=await openStore();
 try{
  return await new Promise((resolve,reject)=>{
   const transaction=db.transaction(store,mode);
   const request=action(transaction.objectStore(store));
   transaction.oncomplete=()=>resolve(request.result);
   transaction.onabort=()=>reject(transaction.error??Error('本机模型存储失败'));
  });
 }finally{db.close();}
}

export const cacheStepMesh=model=>access('models','readwrite',store=>store.put(model));
export const cacheStepNeighborhood=(sha,geometry)=>access('neighborhoods','readwrite',store=>store.put(geometry,sha));
export const loadStepNeighborhood=sha=>access('neighborhoods','readonly',store=>store.get(sha));

export async function loadStepMesh(name,reference){
 const bundledStartup=isBundledStartupStep(name,reference);
 if(reference&&!bundledStartup){
  const model=await access('models','readonly',store=>store.get(reference.sourceSha256));
  if(!model)throw Error('本机缺少模型，请重新导入原 STEP 文件');
  return model;
 }
 if(name!==EXAMPLE_MODEL&&!bundledStartup)throw Error('请导入此工作区的 STEP 文件');
 const response=await fetch(bundledStartup?'/models/a1a.mesh.json':'/models/111.mesh.json');
 if(!response.ok)throw Error('示例模型加载失败');
 const model=await response.json();
 if(bundledStartup&&model.sourceSha256!==reference.sourceSha256)throw Error('示例模型指纹校验失败');
 return model;
}

export function switchStepWorkspace(current,model,stepModel){
 const target={model,...(stepModel?{stepModel}:{})};
 const next={...current};
 for(const key of modelFields)delete next[key];
 return {...next,...target,welds:[],selected:''};
}

export function retainSavedStepWorkspace(draft,saved){
 if(!saved?.model)return draft;
 const next={...draft};
 for(const key of modelFields)if(Object.hasOwn(saved,key))next[key]=saved[key];
 if(saved.welds?.length&&(draft.project!==saved.project||draft.workpieceType!==saved.workpieceType||
  JSON.stringify(draft.planningSettings)!==JSON.stringify(saved.planningSettings)))next.planningSettingsDirty=true;
 return next;
}
