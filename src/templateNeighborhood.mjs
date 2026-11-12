import {Box3,DoubleSide,Ray,Vector3} from 'three';
import {weldRegionBounds} from './templateCoverModel.mjs';
import {
 EPS,along,vectorBetween,dot,interpolate,insideCapture,clipCapturePolyline,captureRayLimit,captureLocal
} from './templateCaptureRange.mjs';
import {endpointType} from './templateGeometryRules.mjs';
import {baseplateDirection,measureBaseplateEdges,measureBaseplateEndpoint} from './templateBaseplateEdges.mjs';
import {closestDistance,distanceProfile} from './templateDistanceProfile.mjs';
import {measurePlanningAxial,measurePlanningBoundaries,planningPartGeometryIndex} from './vendor/geometry-engine.mjs';

const vector=p=>new Vector3(...p);
const unit=p=>{const length=Math.hypot(...p);return length>EPS?p.map(v=>v/length):null;};
const box=(min,max)=>new Box3(vector(min),vector(max));
const samePoint=(a,b)=>Math.hypot(...vectorBetween(a,b))<=EPS;

function clipPolygon(points,distance){
 const clipped=[];
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],da=distance(a),db=distance(b);
  if(da>=-EPS)clipped.push(a);
  if((da<-EPS)!==(db<-EPS))clipped.push(interpolate(a,b,da/(da-db)));
 }
 return clipped;
}

function planeSection(triangle,distance){
 const section=[];
 for(let i=0;i<triangle.length;i++){
  const a=triangle[i],b=triangle[(i+1)%triangle.length],da=distance(a),db=distance(b);
  if(Math.abs(da)<=EPS)section.push(a);
  if(da<-EPS&&db>EPS||da>EPS&&db<-EPS)section.push(interpolate(a,b,da/(da-db)));
 }
 return section.filter((point,index)=>section.findIndex(other=>samePoint(other,point))===index);
}

function rayHit(parts,point,direction,limit){
 if(!Number.isFinite(limit)||limit<0)return null;
 const ray=new Ray(vector(point),vector(direction));
 const end=along(point,direction,limit);
 const bounds=box(point.map((v,i)=>Math.min(v,end[i])-EPS),point.map((v,i)=>Math.max(v,end[i])+EPS));
 let nearest=null;
 for(const part of parts){
  if(!part.bounds.intersectsBox(bounds))continue;
  const hit=part.tree()?.raycastFirst(ray,DoubleSide,0,nearest?.distance??limit+EPS);
  if(hit&&hit.distance<=limit+EPS&&(!nearest||hit.distance<nearest.distance))nearest={distance:hit.distance,from:point,to:hit.point.toArray()};
 }
 return nearest;
}

// Intersect solids with the strip swept by a single weld link towards its baseplate.
function solidLink(parts,start,end,direction,region,emit){
 const path=vectorBetween(start,end),depth=dot(path,direction),tangent=unit(along(path,direction,-depth));
 const {frame,cad}=region;
 if(!tangent){
  const origin=depth>0?start:end,limit=captureRayLimit(frame,origin,direction);
  const ray=new Ray(vector(origin),vector(direction));
  const bounds=new Box3().setFromPoints([ray.origin,ray.at(limit,new Vector3())]).expandByScalar(EPS);
  for(const part of parts){
   if(!part.bounds.intersectsBox(bounds))continue;
   for(const hit of part.tree()?.raycast(ray,DoubleSide,0,limit+EPS)??[]){
    const point=hit.point.toArray(),fraction=dot(vectorBetween(start,point),direction)/depth;
    if(depth>0)emit(0,Math.min(1,fraction),point,point);
    else emit(Math.max(0,fraction),1,point,point);
   }
  }
  return;
 }
 const normal=vector(tangent).cross(vector(direction)).toArray(),width=dot(path,tangent);
 const fraction=point=>dot(vectorBetween(start,point),tangent)/width;
 const clearance=point=>dot(vectorBetween(interpolate(start,end,fraction(point)),point),direction);
 const limit=Math.hypot(...vectorBetween(cad.min,cad.max));
 const bounds=new Box3().setFromPoints([start,end,along(start,direction,limit),along(end,direction,limit)].map(vector))
  .intersect(box(cad.min,cad.max)).expandByScalar(EPS);
 const limits=[fraction,p=>1-fraction(p),clearance,...frame.axes.flatMap((_,i)=>[
  p=>captureLocal(frame,p)[i]-frame.min[i],p=>frame.max[i]-captureLocal(frame,p)[i]
 ])];
 for(const part of parts){
  if(!part.bounds.intersectsBox(bounds))continue;
  part.tree()?.shapecast({
   intersectsBounds:triangleBounds=>triangleBounds.intersectsBox(bounds),
   intersectsTriangle:triangle=>{
    let hits=planeSection([triangle.a,triangle.b,triangle.c].map(p=>p.toArray()),p=>dot(vectorBetween(start,p),normal));
    for(const bound of limits){
     if(!hits.length)break;
     hits=clipPolygon(hits,bound);
    }
    for(let i=0;i<hits.length;i++){
     const a=hits[i],b=hits[(i+1)%hits.length];
     if(hits.length!==2||i===0)emit(fraction(a),fraction(b),a,b);
    }
    return false;
   }
  });
 }
}

function segmentSolidGap(segment,parts,region,direction){
 let nearest=null,station=0;
 const pieces=[];
 for(let i=1;i<segment.pathPoints.length;i++){
  const start=segment.pathPoints[i-1],end=segment.pathPoints[i],length=Math.hypot(...vectorBetween(start,end));
  if(length<=EPS)continue;
  solidLink(parts,start,end,direction,region,(a,b,to,endTo)=>{
   if(![a,b].every(Number.isFinite))return;
   if(a>b){[a,b]=[b,a];[to,endTo]=[endTo,to];}
   a=Math.max(0,a);b=Math.min(1,b);
   if(b<a)return;
   const piece={start:station+a*length,end:station+b*length,from:interpolate(start,end,a),to,
    endFrom:interpolate(start,end,b),endTo,kind:'solid'};
   const hit=closestDistance(piece);
   if(!nearest||hit.distance<nearest.distance)nearest=hit;
   if(piece.end-piece.start>EPS)pieces.push(piece);
  });
  station+=length;
 }
 return distanceProfile(pieces,nearest,station);
}

function segmentSource(segment,sourceWelds){
 const source=sourceWelds.get(segment.sourceWeldId);
 if(!source)return null;
 const points=segment.pathPoints;
 return {...source,start:points[0],end:points.at(-1),closed:samePoint(points[0],points.at(-1)),
  segments:[{...source.segments[0],start:points[0],end:points.at(-1),points,length:segment.length}]};
}

function edgeDistance(source,edges,frame){
 if(!source||!edges)return null;
 const limit=Math.hypot(...vectorBetween(frame.min,frame.max));
 const groups=measurePlanningBoundaries(source,edges,limit,points=>
  clipCapturePolyline(frame,points.map(p=>p.toArray())).map(chunk=>chunk.map(vector))
 );
 let closest=null;
 for(const {spans} of groups)for(const span of spans){
  if(span.minDistance<=.02||closest&&span.minDistance>=closest.distance)continue;
  closest={distance:span.minDistance,from:span.minPoint.toArray(),to:span.minBoundaryPoint.toArray()};
 }
 return closest;
}

function measureEndpoint(weld,key,source,edges,parts,frame){
 const start=key==='start',segment=start?weld.segments[0]:weld.segments.at(-1);
 const points=segment.pathPoints,point=points[start?0:points.length-1];
 const neighbors=start?points.slice(1):points.slice(0,-1).reverse();
 const neighbor=neighbors.find(p=>!samePoint(point,p));
 const outward=neighbor&&unit(vectorBetween(neighbor,point));
 const facts=weld.endpointFacts?.[key];
 const hasHole=facts?.hasHole??weld[key+'Hole'];
 const holeBoundary=facts?.openingBoundaryPoints??[];
 const holeSize=hasHole===false?0:
  holeBoundary.length&&holeBoundary.every(p=>insideCapture(frame,p))&&Number.isFinite(facts?.holeSize)?facts.holeSize:null;
 let gap=null;
 if(outward){
  const limit=captureRayLimit(frame,point,outward);
  const hit=rayHit(parts,point,outward,limit);
  const axial=source&&edges?measurePlanningAxial(source,edges):null;
  const clearances=Object.values(axial??{}).map(face=>face[(start?'起点':'终点')+'距离']).filter(v=>Number.isFinite(v)&&v>=0&&v<=limit+EPS);
  const distance=clearances.length?Math.min(...clearances):null;
  gap=hit??(distance!==null?{distance,from:point,to:along(point,outward,distance)}:null);
 }
 const edgeDistance=measureBaseplateEndpoint(point,source,edges,frame);
 return {position:point,type:endpointType(facts),hasHole,holeSize,holeBoundary:holeSize>0?holeBoundary:[],gap,edgeDistance};
}

export function createTemplateNeighborhoodMeasurer({parts,mesh,edges,sourceWelds}){
 const lookup=new Map(sourceWelds.map(weld=>[weld.id,weld]));
 const solids=parts.filter(part=>part.vertexCount>=3&&part.solidCount!==0).map(part=>({
  id:part.id,bounds:box(part.bbox.min,part.bbox.max),tree:()=>planningPartGeometryIndex(mesh,part).tree
 }));
 const cache=new Map();
 return (weld,range)=>{
  if(!weld.segments?.length||weld.segments.some(segment=>!segment.pathPoints?.length))return null;
  const signature=JSON.stringify([range,weld.segments.map(s=>[s.sourceWeldId,s.mainPartId,s.subPartId,s.pathPoints]),weld.endpointFacts,weld.startHole,weld.endHole]);
  if(cache.has(signature))return cache.get(signature);
  const region=weldRegionBounds(weld,[0,0,0],0,range);
  const sources=weld.segments.map(segment=>segmentSource(segment,lookup));
  const candidates=(segment,source)=>{
   const own=new Set([segment.mainPartId,segment.subPartId,source?.mainPartId,source?.subPartId]);
   return solids.filter(part=>!own.has(part.id));
  };
  const segments=weld.segments.map((segment,index)=>{
   const source=sources[index];
   let legacyEdge;
   const solidGap=segmentSolidGap(segment,candidates(segment,source),region,baseplateDirection(source));
   return {
    baseplate:measureBaseplateEdges(segment,source,edges,region.frame),
    get edge(){return legacyEdge??=edgeDistance(source,edges,region.frame);},
    gap:solidGap.nearest,solidGap
   };
  });
  const result={segments};
  for(const [key,index] of [['start',0],['end',segments.length-1]]){
   result[key]=measureEndpoint(weld,key,sources[index],edges,candidates(weld.segments[index],sources[index]),region.frame);
  }
  if(cache.size>=500)cache.delete(cache.keys().next().value);
  cache.set(signature,result);
  return result;
 };
}

export async function loadDemoTemplateNeighborhood(signal){
 const base='/models/111-rules';
 const get=async name=>{
  const response=await fetch(base+'/'+name,{signal});
  if(!response.ok)throw Error('焊缝邻域几何数据加载失败');
  return response;
 };
 const [partData,mesh,edges,canonical]=await Promise.all([
  get('parts.json').then(response=>response.json()),
  get('mesh.bin').then(response=>response.arrayBuffer()),
  get('edges.json').then(response=>response.json()),
  get('planning-input.json').then(response=>response.json())
 ]);
 return createTemplateNeighborhoodMeasurer({parts:partData.parts,mesh:new Float32Array(mesh),edges,sourceWelds:canonical.weldsData.welds});
}
