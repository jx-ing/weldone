import {syncControlPoints} from './templatePointAnchors.mjs';
const uid=()=>crypto.randomUUID();
export function clonePassPoints(points) {
  const ids=new Map(points.map(p=>[p.id,uid()]));
  return points.map(p=>({...structuredClone(p),id:ids.get(p.id),...(p.referenceId!==undefined?{referenceId:ids.get(p.referenceId)||''}:{})}));
}
export function ensureLayers(t) {
  const layers=t.layers===undefined?[{id:uid(),name:'第 1 层',height:0,passes:[{id:uid(),name:'第 1 道',offset:{y:0,z:0},points:t.points}]}]:t.layers;
  if(!Array.isArray(layers)||!layers.length||layers.some(l=>!Array.isArray(l.passes)||!l.passes.length))throw Error('每个模板至少需要一层，每层至少需要一道');
  return {...t,layers:layers.map((layer,i)=>({...layer,passes:layer.passes.map((pass,j)=>({...pass,points:i===0&&j===0?t.points:syncControlPoints({...t,points:pass.points}).points}))}))};
}
export function updatePass(t,id,values) {
  const layers=t.layers.map(l=>({...l,passes:l.passes.map(p=>p.id===id?{...p,...values}:p)}));
  return {...t,layers,points:layers[0].passes[0].points};
}
export function addPass(t,layerId,sourceId) {
  const source=t.layers.flatMap(l=>l.passes).find(p=>p.id===sourceId)||t.layers[0].passes[0];
  return {...t,layers:t.layers.map(l=>{if(l.id!==layerId)return l;let n=1;while(l.passes.some(p=>p.name===`第 ${n} 道`))n++;return {...l,passes:[...l.passes,{...structuredClone(source),id:uid(),name:`第 ${n} 道`,offset:{y:0,z:0},points:clonePassPoints(source.points)}]};})};
}
export function addLayer(t,sourceId) {
  const source=t.layers.flatMap(l=>l.passes).find(p=>p.id===sourceId)||t.layers[0].passes[0];
  let n=1;while(t.layers.some(l=>l.name===`第 ${n} 层`))n++;
  return {...t,layers:[...t.layers,{id:uid(),name:`第 ${n} 层`,height:0,passes:[{...structuredClone(source),id:uid(),name:'第 1 道',offset:{y:0,z:0},points:clonePassPoints(source.points)}]}]};
}
export function removePass(t,layerId,passId) {
  const layers=t.layers.map(l=>l.id===layerId?{...l,passes:l.passes.length>1?l.passes.filter(p=>p.id!==passId):l.passes}:l);
  return {...t,layers,points:layers[0].passes[0].points};
}
export function removeLayer(t,layerId) {
  if(t.layers.length===1)return t;const layers=t.layers.filter(l=>l.id!==layerId);return {...t,layers,points:layers[0].passes[0].points};
}
