import {connectSegmentIntersections,intersectSegmentEnds,mergeCornerAngles,INTERSECTION_TOLERANCE} from './mergeIntersectionGeometry.mjs';
import {distance,pathLength,sampleManualWeldPath} from './manualWeldModel.mjs';
import {weldPointDistance} from './manualSplitModel.mjs';
import {sliceWeldSegments} from './planningPathSettings.mjs';
import {directedWeld,normalizeVerticalWeld,verticalTraversal,weldTravelReversed} from './weldDirectionGeometry.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {sameGroove} from './grooveModel.mjs';
import {distanceRangesBelow} from './templateDistanceProfile.mjs';

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
 for(const facts of [start,end]){
  if(!hole(facts))continue;
  const thickness=plateThickness(segment,facts);
  if(finite(rules.maxHolePlateThickness)&&finite(thickness)&&thickness>rules.maxHolePlateThickness)return true;
  if(finite(facts.holeSize)&&facts.holeSize<rules.minCornerHoleSize)return true;
 }
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

function physicalTraversal(weld,reverse){
 return directedWeld(weld,undefined,reverse);
}

function joinedWeld(left,right,connected){
 const {segments,connections,length}=connected;
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
  cornerAngles:mergeCornerAngles(segments),mergeIntersections:connections,sourceEvidence,atConnection:true,
  endpointFacts:{start:endFacts(left,'start'),end:endFacts(right,'end')},startHole:left.startHole,endHole:right.endHole};
}

function mergeWelds(input,{angleMin,angleMax,maxGroove},measureCorner){
 let welds=input;
 // Index endpoint candidates by weld distance. Re-index when a chain grows.
 while(true){
  const bins=new Map(),joins=[],width=Math.max(INTERSECTION_TOLERANCE,2*maxGroove);
  const grid=point=>point.map(value=>Math.floor(value/width));
  for(const [index,weld] of welds.entries()){
   if(weld.closure==='closed'||weld.segments.length>=30)continue;
   for(const side of ['start','end']){
    const segment=weld.segments[side==='start'?0:weld.segments.length-1],point=endPoint(segment,side);
    const cell=grid(point);
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
     const neighbors=bins.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))??[];
     for(const other of neighbors){
      if(other.index===index||weld.segments.length+other.weld.segments.length>30||distance(point,other.point)>width)continue;
      if(![segment.mainPartId,segment.subPartId].some(id=>id&&(id===other.segment.mainPartId||id===other.segment.subPartId)))continue;
      const left=physicalTraversal(other.weld,other.side==='start'),right=physicalTraversal(weld,side==='end');
      const before=left.segments.at(-1),after=right.segments[0];
      try{
       const connection=intersectSegmentEnds(before,after);
       if(connection.gap>EPS&&(
        connection.beforeExtension< -EPS||connection.afterExtension< -EPS||
        Math.max(connection.beforeExtension,connection.afterExtension)>=maxGroove))continue;
       const [angle]=mergeCornerAngles([before,after]);
       const measured=angleMax>180?directedWeld({...left,pathDirectionResolved:false,direction:'正向',segments:[before,after]},measureCorner,false).cornerDirections[0]:null;
       const included=measured?.cornerSource==='solid'?measured.angle:angle;
       if(!Number.isFinite(included)||included<angleMin-EPS||included>angleMax+EPS)continue;
       const connected=connectSegmentIntersections([...left.segments,...right.segments]);
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
   if(!threeFaceHole(facts)||!facts.openingBoundaryPoints?.length)continue;
   if(!openings.has(pair))openings.set(pair,[]);
   openings.get(pair).push({facts,point:endPoint(segment,side)});
  }
 }
 return openings;
}

function cutAtOpening(segment,{facts,point}){
 const points=segment.pathPoints,length=pathLength(points);
 const station=weldPointDistance({segments:[segment]},point);
 const frame=sampleManualWeldPath([segment],station);
 if(!frame||distance(frame.position,point)>INTERSECTION_TOLERANCE)return null;
 const extents=facts.openingBoundaryPoints.map(boundary=>station+
  boundary.reduce((sum,value,index)=>sum+(value-point[index])*frame.tangent[index],0));
 const low=Math.min(...extents),high=Math.max(...extents),middle=(low+high)/2;
 return low>=-EPS&&high<=length+EPS&&high-low>EPS&&middle>EPS&&middle<length-EPS?middle:null;
}

function splitWeld(weld,openings,rules,measure){
 let offset=0;
 const cuts=[],blocked=[];
 for(const segment of weld.segments){
  const length=pathLength(segment.pathPoints);
  const ownOpenings=['start','end'].flatMap(side=>{
   const facts=segment.endpointFacts?.[side];
   return threeFaceHole(facts)&&facts.openingBoundaryPoints?.length?[{facts,point:endPoint(segment,side)}]:[];
  });
  for(const opening of [...ownOpenings,...(openings.get(pairKey(segment))??[])]){
   const at=cutAtOpening(segment,opening);
   if(at!==null)cuts.push({at:offset+at,reason:'过焊孔打断',opening:opening.facts});
  }
  if(rules.outerClearance>0){
   const profile=measure?.segmentClearance?.(segment,rules.outerClearance)??segment.solidGap;
   for(const range of distanceRangesBelow(profile,rules.outerClearance)){
    const start=offset+Math.max(0,range.start),end=offset+Math.min(length,range.end);
    if(end-start<=EPS)continue;
    blocked.push({start,end});
    cuts.push({at:start,reason:'间隙打断'},{at:end,reason:'间隙打断'});
   }
  }
  offset+=length;
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

export function classifyWeldWrap(weld,maximum,measureCorner){
 const directed=directedWeld(weld,measureCorner),markers=new Map();
 const ends=weld.segments.map(()=>({startWrapKind:null,endWrapKind:null}));
 const outer=index=>{
  const next=directed.segments[(index+1)%directed.segments.length];
  if(isVertical(next))return false;
  return directed.cornerDirections[index]?.angleSide==='outer'||
   weld.closure==='closed'&&directed.closingCorner?.angleSide==='outer'&&(index===-1||index===directed.segments.length-1);
 };
 for(const [index,segment] of directed.segments.entries()){
  const thickness=plateThickness(segment,segment.endpointFacts?.start)??plateThickness(segment,segment.endpointFacts?.end);
  if(segment.geometry!=='直线'||!finite(thickness)||pathLength(segment.pathPoints)>thickness+EPS||finite(maximum)&&thickness>=maximum)continue;
  const before=outer(index-1),after=outer(index);
  if(!before&&!after)continue;
  const kind=before&&after?'U':'L';
  markers.set(directed.sourceSegmentIndices[index],kind);
  const endKey=side=>(weldTravelReversed(weld)?(side==='start'?'end':'start'):side)+'WrapKind';
  function mark(at,side){
   const segmentIndex=directed.sourceSegmentIndices[(at+ends.length)%ends.length];
   const key=endKey(side);
   if(ends[segmentIndex][key]!=='U')ends[segmentIndex][key]=kind;
  }
  if(before){mark(index,'start');mark(index-1,'end');}
  if(after){mark(index,'end');mark(index+1,'start');}
 }
 const kinds=[...markers.values()];
 return {...weld,...(kinds.length?{topology:kinds.includes('U')?'U':'L'}:{}),segments:weld.segments.map((segment,index)=>({
  ...segment,...ends[index],...(markers.has(index)?{strategyRole:'wrap',strategyWrapKind:markers.get(index)}:{strategyRole:segment.strategyRole==='wrap'?undefined:segment.strategyRole,strategyWrapKind:undefined})
 }))};
}

export function preprocessExtractedWelds(welds,rules,merge,measure){
 const openings=holeCrossings(welds);
 const kept=welds.filter(weld=>!shouldDelete(weld,rules,measure));
 const joined=mergeWelds(kept,merge,measure?.measureCorner);
 return joined.flatMap(weld=>splitWeld(weld,openings,rules,measure))
  .map(weld=>normalizeVerticalWeld(classifyWeldWrap(weld,rules.maxWrapPlateThickness,measure?.measureCorner)));
}
