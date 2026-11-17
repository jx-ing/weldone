import {Vector3} from 'three';

const linkFor=(device,role)=>device.bindings.find(binding=>binding.role===role)?.link;

export function workstationLaser(workstation,robot){
 const flange=workstation.object.getObjectByName(linkFor(robot,'flange'));
 const tcp=flange?.getObjectByName(linkFor(robot,'welding_tcp'));
 if(!tcp)return null;
 for(const camera of workstation.devices.filter(device=>device.kind==='precision')){
  const source=flange.getObjectByName(linkFor(camera,'laser_origin'));
  const profile=flange.getObjectByName(linkFor(camera,'nominal_profile_center'));
  if(!source||!profile)continue;
  const local=node=>tcp.worldToLocal(node.getWorldPosition(new Vector3()));
  const emitter=local(source),nominal=local(profile);
  const binding=camera.bindings.find(binding=>binding.role==='laser_plane');
  const fan=binding&&flange.getObjectByName(binding.link)?.getObjectByName(binding.visual);
  const normal=fan&&fanNormal(fan,tcp);
  const trackingPlane=normal&&{normal:normal.toArray(),gap:normal.dot(nominal)*1000,
   nominal:nominal.clone().multiplyScalar(1000).toArray()};
  const receiver=flange.getObjectByName(linkFor(camera,'optical_origin'));
  const readings=name=>String(camera.properties?.find(property=>property.name===name)?.value??'').split(',').map(Number);
  return {id:camera.id,emitter,beam:nominal.sub(emitter).normalize(),trackingPlane,
   receiver:receiver?local(receiver):null,workingDistances:readings('working_distances'),widths:readings('scan_widths')};
 }
 return null;
}

function fanNormal(fan,tcp){
 let largest=0,normal;
 fan.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const {position}=mesh.geometry.attributes,index=mesh.geometry.index;
  const count=index?.count??position.count;
  mesh.updateWorldMatrix(true,false);
  tcp.updateWorldMatrix(true,false);
  const matrix=tcp.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const vertex=i=>new Vector3().fromBufferAttribute(position,index?.getX(i)??i).applyMatrix4(matrix);
  for(let i=0;i+2<count;i+=3){
   const a=vertex(i),cross=vertex(i+1).sub(a).cross(vertex(i+2).sub(a));
   const area=cross.lengthSq();
   // The outer faces of the thin fan are larger than its edge faces.
   if(area>largest){largest=area;normal=cross.normalize();}
  }
 });
 return normal;
}

export function workstationTrackingPlanes(workstation){
 return Object.fromEntries(workstation.devices.filter(device=>device.kind==='robot').map(robot=>
  [robot.id,workstationLaser(workstation,robot)?.trackingPlane??null]));
}
