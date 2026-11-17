import {BufferAttribute,BufferGeometry,DoubleSide,Ray,Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

export const CAPTURE_SPACING_MM=.5;
export const COARSE_CAPTURE_SPACING_MM=3;
const epsilon=.02;
const clampToHalfWidth=(value,half)=>Math.max(-half,Math.min(half,value));

export function sampleVisibleWorkpiece(model,frames,spacing=CAPTURE_SPACING_MM){
 const origin=new Vector3(...model.origin);
 const positions=new Float32Array(model.meshes.reduce((size,mesh)=>size+mesh.positions.length,0));
 const indices=new Uint32Array(model.meshes.reduce((size,mesh)=>size+mesh.indices.length,0));
 let p=0,j=0;
 for(const mesh of model.meshes){
  positions.set(mesh.positions,p);
  for(const index of mesh.indices)indices[j++]=p/3+index;
  p+=mesh.positions.length;
 }
 if(!indices.length)throw Error('工件缺少可采集的表面网格');
 const geometry=new BufferGeometry();
 geometry.setAttribute('position',new BufferAttribute(positions,3));
 geometry.setIndex(new BufferAttribute(indices,1));
 try{
  const tree=new MeshBVH(geometry);
  const ray=new Ray(),eyeRay=new Ray();
  const voxels=new Set(),cloud=[];
  const store=(hit)=>{
   const point=hit.point.add(origin);
   const key=point.toArray().map(value=>Math.floor(value/spacing)).join(',');
   if(!voxels.has(key)){voxels.add(key);cloud.push(point.x,point.y,point.z);}
  };
  const axes=frame=>({...frame,
   origin:new Vector3(...frame.origin).sub(origin),forward:new Vector3(...frame.forward).normalize(),
   right:new Vector3(...frame.right).normalize(),up:frame.up&&new Vector3(...frame.up).normalize(),
   receivers:(frame.receivers??[]).map(point=>new Vector3(...point).sub(origin))});
  function capture(frame){
   const {origin:position,forward,right,up,distance,range,receivers,stripHalfWidth,sampleDistance=distance}=frame;
   if(!(distance>0&&range>=distance)||!right.lengthSq()||!forward.lengthSq())return;
   const halfWidth=frame.width/2,halfHeight=(frame.height??0)/2;
   const stepX=spacing*distance/sampleDistance;
   const countX=Math.ceil(halfWidth/stepX),countY=Math.ceil(halfHeight/spacing);
   ray.origin.copy(position);
   for(let y=-countY;y<=countY;y++)for(let x=-countX;x<=countX;x++){
    ray.direction.copy(forward).multiplyScalar(distance).addScaledVector(right,clampToHalfWidth(x*stepX,halfWidth));
    if(up)ray.direction.addScaledVector(up,clampToHalfWidth(y*spacing,halfHeight));
    ray.direction.normalize();
    const hit=tree.raycastFirst(ray,DoubleSide,epsilon,range/ray.direction.dot(forward));
    if(!hit||stripHalfWidth!==undefined&&Math.abs((hit.point.x-position.x)*right.x+
      (hit.point.y-position.y)*right.y+(hit.point.z-position.z)*right.z)>stripHalfWidth+spacing)continue;
    const visible=receivers.every(receiver=>{
     eyeRay.origin.copy(receiver);
     eyeRay.direction.subVectors(hit.point,receiver);
     const length=eyeRay.direction.length();
     return length<=epsilon||!tree.raycastFirst(eyeRay,DoubleSide,epsilon,length-epsilon);
    });
    if(visible)store(hit);
   }
  }
  let previous;
  for(const source of frames){
   const frame=axes(source);
   if(frame.kind==='laser'&&previous?.kind==='laser'&&frame.group===previous.group){
    const before=previous.origin.clone().addScaledVector(previous.forward,previous.distance);
    const after=frame.origin.clone().addScaledVector(frame.forward,frame.distance);
    const movement=before.distanceTo(after)+frame.right.angleTo(previous.right)*frame.width/2;
    const steps=Math.max(1,Math.ceil(movement/spacing));
    for(let step=1;step<steps;step++){
     const t=step/steps,lerp=(a,b)=>a+(b-a)*t;
     capture({...frame,origin:previous.origin.clone().lerp(frame.origin,t),
      forward:previous.forward.clone().lerp(frame.forward,t).normalize(),
      right:previous.right.clone().lerp(frame.right,t).normalize(),stripHalfWidth:frame.stripHalfWidth,sampleDistance:frame.sampleDistance,
      receivers:frame.receivers.map((receiver,index)=>previous.receivers[index]?.clone().lerp(receiver,t)??receiver),
      distance:lerp(previous.distance,frame.distance),width:lerp(previous.width,frame.width)});
    }
   }
   capture(frame);
   previous=frame;
  }
  return new Float32Array(cloud);
 }finally{geometry.dispose();}
}

export function pointCloudPly(positions,spacing=CAPTURE_SPACING_MM){
 const header=`ply\nformat binary_little_endian 1.0\ncomment millimetres, ${spacing} mm voxel pitch\nelement vertex ${positions.length/3}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
 const body=new DataView(new ArrayBuffer(positions.length*4));
 positions.forEach((value,index)=>body.setFloat32(index*4,value,true));
 return new Blob([header,body.buffer],{type:'application/octet-stream'});
}
