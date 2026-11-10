import {grooveType} from './grooveModel.mjs';
export const WELD_TYPES=['角焊缝','搭接焊缝','对接焊缝'];
export function workFacesForType(type){return type==='小组立'?['上','下']:['中组立','护板'].includes(type)?['上']:[];}
export function patchWeldGroup(weld,key,value){return weld.segments.map(segment=>({...segment,[key]:value}));}
export function patchWeldSegment(weld,index,key,value){return weld.segments.map((segment,i)=>i===index?{...segment,[key]:value}:segment);}
export function patchWeldGroove(weld,key,value){
 const groove={type:'无坡口',angle:0,depth:0,rootGap:0,rootRadius:0,...weld.groove,[key]:value};
 if(key==='type'&&grooveType(value)==='无坡口')return {...groove,angle:0,depth:0,rootGap:0,rootRadius:0,rootFace:0};
 return groove;
}
export const segmentName=(weld,index)=>weld.segments.length===1?weld.id:`${weld.id} · 第${index+1}段`;
