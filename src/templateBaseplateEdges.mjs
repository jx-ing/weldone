import {EPS,along,clipCapturePolyline,dot,interpolate,vectorBetween} from './templateCaptureRange.mjs';

import {closestDistance,distanceProfile} from './templateDistanceProfile.mjs';

const seamTolerance=.02;
const edgeIndex=new WeakMap();

function baseplateFace(source){
 const faces=source.properties?.焊缝段?.[0];
 const main=faces?.主板面,sub=faces?.副板面;
 const horizontal=face=>face?.类型==='平面'&&Math.abs(face.法向?.[2])>=.95;
 const useSub=horizontal(sub)&&!horizontal(main);
 return {face:useSub?sub:main,part:useSub?source.subPartId:source.mainPartId,
  fallback:useSub?source.subFaceIndex:source.mainFaceIndex};
}

export function baseplateDirection(source){
 const normal=source&&baseplateFace(source).face?.法向;
 const length=Array.isArray(normal)&&Math.hypot(...normal);
 return length>EPS?normal.map(value=>-value/length):[0,0,-1];
}

function baseplateEdges(source,data){
 const {face,part,fallback}=baseplateFace(source);
 const index=face?.来源面索引??fallback;
 if(!edgeIndex.has(data)){
  const byFace=new Map();
  for(const edge of data.edges){
   if(edge.wire!=='inner'&&edge.wire!=='outer')continue;
   const key=edge.partId+'|'+edge.faceIndex;
   if(!byFace.has(key))byFace.set(key,[]);
   byFace.get(key).push(edge);
  }
  edgeIndex.set(data,byFace);
 }
 return edgeIndex.get(data).get(part+'|'+index)??[];
}

function projectLink(start,end,station,boundaries,pieces,nearest){
 const delta=vectorBetween(start,end),length=Math.hypot(...delta);
 const tangent=delta.map(value=>value/length);
 const project=point=>dot(vectorBetween(start,point),tangent);
 for(const {points,kind} of boundaries)for(let i=1;i<points.length;i++){
  let a=points[i-1],b=points[i],left=project(a),right=project(b);
  if(left>right){[a,b]=[b,a];[left,right]=[right,left];}
  const splits=[0,1];
  for(const limit of [0,length]){
   const t=(limit-left)/(right-left);
   if(t>EPS&&t<1-EPS)splits.push(t);
  }
  splits.sort((x,y)=>x-y);
  const pointAt=t=>{
   const s=Math.max(0,Math.min(length,left+(right-left)*t));
   return {s:station+s,from:along(start,tangent,s),to:interpolate(a,b,t)};
  };
  // A plate boundary coinciding with the weld itself is not a neighboring edge.
  const onSeam=right-left>EPS&&[a,b].every(p=>{
   const residual=vectorBetween(along(start,tangent,project(p)),p);
   return Math.hypot(...residual)<=seamTolerance;
  })&&Math.min(right,length)-Math.max(left,0)>EPS;
  if(onSeam)continue;
  for(let j=1;j<splits.length;j++){
   const first=pointAt(splits[j-1]),last=pointAt(splits[j]);
   const piece={start:first.s,end:last.s,from:first.from,to:first.to,endFrom:last.from,endTo:last.to,kind};
   const hit=closestDistance(piece);
   if(!nearest||hit.distance<nearest.distance)nearest=hit;
   if(piece.end-piece.start>EPS)pieces.push(piece);
  }
 }
 return nearest;
}

function clippedBaseplateBoundaries(source,edges,frame){
 return baseplateEdges(source,edges).flatMap(edge=>{
  const points=edge.points?.length>=2?edge.points:[edge.start,edge.end];
  const closed=edge.closed&&Math.hypot(...vectorBetween(points[0],points.at(-1)))>EPS;
  return clipCapturePolyline(frame,closed?[...points,points[0]]:points).flatMap(chunk=>
   chunk.slice(1).map((end,index)=>({points:[chunk[index],end],kind:edge.wire==='inner'?'hole':'plate'})));
 });
}

function neighboringBoundaries(path,source,edges,frame){
 const onPath=point=>path.some((end,index)=>{
  if(index===0)return false;
  const start=path[index-1],delta=vectorBetween(start,end),size=dot(delta,delta);
  if(size<=EPS*EPS)return false;
  const t=Math.max(0,Math.min(1,dot(vectorBetween(start,point),delta)/size));
  return Math.hypot(...vectorBetween(point,along(start,delta,t)))<=seamTolerance;
 });
 return clippedBaseplateBoundaries(source,edges,frame).filter(({points:[start,end]})=>
  !(onPath(start)&&onPath(end)&&onPath(interpolate(start,end,.5))));
}

export function measureBaseplateEndpoint(point,source,edges,frame){
 if(!source||!edges)return null;
 let nearest=null;
 for(const {points:[start,end],kind} of clippedBaseplateBoundaries(source,edges,frame)){
  const delta=vectorBetween(start,end);
  const t=Math.max(0,Math.min(1,dot(vectorBetween(start,point),delta)/dot(delta,delta)));
  const to=along(start,delta,t),distance=Math.hypot(...vectorBetween(point,to));
  if(!nearest||distance<nearest.distance)nearest={from:point,to,distance,kind};
 }
 return nearest;
}

export function measureBaseplateEdges(segment,source,edges,frame){
 if(!source||!edges)return null;
 const boundaries=neighboringBoundaries(segment.pathPoints,source,edges,frame);
 const pieces=[];
 let station=0,nearest=null;
 for(let i=1;i<segment.pathPoints.length;i++){
  const a=segment.pathPoints[i-1],b=segment.pathPoints[i],length=Math.hypot(...vectorBetween(a,b));
  if(length<=EPS)continue;
  nearest=projectLink(a,b,station,boundaries,pieces,nearest);
  station+=length;
 }
 return distanceProfile(pieces,nearest,station);
}

