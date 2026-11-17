import {LASER_MOUNT_SIDES} from './laserCameraMount.mjs';

export const DEVICE_TRACKING_MODES=[['arc','电弧跟踪'],['laser','激光跟踪']];
export const PRECISION_CAMERA_BRANDS=[['none','无'],['weijing','伟景'],['yinglai','英莱线激光']];
export const ROBOT_MOUNTING_OPTIONS=[['upright','正装'],['inverted','倒装']];

const camera=()=>({brand:'',model:'',address:'',port:null});

export function migrateDeviceControl(legacy,capabilities={}){
 const laser=legacy?.precisionCameras?.laser,structure=legacy?.precisionCameras?.structuredLight;
 const hasLegacyCameras=!!legacy?.precisionCameras;
 const noPrecision=hasLegacyCameras?laser?.enabled!==true&&structure?.enabled!==true:
  capabilities.structuredLightPrecision===false&&capabilities.laserPrecision===false;
 const useLaser=hasLegacyCameras?laser?.enabled&&!structure?.enabled:
  capabilities.structuredLightPrecision===false&&capabilities.laserPrecision===true;
 const both=hasLegacyCameras?laser?.enabled===true&&structure?.enabled===true:
  capabilities.laserPrecision===true&&capabilities.structuredLightPrecision===true;
 const brand=noPrecision?'none':useLaser?'yinglai':'weijing';
 const trackingModes=legacy?.trackingModes??DEVICE_TRACKING_MODES.filter(([key])=>capabilities[key+'Tracking']!==false).map(([key])=>key);
 return {
  robot:{address:'',port:null,model:legacy?.robotModel??'',reach:null,workingRange:'',externalTravel:null,mounting:'upright',trackingModes:[...trackingModes],
   ...(legacy?.welderModel!==undefined?{welderModel:legacy.welderModel}:{}),
   ...(legacy?.wireType!==undefined?{wireType:legacy.wireType}:{})},
  coarseCamera:{...camera(),model:legacy?.coarseCameraModel??'',scanMode:'auto',scanStart:null,scanEnd:null},
  precisionCamera:{brand,profiles:{
   weijing:{model:structure?.model??'',address:'',port:null},
   yinglai:{model:laser?.model??'',address:'',port:null,id:null}
  },...(both?{brands:['weijing','yinglai']}:{})}
 };
}

export const MAX_ADDITIONAL_DEVICES=50;
export const BASE_DEVICE_TYPES=[['robot','焊接机器人'],['coarseCamera','粗定位相机']];

export function robotProfiles(control){
 const robots=[{id:control.robotId??'robot',type:'robot',configuration:control.robot},
  ...(control.additionalDevices??[]).filter(device=>device.type==='robot')];
 return robots.map((device,index)=>({...device,label:'机械臂 '+(index+1)}));
}

export function enabledPlanningRobots(control){
 const active=control.enabledRobotIds??[control.robotId??'robot'];
 const robots=robotProfiles(control).filter(device=>active.includes(device.id));
 return robots.map(({id,label,configuration})=>({id,label,configuration}));
}

export function addDeviceProfile(control,type,id){
 if(!BASE_DEVICE_TYPES.some(([key])=>key===type)||!id)throw Error('设备类型无效');
 const additionalDevices=control.additionalDevices??[];
 if(additionalDevices.length>=MAX_ADDITIONAL_DEVICES||additionalDevices.some(device=>device.id===id))throw Error('设备数量超出限制或编号重复');
 return {...control,additionalDevices:[...additionalDevices,{id,type,configuration:migrateDeviceControl()[type]}]};
}

export function activateDeviceProfile(control,id){
 const selected=control.additionalDevices?.find(device=>device.id===id);
 if(!selected)return control;
 const {type,configuration}=selected;
 return {...control,[type]:configuration,additionalDevices:control.additionalDevices.map(device=>
  device.id===id?{...device,configuration:control[type]}:device)};
}

export function enabledPrecisionBrands({precisionCamera}){
 return precisionCamera?.brands??(precisionCamera?.brand&&precisionCamera.brand!=='none'?[precisionCamera.brand]:[]);
}

export function deviceControlCapabilities(control){
 const robots=enabledPlanningRobots(control);
 const supports=mode=>robots.length>0&&robots.every(({configuration})=>configuration.trackingModes.includes(mode));
 const brands=enabledPrecisionBrands(control),laserPrecision=brands.includes('yinglai');
 return {arcTracking:supports('arc'),laserTracking:laserPrecision&&supports('laser'),
  structuredLightPrecision:brands.includes('weijing'),laserPrecision};
}

export function deviceControlError(value){
 const {robot,coarseCamera,precisionCamera}=value??{};
 if(!robot||!coarseCamera||!precisionCamera)return '设备配置无效';
 const brands=precisionCamera.brands;
 if(brands===undefined?!PRECISION_CAMERA_BRANDS.some(([key])=>key===precisionCamera.brand):
  !Array.isArray(brands)||new Set(brands).size!==brands.length||brands.some(brand=>!['weijing','yinglai'].includes(brand)))return '精定位相机配置无效';
 const text=(v,max=80)=>typeof v==='string'&&v.length<=max;
 const port=v=>v===null||Number.isInteger(v)&&v>0&&v<=65535;
 const number=(v,min=-Infinity)=>v===null||Number.isFinite(v)&&v>=min;
 const connection=device=>device&&text(device.model)&&text(device.address,255)&&port(device.port);
 const additional=value.additionalDevices??[];
 if(!Array.isArray(additional)||additional.length>MAX_ADDITIONAL_DEVICES||
  additional.some(device=>typeof device?.id!=='string'||!device.id||!BASE_DEVICE_TYPES.some(([type])=>type===device.type))||
  new Set(additional.map(device=>device.id)).size!==additional.length)return '附加设备配置无效';
 const registered=robotProfiles(value);
 const enabled=value.enabledRobotIds??[value.robotId??'robot'];
 if(!Array.isArray(enabled)||!enabled.length||new Set(enabled).size!==enabled.length||enabled.some(id=>!registered.some(robot=>robot.id===id)))return '请至少选择一台生效的机械臂。';
 const robots=registered.map(device=>device.configuration);
 const coarse=[coarseCamera,...additional.filter(device=>device.type==='coarseCamera').map(device=>device.configuration)];
 if(![...robots,...coarse,...['weijing','yinglai'].map(key=>precisionCamera.profiles?.[key])].every(connection))
  return '请检查设备型号、地址和端口。端口应为 1–65535 的整数。';
 for(const config of robots){
  if(!text(config.workingRange??'',160)||!number(config.reach,0)||!number(config.externalTravel,0))return '请检查设备详情。臂展和有效行程须为非负数。';
  if(config.mounting!==undefined&&!ROBOT_MOUNTING_OPTIONS.some(([mode])=>mode===config.mounting))return '请选择有效的机器人安装方式。';
  if(config.laserMountSide!==undefined&&!LASER_MOUNT_SIDES.some(([side])=>side===config.laserMountSide))return '请选择有效的线激光安装侧。';
  const modes=config.trackingModes;
  if(!Array.isArray(modes)||new Set(modes).size!==modes.length||modes.some(mode=>!DEVICE_TRACKING_MODES.some(([key])=>key===mode)))return '焊缝跟踪方式无效。';
 }
 if(coarse.some(config=>!text(config.brand)||!['auto','manual'].includes(config.scanMode)||!number(config.scanStart)||!number(config.scanEnd)))
  return '请检查粗定位扫描位置。';
 const id=precisionCamera.profiles.yinglai.id;
 if(id!==null&&(!Number.isInteger(id)||id<0))return '线激光设备 ID 须为非负整数。';
 return '';
}
