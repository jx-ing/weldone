import {Quaternion,Vector3} from 'three';
import {detectWeldCollision,mergeCollisionRanges} from './weldCollision.mjs';
import {continuousOpeningWrapAt,normalizeWrapMarkers,wrapGroups} from './weldWrapJunctions.mjs';
import {weldLayerLayout,weldLayerPassPaths} from './weldLayerLayout.mjs';
import {pathLength} from './manualWeldModel.mjs';
import {weldTravelReversed} from './weldDirectionGeometry.mjs';
import {excludeVerifiedCollision,assignWeldingOrder} from './strategyGeometry.mjs';
import {planWeld} from './weldMatching.mjs';
import {FLAT_L_WRAP_LIMIT,settingsDefaults} from './planningSettingsModel.mjs';
import {MAX_PLANNING_WELDS} from './planningRequirements.mjs';
import {resolveWeldToolPose,weldTorchAngles} from './weldToolPose.mjs';
import {generateStrategyPlan} from './strategyPlanning.mjs';
import {cornerPathDefaults} from './planningConfiguration.mjs';

function blockedWrapJoint(weld,ranges){
 const lengths=weld.segments.map(segment=>pathLength(segment.pathPoints));
 const stations=[0];
 for(const length of lengths)stations.push(stations.at(-1)+length);
 const total=stations.at(-1),reversed=weldTravelReversed(weld);
 const overlaps=(from,to)=>ranges.some(([a,b])=>reversed?a<total-from&&b>total-to:a<to&&b>from);
 const group=wrapGroups(weld).find(({segment})=>overlaps(stations[segment],stations[segment+1]));
 if(group)return {kind:weld.segments[group.segment].strategyWrapKind,segment:group.segment};
 const opening=weld.segments.findIndex((segment,index)=>
  continuousOpeningWrapAt(segment,weld.segments[index+1])&&overlaps(stations[index+1],stations[index+1]));
 return opening<0?null:{kind:'opening'};
}

export function collisionReport(weld,result){
 const state=!result?'未检测':result.ranges.length?'检测到碰撞':result.uncertain.length?'局部未能判定':
  result.passes.some(pass=>pass.closest)?'间隙不足':'未发现碰撞';
 return {...weld,collisionState:state,collisionVerified:!!result&&!result.ranges.length&&!result.uncertain.length,collisionPasses:result?.passes,
  ...(weld.strategyPlan?{strategyPlan:{...weld.strategyPlan,collisionStatus:state}}:{})};
}

function collisionPaths(weld,workspace,options){
 const layout=weldLayerLayout(weld,undefined,workspace.templates,workspace.processLibrary,options);
 return weldLayerPassPaths(weld,layout,weld.strategyPlan,options.measureTemplateNeighborhood?.referenceNormalAt,undefined,{collisionOnly:true});
}

export function inspectPlanningWeld(weld,workspace,scene,options){
 if(!weld.enabled||!weld.planned)return null;
 const paths=collisionPaths(weld,workspace,options);
 return paths.length?detectWeldCollision(paths,scene):null;
}

const radians=Math.PI/180;

function* wrapPoseCandidates(wrap){
 const reference=new Quaternion().fromArray(wrap.reference);
 const preferred=new Quaternion().fromArray(wrap.preferred);
 const limit=FLAT_L_WRAP_LIMIT*radians;
 const axes=[wrap.frame.tangent,wrap.frame.normal,wrap.frame.up].map(axis=>new Vector3(...axis));
 const directions=[...axes,...[[0,1],[0,2],[1,2]].flatMap(([a,b])=>[
  axes[a].clone().add(axes[b]).normalize(),axes[a].clone().sub(axes[b]).normalize()])];
 const seen=new Set();
 const limitPose=pose=>reference.clone().slerp(pose,Math.min(1,limit/(reference.angleTo(pose)||1)));
 for(const base of [preferred,reference]){
  for(const step of [0,10,22.5,35]){
   for(const axis of step?directions:[axes[0]])for(const sign of step?[1,-1]:[1]){
    const candidate=limitPose(new Quaternion().setFromAxisAngle(axis,step*sign*radians).multiply(base));
    const key=candidate.toArray().map(value=>value.toFixed(4)).join(',');
    if(seen.has(key)||preferred.angleTo(candidate)<1e-5)continue;
    seen.add(key);
    yield candidate.toArray();
   }
  }
 }
}

function fitFlatWrapPose(weld,joint,workspace,scene,options){
 if(!weld.strategyPlan||!weld.processParameters||!scene.contact||weld.matchPlan?.route!=='automatic')return null;
 const wrap=weld.strategyPlan.passes.find(pass=>pass.flatWraps?.some(item=>item.segment===joint.segment))?.flatWraps.find(item=>item.segment===joint.segment);
 if(!wrap)return null;
 const {from,to}=wrap;
 const corner=cornerPathDefaults(options.cornerPathParameters,'outer');
 const margin=Math.max(corner.before,corner.after);
 const layout=weldLayerLayout(weld,undefined,workspace.templates,workspace.processLibrary,options);
 const noOffsets=layout.every(layer=>layer.passes.every(pass=>!pass.offset?.wire&&pass.points.every(point=>
  !Object.values(point.poseOffset??{}).some(Boolean)&&!Object.values(point.offset??{}).some(Boolean))));
 const probes=noOffsets?collisionPaths(weld,workspace,options).flatMap(pass=>[(from+to)/2,to,from].flatMap(at=>pass.posesAt(at))):[];
 for(const quaternion of wrapPoseCandidates(wrap)){
  const orientation=new Quaternion().fromArray(quaternion);
  if(probes.some(pose=>scene.contact(resolveWeldToolPose({...pose.frame,position:pose.position,
   pose:weldTorchAngles(pose.frame,orientation)}).head)))continue;
  const wrapPoseOverrides={...weld.wrapPoseOverrides,[joint.segment]:quaternion};
  const strategyPlan=generateStrategyPlan(weld,weld.processParameters,{...options,wrapPoseOverrides});
  const candidate={...weld,wrapPoseOverrides,strategyPlan};
  const paths=collisionPaths(candidate,workspace,options).flatMap(pass=>{
   const startStation=Math.max(pass.startStation,from-margin),endStation=Math.min(pass.endStation,to+margin);
   if(endStation<=startStation)return [];
   return [{...pass,startStation,endStation}];
  });
  if(!paths.length||paths.some(pass=>[from,(from+to)/2,to].some(station=>
   pass.posesAt(station).some(pose=>scene.contact(pose.head)))))continue;
  const detection=detectWeldCollision(paths,scene);
   if(!detection.ranges.length&&!detection.uncertain.length)return candidate;
 }
 return null;
}

export async function resolvePlanningCollisions(workspace,scene,options,onProgress,{idBase,idStep=1,assignOrder=true,yieldForProgress=true,checkOnly=false}={}){
 const welds=[],originals=[];
 const started=performance.now();
 let lastYield=started,detectionMs=0;
 const settings=settingsDefaults(options);
 let id=idBase??Math.max(10000,...workspace.welds.map(weld=>Number(weld.id.slice(1))||0));
 const nextId=()=> 'W'+String(id+=idStep);
 const counts={checked:0,unchecked:0,trimmed:0,removed:0};
 const inspect=weld=>{
  const start=performance.now();
  const result=inspectPlanningWeld(weld,workspace,scene,options);
  detectionMs+=performance.now()-start;
  return result;
 };
 const replan=weld=>planWeld(weld,workspace.templates,workspace.processLibrary,options);
 function process(original){
  const results=[];
  let modified=false,originalDetection;
  const queue=[{weld:original,attempts:0,triedWraps:new Set()}];
  while(queue.length){
   const {weld,attempts,triedWraps=new Set()}=queue.shift();
   const detection=inspect(weld);
   if(weld===original)originalDetection=detection;
   if(!detection?.ranges.length){results.push(collisionReport(weld,detection));continue;}
   if(checkOnly){
    results.push(collisionReport({...weld,planned:false},detection));
    continue;
   }
   const joint=blockedWrapJoint(weld,detection.ranges);
   if(joint){
    if(joint.kind==='L'&&!triedWraps.has(joint.segment)){
     const start=performance.now();
     const adjusted=fitFlatWrapPose(weld,joint,workspace,scene,options);
     detectionMs+=performance.now()-start;
     triedWraps.add(joint.segment);
     if(adjusted){
      queue.unshift({weld:adjusted,attempts,triedWraps});
      continue;
     }
    }
    results.push(collisionReport({...weld,planned:false},detection));
    continue;
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
    const originalSegments=weld.segments;
    const wrapPoseOverrides={};
    for(const [index,segment] of fragment.segments.entries()){
     const source=originalSegments.findIndex(item=>
      item.pathPoints.length===segment.pathPoints.length&&item.pathPoints.every((point,pointIndex)=>
       point.every((value,axis)=>value===segment.pathPoints[pointIndex][axis])));
     if(weld.wrapPoseOverrides?.[source])wrapPoseOverrides[index]=weld.wrapPoseOverrides[source];
    }
    fragment.wrapPoseOverrides=wrapPoseOverrides;
    normalizeWrapMarkers(fragment.segments);
    if(!fragment.segments.some(segment=>segment.strategyRole==='wrap'))fragment.topology=
     fragment.segments.some((segment,index)=>continuousOpeningWrapAt(segment,fragment.segments[index+1]))?'L':
     fragment.segments.length>1?'corner':undefined;
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
