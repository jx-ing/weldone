import {Box3,DoubleSide,Ray,Vector3} from 'three';
import {weldRegionBounds} from './templateCoverModel.mjs';
import {
 EPS,along,vectorBetween,dot,interpolate,insideCapture,clipCapturePolyline,clipCaptureSegment,captureRayLimit,captureLinkOffsets
} from './templateCaptureRange.mjs';
import {endpointType} from './templateGeometryRules.mjs';
import {validReferenceNormal} from './weldDirectionGeometry.mjs';
import {baseplateDirection,baseplateFace,measureBaseplateEdges,measureBaseplateEndpoint} from './templateBaseplateEdges.mjs';
import {closestDistance,distanceProfile,distanceRangesBelow} from './templateDistanceProfile.mjs';
import {measurePlanningAxial,measurePlanningBoundaries,planningPartGeometryIndex} from './vendor/geometry-engine.mjs';
import {bundledModelUrl} from './bundledModels.mjs';

const vector=p=>new Vector3(...p);
const unit=p=>{const length=Math.hypot(...p);return length>EPS?p.map(v=>v/length):null;};
const box=(min,max)=>new Box3(vector(min),vector(max));
const samePoint=(a,b)=>Math.hypot(...vectorBetween(a,b))<=EPS;
const solidProbeDirection=vector([.58,.73,.36]).normalize();

function insideSolid(part,point){
 if(!part.bounds.containsPoint(point))return false;
 const hit=part.tree()?.raycastFirst(new Ray(point,solidProbeDirection),DoubleSide,.0001);
 return !!hit?.face&&hit.face.normal.dot(solidProbeDirection)>1e-7;
}

function outwardGapDirection(segment,source,parts){
 const {face,sideFace,sidePart}=baseplateFace(source??segment);
 const baseNormal=face?.法向??segment.referenceNormal;
 if(!validReferenceNormal(baseNormal))return ()=>null;
 const normal=unit(baseNormal);
 const side=parts.get(sidePart??segment.subPartId);
 const planar=sideFace?.类型==='平面'?sideFace.法向:
  !sideFace&&segment.geometry==='直线'?segment.subFaceNormal:undefined;
 return (start,end)=>{
  const tangent=unit(vectorBetween(start,end));
  const across=unit(vector(normal).cross(vector(tangent)).toArray());
  if(!across)return null;
  if(side){
   const middle=interpolate(start,end,.5);
   for(const offset of [.2,.5,1,2,4]){
    const above=along(middle,normal,Math.min(.8,offset*.5));
    const positive=insideSolid(side,vector(along(above,across,offset)));
    const negative=insideSolid(side,vector(along(above,across,-offset)));
    if(positive!==negative)return positive?across.map(value=>-value):across;
   }
  }
  if(!validReferenceNormal(planar))return null;
  const alignment=dot(unit(planar),across);
  return Math.abs(alignment)>.2?across.map(value=>value*Math.sign(alignment)):null;
 };
}

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
  if(hit&&hit.distance<=limit+EPS&&(!nearest||hit.distance<nearest.distance))nearest={distance:hit.distance,from:point,to:hit.point.toArray(),partId:part.id};
 }
 return nearest;
}

function captureLimits(frame,relativePoint){
 return frame.axes.flatMap((axis,i)=>[
  point=>dot(relativePoint(point),axis)-frame.min[i],
  point=>frame.max[i]-dot(relativePoint(point),axis)
 ]);
}

// Intersect solids with the strip swept by the measurement rays along a weld link.
function solidLink(parts,start,end,direction,region,emit,offsetFrame){
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
    let low=depth>0?0:Math.max(0,fraction),high=depth>0?Math.min(1,fraction):1;
    if(high<low)continue;
    if(offsetFrame){
     const offsets=[low,high].map(at=>vectorBetween(interpolate(start,end,at),point));
     const clipped=clipCaptureSegment(offsetFrame,...offsets);
     if(!clipped)continue;
     const span=high-low;
     high=low+span*clipped[1];
     low+=span*clipped[0];
    }
    emit(low,high,point,point);
   }
  }
  return;
 }
 const normal=vector(tangent).cross(vector(direction)).toArray(),width=dot(path,tangent);
 const fraction=point=>dot(vectorBetween(start,point),tangent)/width;
 const clearance=point=>dot(vectorBetween(interpolate(start,end,fraction(point)),point),direction);
 const limit=offsetFrame?captureRayLimit(offsetFrame,[0,0,0],direction):Math.hypot(...vectorBetween(cad.min,cad.max));
 const bounds=new Box3().setFromPoints([start,end,along(start,direction,limit),along(end,direction,limit)].map(vector))
  .intersect(box(cad.min,cad.max)).expandByScalar(EPS);
 const limits=[fraction,p=>1-fraction(p),clearance,...captureLimits(frame,p=>vectorBetween(frame.base,p))];
 if(offsetFrame)limits.push(...captureLimits(offsetFrame,p=>vectorBetween(interpolate(start,end,fraction(p)),p)));
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

function segmentSolidGap(segment,parts,region,directionForLink,range){
 let nearest=null,station=0;
 const pieces=[];
 for(let i=1;i<segment.pathPoints.length;i++){
  const start=segment.pathPoints[i-1],end=segment.pathPoints[i],length=Math.hypot(...vectorBetween(start,end));
  if(length<=EPS)continue;
  const direction=directionForLink(start,end);
  if(!direction){station+=length;continue;}
  const offsetFrame=range&&captureLinkOffsets(start,end,range,region.frame);
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
  },offsetFrame);
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
 const edgeDistance=measureBaseplateEndpoint(point,outward,source,edges,frame);
 return {position:point,type:facts?endpointType(facts):undefined,hasHole,holeSize,holeBoundary:holeSize>0?holeBoundary:[],gap,edgeDistance};
}

export function createTemplateNeighborhoodMeasurer({parts,mesh,edges,sourceWelds}){
 const lookup=new Map(sourceWelds.map(weld=>[weld.id,weld]));
 const solids=parts.filter(part=>part.vertexCount>=3&&part.solidCount!==0).map(part=>({
  id:part.id,bounds:box(part.bbox.min,part.bbox.max),tree:()=>planningPartGeometryIndex(mesh,part).tree
 }));
 const byPart=new Map(solids.map(part=>[part.id,part]));
 const cache=new Map();
 const measure=(weld,range)=>{
  if(!weld.segments?.length||weld.segments.some(segment=>!segment.pathPoints?.length))return null;
  const signature=JSON.stringify([range,weld.segments.map(s=>[s.sourceWeldId,s.mainPartId,s.subPartId,s.referenceNormal,s.subFaceNormal,s.pathPoints]),weld.endpointFacts,weld.startHole,weld.endHole]);
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
   const solidGap=segmentSolidGap(segment,candidates(segment,source),region,outwardGapDirection(segment,source,byPart),range);
   return {
    baseplate:measureBaseplateEdges(segment,source,edges,region.frame,range),
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
 measure.endpointClearance=(segment,side,limit)=>{
  const points=segment.pathPoints,start=side==='start';
  const point=start?points[0]:points.at(-1),next=start?points[1]:points.at(-2);
  const outward=unit(vectorBetween(next,point));
  if(!outward)return null;
  const source=segmentSource(segment,lookup);
  const own=new Set([segment.mainPartId,segment.subPartId,source?.mainPartId,source?.subPartId]);
  return rayHit(solids.filter(part=>!own.has(part.id)),point,outward,limit)?.distance??null;
 };
 measure.segmentClearance=(segment,limit)=>{
  const source=segmentSource(segment,lookup);
  const own=new Set([segment.mainPartId,segment.subPartId,source?.mainPartId,source?.subPartId]);
  const range={along:limit,across:limit,above:limit,below:limit};
  const region=weldRegionBounds({segments:[segment]},[0,0,0],0,range);
  return segmentSolidGap(segment,solids.filter(part=>!own.has(part.id)),region,()=>baseplateDirection(source));
 };
 measure.outerCornerClearance=([before,after],point,limit)=>{
  const incoming=unit(vectorBetween(before.pathPoints.at(-2),before.pathPoints.at(-1)));
  const outgoing=unit(vectorBetween(after.pathPoints[1],after.pathPoints[0]));
  if(!incoming||!outgoing)return null;
  const outward=unit(along(incoming,outgoing,1));
  const own=new Set([before.mainPartId,before.subPartId,after.mainPartId,after.subPartId]);
  const candidates=solids.filter(part=>!own.has(part.id));
  return [outward,incoming,outgoing].filter(Boolean).map(direction=>rayHit(candidates,point,direction,limit))
   .filter(Boolean).sort((a,b)=>a.distance-b.distance)[0]??null;
 };
 measure.oppositeCornerRanges=(segment,limit,corners)=>{
  const own=new Set([segment.mainPartId,segment.subPartId]);
  const relevant=corners.filter(corner=>own.has(corner.partId));
  if(!relevant.length)return [];
  const source=segmentSource(segment,lookup);
  const range={along:limit,across:limit,above:limit,below:limit};
  const region=weldRegionBounds({segments:[segment]},[0,0,0],0,range);
  return relevant.flatMap(({point,segments})=>{
   const cornerParts=new Set(segments.flatMap(part=>[part.mainPartId,part.subPartId]));
   const subjects=solids.filter(part=>cornerParts.has(part.id)&&!own.has(part.id));
   const profile=segmentSolidGap(segment,subjects,region,()=>baseplateDirection(source));
   const nearby=distanceRangesBelow({pieces:profile.pieces.map(piece=>({...piece,to:point,endTo:point}))},limit);
   return distanceRangesBelow(profile,limit).flatMap(gap=>nearby.flatMap(window=>{
    const start=Math.max(gap.start,window.start),end=Math.min(gap.end,window.end);
    return end-start>EPS?[{start,end}]:[];
   }));
  });
 };
 const partsById=new Map(parts.map(part=>[part.id,part]));
 measure.referenceNormalAt=(segment,position,tangent)=>{
  if(validReferenceNormal(segment.referenceNormal))return segment.referenceNormal;
  const source=segmentSource(segment,lookup);
  const id=segment.mainPartId??source?.mainPartId;
  const part=partsById.get(id);
  if(!part||part.vertexCount<3)return undefined;
  const {tree,geometry}=planningPartGeometryIndex(mesh,part);
  const hit=tree?.closestPointToPoint(vector(position),{},0,1);
  if(!hit)return undefined;
  const normal=new Vector3().fromBufferAttribute(geometry.getAttribute('normal'),hit.faceIndex*3).normalize();
  if(normal.lengthSq()<.99||Math.abs(normal.dot(vector(tangent)))>.25)return undefined;
  return normal.toArray();
 };
 const cornerCache=new Map();
 measure.measureCorner=({before,after,normal,incoming,outgoing})=>{
  const sourceBefore=lookup.get(before.sourceWeldId),sourceAfter=lookup.get(after.sourceWeldId);
  const pair=(segment,source)=>[segment.mainPartId??source?.mainPartId,segment.subPartId??source?.subPartId];
  const a=pair(before,sourceBefore),b=pair(after,sourceAfter);
  if([...a,...b].some(id=>!byPart.has(id)))return undefined;
  const end=before.pathPoints.at(-1),start=after.pathPoints[0];
  const key=JSON.stringify([a,b,end,start,normal,incoming,outgoing,before.length,after.length]);
  if(cornerCache.has(key))return cornerCache.get(key);
  const result=(()=>{
   const center=vector(interpolate(end,start,.5)),axis=vector(normal);
   const rayA=vector(incoming).negate(),rayB=vector(outgoing);
   const length=Math.min(before.length,after.length);
   if(!Number.isFinite(length)||length<=0||vector(end).distanceTo(vector(start))>.1)return null;
   const shared=a.filter(id=>b.includes(id));
   // Prefer the common face with a normal perpendicular to the bend plane.
   const alignment=(partId,segment,source,ids)=>{
    const main=partId===ids[0],face=source?.properties?.焊缝段?.[0];
    const direction=main?(segment.referenceNormal??face?.主板面?.法向):(segment.subFaceNormal??face?.副板面?.法向);
    return direction?.length===3?Math.abs(vector(direction).normalize().dot(axis)):0;
   };
   const bases=shared.map(id=>({id,score:Math.min(alignment(id,before,sourceBefore,a),alignment(id,after,sourceAfter,b))}))
    .filter(part=>part.score>.85).sort((x,y)=>y.score-x.score);
   const base=bases[0];
   if(!base||bases[1]?.score>=base.score-.03)return null;
   const subjects=[...new Set([...a,...b].filter(id=>id!==base.id))].map(id=>byPart.get(id));
   const bisector=rayA.clone().add(rayB).normalize();
   const radii=[.2,.4,.7].map(fraction=>Math.min(6,length*.48)*fraction);
   const votes=[];
   for(const radius of radii){
    const height=Math.min(.8,Math.max(.025,radius*.25));
    // A seam can turn at the support's rim. Check the adjacent legs as well as
    // the vertex, where both side probes can land outside the finite face.
    const support=byPart.get(base.id);
    const exposedSides=new Set();
    for(const station of [center,center.clone().addScaledVector(rayA,radius),center.clone().addScaledVector(rayB,radius)]){
     const positive=insideSolid(support,station.clone().addScaledVector(axis,height));
     const negative=insideSolid(support,station.clone().addScaledVector(axis,-height));
     if(positive!==negative)exposedSides.add(positive?-1:1);
    }
    if(exposedSides.size!==1)continue;
    const [exposed]=exposedSides;
    const origin=center.clone().addScaledVector(axis,exposed*height);
    const sample=directions=>directions.filter(direction=>{
     const point=origin.clone().addScaledVector(direction,radius);
     return subjects.some(part=>insideSolid(part,point));
    }).length;
    const minor=sample([bisector,rayA.clone().lerp(rayB,.35).normalize(),rayA.clone().lerp(rayB,.65).normalize()]);
    const major=sample([bisector.clone().negate(),rayA.clone().negate(),rayB.clone().negate()]);
    if(minor>=2&&major===0)votes.push('outer');
    if(major>=2&&minor===0)votes.push('inner');
   }
   return votes.length>=2&&votes.every(vote=>vote===votes[0])?votes[0]:null;
  })();
  if(cornerCache.size>=3000)cornerCache.clear();
  cornerCache.set(key,result);
  return result;
 };
 return measure;
}

export async function loadDemoTemplateNeighborhood(signal){
 const get=async name=>{
  const response=await fetch(bundledModelUrl('111-rules/'+name),{signal});
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
