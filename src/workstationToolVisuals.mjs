import {Group,Matrix4,Vector3} from 'three';
import {workstationRobot} from './workstationSimulation.mjs';
import {setWorkstationStructuredLight} from './nanyangToolHead.mjs';

function installedTools(scene,devices,robot){
 const flange=scene.getObjectByName(robot.bindings.find(binding=>binding.role==='flange')?.link);
 if(!flange)return null;
 const tcp=flange.getObjectByName(robot.bindings.find(binding=>binding.role==='welding_tcp')?.link);
 const camera=devices.find(device=>device.kind==='precision'&&device.bindings.some(binding=>
  binding.role==='site_measurement_tcp'&&flange.getObjectByName(binding.link)));
 if(!tcp||!camera)return null;
 const body=camera.bindings.find(binding=>binding.role==='body');
 const mount=flange.getObjectByName(body.link);
 const torch=mount?.children.find(node=>node.userData.urdfVisual?.startsWith('torch_'));
 return torch?{flange,tcp,camera,torch}:null;
}

// Extend only the rear collar on the render copy of the native torch. Keep the
// rest of the housing and the entire neck in their original calibrated pose.
function seatTorchOnFlange(flange,torch){
 flange.updateWorldMatrix(true,true);
 const flangeInverse=flange.matrixWorld.clone().invert();
 const meshes=[];
 const point=new Vector3();
 let rear=Infinity;
 torch.traverse(node=>{
  if(!node.isMesh)return;
  const toFlange=flangeInverse.clone().multiply(node.matrixWorld);
  const positions=node.geometry.attributes.position;
  for(let i=0;i<positions.count;i++)rear=Math.min(rear,point.fromBufferAttribute(positions,i).applyMatrix4(toFlange).z);
  meshes.push({node,toFlange});
 });
 if(!(rear>1e-6&&Number.isFinite(rear)))return;
 const shoulder=rear+.018;
 for(const {node,toFlange} of meshes){
  const geometry=node.geometry.clone(),positions=geometry.attributes.position;
  const fromFlange=toFlange.clone().invert();
  for(let i=0;i<positions.count;i++){
   point.fromBufferAttribute(positions,i).applyMatrix4(toFlange);
   if(point.z>=shoulder)continue;
   point.z=shoulder*(point.z-rear)/(shoulder-rear);
   point.applyMatrix4(fromFlange);
   positions.setXYZ(i,point.x,point.y,point.z);
  }
  positions.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  node.geometry=geometry;
 }
}

export function workstationDisplayObject(scene,devices){
 const display=scene.clone(true);
 for(const robot of devices.filter(device=>device.kind==='robot')){
  const tools=installedTools(display,devices,robot);
  if(tools)seatTorchOnFlange(tools.flange,tools.torch);
 }
 return display;
}

export function createWorkstationToolPreview(workstation,robotId){
 const robot=workstationRobot(workstation,robotId);
 if(!robot)return null;
 const device=workstation.devices.find(item=>item.id===robot.id);
 const tools=installedTools(workstation.visualObject??workstation.object,workstation.sceneDevices??workstation.devices,device);
 if(!tools)return null;
 const {flange,tcp,camera}=tools;
 flange.updateWorldMatrix(true,true);
 const relative=tcp.matrixWorld.clone().invert().multiply(flange.matrixWorld);
 const assembly=flange.clone(true);
 assembly.matrixAutoUpdate=false;
 assembly.matrix.copy(relative);
 assembly.matrixWorldNeedsUpdate=true;
 const object=new Group();
 object.add(assembly);
 const optics=camera.bindings.filter(binding=>['field_of_view','laser_plane','nominal_scan_line'].includes(binding.role))
  .map(binding=>({role:binding.role,node:assembly.getObjectByName(binding.link)?.getObjectByName(binding.visual)}))
  .filter(item=>item.node);
 return {object,robot,setFieldOfView(show,showLaserLine,method,coverOpen){
  const laserInstalled=workstation.devices.some(device=>device.id===camera.id);
  for(const {role,node} of optics)node.visible=laserInstalled&&method!=='structuredLight'&&!!(role==='field_of_view'?show:showLaserLine);
  setWorkstationStructuredLight(assembly,coverOpen,!!show&&method==='structuredLight');
 }};
}
