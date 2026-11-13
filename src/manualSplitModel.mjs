import {MAX_PLANNING_WELDS,weldForm} from './planningRequirements.mjs';
import {distance,pathLength,pathGeometry,sampleManualWeldPath} from './manualWeldModel.mjs';
import {normalizeVerticalWeld} from './weldDirectionGeometry.mjs';
import {mergeCornerAngles} from './mergeIntersectionGeometry.mjs';
const metric=v=>Math.round(v*10000)/10000;
export function weldPointDistance(weld,point){
 let start=0,best={error:Infinity,distance:0};
 for(const s of weld.segments)for(let i=1;i<s.pathPoints.length;i++){
  const a=s.pathPoints[i-1],b=s.pathPoints[i],delta=b.map((v,j)=>v-a[j]),length=distance(a,b),t=length?Math.max(0,Math.min(1,delta.reduce((n,v,j)=>n+(point[j]-a[j])*v,0)/(length*length))):0,project=a.map((v,j)=>v+delta[j]*t),error=distance(point,project);
  if(error<best.error)best={error,distance:start+length*t};start+=length;
 }
 return best.distance;
}
function piece(segment,points,atStart,atEnd){
 const shape=pathGeometry(points),length=pathLength(points);return {...structuredClone(segment),...shape,geometry:shape.geometry==='圆弧'?'曲线':shape.geometry,pathPoints:points,length:metric(length)||length,...(segment.strategyRole==='wrap'?{strategyWrapKind:'L'}:{}),...(!atStart?{startWrapMode:'none',startWrapKind:null,startReferenceNormal:undefined}:{}),...(!atEnd?{endWrapMode:'none',endWrapKind:null,endReferenceNormal:undefined}:{})};
}
export function splitWeldPreview(weld,at,{minimumLength=.1}={}){
 if(!weld||!weld.enabled||weld.mergedInto||weld.splitInto)throw Error('请选择启用且未被合并或打断的焊道');
 if(!weld.segments?.every(s=>s.pathPoints?.length>=2))throw Error('焊道缺少真实模型路径');
 const total=weld.segments.reduce((n,s)=>n+pathLength(s.pathPoints),0);
 if(!Number.isFinite(at)||at<minimumLength||at>total-minimumLength)throw Error('断点距起终点均须至少'+minimumLength+' mm');
 const left=[],right=[];let offset=0;
 for(const s of weld.segments){
  const length=pathLength(s.pathPoints);
  if(at>=offset+length-1e-8)left.push(structuredClone(s));
  else if(at<=offset+1e-8)right.push(structuredClone(s));
  else{const local=at-offset,points=s.pathPoints;let walked=0,done=false,before=[points[0]],after=[];
   for(let i=1;i<points.length;i++){const d=distance(points[i-1],points[i]);if(!done&&local<=walked+d+1e-8){const t=d?(local-walked)/d:0,p=points[i-1].map((v,j)=>v+(points[i][j]-v)*t);if(distance(before.at(-1),p)>1e-8)before.push(p);after=[p];if(distance(p,points[i])>1e-8)after.push(points[i]);done=true;}else if(done)after.push(points[i]);else before.push(points[i]);walked+=d;}
   left.push(piece(s,before,true,false));right.push(piece(s,after,false,true));
  }offset+=length;
 }
 if([...left,...right].some(s=>s.length<minimumLength))throw Error('断点会产生短于'+minimumLength+' mm的焊缝段，请调整位置');
 if(left.length)Object.assign(left.at(-1),{endWrapMode:'none',endWrapKind:null});
 if(right.length)Object.assign(right[0],{startWrapMode:'none',startWrapKind:null});
 const pieces=weld.closure==='closed'?[[...right,...left]]:[left,right];
 if(pieces.some(p=>p.length>30))throw Error('打断后超过30段，请先减少焊缝段数量');
 return {at,total,position:sampleManualWeldPath(weld.segments,at,weld.cornerReferenceNormal).position,pieces,lengths:pieces.map(p=>metric(p.reduce((n,s)=>n+s.length,0)))};
}
export function planeSplitStations(weld,origin,normal){
 const signed=point=>point.reduce((value,coordinate,index)=>value+(coordinate-origin[index])*normal[index],0);
 const stations=[];
 let walked=0;
 for(const segment of weld.segments)for(let index=1;index<segment.pathPoints.length;index++){
  const a=segment.pathPoints[index-1],b=segment.pathPoints[index],length=distance(a,b),start=signed(a),end=signed(b);
  if(Math.abs(start-end)>1e-8&&start*end<=0)stations.push(walked+length*start/(start-end));
  walked+=length;
 }
 return stations.filter((value,index)=>value>=.1&&value<=walked-.1&&(!index||value-stations[index-1]>=.1));
}

export function multiSplitPreview(weld,stations){
 if(!stations?.length)throw Error('所选平面未穿过焊缝内部');
 if(stations.length===1)return splitWeldPreview(weld,stations[0]);
 const pieces=[];
 let rest=weld.segments,previous=0;
 for(const station of stations){
  const preview=splitWeldPreview({...weld,closure:'open',segments:rest},station-previous);
  pieces.push(preview.pieces[0]);
  rest=preview.pieces[1];
  previous=station;
 }
 if(weld.closure==='closed')pieces[0]=[...rest,...pieces[0]];
 else pieces.push(rest);
 return {pieces,lengths:pieces.map(segments=>metric(segments.reduce((total,segment)=>total+segment.length,0)))};
}

export function canSeparateWeldSegments(weld){
 return !!(weld?.enabled&&!weld.mergedInto&&!weld.splitInto&&weld.segments?.length>1&&
  weld.segments.every(segment=>!segment.connectionGap&&segment.pathPoints?.length>=2));
}

function separatedSegmentRuns(weld,indices){
 if(!canSeparateWeldSegments(weld))throw Error('请选择包含多个有效焊缝段的焊缝');
 if(!indices.length||indices.some(index=>!Number.isInteger(index)||index<0||index>=weld.segments.length)){
  throw Error('请选择要拆分的焊缝段');
 }
 const selected=new Set(indices),runs=[];
 let remainder=[];
 for(let i=0;i<weld.segments.length;i++){
  if(!selected.has(i)){remainder.push(i);continue;}
  if(remainder.length)runs.push(remainder);
  remainder=[];
  runs.push([i]);
 }
 if(remainder.length)runs.push(remainder);
 if(weld.closure==='closed'&&!selected.has(0)&&!selected.has(weld.segments.length-1)){
  runs[0]=[...runs.pop(),...runs[0]];
 }
 return runs;
}

function detachedSourceSegments(weld){
 const originals=weld.mergeHistory?.originals??[];
 const source=originals.flatMap(original=>{
  const reversed=weld.mergedFrom?.find(item=>item.id===original.id)?.reversed;
  const segments=original.segments.filter(segment=>!segment.connectionGap);
  return (reversed?segments.slice().reverse():segments).map((segment,index)=>{
   const start=index===0?original.endpointFacts?.[reversed?'end':'start']:undefined;
   const end=index===segments.length-1?original.endpointFacts?.[reversed?'start':'end']:undefined;
   const facts=reversed?{start:segment.endpointFacts?.end,end:segment.endpointFacts?.start}:segment.endpointFacts;
   return {
    points:reversed?segment.pathPoints.slice().reverse():segment.pathPoints,
    leg:segment.weldLeg??original.leg,
    endpointFacts:{start:facts?.start??start,end:facts?.end??end}
   };
  });
 });
 return source.length===weld.segments.length?source:[];
}

function restoreSegmentEnd(points,endpoint,atStart){
 const found=points.findIndex(point=>distance(point,endpoint)<1e-8);
 if(found>=0)return atStart?points.slice(found):points.slice(0,found+1);
 return atStart?[[...endpoint],...points.slice(1)]:[...points.slice(0,-1),[...endpoint]];
}

export function separateWeldSegments(d,id,indices){
 const original=d.welds.find(weld=>weld.id===id);
 const selected=new Set(indices);
 const runs=separatedSegmentRuns(original,[...selected]);
 const source=detachedSourceSegments(original);
 const joins=original.mergeIntersections??[];
 const parts=runs.map(run=>{
  const segments=run.map((index,i)=>{
   const segment=structuredClone(original.segments[index]),saved=source[index];
   const first=i===0,last=i===run.length-1;
   const start=first&&(saved?.points[0]??joins.find(connection=>connection.afterSegment===index+1)?.afterEndpoint);
   const end=last&&(saved?.points.at(-1)??joins.find(connection=>connection.beforeSegment===index+1)?.beforeEndpoint);
   if(saved&&first&&last){
    segment.pathPoints=structuredClone(saved.points);
   }else{
    if(start)segment.pathPoints=restoreSegmentEnd(segment.pathPoints,start,true);
    if(end)segment.pathPoints=restoreSegmentEnd(segment.pathPoints,end,false);
   }
   segment.length=metric(pathLength(segment.pathPoints));
   if(segment.length<.1)throw Error('拆分会产生短于 0.1 mm 的焊缝段');
   const leg=segment.weldLeg??saved?.leg;
   if(Number.isFinite(leg)&&leg>0)segment.weldLeg=leg;
   return segment;
  });
  const endpoint=key=>{
   const index=key==='start'?run[0]:run.at(-1);
   const outer=original.closure!=='closed'&&index===(key==='start'?0:original.segments.length-1);
   const facts=source[index]?.endpointFacts?.[key]??original.segments[index].endpointFacts?.[key]??(outer?original.endpointFacts?.[key]:undefined);
   return {facts,hasHole:facts?.hasHole??(outer&&!!original[key+'Hole']),wrap:outer?original[key+'WrapMode']:'none'};
  };
  const legs=new Set(segments.map(segment=>segment.weldLeg??original.leg));
  const label=run.length===1?`${run[0]+1}`:`${run[0]+1}–${run.at(-1)+1}`;
  const name=`${id} · ${selected.has(run[0])?'第'+label+'段':'保留段 '+label}`;
  return {segments,name,leg:legs.size===1?[...legs][0]:null,start:endpoint('start'),end:endpoint('end')};
 });
 return installSplitWelds(d,original,parts,3,Math.max(0,runs.findIndex(run=>selected.has(run[0]))));
}

export function splitSelectedWeld(d,id,at,{revision}={}){
 const original=d.welds.find(w=>w.id===id),preview=Array.isArray(at)?multiSplitPreview(original,at):splitWeldPreview(original,at);
 const endpoint=(key,outer)=>({
  facts:outer?original.endpointFacts?.[key]:{type:null,breakReason:'长度打断'},
  hasHole:outer&&!!original[key+'Hole'],wrap:outer?original[key+'WrapMode']:'none'
 });
 const parts=preview.pieces.map((segments,i)=>({
  segments,name:original.name+' · 打断'+(i+1),
  start:endpoint('start',original.closure!=='closed'&&i===0),
  end:endpoint('end',original.closure!=='closed'&&i===preview.pieces.length-1)
 }));
 return installSplitWelds(d,original,parts,revision);
}

export function installWrapSplit(workspace,original,fragments){
 const parts=fragments.map((fragment,index)=>({
  segments:fragment.segments,name:(original.name+' · 包角拆分 '+(index+1)).slice(0,80),
  start:{facts:fragment.endpointFacts.start,hasHole:fragment.startHole,wrap:fragment.startWrapMode},
  end:{facts:fragment.endpointFacts.end,hasHole:fragment.endHole,wrap:fragment.endWrapMode},
  topology:fragment.topology,wrapSplit:true
 }));
 return installSplitWelds(workspace,original,parts,3);
}

function installSplitWelds(d,original,parts,revision,selectedIndex=0){
 const {id}=original,used=new Set(d.welds.map(w=>w.id));
 if(d.welds.length+parts.length>MAX_PLANNING_WELDS)throw Error('工作区焊道数量已达上限');
 let n=revision===3?Math.max(0,...d.welds.map(weld=>Number(weld.id.slice(1))||0))+1:1;
 const children=parts.map(({segments,name,start,end,topology,wrapSplit,leg=original.leg})=>{
  while(used.has('W'+String(n).padStart(3,'0')))n++;
  const nextId='W'+String(n).padStart(3,'0');used.add(nextId);
  return {id:nextId,name,source:'manual',model:d.model,enabled:true,planned:false,completeStart:true,completeEnd:true,closure:'open',topology,length:metric(segments.reduce((total,segment)=>total+segment.length,0)),leg,weldType:weldForm(original),position:segments.every(s=>s.position===segments[0].position)?segments[0].position:'混合位置（逐段设置）',segments,cornerAngles:mergeCornerAngles(segments),groove:structuredClone(original.groove),workFace:original.workFace,robotModel:original.robotModel,robotName:original.robotName,tracking:original.tracking,startWrapMode:start.wrap,endWrapMode:end.wrap,startHole:start.hasHole,endHole:end.hasHole,atConnection:segments.length>1,current:null,voltage:null,speed:null,template:'',direction:'正向',cornerReferenceNormal:original.cornerReferenceNormal,splitFrom:{id,source:original.source,processingKey:original.processingKey,sourceSha256:original.sourceSha256,...(wrapSplit?{wrap:true}:{})},
   ...(revision===3?{machineCount:original.machineCount,endpointFacts:{start:start.facts,end:end.facts}}:{})};
 });
 return {...d,welds:[...d.welds.map(w=>w.id===id?{...w,enabled:false,planned:false,splitInto:children.map(c=>c.id)}:w),...children.map(normalizeVerticalWeld)],selected:children[selectedIndex].id,manualSplitHistory:[...(d.manualSplitHistory||[]),{original:structuredClone(original),childIds:children.map(c=>c.id),selected:d.selected}],...(revision===3?{manualEditHistory:[...(d.manualEditHistory??[]),{kind:'split',id}]}:{})};
}
export function undoLastSplit(d){
 const history=d.manualSplitHistory||[],last=history.at(-1);if(!last)throw Error('没有可撤销的打断');
 const children=d.welds.filter(w=>last.childIds.includes(w.id));if(children.length!==last.childIds.length||children.some(w=>w.mergedInto||w.splitInto))throw Error('请先撤销这些焊道的后续合并或打断');
 return {...d,welds:d.welds.filter(w=>!last.childIds.includes(w.id)).map(w=>w.id===last.original.id?structuredClone(last.original):w),selected:last.original.id,manualSplitHistory:history.slice(0,-1)};
}
