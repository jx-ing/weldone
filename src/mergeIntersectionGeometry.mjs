import {distance,pathLength} from './manualWeldModel.mjs';
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=v=>{const n=Math.hypot(...v);return n>1e-9?mul(v,1/n):null;};
const metric=v=>Math.round(v*10000)/10000;
export const INTERSECTION_TOLERANCE=.001;
function endTangent(points,last){const p=last?points.at(-1):points[0];for(let i=1;i<points.length;i++){const v=last?sub(p,points[points.length-1-i]):sub(points[i],p),n=unit(v);if(n)return n;}throw Error('焊缝段缺少有效的端点方向');}
export function intersectSegmentEnds(before,after){
  const p=before.pathPoints.at(-1),q=after.pathPoints[0],u=endTangent(before.pathPoints,true),v=endTangent(after.pathPoints,false),gap=distance(p,q);
  let point,method='line-intersection';
  if(gap<=1e-8){point=[...p];method='coincident';}
  else{const uv=dot(u,v),den=1-uv*uv,w=sub(p,q);
    if(den<1e-12){if(Math.hypot(...cross(sub(q,p),u))>INTERSECTION_TOLERANCE)throw Error('相邻焊缝段的延长线平行且不共线，无法得到交点');if(uv<0)throw Error('反向共线焊缝重叠，无法确定连接交点');point=mul(add(p,q),.5);method='collinear';}
    else{const a=(uv*dot(v,w)-dot(u,w))/den,b=(dot(v,w)-uv*dot(u,w))/den,pa=add(p,mul(u,a)),pb=add(q,mul(v,b));if(distance(pa,pb)>INTERSECTION_TOLERANCE)throw Error('相邻焊缝段的空间延长线不相交，无法合并');point=mul(add(pa,pb),.5);}
  }
  point=point.map(n=>Math.abs(n)<1e-10?0:n);
  return {point,gap:metric(gap),method,beforeExtension:dot(sub(point,p),u),afterExtension:-dot(sub(point,q),v),beforeEndpoint:[...p],afterEndpoint:[...q]};
}
function setBoundary(segment,point,last){
  const points=segment.pathPoints,endpoint=last?points.at(-1):points[0],t=endTangent(points,last),signed=dot(sub(point,endpoint),t)*(last?1:-1);let next;
  if(distance(point,endpoint)<1e-8)next=points;
  else if(segment.geometry==='直线'){
    if(last){const first=points[0],extent=dot(sub(point,first),t);if(extent<=1e-8)throw Error('延长线交点越过焊缝段，无法保留有效长度');next=[...points.slice(0,-1).filter(p=>dot(sub(p,first),t)<extent-1e-8),point];}
    else{const end=points.at(-1),extent=dot(sub(end,point),t);if(extent<=1e-8)throw Error('延长线交点越过焊缝段，无法保留有效长度');next=[point,...points.slice(1).filter(p=>dot(sub(end,p),t)<extent-1e-8)];}
  }else if(signed>=-1e-8)next=last?[...points,point]:[point,...points];
  else{const piece=last?distance(points.at(-2),endpoint):distance(points[1],endpoint);if(-signed>piece+1e-8)throw Error('曲线切向交点位于有效曲线内部，无法通过延长连接');next=last?[...points.slice(0,-1),point]:[point,...points.slice(1)];}
  const measured=pathLength(next),length=metric(measured)||measured;if(measured<=1e-8||next.length>20000)throw Error('交点连接后的焊缝段长度或采样点数量无效');
  segment.pathPoints=next;segment.length=length;delete segment.connectionGap;
}
export function connectSegmentIntersections(input,{closed=false}={}){
  const segments=structuredClone(input.filter(s=>!s.connectionGap)),connections=[];
  if(!segments.length)throw Error('没有可合并的有效焊缝段');
  const join=(i,j)=>{const connection=intersectSegmentEnds(segments[i],segments[j]);setBoundary(segments[i],connection.point,true);setBoundary(segments[j],connection.point,false);if(connection.gap>1e-8)connections.push({...connection,beforeSegment:i+1,afterSegment:j+1});};
  for(let i=1;i<segments.length;i++)join(i-1,i);if(closed&&segments.length>1)join(segments.length-1,0);
  const length=segments.reduce((sum,s)=>sum+pathLength(s.pathPoints),0);
  return {segments,connections,gaps:connections.map(c=>c.gap),length:metric(length)||length};
}
export function mergeCornerAngles(segments){return segments.slice(1).map((s,i)=>{const a=endTangent(segments[i].pathPoints,true),b=endTangent(s.pathPoints,false);return metric(Math.acos(Math.max(-1,Math.min(1,-dot(a,b))))*180/Math.PI);});}
export function normalizeLegacyMergeGaps(w){
  if(!['manual-merge','extracted'].includes(w.source)||!w.segments?.some(s=>s.connectionGap))return w;
  try{const joined=connectSegmentIntersections(w.segments,{closed:w.closure==='closed'}),backup=Object.fromEntries(['segments','length','cornerAngles','planned','controlPoints','layers','localApplications','matchPlan'].filter(k=>w[k]!==undefined).map(k=>[k,structuredClone(w[k])]));return {...w,segments:joined.segments,length:joined.length,cornerAngles:mergeCornerAngles(joined.segments),mergeIntersections:joined.connections,gapConnectionMode:'intersection',gapJoinBackup:backup,planned:false,controlPoints:[],layers:[],localApplications:[],...(w.sourceEvidence?{sourceEvidence:{...w.sourceEvidence,mergeIntersections:joined.connections}}:{})};}catch(error){return {...w,planned:false,gapJoinError:error.message};}
}
