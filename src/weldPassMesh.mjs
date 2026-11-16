import {BufferGeometry,DoubleSide,Float32BufferAttribute,Ray,Vector3} from 'three';
import {validReferenceNormal} from './weldDirectionGeometry.mjs';
import {horizontalWeldNormal} from './manualWeldModel.mjs';
import {planningPartGeometryIndex} from './vendor/geometry-engine.mjs';

const vector=point=>new Vector3(...point);
export const weldSectionSide=(tangent,preferred=[0,0,1])=>
 horizontalWeldNormal(tangent,vector(preferred).cross(vector(tangent)).toArray());

export function weldPassLegDirections(tangent,segment,side){
 const axis=vector(tangent);
 const perpendicular=normal=>{
  const direction=vector(normal);
  return direction.addScaledVector(axis,-direction.dot(axis)).normalize();
 };
 const main=segment.referenceNormal;
 const sub=segment.subFaceNormal;
 if(validReferenceNormal(main)&&validReferenceNormal(sub)){
  const a=perpendicular(main),b=perpendicular(sub);
  const cosine=a.dot(b);
  const alongMain=b.clone().addScaledVector(a,-cosine);
  const alongSub=a.clone().addScaledVector(b,-cosine);
  if(alongMain.lengthSq()>1e-8&&alongSub.lengthSq()>1e-8){
   return [alongMain.normalize().toArray(),alongSub.normalize().toArray()];
  }
 }
 if(validReferenceNormal(main)){
  const up=perpendicular(main);
  const alongMain=new Vector3().crossVectors(up,axis).normalize();
  if(alongMain.dot(vector(side))<0)alongMain.negate();
  if(up.lengthSq()>1e-8)return [alongMain.toArray(),up.toArray()];
 }
 const horizontal=perpendicular(side);
 const normal=new Vector3().crossVectors(axis,horizontal).normalize();
 const up=normal.z<0?normal.negate():normal;
 return [horizontal.toArray(),up.toArray()];
}

export function weldSegmentPass(segment,weldLeg,referenceNormal){
 const leg=weldLeg??segment.weldLeg;
 if(!Number.isFinite(leg)||leg<=0||!segment.pathPoints?.length)return null;
 const positions=segment.pathPoints.filter((point,i,all)=>!i||vector(point).distanceToSquared(vector(all[i-1]))>1e-16);
 if(positions.length<2)return null;
 const sections=positions.map((point,i)=>{
  const previous=positions[Math.max(0,i-1)],next=positions[Math.min(positions.length-1,i+1)];
  const tangent=vector(next).sub(vector(previous));
  if(tangent.lengthSq()<1e-16)tangent.subVectors(vector(next),vector(point));
  tangent.normalize();
  const preferred=segment.referenceNormal??referenceNormal??[0,0,1];
  const axis=tangent.toArray();
  return weldPassLegDirections(axis,segment,weldSectionSide(axis,preferred));
 });
 return {positions,sections,leg};
}

export function weldSolidTest(meshes){
 const parts=meshes.map(mesh=>{
  const geometry=mesh.geometry,positions=geometry.getAttribute('position'),indices=geometry.index;
  geometry.computeBoundingBox();
  let tree;
  return {bounds:geometry.boundingBox,tree:()=>{
   if(tree)return tree;
   const count=indices?.count??positions.count,vertices=new Float32Array(count*6);
   for(let i=0;i<count;i++){
    const index=indices?indices.getX(i):i;
    vertices.set([positions.getX(index),positions.getY(index),positions.getZ(index)],i*6);
   }
   tree=planningPartGeometryIndex(vertices,{vertexOffset:0,vertexCount:count}).tree;
   return tree;
  }};
 });
 const ray=new Ray(new Vector3(),new Vector3(.58,.73,.36).normalize());
 return point=>{
  ray.origin.copy(point);
  return parts.some(part=>{
   if(!part.bounds.containsPoint(point))return false;
   const hit=part.tree()?.raycastFirst(ray,DoubleSide,.0001);
   return !!hit?.face&&hit.face.normal.dot(ray.direction)>0;
  });
 };
}

// Probe the two legs' candidate quadrants at several positions inside the triangle.
export function weldSectionSigns(pass,contains,world){
 const {positions,sections,leg}=pass;
 const links=[...new Set([0,Math.floor((positions.length-2)/2),positions.length-2])];
 const choices=[[1,1],[-1,1],[1,-1],[-1,-1]];
 let best=choices[0],lowest=Infinity;
 for(const signs of choices){
  let hits=0;
  for(const i of links){
   const point=world(positions[i]).lerp(world(positions[i+1]),.5);
   const [a,b]=sections[i];
   for(const [u,v] of [[.22,.22],[.60,.16],[.16,.60]]){
    const offset=positions[i].map((value,axis)=>value+leg*(u*a[axis]*signs[0]+v*b[axis]*signs[1]));
    if(contains(point.clone().add(world(offset).sub(world(positions[i])))))hits++;
   }
  }
  if(hits<lowest){best=signs;lowest=hits;}
  if(hits===0)break;
 }
 return best;
}

export function orientWeldSections(pass,signs,segmentIndices){
 return {...pass,sections:pass.sections.map((section,i)=>{
  const direction=signs[segmentIndices?.[i]??0]??[1,1];
  return section.map((axis,j)=>axis.map(value=>value*direction[j]));
 })};
}

export function weldPassMeshGeometry(pass,world){
 const {positions,sections,leg}=pass;
 if(!(leg>0)||!sections||positions.length<2)return null;
 const rings=positions.map((point,index)=>[
  world(point),
  ...sections[index].map(direction=>world(point.map((value,i)=>value+direction[i]*leg)))
 ]);
 const vertices=[],indices=[];
 const [root,firstLeg,secondLeg]=rings[0];
 const normal=firstLeg.clone().sub(root).cross(secondLeg.clone().sub(root));
 const nextRoot=rings.find(([position])=>position.distanceToSquared(root)>1e-12)?.[0];
 const reverse=nextRoot&&normal.dot(nextRoot.clone().sub(root))>0;
 const triangle=(a,b,c)=>indices.push(a,reverse?c:b,reverse?b:c);
 // Give each longitudinal face its own vertices to keep the triangle's edges sharp.
 for(let side=0;side<3;side++){
  const next=(side+1)%3,base=vertices.length/3;
  for(const ring of rings)vertices.push(...ring[side].toArray(),...ring[next].toArray());
  for(let i=1;i<rings.length;i++){
   const a=base+2*(i-1),b=a+2;
   triangle(a,b,a+1);
   triangle(b,b+1,a+1);
  }
 }
 for(const ring of [rings[0],[...rings.at(-1)].reverse()]){
  const base=vertices.length/3;
  for(const vertex of ring)vertices.push(...vertex.toArray());
  triangle(base,base+1,base+2);
 }
 const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(vertices,3));
 geometry.setIndex(indices);
 geometry.computeVertexNormals();
 return geometry;
}
