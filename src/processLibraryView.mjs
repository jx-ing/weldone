import {processWeldForms} from './planningRequirements.mjs';
import {grooveType,grooveValue} from './grooveModel.mjs';

export const PROCESS_TYPES={standard:'常规',inner:'内角',outer:'外角'};
export const PROCESS_CATEGORIES=[
 {id:'fillet',name:'角焊缝'},
 {id:'lap',name:'搭接焊缝'},
];
export function processCategory(p){return PROCESS_CATEGORIES.find(c=>processWeldForms(p).includes(c.name))?.id||'other';}
export function processInCategory(p,category){const name=PROCESS_CATEGORIES.find(c=>c.id===category)?.name;return name?processWeldForms(p).includes(name):processCategory(p)==='other';}
export const processType=p=>PROCESS_TYPES[p.processType||'standard']||'常规';
export const processPositionLabel=value=>value?.startsWith('PB')?'平角焊':(value?.startsWith('PF')||value?.startsWith('PG'))?'立焊':value?.split(' · ')[1]||value||'待补充';
export const processWeldType=p=>(p.processLayers?.length||1)===1&&(p.processLayers?.reduce((n,l)=>n+l.passes.length,0)||1)===1?'single':'multi';
export function queryProcesses(entries,category,filters,sort){
 const matchingKeys=['weldForm','position','leg','groove','weldType','arcTracking','machineMode','layerCount','passCount','angle','depth','rootGap','rootRadius','rootFace'];
 const name=matchingKeys.some(key=>filters[key])?'':filters.name?.trim().toLowerCase();
 let rows=entries.filter(p=>processInCategory(p,filters.weldForm||category)&&(!filters.arcTracking||String(p.arcTracking??false)===filters.arcTracking)&&(!filters.machineMode||(p.processLayers?.flatMap(layer=>layer.passes)??[p]).some(pass=>pass.machineMode===filters.machineMode))&&(!name||p.name.toLowerCase().includes(name))&&(!filters.type||(p.processType||'standard')===filters.type)&&(!filters.position||p.position===filters.position)&&(!filters.leg||String(p.leg)===filters.leg)&&(!filters.groove||grooveType(p.groove?.type)===grooveType(filters.groove))&&(!filters.weldType||processWeldType(p)===filters.weldType)
  &&(!filters.layerCount||Number(filters.layerCount)===(p.processLayers?.length||1))
  &&(!filters.passCount||Number(filters.passCount)===(p.processLayers?.reduce((sum,layer)=>sum+layer.passes.length,0)||1))
  &&['angle','depth','rootGap','rootRadius','rootFace'].every(key=>!filters[key]||Number(filters[key])===grooveValue(p.groove,key)));
 const value=(p,key)=>key==='type'?processType(p):key==='groove'?p.groove?.type||'':key==='passes'?p.processLayers?.reduce((n,l)=>n+l.passes.length,0)||1:p[key]??'';
 if(sort?.key)rows=[...rows].sort((a,b)=>{const av=value(a,sort.key),bv=value(b,sort.key),n=['leg','passes'].includes(sort.key)?Number(av)-Number(bv):String(av).localeCompare(String(bv),'zh-CN',{numeric:true});return sort.direction==='desc'?-n:n;});return rows;
}
