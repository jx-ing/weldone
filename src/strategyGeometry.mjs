import {endpointStrategy} from './strategyPlanning.mjs';
import {settingsDefaults} from './planningSettingsModel.mjs';
import {directedWeld} from './weldDirectionGeometry.mjs';
import {distance} from './manualWeldModel.mjs';
import {mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
import {MAX_PLANNING_WELDS,weldPositionCode} from './planningRequirements.mjs';
import {sliceWeldSegments} from './planningPathSettings.mjs';

const subtract = (a,b) => a.map((value,index)=>value-b[index]);
const dot = (a,b) => a.reduce((sum,value,index)=>sum+value*b[index],0);
const unit = vector => {const size=Math.hypot(...vector);return size>1e-8?vector.map(value=>value/size):null;};
const boundary = (weld,side) => {
 const segment=side==='start'?weld.segments[0]:weld.segments.at(-1);
 const points=segment.pathPoints;
 return {segment,position:side==='start'?points[0]:points.at(-1),tangent:unit(side==='start'?subtract(points[0],points[1]):subtract(points.at(-1),points.at(-2)))};
};
const weldArc=segment=>segment.geometry==='圆弧'||Number.isFinite(segment.shape?.radius);
const isVertical=weld=>['PF','PG'].includes(weldPositionCode(weld.position));
const actualCollision=(weld,settings)=>settings.samplingAvoidance.enabled&&settings.samplingAvoidance.autoDeleteUnavoidable&&weld.collisionResult?.verified===true;

export function excludeVerifiedCollision(weld,settings,nextId){
 if(!actualCollision(weld,settings)||!weld.segments?.every(segment=>segment.pathPoints?.length>=2))return [weld];
 const data=weld.collisionResult;
 if(data.entireWeld===true)return [];
 if(!Array.isArray(data.unavoidableRanges)||!data.unavoidableRanges.length)return [weld];
 const ranges=data.unavoidableRanges.filter(range=>Array.isArray(range)&&range.length===2&&range.every(Number.isFinite)&&range[0]>=0&&range[0]<range[1]&&range[1]<=weld.length).sort((a,b)=>a[0]-b[0]);
 if(ranges.length!==data.unavoidableRanges.length)return [weld];
 const kept=[];
 let start=0;
 for(const [from,to] of ranges){if(from-start>=.1)kept.push([start,from]);start=Math.max(start,to);}
 if(weld.length-start>=.1)kept.push([start,weld.length]);
 const cut={type:'避障打断',breakReason:'避障打断'};
 return kept.map(([from,to])=>{
  const segments=sliceWeldSegments(weld,from,to);
  return {...weld,id:nextId(),name:weld.name+' · 避障打断',processingKey:weld.processingKey+':avoid:'+from+':'+to,closure:'open',segments,length:segments.reduce((sum,s)=>sum+s.length,0),cornerAngles:mergeCornerAngles(segments),intermittentRanges:undefined,
   collisionResult:undefined,endpointFacts:{start:from>0?cut:weld.endpointFacts?.start,end:to<weld.length?cut:weld.endpointFacts?.end},
   startHole:from===0&&weld.startHole,endHole:to===weld.length&&weld.endHole};
 });
}

export function strategyGeometryRows(rows,rawSettings){
 const settings=settingsDefaults(rawSettings),expanded=[];
 let sequence=Math.max(0,...rows.map(({weld})=>Number(weld.id.slice(1))||0));
 const nextId=()=> 'W'+String(++sequence).padStart(3,'0');
 for(const row of rows){
  const {weld,decision}=row;
  if(!decision.ready||decision.route!=='automatic'||!weld.segments?.every(segment=>segment.pathPoints?.length>=2)){
   expanded.push(row);continue;
  }
  for(const part of excludeVerifiedCollision(weld,settings,nextId)){
   const indices=part.segments.slice(1).flatMap((segment,index)=>weldArc(part.segments[index])&&weldArc(segment)&&Math.abs((part.cornerAngles?.[index]??180)-180)>.01?[index+1]:[]);
   if(!indices.length){expanded.push({weld:part,decision:{...decision,plannedSegments:part.segments}});continue;}
   const breakType={type:'长度打断',breakReason:'长度打断'};
   const boundaries=[0,...indices,part.segments.length];
   for(const [index,start] of boundaries.slice(0,-1).entries()){
    const end=boundaries[index+1],segments=part.segments.slice(start,end);
    const child={...part,id:nextId(),name:part.name+' · 圆弧段'+(index+1),processingKey:part.processingKey+':arc:'+start,closure:'open',segments,length:segments.reduce((sum,s)=>sum+s.length,0),cornerAngles:mergeCornerAngles(segments),intermittentRanges:undefined,endpointFacts:{start:start?breakType:part.endpointFacts?.start,end:end<part.segments.length?breakType:part.endpointFacts?.end},startHole:!start&&part.startHole,endHole:end===part.segments.length&&part.endHole};
    expanded.push({weld:child,decision:{...decision,plannedSegments:segments}});
   }
  }
 }

 const buckets=new Map();
 for(const row of expanded){
  const {weld,decision}=row;
  if(!decision.ready||decision.route!=='automatic'||weld.closure==='closed'||!weld.segments?.every(segment=>segment.pathPoints?.length>=2))continue;
  for(const side of ['start','end']){
   const facts=weld.endpointFacts?.[side],end=boundary(weld,side);
   if(endpointStrategy(facts,settings,end.segment.position,side,weld.machineCount===2)!=='U')continue;
   if(!end.tangent||!Number.isFinite(facts?.plateThickness)||facts.plateThickness<=0||!facts.offsetDirection||!end.segment.subPartId||!end.segment.mainPartId)continue;
   const key=[decision.process.id,end.segment.mainPartId,end.segment.subPartId].join('|');
   if(!buckets.has(key))buckets.set(key,[]);
   buckets.get(key).push({row,side,facts,...end});
  }
 }
 const consumed=new Set(),joined=[];
 for(const endpoints of buckets.values()){
  for(const a of endpoints){
   if(consumed.has(a.row.weld.id))continue;
   const matches=endpoints.filter(b=>{
    if(a.row===b.row||consumed.has(b.row.weld.id))return false;
    const gap=distance(a.position,b.position),toward=unit(subtract(b.position,a.position));
    return toward&&Math.abs(gap-a.facts.plateThickness)<.5&&Math.abs(gap-b.facts.plateThickness)<.5&&dot(a.tangent,b.tangent)>.99&&
      Math.abs(dot(a.tangent,toward))<.05&&dot(a.facts.offsetDirection,toward)>.95&&dot(b.facts.offsetDirection,toward)<-.95;
   });
   if(matches.length!==1)continue;
   const b=matches[0],left=directedWeld({...a.row.weld,direction:a.side==='start'?'反向':'正向'}),right=directedWeld({...b.row.weld,direction:b.side==='end'?'反向':'正向'});
   const pathPoints=[a.position,b.position].map(point=>[...point]);
   const connector={...a.segment,geometry:'直线',shape:undefined,pathPoints,length:distance(...pathPoints),strategyRole:'wrap'};
   const segments=[...left.segments,connector,...right.segments];
   if(segments.length>30)continue;
   const maxLength=settings.mergeParameters.lengthEnabled?settings.mergeParameters.maxLength:Infinity;
   const length=segments.reduce((sum,segment)=>sum+segment.length,0);
   if(length>maxLength)continue;
   const weld={...a.row.weld,id:nextId(),name:('U形包角 · '+a.row.weld.name+' / '+b.row.weld.name).slice(0,80),processingKey:'wrap:'+a.row.weld.processingKey+';'+b.row.weld.processingKey,direction:'正向',segments,length,cornerAngles:mergeCornerAngles(segments),startHole:left.startHole,endHole:right.endHole,endpointFacts:{start:left.endpointFacts?.start,end:right.endpointFacts?.end},
    sourceEvidence:{...a.row.weld.sourceEvidence,unitKeys:[...(a.row.weld.sourceEvidence?.unitKeys??[]),...(b.row.weld.sourceEvidence?.unitKeys??[])]}};
   joined.push({weld,decision:{...a.row.decision,plannedSegments:segments}});
   consumed.add(a.row.weld.id);consumed.add(b.row.weld.id);
  }
 }
 const result=[...expanded.filter(row=>!consumed.has(row.weld.id)),...joined];
 if(result.length>MAX_PLANNING_WELDS)throw Error('规划后的焊缝数量超过工作区上限');
 return result;
}

export function assignWeldingOrder(welds, settings){
 const verticalByPart=new Map();
 const parts=weld=>new Set(weld.segments?.flatMap(segment=>[segment.mainPartId,segment.subPartId]).filter(Boolean));
 const available=welds.filter(weld=>weld.enabled&&weld.planned);
 for(const weld of available.filter(isVertical))for(const part of parts(weld)){
  if(!verticalByPart.has(part))verticalByPart.set(part,[]);
  verticalByPart.get(part).push(weld);
 }
 const direction=settings.sequenceParameters?.scanDirection;
 const projected=weld=>{
  const point=weld.segments?.[0]?.pathPoints?.[0];
  return Array.isArray(direction)&&direction.length===3&&direction.every(Number.isFinite)&&point?dot(point,direction):0;
 };
 available.sort((a,b)=>projected(b)-projected(a)||Number(isVertical(b))-Number(isVertical(a)));
 const order=new Map();
 for(const weld of available){
  if(!isVertical(weld))for(const part of parts(weld))for(const dependency of verticalByPart.get(part)??[]){
   if(!order.has(dependency.id))order.set(dependency.id,order.size+1);
  }
  if(!order.has(weld.id))order.set(weld.id,order.size+1);
 }
 return welds.map(weld=>({...weld,weldingOrder:order.get(weld.id)??null}));
}
