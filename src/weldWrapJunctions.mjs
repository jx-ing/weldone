import {distance,pathGeometry,pathLength,wrapPathStation} from './manualWeldModel.mjs';
import {sliceWeldSegments} from './planningPathSettings.mjs';
import {INTERSECTION_TOLERANCE,mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
import {normalizeVerticalWeld,weldTravelReversed} from './weldDirectionGeometry.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {configuredWrapDistance,hasVerticalWrapLength,wrapDistanceRatio} from './planningConfiguration.mjs';

export const endpointWrapChoices=[['none','不包角'],['L','L形包角'],['U','U形包角'],['vertical','立焊上包角']];
export const continuousOpeningWrapAt=(before,after)=>before?.endWrapKind==='L'&&after?.startWrapKind==='L'&&
 before.endpointFacts?.end?.continuousOpeningWrap===true&&after.endpointFacts?.start?.continuousOpeningWrap===true;
const otherEnd=side=>side==='start'?'end':'start';
const endpoint=(points,side)=>side==='start'?points[0]:points.at(-1);
const samePoint=(a,b)=>distance(a,b)<=INTERSECTION_TOLERANCE;
const vector=(from,to)=>to.map((value,index)=>value-from[index]);
const unit=values=>{const length=Math.hypot(...values);return length>1e-7?values.map(value=>value/length):null;};
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

export function endpointWrapAt(weld,index,side){
 const physical=weldTravelReversed(weld)?otherEnd(side):side;
 const segment=weld.segments[index];
 const edit=segment?.[physical+'WrapEdit'];
 const blocked=side==='start'&&weldPositionCode(segment?.position)==='PF'&&!segment?.endpointFacts?.[physical]?.continuousOpeningWrap;
 const kind=edit?.kind??segment?.[physical+'WrapKind']??'none';
 const count=weld.segments.length,previous=physical==='start'?index-1:index;
 const junctionId=weld.closure==='closed'?(previous+count)%count:previous;
 const junction=kind!=='none'?weldWrapJunctions(weld).find(joint=>joint.id===junctionId):undefined;
 const pending=weld.pendingWrapEdits?.find(item=>item.id===junction?.id||item.type==='L'&&junction?.joints.includes(item.id));
 return {physical,value:blocked?'none':pending?.type??kind,blocked,edit,junction,pending};
}

export function endpointWrapNeighbor(weld,index,side){
 const at=index+(side==='start'?-1:1),count=weld.segments.length;
 if(at>=0&&at<count)return weld.segments[at];
 return weld.closure==='closed'&&count>1?weld.segments[(at+count)%count]:undefined;
}

export function endpointWrapEdge(segment,side,edgePoints,previousEdges=[]){
 const points=segment.pathPoints;
 const previous=previousEdges.at(-1);
 const start=previous?.at(-1)??endpoint(points,side);
 const approach=previous?.at(-2)??points[side==='start'?1:points.length-2];
 const incoming=unit(vector(approach,start));
 if(!incoming||!edgePoints?.every(point=>point.length===3&&point.every(Number.isFinite)))return null;
 let at=edgePoints.findIndex(point=>samePoint(point,start));
 if(at<0){
  const link=edgePoints.findIndex((end,index)=>{
   if(index===0)return false;
   const a=edgePoints[index-1],direction=unit(vector(a,end));
   if(!direction)return false;
   const t=dot(vector(a,start),direction);
   return t>0&&t<distance(a,end)&&samePoint(start,a.map((n,i)=>n+t*direction[i]));
  });
  if(link>0){edgePoints=[...edgePoints.slice(0,link),start,...edgePoints.slice(link)];at=link;}
 }
 if(at<0)return null;
 const choices=[edgePoints.slice(at),edgePoints.slice(0,at+1).reverse()].filter(path=>path.length>=2)
  .filter(path=>{
   const outgoing=unit(vector(start,path[1]));
   return outgoing&&Math.abs(dot(incoming,outgoing))<.98;
  });
 if(choices.length!==1)return null;
 const path=[start,...choices[0].slice(1)];
 if(previousEdges.length){
  const previousDirection=unit(vector(previous[0],previous.at(-1)));
  const first=unit(vector(points[side==='start'?1:points.length-2],endpoint(points,side)));
  const next=unit(vector(path[0],path[1]));
  if(!previousDirection||!first||!next||dot(first,next)>-.95||
   dot(cross(first,previousDirection),cross(previousDirection,next))<=0)return null;
 }
 return path;
}

export function endpointWrapCandidates(weld,index,side){
 const segment=weld.segments[index],neighbor=endpointWrapNeighbor(weld,index,side);
 if(!neighbor||neighbor.generatedEndpointWrap||segment[side+'AdjustedForMerge']||neighbor[otherEnd(side)+'AdjustedForMerge'])return [];
 const points=neighbor.pathPoints;
 const anchor=endpoint(segment.pathPoints,side);
 if(!samePoint(anchor,endpoint(points,otherEnd(side))))return [];
 const path=endpointWrapEdge(segment,side,points);
 return path?[path]:[];
}

export function endpointWrapEdgePortion(points,pick){
 const length=pathLength(points);
 const at=weldPointDistance({segments:[{pathPoints:points}]},pick);
 if(at<.1||length<.1)return null;
 if(at>=length-1e-7)return points;
 const edge={pathPoints:points,length,geometry:'曲线'};
 return sliceWrapSegment(edge,'start',at).pathPoints;
}

// Materialize explicit endpoint edits against the original segments each time.
// The appended sections are derived from the selected CAD edges.
export function materializeEndpointWraps(weld,settings){
 const base=weld.segments.filter(segment=>!segment.generatedEndpointWrap);
 if(!base.some(segment=>segment.startWrapEdit||segment.endWrapEdit)&&base.length===weld.segments.length)return weld;
 const segments=base.map(segment=>{
  const autoStartWrapKind=Object.hasOwn(segment,'autoStartWrapKind')?segment.autoStartWrapKind:segment.startWrapKind??null;
  const autoEndWrapKind=Object.hasOwn(segment,'autoEndWrapKind')?segment.autoEndWrapKind:segment.endWrapKind??null;
  const autoStrategyWrapKind=Object.hasOwn(segment,'autoStrategyWrapKind')?segment.autoStrategyWrapKind:segment.strategyWrapKind??null;
  return {...segment,autoStartWrapKind,autoEndWrapKind,autoStrategyWrapKind,
   startWrapKind:autoStartWrapKind,endWrapKind:autoEndWrapKind,strategyWrapKind:autoStrategyWrapKind??undefined,
   strategyRole:autoStrategyWrapKind?'wrap':segment.strategyRole==='wrap'?undefined:segment.strategyRole};
 });
 const row={...weld,segments};
 const generated={start:[],end:[]};
 const canWrap=kind=>kind==='U'||kind==='L'&&wrapDistanceRatio(settings)>0||kind==='vertical'&&hasVerticalWrapLength(settings);
 for(const [index,segment] of segments.entries())for(const side of ['start','end']){
  const edit=segment[side+'WrapEdit'];
  if(!edit)continue;
  const label=side+'WrapKind',neighbor=endpointWrapNeighbor(row,index,side);
  if(!canWrap(edit.kind)){segment[label]=null;continue;}
  segment[label]=edit.kind;
  if(neighbor){
   const short=neighbor.strategyRole==='wrap'?neighbor:
    segment.strategyRole==='wrap'?segment:neighbor;
   short.strategyRole='wrap';
   short.strategyWrapKind=edit.kind;
   continue;
  }
  if(edit.edges?.length!==(edit.kind==='U'?2:1))continue;
  const {startWrapKind,endWrapKind,startWrapEdit,endWrapEdit,autoStartWrapKind,autoEndWrapKind,autoStrategyWrapKind,
   endpointFacts,sourceWeldId,sourceUnitKey,terminalThicknessWeld,...parent}=segment;
  const parts=edit.edges.map((edge,at)=>{
   const pathPoints=side==='start'?[...edge].reverse():edge;
   const wrapSide=otherEnd(side),orientation=edit.kind==='U'&&at===1?null:edit.kind;
   const path={...parent,...pathGeometry(pathPoints),pathPoints,length:pathLength(pathPoints),
    generatedEndpointWrap:true,generatedForSide:side,position:edit.kind==='vertical'?'PB · 横角焊':segment.position,
    strategyRole:orientation?'wrap':undefined,strategyWrapKind:orientation??undefined,
    [wrapSide+'WrapKind']:edit.kind,...(edit.kind==='U'&&at===0?{[side+'WrapKind']:'U'}:{})};
   if(orientation&&edit.kind!=='U'){
    const limit=wrapSegmentDistance({...path,endpointFacts},settings,edit.kind);
    if(limit)return {...sliceWrapSegment(path,wrapSide,limit),strategyRole:'wrap',strategyWrapKind:edit.kind};
   }
   return path;
  });
  generated[side]=side==='start'?parts.reverse():parts;
 }
 // When both sides of a pre-existing connector explicitly opt out, treat it
 // as an ordinary segment. Keep each side's setting separate.
 for(const [index,segment] of segments.entries()){
  if(segment.strategyRole!=='wrap')continue;
  const active=['start','end'].some(side=>{
   const adjacent=endpointWrapNeighbor(row,index,side);
   const manual=segment[side+'WrapEdit'],other=adjacent?.[otherEnd(side)+'WrapEdit'];
   if(manual||other)return canWrap(manual?.kind)||canWrap(other?.kind);
   return !!segment[side+'WrapKind']||!!adjacent?.[otherEnd(side)+'WrapKind'];
  });
  if(!active){delete segment.strategyRole;delete segment.strategyWrapKind;}
 }
 const all=[...generated.start,...segments,...generated.end];
 const kind=['U','vertical','L'].find(value=>all.some(segment=>segment.strategyWrapKind===value));
 const sourceFacts=weld.endpointWrapSourceFacts??weld.endpointFacts??{};
 const endpointFacts={...sourceFacts};
 for(const side of ['start','end'])if(generated[side].length)endpointFacts[side]={hasHole:false};
 const {pathDirectionResolved,cornerGeometryMeasured,cornerDirections,sourceSegmentIndices,...untouched}=weld;
 return {...untouched,segments:all,topology:kind??(all.length>1?'corner':undefined),atConnection:all.length>1,
  endpointWrapSourceFacts:sourceFacts,endpointFacts,startHole:!!endpointFacts.start?.hasHole,endHole:!!endpointFacts.end?.hasHole,
  cornerAngles:mergeCornerAngles(all),length:all.reduce((sum,segment)=>sum+pathLength(segment.pathPoints),0)};
}

export function overlappingEndpointWrap(weld,welds){
 const additions=weld.segments.filter(segment=>segment.generatedEndpointWrap).flatMap(segment=>segment.pathPoints.slice(1)
  .map((end,index)=>[segment.pathPoints[index],end]));
 if(!additions.length)return null;
 return welds.find(other=>other.id!==weld.id&&other.enabled&&other.segments?.some(segment=>
  segment.pathPoints?.slice(1).some((end,index)=>{
   const start=segment.pathPoints[index];
   return additions.some(([from,to])=>{
    const direction=unit(vector(from,to));
    if(!direction)return false;
    const size=distance(from,to),a=dot(vector(from,start),direction),b=dot(vector(from,end),direction);
    if(Math.min(size,Math.max(a,b))-Math.max(0,Math.min(a,b))<=INTERSECTION_TOLERANCE)return false;
    return [[start,a],[end,b]].every(([point,at])=>samePoint(point,from.map((value,i)=>value+at*direction[i])));
   });
  })
 ));
}

export function uWrapStartStation(segments,stations,preferred,closed){
 const total=stations.at(-1);
 const at=closed?wrapPathStation(preferred,total):preferred;
 const tolerance=1e-5;
 const blocked=segments.findIndex((segment,index)=>segment.strategyWrapKind==='U'&&
  (at>=stations[index]-tolerance&&at<=stations[index+1]+tolerance||
   closed&&(at<=tolerance&&index===segments.length-1||total-at<=tolerance&&index===0)));
 if(blocked<0)return preferred;
 for(let step=1;step<segments.length;step++){
  const index=closed?(blocked+step)%segments.length:blocked-step;
  if(index<0)break;
  const segment=segments[index];
  if(segment.strategyWrapKind==='U'||segment.connectionGap||stations[index+1]-stations[index]<=2*tolerance)continue;
  return (stations[index]+stations[index+1])/2;
 }
 return null;
}

export function wrapGroups(weld){
 const {segments,closure}=weld;
 return segments.flatMap((segment,index)=>{
  if(!['L','U','vertical'].includes(segment.strategyWrapKind))return [];
  const joints=[];
  if((index>0||closure==='closed')&&segment.startWrapKind)joints.push((index+segments.length-1)%segments.length);
  if((index<segments.length-1||closure==='closed')&&segment.endWrapKind)joints.push(index);
  return joints.length?[{segment:index,joints}]:[];
 });
}

export function weldWrapJunctions(weld){
 const count=weld.segments.length,reversed=weldTravelReversed(weld);
 const joints=new Map();
 for(const {joints:ids,segment:groupSegment} of wrapGroups(weld)){
  for(const id of ids){
   const index=reversed&&id<count-1?count-2-id:id;
   const kind=weld.segments[id].endWrapKind??weld.segments[(id+1)%count].startWrapKind;
   const pending=weld.pendingWrapEdits??[];
   const type=pending.find(edit=>edit.id===id)?.type??kind;
   const current=joints.get(id);
   if(!current||ids.length>current.joints.length){
    joints.set(id,{id,index,type,kind,joints:ids,segment:groupSegment,canUseU:ids.length===2});
   }
  }
 }
 return [...joints.values()].sort((a,b)=>a.index-b.index);
}

function fragment(weld,segments,start,end){
 const first=segments[0];
 const facts={type:null,breakReason:'包角断开'};
 const topology=['U','vertical','L'].find(kind=>segments.some(segment=>segment.strategyWrapKind===kind));
 const {pendingWrapEdits,wrapPoseOverrides,strategyPlan,matchPlan,pointLayout,manualControlPoints,planningPointOverrides,mergedFrom,mergeHistory,mergeIntersections,mergedInto,splitInto,...base}=weld;
 const main=segments.filter(segment=>segment.strategyRole!=='wrap');
 const upright=topology==='vertical'&&main.length>0&&main.every(segment=>weldPositionCode(segment.position)==='PF');
 return normalizeVerticalWeld({...base,segments,closure:'open',length:segments.reduce((sum,segment)=>sum+pathLength(segment.pathPoints),0),
  position:upright?main[0].position:segments.every(segment=>segment.position===first.position)?first.position:'混合位置（逐段设置）',
  topology:topology??(segments.length>1?'corner':undefined),cornerAngles:mergeCornerAngles(segments),
  intermittentRanges:undefined,planned:false,completeStart:true,completeEnd:true,atConnection:segments.length>1,
  startWrapMode:start?weld.startWrapMode:'none',endWrapMode:end?weld.endWrapMode:'none',
  startHole:start&&weld.startHole,endHole:end&&weld.endHole,
  endpointFacts:{start:start?weld.endpointFacts?.start:facts,end:end?weld.endpointFacts?.end:facts}});
}

export function normalizeWrapMarkers(segments){
 for(const segment of segments){
  if(segment.strategyRole!=='wrap')continue;
  const count=Number(!!segment.startWrapKind)+Number(!!segment.endWrapKind);
  if(count)segment.strategyWrapKind=segment.strategyWrapKind==='vertical'?'vertical':
   count===2&&!segment.endpointFacts?.start?.continuousOpeningWrap&&!segment.endpointFacts?.end?.continuousOpeningWrap?'U':'L';
  else {delete segment.strategyRole;delete segment.strategyWrapKind;}
 }
 for(let id=0;id<segments.length-1;id++){
  const before=segments[id],after=segments[id+1];
  if(!before.endWrapKind&&!after.startWrapKind)continue;
  if(continuousOpeningWrapAt(before,after))continue;
  const kind=['U','vertical','L'].find(kind=>before.strategyWrapKind===kind||after.strategyWrapKind===kind);
  before.endWrapKind=kind;
  after.startWrapKind=kind;
 }
}

export function wrapPlateThickness(segment){
 return [segment.endpointFacts?.start?.plateThickness,segment.endpointFacts?.end?.plateThickness,
  segment.subplateThickness,segment.plateThickness?.副板厚度,segment.plateThickness]
  .find(value=>Number.isFinite(value)&&value>0);
}

export function wrapSegmentDistance(segment,settings,kind=segment.strategyWrapKind){
 return configuredWrapDistance(wrapPlateThickness(segment),settings,kind);
}

export function sliceWrapSegment(segment,side,distance){
 const length=pathLength(segment.pathPoints);
 if(!(distance>0&&distance<length-1e-7))return structuredClone(segment);
 const from=side==='start'?0:length-distance;
 const to=side==='start'?distance:length;
 const [part]=sliceWeldSegments({segments:[segment],length},from,to);
 const cut=side==='start'?'end':'start';
 part.endpointFacts={...part.endpointFacts,[cut]:{hasHole:false,type:null,breakReason:'包角距离'}};
 return part;
}

export function applyWeldWrapEdits(weld,edits,settings){
 let fragments=[{...weld,segments:weld.segments.map((segment,index)=>({...segment,wrapEditSourceIndex:index}))}];
 let applied=0;
 const ordered=[...edits].sort((a,b)=>Number(b.type==='none')-Number(a.type==='none'));
 for(const {id,type} of ordered){
  const next=(id+1)%weld.segments.length;
  fragments=fragments.flatMap(fragment=>{
   const joint=weldWrapJunctions(fragment).find(({id:at})=>
    fragment.segments[at].wrapEditSourceIndex===id&&
    fragment.segments[(at+1)%fragment.segments.length].wrapEditSourceIndex===next);
   if(!joint||joint.kind===type)return [fragment];
   const split=splitWeldWrap(fragment,joint.id,type,settings);
   if(split.length)applied++;
   return split.length?split:[fragment];
  });
 }
 return applied?fragments.map(fragment=>({...fragment,segments:fragment.segments.map(({wrapEditSourceIndex,...segment})=>segment)})):[];
}

export function splitWeldWrap(weld,id,type,settings,segment){
 const group=segment===undefined?weldWrapJunctions(weld).find(joint=>joint.id===id):
  wrapGroups(weld).find(group=>group.segment===segment&&group.joints.includes(id));
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
  const pivot=group.segment;
  const connector=segments[pivot];
  const distance=settings?wrapSegmentDistance(connector,settings,'L'):null;
  if(distance===0)return [];
  const before=segments.slice(0,pivot),after=segments.slice(pivot+1);
  const closed=weld.closure==='closed';
  // Retire the original U edit at both joints so later planning cannot
  // regenerate the connector over its two new L sections.
  for(const [segment,sides] of [[before.at(-1)??(closed?after.at(-1):undefined),['end']],
   [connector,['start','end']],[after[0]??(closed?before[0]:undefined),['start']]]){
   if(!segment)continue;
   delete segment.generatedEndpointWrap;
   delete segment.generatedForSide;
   delete segment.autoStrategyWrapKind;
   for(const side of sides){
    delete segment[side+'WrapEdit'];
    delete segment[side==='start'?'autoStartWrapKind':'autoEndWrapKind'];
   }
  }
  const length=distance??pathLength(connector.pathPoints)/2;
  const head=sliceWrapSegment(connector,'start',length);
  const tail=sliceWrapSegment(connector,'end',length);
  head.endWrapKind=null;
  tail.startWrapKind=null;
  // Opening a closed path at the selected connector leaves the rest connected.
  runs=closed?[[tail,...after,...before,head]]:[[...before,head],[tail,...after]];
 }
 return runs.filter(run=>run.length).map((run,index,all)=>{
  normalizeWrapMarkers(run);
  // Retain only original external endpoint facts, never a fact from a cut.
  const open=weld.closure!=='closed';
  return fragment(weld,run,open&&index===0,open&&index===all.length-1);
 });
}
