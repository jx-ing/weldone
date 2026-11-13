import {BufferGeometry,Float32BufferAttribute,Vector3} from 'three';
import {validReferenceNormal} from './weldDirectionGeometry.mjs';

const vector=point=>new Vector3(...point);

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
 const horizontal=perpendicular(side);
 const normal=new Vector3().crossVectors(axis,horizontal).normalize();
 const up=normal.z<0?normal.negate():normal;
 return [horizontal.toArray(),up.toArray()];
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
