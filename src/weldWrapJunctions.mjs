import {pathLength} from './manualWeldModel.mjs';
import {splitWeldPreview} from './manualSplitModel.mjs';
import {mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
import {weldTravelReversed} from './weldDirectionGeometry.mjs';

function wrapGroups(weld){
 const {segments,closure}=weld;
 return segments.flatMap((segment,index)=>{
  if(!['L','U'].includes(segment.strategyWrapKind))return [];
  const joints=[];
  if((index>0||closure==='closed')&&segment.startWrapKind)joints.push((index+segments.length-1)%segments.length);
  if((index<segments.length-1||closure==='closed')&&segment.endWrapKind)joints.push(index);
  return joints.length?[{segment:index,joints}]:[];
 });
}

export function weldWrapJunctions(weld){
 const count=weld.segments.length,reversed=weldTravelReversed(weld);
 const joints=new Map();
 for(const {joints:ids} of wrapGroups(weld)){
  for(const id of ids){
   const index=reversed&&id<count-1?count-2-id:id;
   const pending=weld.pendingWrapEdit;
   const type=pending?.id===id?pending.type:weld.segments[id].endWrapKind;
   joints.set(id,{id,index,type,canUseU:ids.length===2||joints.get(id)?.canUseU});
  }
 }
 return [...joints.values()].sort((a,b)=>a.index-b.index);
}

function fragment(weld,segments,start,end){
 const first=segments[0];
 const facts={type:null,breakReason:'包角断开'};
 const topology=['U','L'].find(kind=>segments.some(segment=>segment.strategyWrapKind===kind));
 const {pendingWrapEdit,strategyPlan,matchPlan,pointLayout,manualControlPoints,planningPointOverrides,mergedFrom,mergeHistory,mergeIntersections,mergedInto,splitInto,...base}=weld;
 return {...base,segments,closure:'open',length:segments.reduce((sum,segment)=>sum+pathLength(segment.pathPoints),0),
  position:segments.every(segment=>segment.position===first.position)?first.position:'混合位置（逐段设置）',
  topology:topology??(segments.length>1?'corner':undefined),cornerAngles:mergeCornerAngles(segments),
  intermittentRanges:undefined,planned:false,completeStart:true,completeEnd:true,atConnection:segments.length>1,
  startWrapMode:start?weld.startWrapMode:'none',endWrapMode:end?weld.endWrapMode:'none',
  startHole:start&&weld.startHole,endHole:end&&weld.endHole,
  endpointFacts:{start:start?weld.endpointFacts?.start:facts,end:end?weld.endpointFacts?.end:facts}};
}

function normalizeMarkers(segments){
 for(const segment of segments){
  if(segment.strategyRole!=='wrap')continue;
  const count=Number(!!segment.startWrapKind)+Number(!!segment.endWrapKind);
  if(count)segment.strategyWrapKind=count===2?'U':'L';
  else {delete segment.strategyRole;delete segment.strategyWrapKind;}
 }
 for(let id=0;id<segments.length-1;id++){
  const before=segments[id],after=segments[id+1];
  if(!before.endWrapKind&&!after.startWrapKind)continue;
  const kind=before.strategyWrapKind==='U'||after.strategyWrapKind==='U'?'U':'L';
  before.endWrapKind=kind;
  after.startWrapKind=kind;
 }
}

export function splitWeldWrap(weld,id,type){
 const group=wrapGroups(weld).find(group=>group.joints.includes(id));
 if(!group||type!=='none'&&(type!=='L'||group.joints.length!==2))return [];
 const segments=weld.segments.map(segment=>structuredClone(segment));
 let runs;
 if(type==='none'){
  const next=(id+1)%segments.length;
  segments[id].endWrapKind=null;
  segments[next].startWrapKind=null;
  segments[id].endWrapMode='none';
  segments[next].startWrapMode='none';
  runs=weld.closure==='closed'?[[...segments.slice(next),...segments.slice(0,next)]]:
   [segments.slice(0,next),segments.slice(next)];
 }else{
  // Keep one corner on each side of the cut through the connector.
  const pivot=group.segment;
  const from=weld.closure==='closed'?(pivot+Math.ceil(segments.length/2))%segments.length:0;
  const ordered=[...segments.slice(from),...segments.slice(0,from)];
  const index=ordered.indexOf(segments[pivot]);
  ordered[0].startWrapKind=null;
  ordered.at(-1).endWrapKind=null;
  const lengths=ordered.map(segment=>pathLength(segment.pathPoints));
  const station=lengths.slice(0,index).reduce((sum,length)=>sum+length,0)+lengths[index]/2;
  runs=splitWeldPreview({...weld,segments:ordered,closure:'open'},station,{minimumLength:1e-7}).pieces;
 }
 return runs.filter(run=>run.length).map((run,index,all)=>{
  normalizeMarkers(run);
  // Retain only original external endpoint facts, never a fact from a cut.
  const open=weld.closure!=='closed';
  return fragment(weld,run,open&&index===0,open&&index===all.length-1);
 });
}
