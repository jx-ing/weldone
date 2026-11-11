import {validateProcessEntry,copyProcessEntry} from './processParameterModel.mjs';
import {belongsToDevice,migrateProcessPasses} from './planningRequirements.mjs';
import {validDeviceProfileStore} from './processDeviceModel.mjs';
import {normalizeActiveDevices} from './processDeviceLibraries.mjs';
export function mergeProcessLibrary(entries,data){const incoming=Array.isArray(data)?data:data?.entries;if(!Array.isArray(incoming)||incoming.length>1000||incoming.some(p=>!p||typeof p!=='object'||validateProcessEntry(p,{allowLegacyLeg:true}).length))throw Error('文件中的工艺参数不完整或格式无效');const next=structuredClone(entries.map(migrateProcessPasses)),ids=new Map(next.map(p=>[p.id,p]));for(const value of incoming){const p=structuredClone(migrateProcessPasses(value));if(!ids.has(p.id)){next.push(p);ids.set(p.id,p);}else if(JSON.stringify(ids.get(p.id))!==JSON.stringify(p)){const copy=copyProcessEntry(p);next.push(copy);ids.set(copy.id,copy);}}if(next.length>1000)throw Error('工艺参数总数不能超过1000');return next;}

export function exportDeviceLibrary(entries,profile){
 return {format:'weldone.process-library',version:2,device:structuredClone(profile),entries:entries.filter(value=>belongsToDevice(value,profile)).map(migrateProcessPasses)};
}

export function importDeviceLibraries(entries,profiles,documents){
 let processLibrary=entries, processDeviceProfiles=structuredClone(profiles);
 for(const document of documents){
  if(document?.format!=='weldone.process-library'||![1,2].includes(document.version))throw Error('请选择工艺参数库文件');
  if(document.version===2){
   const device=document.device;
   if(!validDeviceProfileStore([device])||!Array.isArray(document.entries)||document.entries.some(entry=>!belongsToDevice(entry,device)))throw Error('设备信息或工艺参数库归属无效');
   const previous=processDeviceProfiles.find(profile=>profile.id===device.id);
   if(previous&&JSON.stringify(previous.applicability)!==JSON.stringify(device.applicability))throw Error('导入设备编号已存在，且设备信息不同');
   if(!previous)processDeviceProfiles.push({...device,enabled:false});
  }
  processLibrary=mergeProcessLibrary(processLibrary,document);
 }
 return {processLibrary,processDeviceProfiles:normalizeActiveDevices(processDeviceProfiles)};
}
