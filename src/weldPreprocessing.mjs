import {connectSegmentIntersections,intersectSegmentEnds,mergeCornerAngles,INTERSECTION_TOLERANCE} from './mergeIntersectionGeometry.mjs';
import {distance,pathLength,sampleManualWeldPath} from './manualWeldModel.mjs';
import {splitWeldPreview,weldPointDistance} from './manualSplitModel.mjs';
import {sliceWeldSegments} from './planningPathSettings.mjs';
import {directedWeld,measureDirectedConnection,normalizeVerticalWeld,verticalTraversal,weldTravelReversed} from './weldDirectionGeometry.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {sameGroove} from './grooveModel.mjs';
import {sliceWrapSegment,splitWeldWrap,wrapSegmentDistance} from './weldWrapJunctions.mjs';
import {hasVerticalWrapLength,wrapDistanceRatio} from './planningConfiguration.mjs';

const EPS=1e-6;
const isVertical=segment=>weldPositionCode(segment.position)==='PF';
const pairKey=segment=>segment.mainPartId&&segment.subPartId?
 JSON.stringify([segment.mainPartId,segment.subPartId].sort()):null;
const finite=value=>Number.isFinite(value)&&value>=0;
const hole=facts=>facts?.hasHole===true;
const threeFaceHole=facts=>hole(facts)&&(facts.junctionType??facts.type)==='三面交';
const plateThickness=(segment,facts)=>[facts?.plateThickness,segment.subplateThickness,segment.plateThickness?.副板厚度,segment.plateThickness]
 .find(value=>finite(value)&&value>0);
const endFacts=(weld,side)=>weld.endpointFacts?.[side]??weld.segments[side==='start'?0:weld.segments.length-1]?.endpointFacts?.[side];
const endPoint=(segment,side)=>segment.pathPoints[side==='start'?0:segment.pathPoints.length-1];

function shouldDelete(weld,rules,measure){
 if(weld.closure==='closed'||weld.segments.length!==1)return false;
 const segment=weld.segments[0];
 if(!segment.terminalThicknessWeld)return false;
 const start=endFacts(weld,'start'),end=endFacts(weld,'end');
 const bottom=endPoint(segment,'start')[2]<endPoint(segment,'end')[2]?'start':'end';
 if(isVertical(segment)&&hole(bottom==='start'?start:end))return true;
 if(!(rules.outerClearance>0))return false;
 for(const [side,facts] of [['start',start],['end',end]]){
  const gap=facts?.gap;
  if(finite(gap)&&gap<rules.outerClearance)return true;
  if(!finite(gap)){
   const measured=measure?.endpointClearance?.(segment,side,rules.outerClearance);
   if(finite(measured)&&measured<rules.outerClearance)return true;
  }
 }
 return false;
}

function removeVerticalStartHoleWelds(welds){
 const starts=new Map();
 for(const weld of welds)for(const segment of weld.segments){
  if(!isVertical(segment))continue;
  const side=endPoint(segment,'start')[2]<=endPoint(segment,'end')[2]?'start':'end';
  const facts=segment.endpointFacts?.[side]??(weld.segments.length===1?endFacts(weld,side):null);
  const pair=pairKey(segment);
  if(!pair||!hole(facts))continue;
  if(!starts.has(pair))starts.set(pair,[]);
  starts.get(pair).push({point:endPoint(segment,side),facts});
 }
 return welds.filter(weld=>{
  if(weld.segments.length!==1||weld.closure==='closed')return true;
  const [segment]=weld.segments;
  if(isVertical(segment)||segment.geometry!=='直线')return true;
  return !(starts.get(pairKey(segment))??[]).some(({point,facts})=>{
   const thickness=plateThickness(segment,facts);
   return thickness&&pathLength(segment.pathPoints)<=thickness+EPS&&
    ['start','end'].some(side=>distance(endPoint(segment,side),point)<=INTERSECTION_TOLERANCE);
  });
 });
}

function physicalTraversal(weld,reverse){
 return directedWeld(weld,undefined,reverse);
}

function joinedWeld(left,right,connected){
 const {segments,connections,length}=connected;
 const join=left.segments.length-1;
 const beforeOpening=endFacts(left,'end'),afterOpening=endFacts(right,'start');
 if(hole(beforeOpening))segments[join].endpointFacts={...segments[join].endpointFacts,end:beforeOpening};
 if(hole(afterOpening))segments[join+1].endpointFacts={...segments[join+1].endpointFacts,start:afterOpening};
 const leg=left.leg===right.leg?left.leg:null;
 const uniformPosition=segments.every(segment=>segment.position===segments[0].position);
 const samePosition=uniformPosition||segments.every(isVertical);
 const sourceEvidence={...left.sourceEvidence};
 for(const key of ['candidateIds','unitKeys','partPairs','originalPositions','grooves','endpoints']){
  sourceEvidence[key]=[...(left.sourceEvidence?.[key]??[]),...(right.sourceEvidence?.[key]??[])];
 }
 sourceEvidence.mergeIntersections=connections;
 const {pathDirectionResolved,sourceSegmentIndices,cornerDirections,cornerGeometryMeasured,closingCorner,...base}=left;
 return {...base,name:('转角 · '+left.name+' / '+right.name).slice(0,80),direction:weldTravelReversed({segments})?'反向':'正向',topology:'corner',
  processingKey:'merge:'+sourceEvidence.unitKeys.slice().sort().join(';'),
  segments,length,leg,position:uniformPosition?segments[0].position:'待确认',
  calculatedLeg:leg!==null&&(left.calculatedLeg||right.calculatedLeg),
  templateRequired:!samePosition||!Number.isFinite(leg)||left.weldType!==right.weldType||!sameGroove(left.groove,right.groove),
  uniformJoint:(left.uniformJoint??!left.templateRequired)&&(right.uniformJoint??!right.templateRequired)&&
   left.weldType===right.weldType&&sameGroove(left.groove,right.groove),
  cornerAngles:mergeCornerAngles(segments),mergeIntersections:connections,sourceEvidence,atConnection:true,
  endpointFacts:{start:endFacts(left,'start'),end:endFacts(right,'end')},startHole:left.startHole,endHole:right.endHole};
}

function openingCanContinue(segment,facts,rules){
 const thickness=plateThickness(segment,facts);
 return !threeFaceHole(facts)&&
  !(rules.minCornerHoleSize>0&&(!finite(facts.holeSize)||facts.holeSize<=rules.minCornerHoleSize))&&
  !(finite(rules.maxHolePlateThickness)&&(!finite(thickness)||thickness>rules.maxHolePlateThickness));
}

function crossesDisallowedOpening(before,after,start,end,connection,rules){
 const openings=[[before,end],[after,start]].filter(([,facts])=>hole(facts));
 if(!openings.length)return false;
 const sameOpening=end?.openingBoundaryIds?.some(id=>start?.openingBoundaryIds?.includes(id));
 const crossesOpening=connection.gap>EPS||sameOpening||openings.length===2;
 if(!crossesOpening)return false;
 return openings.some(([segment,facts])=>!openingCanContinue(segment,facts,rules));
}

function mergeWelds(input,{angleMin,angleMax,maxGroove,maxLength,maxCount},rules,measure,outerCorners){
 let welds=input;
 // Index endpoint candidates by weld distance. Re-index when a chain grows.
 while(true){
  const bins=new Map(),joins=[],width=Math.max(INTERSECTION_TOLERANCE,2*maxGroove);
  const grid=point=>point.map(value=>Math.floor(value/width));
  for(const [index,weld] of welds.entries()){
   if(weld.closure==='closed'||weld.segments.length>=30||Number.isFinite(maxLength)&&weld.length>maxLength+EPS)continue;
   for(const side of ['start','end']){
    const segment=weld.segments[side==='start'?0:weld.segments.length-1],point=endPoint(segment,side);
     const cell=grid(point);
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
     const neighbors=bins.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))??[];
     for(const other of neighbors){
       if(other.index===index||weld.segments.length+other.weld.segments.length>Math.min(30,maxCount??30)||distance(point,other.point)>maxGroove+EPS)continue;
      if(![segment.mainPartId,segment.subPartId].some(id=>id&&(id===other.segment.mainPartId||id===other.segment.subPartId)))continue;
      const left=physicalTraversal(other.weld,other.side==='start'),right=physicalTraversal(weld,side==='end');
      const before=left.segments.at(-1),after=right.segments[0];
      try{
       const connection=intersectSegmentEnds(before,after);
       if(connection.gap>EPS&&(
        connection.beforeExtension< -EPS||connection.afterExtension< -EPS||
         connection.gap>maxGroove+EPS))continue;
        const end=endFacts(left,'end'),start=endFacts(right,'start');
        if([end,start].some(facts=>facts?.breakReason==='用户删除'))continue;
        if(crossesDisallowedOpening(before,after,start,end,connection,rules))continue;
       const [angle]=mergeCornerAngles([before,after]);
        const connected=connectSegmentIntersections([...left.segments,...right.segments]);
        if(Number.isFinite(maxLength)&&connected.length>maxLength+EPS)continue;
        const pair=connected.segments.slice(left.segments.length-1,left.segments.length+1);
        const measured=angleMax>180||rules.outerClearance>0?measureDirectedConnection(left,...pair,measure?.measureCorner):null;
        const included=measured?.cornerSource==='solid'&&Number.isFinite(measured.angle)?measured.angle:angle;
        const mergeAngle=angleMax<=180&&included>180?360-included:included;
        if(!Number.isFinite(mergeAngle)||mergeAngle<angleMin-EPS||mergeAngle>angleMax+EPS)continue;
        if(rules.outerClearance>0&&measured?.angleSide==='outer'){
         const clearance=measure?.outerCornerClearance?.(pair,connection.point,rules.outerClearance);
         const blocked=clearance?.distance<rules.outerClearance||[end,start].some(facts=>finite(facts?.gap)&&facts.gap<rules.outerClearance);
         if(blocked){
          if(clearance?.partId)outerCorners.set(JSON.stringify([connection.point,clearance.partId]),{
           point:connection.point,partId:clearance.partId,segments:pair
          });
          continue;
         }
        }
       if(verticalTraversal(connected.segments)==='conflict')continue;
       joins.push({a:other.index,b:index,gap:connection.gap,weld:joinedWeld(left,right,connected)});
      }catch{/* No valid forward intersection. */}
     }
    }
    const key=cell.join(',');
    if(!bins.has(key))bins.set(key,[]);
    bins.get(key).push({index,weld,side,segment,point});
   }
  }
  if(!joins.length)return welds;
  const replaced=new Map(),consumed=new Set();
  for(const join of joins.sort((a,b)=>a.gap-b.gap||a.a-b.a||a.b-b.b)){
   if(consumed.has(join.a)||consumed.has(join.b))continue;
   consumed.add(join.a);consumed.add(join.b);replaced.set(join.a,join.weld);
  }
  welds=welds.flatMap((weld,index)=>replaced.has(index)?[replaced.get(index)]:consumed.has(index)?[]:[weld]);
 }
}

function holeCrossings(welds){
 const openings=new Map();
 for(const weld of welds)for(const segment of weld.segments){
  const pair=pairKey(segment);
  if(!pair)continue;
  for(const side of ['start','end']){
   const facts=segment.endpointFacts?.[side]??(segment===weld.segments[side==='start'?0:weld.segments.length-1]?endFacts(weld,side):null);
   if(!hole(facts)||!facts.openingBoundaryPoints?.length)continue;
   if(!openings.has(pair))openings.set(pair,[]);
   openings.get(pair).push({pair,facts,point:endPoint(segment,side)});
  }
 }
 return openings;
}

function cutAtOpening(weld,length,{facts,point}){
 const station=weldPointDistance(weld,point);
 const frame=sampleManualWeldPath(weld.segments,station);
 if(!frame||distance(frame.position,point)>INTERSECTION_TOLERANCE)return null;
 const extents=facts.openingBoundaryPoints.map(boundary=>{
  const at=weldPointDistance(weld,boundary);
  if(at>EPS&&at<length-EPS)return at;
  const edge=sampleManualWeldPath(weld.segments,at);
  return at+boundary.reduce((sum,value,index)=>sum+(value-edge.position[index])*edge.tangent[index],0);
 });
 const low=Math.min(...extents),high=Math.max(...extents),middle=(low+high)/2;
 return low>=-EPS&&high<=length+EPS&&high-low>EPS&&middle>EPS&&middle<length-EPS?middle:null;
}

function placeContinuousOpenings(weld,openings,rules){
 const stations=[0];
 for(const segment of weld.segments)stations.push(stations.at(-1)+pathLength(segment.pathPoints));
 const sameOpening=(a,b)=>hole(a)&&(a.openingBoundaryIds?.some(id=>b.openingBoundaryIds?.includes(id))||
  a.openingBoundaryPoints?.length===b.openingBoundaryPoints.length&&a.openingBoundaryPoints.every(point=>
   b.openingBoundaryPoints.some(other=>distance(point,other)<=INTERSECTION_TOLERANCE)));
 const located=weld.segments.map(()=>[]);
 const junctions=new Map();
 const candidates=new Set(weld.segments.flatMap(segment=>openings.get(pairKey(segment))??[]));
 for(const opening of candidates){
  const {facts,pair}=opening;
  if(facts.breakReason||weld.segments.some(segment=>['start','end'].some(side=>sameOpening(segment.endpointFacts?.[side],facts))))continue;
  const at=cutAtOpening(weld,stations.at(-1),opening);
  if(at===null)continue;
  const index=stations.findIndex((station,i)=>station>at+EPS&&i>0)-1;
  const segment=weld.segments[index];
  if(!segment||pairKey(segment)!==pair||!openingCanContinue(segment,facts,rules))continue;
  const local=at-stations[index];
  if(local<=EPS){
   if(index>0&&pairKey(weld.segments[index-1])===pair)junctions.set(index,facts);
  }else if(!located[index].some(mark=>Math.abs(mark.at-local)<=INTERSECTION_TOLERANCE))located[index].push({at:local,facts});
 }
 if(!junctions.size&&!located.some(marks=>marks.length))return weld;
 const firstSegment=[],lastSegment=[];
 let segmentCount=0;
 const segments=weld.segments.flatMap((segment,index)=>{
  let tail=segment,previous=0;
  const start=junctions.get(index),end=junctions.get(index+1);
  if(start||end)tail={...segment,endpointFacts:{...segment.endpointFacts,...(start?{start}:{}),...(end?{end}:{})}};
  const parts=[];
  for(const {at,facts} of located[index].sort((a,b)=>a.at-b.at)){
   const {pieces:[[before],[after]]}=splitWeldPreview({enabled:true,closure:'open',segments:[tail]},at-previous,{minimumLength:EPS});
   before.endpointFacts={...before.endpointFacts,end:facts};
   after.endpointFacts={...after.endpointFacts,start:facts};
   parts.push(before);tail=after;previous=at;
  }
  firstSegment[index]=segmentCount+1;
  segmentCount+=parts.length+1;
  lastSegment[index]=segmentCount;
  return [...parts,tail];
 });
 const mergeIntersections=weld.mergeIntersections?.map(connection=>({...connection,
  beforeSegment:lastSegment[connection.beforeSegment-1],afterSegment:firstSegment[connection.afterSegment-1]}));
 return {...weld,segments,atConnection:true,cornerAngles:mergeCornerAngles(segments),mergeIntersections};
}

function splitWeld(weld,openings,rules,measure,outerCorners){
 let offset=0;
 const cuts=[],blocked=[];
 const total=weld.segments.reduce((sum,segment)=>sum+pathLength(segment.pathPoints),0);
 const relevantOpenings=new Set(weld.segments.flatMap(segment=>openings.get(pairKey(segment))??[]));
 for(const segment of weld.segments){
  const length=pathLength(segment.pathPoints);
  for(const side of ['start','end']){
   const facts=segment.endpointFacts?.[side];
   if(threeFaceHole(facts)&&facts.openingBoundaryPoints?.length)relevantOpenings.add({facts,point:endPoint(segment,side)});
  }
  if(rules.outerClearance>0){
   const ranges=measure?.oppositeCornerRanges?.(segment,rules.outerClearance,outerCorners)??[];
   for(const range of ranges){
    const start=offset+Math.max(0,range.start),end=offset+Math.min(length,range.end);
    if(end-start<=EPS)continue;
    blocked.push({start,end});
    cuts.push({at:start,reason:'间隙打断'},{at:end,reason:'间隙打断'});
   }
  }
  offset+=length;
 }
 for(const opening of relevantOpenings){
  if(!threeFaceHole(opening.facts))continue;
  const at=cutAtOpening(weld,total,opening);
  if(at!==null)cuts.push({at,reason:'过焊孔打断',opening:opening.facts});
 }
 if(!cuts.length)return [weld];
 const stations=[{at:0}];
 for(const cut of cuts.sort((a,b)=>a.at-b.at||Number(!!b.opening)-Number(!!a.opening))){
  if(cut.at>stations.at(-1).at+EPS&&cut.at<offset-EPS)stations.push(cut);
 }
 stations.push({at:offset});
 return stations.slice(1).flatMap((end,index)=>{
  const start=stations[index],middle=(start.at+end.at)/2;
  if(end.at-start.at<=EPS||blocked.some(range=>middle>range.start-EPS&&middle<range.end+EPS))return [];
  const segments=sliceWeldSegments({...weld,length:offset},start.at,end.at);
  const cutFacts=cut=>({...cut.opening,breakReason:cut.reason,hasHole:!!cut.opening});
  const startFacts=start.at>EPS?cutFacts(start):endFacts(weld,'start');
  const endFactsAt=end.at<offset-EPS?cutFacts(end):endFacts(weld,'end');
  segments[0].endpointFacts={...segments[0].endpointFacts,start:startFacts};
  segments.at(-1).endpointFacts={...segments.at(-1).endpointFacts,end:endFactsAt};
  return [{...weld,closure:'open',topology:segments.length>1?'corner':undefined,atConnection:segments.length>1,segments,
   length:segments.reduce((sum,segment)=>sum+segment.length,0),cornerAngles:mergeCornerAngles(segments),
   processingKey:weld.processingKey+':cut:'+start.at.toFixed(6)+':'+end.at.toFixed(6),mergeIntersections:[],
   endpointFacts:{start:startFacts,end:endFactsAt},startHole:!!startFacts?.hasHole,endHole:!!endFactsAt?.hasHole}];
 });
}

export function classifyWeldWrap(weld,maximum,measureCorner,settings,rules={}){
 const directed=directedWeld(weld,measureCorner),markers=new Map();
 const separateReturns=new Set();
 const ends=weld.segments.map(()=>({startWrapKind:null,endWrapKind:null}));
 const openingEnds=weld.segments.map(()=>new Set());
 const sourceSide=side=>weldTravelReversed(weld)?(side==='start'?'end':'start'):side;
 const continuousOpenings=directed.segments.map((before,index)=>{
  const after=directed.segments[index+1]??(weld.closure==='closed'&&ends.length>1?directed.segments[0]:null);
  if(!after||before.connectionGap||after.connectionGap||distance(endPoint(before,'end'),endPoint(after,'start'))>INTERSECTION_TOLERANCE)return false;
  const openings=[[before,before.endpointFacts?.end],[after,after.endpointFacts?.start]].filter(([,facts])=>hole(facts));
  return openings.length>0&&openings.every(([segment,facts])=>!facts.breakReason&&openingCanContinue(segment,facts,rules));
 });
 const outer=index=>{
  const next=directed.segments[(index+1)%directed.segments.length];
  if(isVertical(next))return false;
  return directed.cornerDirections[index]?.angleSide==='outer'||
   weld.closure==='closed'&&directed.closingCorner?.angleSide==='outer'&&(index===-1||index===directed.segments.length-1);
 };
 for(const [index,segment] of directed.segments.entries()){
  const thickness=plateThickness(segment,segment.endpointFacts?.start)??plateThickness(segment,segment.endpointFacts?.end);
  if(isVertical(segment)||segment.connectionGap||segment.geometry!=='直线'||!finite(thickness)||pathLength(segment.pathPoints)>thickness+EPS||finite(maximum)&&thickness>=maximum)continue;
  const previousIndex=(index+ends.length-1)%ends.length;
  const nextIndex=(index+1)%ends.length;
  const original=directed.sourceSegmentIndices[index];
  const overlapsExtension=other=>{
   const target=directed.sourceSegmentIndices[other];
   return (weld.mergeIntersections??[]).some(({beforeSegment,afterSegment,gap})=>
    gap>INTERSECTION_TOLERANCE&&(
     beforeSegment===original+1&&afterSegment===target+1||
     afterSegment===original+1&&beforeSegment===target+1));
  };
  const previous=directed.segments[previousIndex],next=directed.segments[nextIndex];
  const before=!previous.connectionGap&&!previous.endAdjustedForMerge&&!segment.startAdjustedForMerge&&!overlapsExtension(previousIndex)&&outer(index-1);
  const after=!next.connectionGap&&!next.startAdjustedForMerge&&!segment.endAdjustedForMerge&&!overlapsExtension(nextIndex)&&outer(index);
  if(!before&&!after)continue;
  const upper=before&&(index>0||weld.closure==='closed')&&isVertical(previous)&&!isVertical(segment);
  if(upper?settings?.verticalEnabled===false:settings?.flatEnabled===false)continue;
  const samePair=pairKey(segment)&&pairKey(previous)===pairKey(segment)&&pairKey(next)===pairKey(segment);
  const incoming=sampleManualWeldPath([previous],pathLength(previous.pathPoints))?.tangent;
  const outgoing=sampleManualWeldPath([next],0)?.tangent;
  const opposing=incoming&&outgoing&&incoming.reduce((dot,value,axis)=>dot+value*outgoing[axis],0)<-.98;
  const twoReturns=!upper&&before&&after;
  const opening=continuousOpenings[previousIndex]||continuousOpenings[index];
  const u=twoReturns&&samePair&&opposing&&!opening;
  const kind=opening?'L':upper?'vertical':u?'U':'L';
  if(kind==='L'&&wrapDistanceRatio(settings)===0||kind==='vertical'&&!hasVerticalWrapLength(settings))continue;
  if(twoReturns&&!u&&!opening)separateReturns.add(original);
  markers.set(directed.sourceSegmentIndices[index],kind);
  function mark(at,side){
   const segmentIndex=directed.sourceSegmentIndices[(at+ends.length)%ends.length];
   const key=sourceSide(side)+'WrapKind';
   if(ends[segmentIndex][key]!=='U')ends[segmentIndex][key]=kind;
  }
  if(before){mark(index,'start');mark(index-1,'end');}
  if(after&&!upper){mark(index,'end');mark(index+1,'start');}
 }
 for(const [index,opening] of continuousOpenings.entries()){
  if(!opening)continue;
  for(const [at,side] of [[index,'end'],[(index+1)%ends.length,'start']]){
   const original=directed.sourceSegmentIndices[at],physical=sourceSide(side);
   ends[original][physical+'WrapKind']='L';
   openingEnds[original].add(physical);
  }
 }
 const kinds=[...markers.values()];
 if(continuousOpenings.some(Boolean))kinds.push('L');
 return {...weld,...(kinds.length?{topology:kinds.includes('U')?'U':kinds.includes('vertical')?'vertical':'L'}:{}),segments:weld.segments.map((segment,index)=>({
   ...segment,...ends[index],separateWrapReturns:separateReturns.has(index)||undefined,
   ...openingEndpointFacts(segment,openingEnds[index]),
   ...(markers.has(index)?{strategyRole:'wrap',strategyWrapKind:markers.get(index)}:{strategyRole:segment.strategyRole==='wrap'?undefined:segment.strategyRole,strategyWrapKind:undefined})
 }))};
}

function openingEndpointFacts(segment,ends){
 if(!ends.size&&!segment.endpointFacts?.start?.continuousOpeningWrap&&!segment.endpointFacts?.end?.continuousOpeningWrap)return {};
 const endpointFacts={...segment.endpointFacts};
 for(const side of ['start','end']){
  if(ends.has(side))endpointFacts[side]={...endpointFacts[side],continuousOpeningWrap:true};
  else if(endpointFacts[side]?.continuousOpeningWrap){
   const {continuousOpeningWrap,...facts}=endpointFacts[side];
   endpointFacts[side]=facts;
  }
 }
 return {endpointFacts};
}

const touchesContinuousOpening=segment=>segment.endpointFacts?.start?.continuousOpeningWrap||segment.endpointFacts?.end?.continuousOpeningWrap;

function splitIndependentReturns(weld,settings){
 const at=weld.segments.findIndex(segment=>segment.separateWrapReturns===true);
 if(at<0)return [weld];
 const segments=weld.segments.map((segment,index)=>index===at?{...segment,separateWrapReturns:undefined}:segment);
 const candidate={...weld,segments};
 const before=(at+segments.length-1)%segments.length;
 const parts=splitWeldWrap(candidate,before,'L',settings??{lDistanceRatio:'2/3'},at);
 return (parts.length?parts:[candidate]).flatMap((part,index)=>splitIndependentReturns(
  {...part,processingKey:weld.processingKey+':L:'+at+':'+index},settings));
}

function splitInternalWrapDistances(weld,settings){
 if(!settings)return [weld];
 let offset=0;
 const cuts=[];
 for(const [index,segment] of weld.segments.entries()){
  const length=pathLength(segment.pathPoints);
  const wrap=segment.strategyWrapKind;
  if((wrap==='L'||wrap==='vertical')&&!touchesContinuousOpening(segment)&&(weld.closure==='closed'||index>0&&index<weld.segments.length-1)){
   const distance=wrapSegmentDistance(segment,settings);
   if(distance>0&&distance<length-EPS)cuts.push(offset+(segment.startWrapKind?distance:length-distance));
  }
  offset+=length;
 }
 if(!cuts.length)return [weld];
 const stations=[0,...cuts,offset];
 const runs=stations.slice(1).map((end,index)=>sliceWeldSegments({...weld,length:offset},stations[index],end));
 if(weld.closure==='closed')runs[0]=[...runs.pop(),...runs[0]];
 return runs.map((segments,index)=>{
  for(const segment of segments){
   if(!['L','vertical'].includes(segment.strategyWrapKind)||segment.startWrapKind||segment.endWrapKind)continue;
   delete segment.strategyWrapKind;
   delete segment.strategyRole;
  }
  const cut={type:null,hasHole:false,breakReason:'包角距离'};
  const start=index===0&&weld.closure!=='closed'?endFacts(weld,'start'):cut;
  const end=index===runs.length-1&&weld.closure!=='closed'?endFacts(weld,'end'):cut;
  segments[0].endpointFacts={...segments[0].endpointFacts,start};
  segments.at(-1).endpointFacts={...segments.at(-1).endpointFacts,end};
  const topology=['U','vertical','L'].find(kind=>segments.some(segment=>segment.strategyWrapKind===kind));
  return {...weld,segments,closure:'open',atConnection:segments.length>1,topology:topology??(segments.length>1?'corner':undefined),
   processingKey:weld.processingKey+':wrap-distance:'+index,mergeIntersections:[],cornerAngles:mergeCornerAngles(segments),
   length:segments.reduce((sum,segment)=>sum+segment.length,0),endpointFacts:{start,end},startHole:!!start?.hasHole,endHole:!!end?.hasHole};
 });
}

function sizeWrapSegments(weld,settings){
 const {uniformJoint,...weldData}=weld;
 if(!settings||weld.closure==='closed')return weldData;
 const last=weld.segments.length-1;
 const segments=weld.segments.map((segment,index)=>{
  if(!['L','vertical'].includes(segment.strategyWrapKind)||touchesContinuousOpening(segment))return segment;
  const distance=wrapSegmentDistance(segment,settings);
  if(index===last&&segment.startWrapKind)return sliceWrapSegment(segment,'start',distance);
  if(index===0&&segment.endWrapKind)return sliceWrapSegment(segment,'end',distance);
  return segment;
 });
 const start=segments[0].endpointFacts?.start??weld.endpointFacts?.start;
 const end=segments.at(-1).endpointFacts?.end??weld.endpointFacts?.end;
 const mainSegments=segments.filter(segment=>segment.strategyRole!=='wrap');
 const main=mainSegments[0];
 const verticalOnly=segments.some(segment=>segment.strategyWrapKind==='vertical')&&mainSegments.length>0&&
  mainSegments.every(segment=>isVertical(segment));
 const uniformMainLeg=main&&mainSegments.every(segment=>segment.weldLeg===main.weldLeg);
 return {...weldData,segments,length:segments.reduce((sum,segment)=>sum+segment.length,0),
  endpointFacts:{start,end},startHole:!!start?.hasHole,endHole:!!end?.hasHole,
  ...(verticalOnly&&uniformMainLeg&&uniformJoint?{position:main.position,leg:main.weldLeg??weld.leg,templateRequired:false}: {})};
}

export function classifyManualMergeWraps(weld,rules,settings,measureCorner){
 const classified=normalizeVerticalWeld(classifyWeldWrap(weld,rules?.maxWrapPlateThickness,measureCorner,settings,rules));
 return sizeWrapSegments(classified,settings);
}

export function preprocessExtractedWelds(welds,rules,merge,measure,wrapSettings){
 const openings=holeCrossings(welds);
 const kept=removeVerticalStartHoleWelds(welds).filter(weld=>!shouldDelete(weld,rules,measure));
 const outerCorners=new Map();
 const joined=mergeWelds(kept,merge,rules,measure,outerCorners);
 const corners=[...outerCorners.values()];
 return joined.flatMap(weld=>splitWeld(weld,openings,rules,measure,corners))
  .map(weld=>placeContinuousOpenings(weld,openings,rules))
  .map(weld=>normalizeVerticalWeld(classifyWeldWrap(weld,rules.maxWrapPlateThickness,measure?.measureCorner,wrapSettings,rules)))
  .flatMap(weld=>splitIndependentReturns(weld,wrapSettings))
  .flatMap(weld=>splitInternalWrapDistances(weld,wrapSettings))
  .map(weld=>sizeWrapSegments(weld,wrapSettings));
}
