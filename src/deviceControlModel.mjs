export const DEVICE_TRACKING_MODES=[['arc','电弧跟踪'],['laser','激光跟踪']];
export const PRECISION_CAMERA_BRANDS=[['weijing','伟景'],['yinglai','英莱线激光']];

const camera=()=>({brand:'',model:'',address:'',port:null});

export function migrateDeviceControl(legacy,capabilities={}){
 const laser=legacy?.precisionCameras?.laser,structure=legacy?.precisionCameras?.structuredLight;
 const brand=laser?.enabled&&!structure?.enabled||!legacy?.precisionCameras&&capabilities.structuredLightPrecision===false&&capabilities.laserPrecision===true?'yinglai':'weijing';
 const trackingModes=legacy?.trackingModes??DEVICE_TRACKING_MODES.filter(([key])=>capabilities[key+'Tracking']!==false).map(([key])=>key);
 return {
  robot:{address:'',port:null,model:legacy?.robotModel??'',reach:null,workingRange:'',externalTravel:null,trackingModes:[...trackingModes],
   ...(legacy?.welderModel!==undefined?{welderModel:legacy.welderModel}:{}),
   ...(legacy?.wireType!==undefined?{wireType:legacy.wireType}:{})},
  coarseCamera:{...camera(),model:legacy?.coarseCameraModel??'',scanMode:'auto',scanStart:null,scanEnd:null},
  precisionCamera:{brand,profiles:{
   weijing:{model:structure?.model??'',address:'',port:null},
   yinglai:{model:laser?.model??'',address:'',port:null,id:null}
  }}
 };
}

export function deviceControlCapabilities(control){
 const modes=control.robot.trackingModes;
 return {arcTracking:modes.includes('arc'),laserTracking:modes.includes('laser'),
  structuredLightPrecision:control.precisionCamera.brand==='weijing',laserPrecision:control.precisionCamera.brand==='yinglai'};
}

export function deviceControlError(value){
 const {robot,coarseCamera,precisionCamera}=value??{};
 if(!robot||!coarseCamera||!precisionCamera||!PRECISION_CAMERA_BRANDS.some(([key])=>key===precisionCamera.brand))return '设备配置无效';
 const text=(v,max=80)=>typeof v==='string'&&v.length<=max;
 const port=v=>v===null||Number.isInteger(v)&&v>0&&v<=65535;
 const number=(v,min=-Infinity)=>v===null||Number.isFinite(v)&&v>=min;
 const connection=device=>device&&text(device.model)&&text(device.address,255)&&port(device.port);
 if(!connection(robot)||!connection(coarseCamera)||!PRECISION_CAMERA_BRANDS.every(([key])=>connection(precisionCamera.profiles?.[key])))return '请检查设备型号、地址和端口。端口应为 1–65535 的整数。';
 if(!text(robot.workingRange??'',160)||!text(coarseCamera.brand)||!number(robot.reach,0)||!number(robot.externalTravel,0))return '请检查设备详情。臂展和有效行程须为非负数。';
 if(!['auto','manual'].includes(coarseCamera.scanMode)||!number(coarseCamera.scanStart)||!number(coarseCamera.scanEnd))return '请检查粗定位扫描位置。';
 const id=precisionCamera.profiles.yinglai.id;
 if(id!==null&&(!Number.isInteger(id)||id<0))return '线激光设备 ID 须为非负整数。';
 const modes=robot.trackingModes;
 if(!Array.isArray(modes)||new Set(modes).size!==modes.length||modes.some(mode=>!DEVICE_TRACKING_MODES.some(([key])=>key===mode)))return '焊缝跟踪方式无效。';
 return '';
}
