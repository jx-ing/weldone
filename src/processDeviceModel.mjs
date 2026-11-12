import {WIRE_TYPES,WIRE_DIAMETERS,SHIELD_GASES,MATERIALS} from './processParameterModel.mjs';

export const WELDER_BRAND_MODELS={'麦格米特':['Artsen pro 500 PR'],'林肯':['R450'],'松下':['YD-500GL5']};
export const ROBOT_BRAND_MODELS={Fanuc:['M-20iD/25']};
export const WELDER_MODELS=['Fronius TPS500i','Lincoln PowerWave R450','Panasonic YD500DP','OTC Daihen FD-V8','Megmeet Artsen II'];
export const ROBOT_MODELS=['KUKA KR10','ABB IRB1600','FANUC ARC Mate1200','YASKAWA MA1440','ESTUN ER10'];
export const PRECISION_CAMERA_TYPES=[['laser','线激光'],['structuredLight','结构光']];
export const DEVICE_TRACKING_MODES=[['arc','电弧跟踪'],['laser','激光跟踪']];
export const newDeviceHardware=()=>({
 coarseCameraModel:'',trackingModes:[],
 precisionCameras:Object.fromEntries(PRECISION_CAMERA_TYPES.map(([key])=>[key,{enabled:false,model:''}]))
});
export const deviceProfileName=value=>[value.welderModel,value.material,value.wireType?value.wireType.replace('焊丝','')+(value.wireDiameter||''):'',value.gas,value.robotModel].filter(Boolean).join('-').slice(0,40)||'新建设备信息';
const signature=value=>JSON.stringify(['welderModel','material','wireType','wireDiameter','gas','robotModel'].map(key=>value?.[key]??''));
export function newDeviceProfile(applicability={},enabled=false){
 const value={welderModel:'',material:'',wireType:'',wireDiameter:null,gas:'',method:'MAG',robotModel:'',deviceRemark:'',...structuredClone(applicability)};
 return {id:crypto.randomUUID(),name:deviceProfileName(value),enabled,automaticName:true,applicability:value};
}
export function initialDeviceProfiles(profiles,initial){
 const next=structuredClone(Array.isArray(profiles)?profiles:[]).filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&item.applicability&&typeof item.applicability==='object');
 if(initial?.welderModel&&!next.some(item=>item.id===initial.deviceProfileId||signature(item.applicability)===signature(initial))){
  const candidate=newDeviceProfile(initial,!next.some(item=>item.enabled));
  if(!validateDeviceProfiles([candidate]))next.push(candidate);
 }
 return next;
}
export function activeDeviceApplicability(profiles){
 const active=profiles.find(item=>item.enabled);
 return active?{...structuredClone(active.applicability),deviceProfileId:active.id,deviceProfileName:active.name}:null;
}
export function updateDeviceProfile(profiles,id,values){
 return profiles.map(item=>{if(item.id!==id)return values.enabled===true?{...item,enabled:false}:item;const next={...item,...values};if(values.applicability&&next.automaticName)next.name=deviceProfileName(next.applicability);return next;});
}
export function validateDeviceProfiles(profiles){
 if(profiles.filter(item=>item.enabled).length>1)return '只能启用一项设备信息';
 for(const item of profiles){
  if(!item.name.trim()||Array.from(item.name.trim()).length>40)return '设备信息名称须为 1–40 个字符';
  const hardware=item.hardware;
  if(hardware!==undefined){
   if(!hardware||typeof hardware!=='object'||Array.isArray(hardware))return '设备相机及跟踪信息无效';
   if(hardware.coarseCameraModel!==undefined&&(typeof hardware.coarseCameraModel!=='string'||hardware.coarseCameraModel.length>80))return '粗定位相机型号最多 80 个字符';
   const modes=hardware.trackingModes;
   if(modes!==undefined&&(!Array.isArray(modes)||new Set(modes).size!==modes.length||modes.some(mode=>!DEVICE_TRACKING_MODES.some(([key])=>key===mode))))return '设备支持的跟踪方式无效';
   if(hardware.precisionCameras!==undefined)for(const [key,label] of PRECISION_CAMERA_TYPES){
    const camera=hardware.precisionCameras?.[key];
    if(!camera||typeof camera.enabled!=='boolean'||typeof camera.model!=='string'||camera.model.length>80)return label+'精定位相机信息无效';
    if(camera.enabled&&!camera.model.trim())return '请填写'+label+'精定位相机型号';
   }
  }
  const a=item.applicability;
  if(a?.welderBrand&&!WELDER_BRAND_MODELS[a.welderBrand]?.includes(a.welderModel))return '请选择与焊机品牌对应的型号';
  if(a?.robotBrand&&!ROBOT_BRAND_MODELS[a.robotBrand]?.includes(a.robotModel))return '请选择与机器人品牌对应的型号';
  if(!a?.welderModel?.trim())return `请填写“${item.name}”的焊机品牌型号`;
  if(!MATERIALS.includes(a.material)||!WIRE_TYPES.includes(a.wireType)||!WIRE_DIAMETERS.includes(a.wireDiameter)||!SHIELD_GASES.includes(a.gas))return `请完善“${item.name}”的母材、焊丝和保护气体`;
  if(!a.robotModel?.trim())return `请填写“${item.name}”的机器人品牌型号`;
 }
 return '';
}
export function validDeviceProfileStore(profiles){
 try{return Array.isArray(profiles)&&profiles.length<=1000&&new Set(profiles.map(item=>item.id)).size===profiles.length&&profiles.every(item=>typeof item.id==='string'&&!!item.id&&typeof item.enabled==='boolean'&&typeof item.name==='string')&&!validateDeviceProfiles(profiles);}catch{return false;}
}
