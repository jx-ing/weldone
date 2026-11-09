import fs from 'node:fs/promises';import path from 'node:path';
import {loadModelData,prepareProcessedGeometryData,computeAllSplitsAsync,computeProcessedGeometryPlan} from '../src/vendor/geometry-engine.mjs';
globalThis.fetch=async input=>{const u=new URL(String(input),'http://localhost'),f=path.join(process.cwd(),'public',decodeURIComponent(u.pathname));try{return new Response(await fs.readFile(f),{headers:{'content-type':u.pathname.endsWith('.json')?'application/json':'application/octet-stream'}});}catch{return new Response('missing',{status:404});}};
const loaded=await loadModelData('/models/111-rules',undefined,{geometryOnly:true}),{data,splitWeldsData}=prepareProcessedGeometryData(loaded);
const splits=await computeAllSplitsAsync([splitWeldsData,data.mesh,data.partsData,data.edgesData,data.contactPairs,50,50,50],{budgetMs:100,onProgress:p=>{if(p.completed===p.total)console.log('splits',p.completed,p.total);}});
const plan=computeProcessedGeometryPlan(data,splits);
console.log('summary',JSON.stringify(plan.summary));console.log('raw',JSON.stringify({keys:Object.keys(data.weldsData.welds[0]),properties:data.weldsData.welds[0].properties.接头形式,position:data.weldsData.welds[0].properties.焊接位置,leg:data.weldsData.welds[0].properties.焊脚}));
console.log('unit',JSON.stringify(plan.merges.units.find(u=>!plan.merges.mergedUnitKeys.has(u.key))).slice(0,3500));console.log('group',JSON.stringify(plan.merges.groups[0]).slice(0,4000));
await fs.writeFile('artifacts/geometry-plan-inspect.json',JSON.stringify({summary:plan.summary,units:plan.merges.units,groups:plan.merges.groups,raw:data.weldsData.welds,splits:[...splits],hidden:[...plan.hiddenUnitKeys]}));
