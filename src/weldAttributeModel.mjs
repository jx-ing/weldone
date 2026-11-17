import {grooveType} from './grooveModel.mjs';
export const WELD_TYPES=['角焊缝','搭接焊缝','对接焊缝'];
const precisionMethods=[['laserSweep','线激光推扫','laserPrecision'],['lineIntersection','打线求交','laserPrecision'],
 ['fixedPhoto','定点拍照','structuredLightPrecision'],['manual','手动精定位'],['continuous','连续扫描','laserPrecision'],['separateEnds','首尾分别设置']];
export function weldPrecisionOptions(capabilities={},endpoint=false){
 return precisionMethods.filter(([method,,capability])=>(!endpoint||method!=='separateEnds')&&
  (!capability||capabilities[capability]===true)).map(([method,label])=>[method,label]);
}
export function weldPrecisionMethod(scan={},capabilities={}){
 if(weldPrecisionOptions(capabilities).some(([method])=>method===scan.precisionMethod))return scan.precisionMethod;
 if(capabilities.structuredLightPrecision===true)return 'fixedPhoto';
 return capabilities.laserPrecision===true?'laserSweep':'';
}
export function weldMeasurementCapabilities(weld,settings={}){
 const robot=weld?.assignedRobot??settings.planningRobots?.[0]?.id;
 const installed=settings.precisionByRobot?.[robot];
 return installed?{...settings.deviceCapabilities,...installed}:settings.deviceCapabilities;
}
export function workFacesForType(type){return type==='小组立'?['上','下']:['中组立','护板'].includes(type)?['上']:[];}
export function patchWeldGroup(weld,key,value){return weld.segments.map(segment=>({...segment,[key]:value}));}
export function patchWeldSegment(weld,index,key,value){return weld.segments.map((segment,i)=>i===index?{...segment,[key]:value}:segment);}
export function patchWeldGroove(weld,key,value){
 const groove={type:'无坡口',angle:0,depth:0,rootGap:0,rootRadius:0,...weld.groove,[key]:value};
 if(key==='type'&&grooveType(value)==='无坡口')return {...groove,angle:0,depth:0,rootGap:0,rootRadius:0,rootFace:0};
 return groove;
}
export const segmentName=(weld,index)=>weld.segments.length===1?weld.id:`${weld.id} · 第${index+1}段`;
