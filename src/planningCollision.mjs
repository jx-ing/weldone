import {detectWeldCollision,mergeCollisionRanges} from './weldCollision.mjs';
import {splitWeldWrap,weldWrapJunctions} from './weldWrapJunctions.mjs';
import {weldLayerLayout,weldLayerPassPaths} from './weldLayerLayout.mjs';
import {pathLength} from './manualWeldModel.mjs';
import {weldTravelReversed} from './weldDirectionGeometry.mjs';
import {excludeVerifiedCollision,assignWeldingOrder} from './strategyGeometry.mjs';
import {analyzeWeldMatch,planWeldFromMatch} from './weldMatching.mjs';
import {settingsDefaults} from './planningSettingsModel.mjs';
import {MAX_PLANNING_WELDS} from './planningRequirements.mjs';

function blockedWrapJoint(weld,ranges){
 const lengths=weld.segments.map(segment=>pathLength(segment.pathPoints));
 const stations=[0];
 for(const length of lengths)stations.push(stations.at(-1)+length);
 const total=stations.at(-1),reversed=weldTravelReversed(weld);
 const overlaps=(from,to)=>ranges.some(([a,b])=>reversed?a<total-from&&b>total-to:a<to&&b>from);
 return weldWrapJunctions(weld).find(({id,type})=>{
  const index=weld.segments[id].strategyWrapKind===type?id:(id+1)%lengths.length;
  return overlaps(stations[index],stations[index+1]);
 });
}

export function collisionReport(weld,result){
 const state=!result?'未检测':result.ranges.length?'检测到碰撞':result.uncertain.length?'局部未能判定':
  result.passes.some(pass=>pass.closest)?'间隙不足':'未发现碰撞';
 return {...weld,collisionState:state,collisionPasses:result?.passes,
  ...(weld.strategyPlan?{strategyPlan:{...weld.strategyPlan,collisionStatus:state}}:{})};
}

export function inspectPlanningWeld(weld,workspace,scene,options){
 if(!weld.enabled||!weld.planned)return null;
 const layout=weldLayerLayout(weld,undefined,workspace.templates,workspace.processLibrary,options);
 const paths=weldLayerPassPaths(weld,layout,weld.strategyPlan,options.measureTemplateNeighborhood?.referenceNormalAt,undefined,{collisionOnly:true});
 return paths.length?detectWeldCollision(paths,scene):null;
}

export async function resolvePlanningCollisions(workspace,scene,options,onProgress,{idBase,idStep=1,assignOrder=true,yieldForProgress=true}={}){
 const welds=[],originals=[];
 const started=performance.now();
 let lastYield=started,detectionMs=0;
 const settings=settingsDefaults(options);
 let id=idBase??Math.max(10000,...workspace.welds.map(weld=>Number(weld.id.slice(1))||0));
 const nextId=()=> 'W'+String(id+=idStep);
 const counts={checked:0,unchecked:0,downgraded:0,trimmed:0,removed:0};
 const inspect=weld=>{
  const start=performance.now();
  const result=inspectPlanningWeld(weld,workspace,scene,options);
  detectionMs+=performance.now()-start;
  return result;
 };
 const replan=weld=>planWeldFromMatch(weld,analyzeWeldMatch(weld,workspace.templates,workspace.processLibrary,options),options);
 function process(original){
  const results=[];
  let modified=false,originalDetection;
  const queue=[{weld:original,attempts:0}];
  while(queue.length){
   const {weld,attempts}=queue.shift();
   const detection=inspect(weld);
   if(weld===original)originalDetection=detection;
   if(!detection?.ranges.length){results.push(collisionReport(weld,detection));continue;}
   const joint=blockedWrapJoint(weld,detection.ranges);
   if(joint){
    const pieces=splitWeldWrap(weld,joint.id,joint.type==='U'?'L':'none');
    if(pieces.length){
     modified=true;
     counts.downgraded++;
     queue.push(...pieces.map((piece,index)=>({attempts,weld:replan({...piece,id:nextId(),
      name:(original.name+' · 包角避障 '+(index+1)).slice(0,80),collisionFragment:true,collisionParentId:original.id,processingKey:weld.processingKey+':wrap:'+index})})));
     continue;
    }
   }
   const total=weld.segments.reduce((sum,segment)=>sum+pathLength(segment.pathPoints),0);
   const reversed=weldTravelReversed(weld);
   const ranges=mergeCollisionRanges(detection.ranges.map(([a,b])=>reversed?[total-b,total-a]:[a,b])
    .map(([a,b])=>[Math.max(0,a-.1),Math.min(total,b+.1)]).filter(([a,b])=>b>a));
   if(!settings.splitParameters.autoDeleteUnavoidable||!ranges.length||attempts>=3){
    results.push(collisionReport({...weld,planned:false},detection));
    continue;
   }
   modified=true;
   counts.trimmed++;
   const pieces=excludeVerifiedCollision({...weld,length:total,collisionResult:{verified:true,unavoidableRanges:ranges}},settings,nextId);
   queue.push(...pieces.map(piece=>{
    const {pointLayout,manualControlPoints,planningPointOverrides,attributeOverrides,...fragment}=piece;
    return {attempts:attempts+1,weld:replan({...fragment,collisionFragment:true,collisionParentId:original.id})};
   }));
   if(results.length+queue.length>MAX_PLANNING_WELDS)throw Error('碰撞打断后的焊缝数量超过工作区上限');
  }
  if(modified){originals.push(collisionReport(original,originalDetection));if(!results.length)counts.removed++;}
  if(results.some(weld=>weld.collisionState!=='未检测')||modified)counts.checked++;
  else counts.unchecked++;
  return results;
 }
 for(const [index,original] of workspace.welds.entries()){
  if(performance.now()-lastYield>=50){
   onProgress?.(index,workspace.welds.length);
   if(yieldForProgress)await new Promise(resolve=>setTimeout(resolve,0));
   lastYield=performance.now();
  }
  welds.push(...(!original.enabled||original.mergedInto||original.splitInto?[original]:process(original)));
  if(welds.length>MAX_PLANNING_WELDS)throw Error('碰撞打断后的焊缝数量超过工作区上限');
 }
 onProgress?.(workspace.welds.length,workspace.welds.length);
 return {welds:assignOrder?assignWeldingOrder(welds,options):welds,collisionOriginals:originals,counts,detectionMs,elapsedMs:performance.now()-started};
}
