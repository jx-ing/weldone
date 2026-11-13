import {assignWeldingOrder} from './strategyGeometry.mjs';
import {MAX_PLANNING_WELDS} from './planningRequirements.mjs';
import {isDemoModel,stepModelKey} from './stepModelStore.mjs';

const workersPerModel=()=>Math.max(1,Math.min(8,(navigator.hardwareConcurrency||2)-1));
const workerDeadline=120000;
const reportInterval=50;

export function createPlanningCollisionPool(){
 let modelKey,workers=[];
 function dispose(){
  for(const entry of workers)entry.stop();
  workers=[];
  modelKey=undefined;
 }
 function prepare(workspace,coverOpen){
  if(!workspace.stepModel&&!isDemoModel(workspace)){dispose();return;}
  const key=stepModelKey(workspace)+':'+coverOpen;
  if(key===modelKey)return;
  dispose();
  modelKey=key;
  for(let index=0;index<workersPerModel();index++){
   let worker;
   try{worker=new Worker(new URL('./planningCollision.worker.js',import.meta.url),{type:'module'});}
   catch{if(!workers.length)modelKey=undefined;break;}
   let pending;
   const fail=message=>{
    const action=pending;
    pending=undefined;
    action?.reject(Error(message));
   };
   worker.onerror=event=>{event.preventDefault();fail(event.message||'碰撞检测后台加载失败');};
   worker.onmessageerror=()=>fail('无法读取碰撞检测结果');
   worker.onmessage=({data})=>{
    if(data.type==='progress'){pending?.onProgress?.(data.done);return;}
    if(data.type==='error'){fail(data.message);return;}
    const action=pending;
    pending=undefined;
    action?.resolve(data.result);
   };
   function send(message,onProgress){
    return new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{worker.terminate();fail('碰撞检测超时，请重试');},workerDeadline);
     pending={onProgress,resolve:value=>{clearTimeout(timer);resolve(value);},
      reject:error=>{clearTimeout(timer);reject(error);}};
     try{worker.postMessage(message);}catch(error){fail(error.message);}
    });
   }
   const ready=send({type:'prepare',model:workspace.model,stepModel:workspace.stepModel,coverOpen});
   ready.catch(()=>{});
   workers.push({ready,send,stop(){worker.terminate();fail('碰撞检测已停止');}});
  }
 }
 async function run(workspace,options,coverOpen,onProgress,geometry){
  prepare(workspace,coverOpen);
  if(!workers.length)throw Error('无法启动碰撞检测后台');
  const {welds,templates,processLibrary}=workspace;
  const {measureTemplateNeighborhood,...settings}=options;
  const eligible=[],skipped=[];
  for(const weld of welds){
   if(weld.enabled&&weld.planned&&!weld.mergedInto&&!weld.splitInto)eligible.push(weld);
   else skipped.push(weld);
  }
  const count=Math.min(workers.length,Math.ceil(eligible.length/8));
  const base=Math.max(10000,...welds.map(weld=>Number(weld.id.slice(1))||0));
  const batches=Array.from({length:count},()=>[]);
  for(const [index,weld] of eligible.entries())batches[index%count].push(weld);
  const done=batches.map(()=>0);
  const start=performance.now();
  let lastReport=start;
  onProgress?.(0,eligible.length);
  try{
   const results=await Promise.all(batches.map(async(batch,index)=>{
    const entry=workers[index];
    await entry.ready;
    return entry.send({type:'run',workspace:{welds:batch,templates,processLibrary},options:settings,geometry,
     idBase:base+index-count+1,idStep:count},completed=>{
     done[index]=completed;
     const totalDone=done.reduce((sum,value)=>sum+value,0);
     const now=performance.now();
     if(totalDone===eligible.length||now-lastReport>=reportInterval){
      onProgress?.(totalDone,eligible.length);
      lastReport=now;
     }
    });
   }));
   const all=[...skipped.map(weld=>weld.enabled&&!weld.mergedInto&&!weld.splitInto?{...weld,collisionState:'未检测'}:weld),...results.flatMap(result=>result.welds)];
   const order=new Map(welds.map((weld,index)=>[weld.id,index]));
   all.sort((a,b)=>(order.get(a.id)??order.get(a.collisionParentId))-(order.get(b.id)??order.get(b.collisionParentId)));
   const collisionOriginals=results.flatMap(result=>result.collisionOriginals).sort((a,b)=>order.get(a.id)-order.get(b.id));
   if(all.length>MAX_PLANNING_WELDS)throw Error('碰撞打断后的焊缝数量超过工作区上限');
   const counts={checked:0,unchecked:skipped.filter(weld=>weld.enabled&&!weld.mergedInto&&!weld.splitInto).length,downgraded:0,trimmed:0,removed:0};
   for(const result of results)for(const key of Object.keys(counts))counts[key]+=result.counts[key];
   return {welds:assignWeldingOrder(all,options),collisionOriginals,counts,
    detectionMs:Math.max(0,...results.map(result=>result.detectionMs)),elapsedMs:performance.now()-start};
  }catch(error){dispose();throw error;}
 }
 return {prepare,run,dispose};
}
