import * as THREE from 'three';
import {capturePoint} from './templateCaptureRange.mjs';

export function weldCapturePlanes(region,world){
 const frame=region.frame;
 if(!frame)return [
  new THREE.Plane(new THREE.Vector3(1,0,0),-region.world.min[0]),new THREE.Plane(new THREE.Vector3(-1,0,0),region.world.max[0]),
  new THREE.Plane(new THREE.Vector3(0,1,0),-region.world.min[1]),new THREE.Plane(new THREE.Vector3(0,-1,0),region.world.max[1]),
  new THREE.Plane(new THREE.Vector3(0,0,1),-region.world.min[2]),new THREE.Plane(new THREE.Vector3(0,0,-1),region.world.max[2])
 ];
 return frame.axes.flatMap(([x,y,z],axis)=>[frame.min,frame.max].map((limit,index)=>{
  const inward=new THREE.Vector3(x,z,-y).multiplyScalar(index===0?1:-1);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(inward,world(capturePoint(frame,limit)));
 }));
}
