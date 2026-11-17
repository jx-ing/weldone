import {LoadingManager} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {workstationDisplayObject} from './workstationToolVisuals.mjs';
import {workstationTrackingPlanes} from './workstationLaserCalibration.mjs';
import {workstationConfiguredDevices,workstationPrecisionBrand} from './workstationDevices.mjs';
import {loadWorkstationStructuredLight} from './nanyangToolHead.mjs';
import {workstationRobot} from './workstationSimulation.mjs';
import {addCoarseCameraPyramids} from './virtualWorkstationCamera.mjs';

const sceneUrl = `${import.meta.env?.BASE_URL??'/'}models/rizhao-0514-workstation.glb`;
let pending,structuredVisual;

export function loadStructuredLightAttachment(){
 structuredVisual??=loadWorkstationStructuredLight().catch(error=>{structuredVisual=undefined;throw error;});
 return structuredVisual;
}

export function configuredTrackingPlanes(workstation,settings){
 const devices=workstationConfiguredDevices(workstation.devices,settings);
 return Object.fromEntries(Object.entries(workstation.laserTrackingByRobot).map(([robot,plane])=>[
  robot,devices.some(device=>device.robotId===robot&&!device.configured&&workstationPrecisionBrand(device)==='yinglai')?plane:null
 ]));
}

export function configureWorkstation(workstation,settings,structuredModel){
 if(!workstation)return null;
 const devices=workstationConfiguredDevices(workstation.devices,settings);
 const visualObject=workstation.visualObject.clone(true);
 const activeIds=new Set(devices.map(device=>device.id));
 for(const device of workstation.devices){
  if(activeIds.has(device.id))continue;
  for(const {link,visual} of device.bindings){
   if(visual){
    const parent=visualObject.getObjectByName(link);
    const node=parent?.getObjectByName(visual);
    if(node)node.visible=false;
    if(device.kind==='precision'&&device.bindings.some(binding=>binding.role==='body'&&binding.visual===visual)){
     // The existing GLB keeps the removable bracket beside the lens body.
     for(const child of parent?.children??[])if(child.userData.urdfVisual?.startsWith('camera_mount_'))child.visible=false;
    }
   }
  }
 }
 if(structuredModel)for(const device of devices.filter(device=>device.configured&&workstationPrecisionBrand(device)==='weijing')){
  const robot=devices.find(candidate=>candidate.id===device.robotId);
  const tcp=visualObject.getObjectByName(robot?.bindings.find(binding=>binding.role==='welding_tcp')?.link);
  if(!tcp)continue;
  const assembly=structuredModel.clone(true);
  assembly.name='precision-camera:'+device.id;
  assembly.userData.precisionCameraId=device.id;
  tcp.add(assembly);
 }
 addCoarseCameraPyramids(visualObject,devices);
 return {...workstation,devices,sceneDevices:workstation.devices,visualObject,coarseCameraId:settings?.coarseCameraId,
  laserTrackingByRobot:configuredTrackingPlanes(workstation,settings)};
}

function annotatedWorkstation({scene}) {
    const root = scene.children.find(node => node.userData.weldone?.devices);
    const metadata = root?.userData.weldone;
    if (metadata?.version !== 1 || metadata.units !== 'm' || !Array.isArray(metadata.devices)) {
      throw new Error('场景缺少有效的设备标注');
    }
    const classified = metadata.devices.map(device => {
      if(typeof device?.id!=='string'||!device.id||typeof device.type!=='string'||!Array.isArray(device.bindings)||
        device.bindings.some(binding=>typeof binding?.role!=='string'||typeof binding.link!=='string')||
        device.properties!=null&&!Array.isArray(device.properties))throw Error('场景设备标注格式无效');
      const purpose = device.properties?.find(property => property.name === 'purpose')?.value ?? '';
      const kind = device.type === 'camera'
        ? (purpose.startsWith('精定位') ? 'precision' : purpose.startsWith('粗定位') ? 'coarse' : 'camera')
        : device.type;
      return {...device, kind};
    });
    const robots=classified.filter(device=>device.kind==='robot');
    if (!robots.length || new Set(classified.map(device => device.id)).size !== classified.length) {
      throw new Error('场景设备编号或机械臂标注无效');
    }
    const devices=classified.map(device=>{
      if(device.kind!=='precision')return device;
      const body=device.bindings.find(binding=>binding.role==='body')?.link;
      const owner=robots.find(robot=>scene.getObjectByName(robot.bindings.find(binding=>binding.role==='flange')?.link)?.getObjectByName(body));
      return owner?{...device,robotId:owner.id}:device;
    });
    const workstation={object:scene,devices};
    if(robots.some(robot=>!workstationRobot(workstation,robot.id)))throw Error('场景机械臂缺少有效的关节或焊接 TCP 标注');
    return {...workstation,visualObject:workstationDisplayObject(scene,devices),name:root.userData.name??root.name,
      laserTrackingByRobot:workstationTrackingPlanes(workstation)};
}

export function loadWorkstationScene() {
  pending ??= new GLTFLoader().loadAsync(sceneUrl).then(annotatedWorkstation).catch(error => {
    pending = undefined;
    throw error;
  });
  return pending;
}

export async function importWorkstationScene(file) {
  const bytes=await file.arrayBuffer();
  if(!/\.glb$/i.test(file.name)||bytes.byteLength<12||new DataView(bytes).getUint32(0,true)!==0x46546c67){
    throw Error('请选择带 WeldOne 设备标注的 GLB 场景文件');
  }
  const manager=new LoadingManager();
  manager.setURLModifier(url=>{
    if(/^(blob|data):/i.test(url))return url;
    throw Error('请使用模型和纹理均内嵌的 GLB 场景文件');
  });
  const [gltf,digest]=await Promise.all([
    new GLTFLoader(manager).parseAsync(bytes,''),
    crypto.subtle.digest('SHA-256',bytes)
  ]);
  const sceneKey=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return {...annotatedWorkstation(gltf),sceneKey,fileName:file.name};
}
