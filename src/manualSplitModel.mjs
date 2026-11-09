import {MAX_PLANNING_WELDS} from './planningRequirements.mjs';
import {distance,pathLength,pathGeometry,sampleManualWeldPath} from './manualWeldModel.mjs';
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
 const shape=pathGeometry(points);return {...structuredClone(segment),...shape,geometry:shape.geometry==='圆弧'?'曲线':shape.geometry,pathPoints:points,length:metric(pathLength(points)),...(segment.strategyRole==='wrap'?{strategyWrapKind:'L'}:{}),...(!atStart?{startWrapMode:'none',startReferenceNormal:undefined}:{}),...(!atEnd?{endWrapMode:'none',endReferenceNormal:undefined}:{})};
}
export function splitWeldPreview(weld,at){
 if(!weld||!weld.enabled||weld.mergedInto||weld.splitInto)throw Error('请选择启用且未被合并或打断的焊道');
 if(!weld.segments?.every(s=>s.pathPoints?.length>=2))throw Error('焊道缺少真实模型路径');
 const total=weld.segments.reduce((n,s)=>n+pathLength(s.pathPoints),0);
 if(!Number.isFinite(at)||at<.1||at>total-.1)throw Error('断点距起终点均须至少0.1 mm');
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
 if([...left,...right].some(s=>s.length<.1))throw Error('断点会产生短于0.1 mm的焊缝段，请调整位置');
 if(left.length)left.at(-1).endWrapMode='none';if(right.length)right[0].startWrapMode='none';
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

export function splitSelectedWeld(d,id,at,{revision}={}){
 const original=d.welds.find(w=>w.id===id),preview=Array.isArray(at)?multiSplitPreview(original,at):splitWeldPreview(original,at),used=new Set(d.welds.map(w=>w.id));
 if(d.welds.length+preview.pieces.length>MAX_PLANNING_WELDS)throw Error('工作区焊道数量已达上限');
 let n=revision===3?Math.max(0,...d.welds.map(weld=>Number(weld.id.slice(1))||0))+1:1;
 const children=preview.pieces.map((segments,i)=>{while(used.has('W'+String(n).padStart(3,'0')))n++;const nextId='W'+String(n).padStart(3,'0');used.add(nextId);
  return {id:nextId,name:original.name+' · 打断'+(i+1),source:'manual',model:d.model,enabled:true,planned:false,completeStart:true,completeEnd:true,closure:'open',length:preview.lengths[i],leg:original.leg,position:segments.every(s=>s.position===segments[0].position)?segments[0].position:'混合位置（逐段设置）',joint:segments.every(s=>s.joint===segments[0].joint)?segments[0].joint:'待确认',segments,cornerAngles:mergeCornerAngles(segments),groove:structuredClone(original.groove),workFace:original.workFace,robotModel:original.robotModel,robotName:original.robotName,tracking:original.tracking,startWrapMode:original.closure!=='closed'&&i===0?original.startWrapMode:'none',endWrapMode:original.closure!=='closed'&&i===preview.pieces.length-1?original.endWrapMode:'none',startHole:original.closure!=='closed'&&i===0&&!!original.startHole,endHole:original.closure!=='closed'&&i===preview.pieces.length-1&&!!original.endHole,atConnection:segments.length>1,current:null,voltage:null,speed:null,template:'',direction:'正向',cornerReferenceNormal:original.cornerReferenceNormal,splitFrom:{id,source:original.source,processingKey:original.processingKey,sourceSha256:original.sourceSha256}};
 }).map((weld,index)=>revision!==3?weld:{...weld,weldType:original.weldType,machineCount:original.machineCount,endpointFacts:{
  start:index===0&&original.closure!=='closed'?original.endpointFacts?.start:{type:'长度打断',breakReason:'长度打断'},
  end:index===preview.pieces.length-1&&original.closure!=='closed'?original.endpointFacts?.end:{type:'长度打断',breakReason:'长度打断'}
 }});
 return {...d,welds:[...d.welds.map(w=>w.id===id?{...w,enabled:false,planned:false,splitInto:children.map(c=>c.id)}:w),...children],selected:children[0].id,manualSplitHistory:[...(d.manualSplitHistory||[]),{original:structuredClone(original),childIds:children.map(c=>c.id),selected:d.selected}],...(revision===3?{manualEditHistory:[...(d.manualEditHistory??[]),{kind:'split',id}]}:{})};
}
export function undoLastSplit(d){
 const history=d.manualSplitHistory||[],last=history.at(-1);if(!last)throw Error('没有可撤销的打断');
 const children=d.welds.filter(w=>last.childIds.includes(w.id));if(children.length!==last.childIds.length||children.some(w=>w.mergedInto||w.splitInto))throw Error('请先撤销这些焊道的后续合并或打断');
 return {...d,welds:d.welds.filter(w=>!last.childIds.includes(w.id)).map(w=>w.id===last.original.id?structuredClone(last.original):w),selected:last.original.id,manualSplitHistory:history.slice(0,-1)};
}
