import {Quaternion,Vector3} from 'three';
import {horizontalWeldNormal,prepareManualWeldPath} from './manualWeldModel.mjs';
import {validReferenceNormal} from './weldDirectionGeometry.mjs';

const EPS=1e-8;
const vector=point=>new Vector3(...point);
const transverse=(normal,tangent)=>normal.clone().addScaledVector(tangent,-normal.dot(tangent));

function circleOf(points){
 if(points.length<3)return null;
 const a=points[0],b=points[Math.floor((points.length-1)/2)],c=points.at(-1).distanceTo(a)<EPS?
  points[Math.floor((points.length-1)*.75)]:points.at(-1);
 const u=b.clone().sub(a),v=c.clone().sub(a),n=u.clone().cross(v),den=2*n.lengthSq();
 if(den<EPS)return null;
 const center=a.clone().add(v.clone().cross(n).multiplyScalar(u.lengthSq())
  .add(n.clone().cross(u).multiplyScalar(v.lengthSq())).divideScalar(den));
 const radius=a.distanceTo(center);
 n.normalize();
 if(points.some(point=>Math.abs(point.distanceTo(center)-radius)>.02||Math.abs(point.clone().sub(center).dot(n))>.02))return null;
 if(n.clone().cross(a.clone().sub(center)).dot(points[1].clone().sub(a))<0)n.negate();
 return {center,n};
}

function createSegmentFrames(segment,fallback,referenceAt){
 const points=segment.pathPoints.map(vector).filter((point,i,all)=>!i||point.distanceToSquared(all[i-1])>EPS*EPS);
 if(points.length<2)return null;
 const stations=[0];
 for(let i=1;i<points.length;i++)stations.push(stations.at(-1)+points[i].distanceTo(points[i-1]));
 const length=stations.at(-1),closed=points[0].distanceTo(points.at(-1))<EPS;
 const circle=segment.geometry==='圆弧'||Number.isFinite(segment.shape?.radius)?circleOf(points):null;
 const main=validReferenceNormal(segment.referenceNormal)?segment.referenceNormal:null;
 const first=segment.startReferenceNormal??main;
 const last=segment.endReferenceNormal??main;
 const a=validReferenceNormal(first)?vector(first).normalize():null;
 const b=validReferenceNormal(last)?vector(last).normalize():null;
 if(a&&b&&a.dot(b)<0)b.negate();
 const sub=validReferenceNormal(segment.subFaceNormal)?vector(segment.subFaceNormal).normalize():null;
 const source=prepareManualWeldPath([segment],segment.referenceNormal??fallback);
 const edges=points.slice(1).map((point,i)=>point.clone().sub(points[i]).normalize());
 const tangentAt=i=>{
  if(circle)return circle.n.clone().cross(points[i].clone().sub(circle.center)).normalize();
  const left=edges[i-1]??(closed?edges.at(-1):edges[0]);
  const right=edges[i]??(closed?edges[0]:edges.at(-1));
  const tangent=left.clone().add(right);
  return tangent.lengthSq()>EPS?tangent.normalize():right.clone();
 };
 const tangents=points.map((_,i)=>tangentAt(i));
 const normals=[];
 for(const [i,tangent] of tangents.entries()){
  const transported=i?normals.at(-1).clone().applyQuaternion(new Quaternion().setFromUnitVectors(tangents[i-1],tangent)):null;
  const measured=referenceAt?.(segment,points[i].toArray(),tangent.toArray());
  const reference=validReferenceNormal(measured)?vector(measured):
   a&&b?a.clone().lerp(b,stations[i]/length):a??b??(circle?.n??(!transported?vector(fallback):null));
  let normal=reference&&transverse(reference,tangent);
  if(!normal||normal.lengthSq()<EPS){
   const geometry=source(stations[i]);
   normal=transported??tangent.clone().cross(vector(horizontalWeldNormal(geometry.tangent,geometry.normal)));
   if(normal.lengthSq()<EPS)normal=transverse(new Vector3(0,0,1),tangent);
   if(normal.lengthSq()<EPS)normal=transverse(new Vector3(1,0,0),tangent);
  }
  normal.normalize();
  if(transported&&normal.dot(transported)<0)normal.negate();
  normals.push(normal);
 }
 // Close the transported frame smoothly over the loop. Keep the sampled geometry
 // and measured length so existing point and pass offsets keep the same station.
 if(closed){
  const firstNormal=normals[0],lastNormal=normals.at(-1),axis=tangents[0];
  const twist=Math.atan2(axis.dot(lastNormal.clone().cross(firstNormal)),lastNormal.dot(firstNormal));
  for(const [i,normal] of normals.entries())normal.applyAxisAngle(tangents[i],twist*stations[i]/length);
  normals[normals.length-1]=firstNormal.clone();
 }
 function sample(station){
  let lo=0,hi=stations.length-1;
  while(hi-lo>1){const mid=(hi+lo)>>1;if(stations[mid]<=station)lo=mid;else hi=mid;}
  const t=Math.max(0,Math.min(1,(station-stations[lo])/(stations[hi]-stations[lo])));
  const geometry=source(station);
  const tangent=circle?circle.n.clone().cross(vector(geometry.position).sub(circle.center)).normalize():
   tangents[lo].clone().lerp(tangents[hi],t).normalize();
  if(tangent.lengthSq()<EPS)tangent.copy(edges[lo]);
  const up=transverse(normals[lo].clone().lerp(normals[hi],t),tangent).normalize();
  const lateral=up.clone().cross(tangent).normalize();
  if(sub&&Math.abs(lateral.dot(sub))>.2&&lateral.dot(sub)<0)lateral.negate();
  const oldSide=horizontalWeldNormal(geometry.tangent,geometry.normal);
  return {position:geometry.position,tangent:tangent.toArray(),normal:lateral.toArray(),up:up.toArray(),
   offsetNormal:oldSide};
 }
 return {length,sample};
}

export function prepareWeldSeamFrames(segments,fallback=[0,0,1],closed=false,referenceAt){
 let length=0;
 const frames=segments.map((segment,index)=>{
  const frame=createSegmentFrames(segment,fallback,referenceAt);
  const from=length;
  length+=frame?.length??0;
  return frame&&{...frame,from,to:length,index};
 }).filter(Boolean);
 if(!frames.length)return ()=>undefined;
 return (distance,segmentIndex)=>{
  let station=distance;
  if(closed&&(station<0||station>length))station=((station%length)+length)%length;
  let lo=0,hi=frames.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(station<frames[mid].to-EPS)hi=mid;else lo=mid+1;}
  const frame=(segmentIndex===undefined?null:frames.find(item=>item.index===segmentIndex))??frames[lo];
  return {...frame.sample(station-frame.from),segmentIndex:frame.index};
 };
}
