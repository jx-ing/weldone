export const PROCESS_TYPES={standard:'常规',inner:'内角',outer:'外角'};
export const PROCESS_CATEGORIES=[
 {id:'fillet',name:'角焊缝',joints:['T 形接头','角接头']},
 {id:'lap',name:'搭接焊缝',joints:['搭接接头']},
];
export function processCategory(p){return PROCESS_CATEGORIES.find(c=>p.weldForms?.length?p.weldForms.includes(c.name):c.joints.includes(p.joint))?.id||'other';}
export const processType=p=>PROCESS_TYPES[p.processType||'standard']||'常规';
export const processPositionLabel=value=>value?.startsWith('PB')?'平角焊':(value?.startsWith('PF')||value?.startsWith('PG'))?'立焊':value?.split(' · ')[1]||value||'待补充';
export const processWeldType=p=>(p.processLayers?.length||1)===1&&(p.processLayers?.reduce((n,l)=>n+l.passes.length,0)||1)===1?'single':'multi';
export function queryProcesses(entries,category,filters,sort){
 let rows=entries.filter(p=>(p.weldForms?.length?p.weldForms.includes(PROCESS_CATEGORIES.find(c=>c.id===category)?.name):processCategory(p)===category)&&(!filters.joint||(p.joints?.length?p.joints:[p.joint]).includes(filters.joint))&&(!filters.arcTracking||String(p.arcTracking??false)===filters.arcTracking)&&(!filters.machineMode||(p.processLayers?.flatMap(layer=>layer.passes)??[p]).some(pass=>pass.machineMode===filters.machineMode))&&(!filters.name||p.name.toLowerCase().includes(filters.name.trim().toLowerCase()))&&(!filters.type||(p.processType||'standard')===filters.type)&&(!filters.position||p.position===filters.position)&&(!filters.leg||String(p.leg)===filters.leg)&&(!filters.groove||grooveType(p.groove?.type)===grooveType(filters.groove))&&(!filters.weldType||processWeldType(p)===filters.weldType));
 const value=(p,key)=>key==='type'?processType(p):key==='groove'?p.groove?.type||'':key==='passes'?p.processLayers?.reduce((n,l)=>n+l.passes.length,0)||1:p[key]??'';
 if(sort?.key)rows=[...rows].sort((a,b)=>{const av=value(a,sort.key),bv=value(b,sort.key),n=['leg','passes'].includes(sort.key)?Number(av)-Number(bv):String(av).localeCompare(String(bv),'zh-CN',{numeric:true});return sort.direction==='desc'?-n:n;});return rows;
}
import {grooveType} from './grooveModel.mjs';
