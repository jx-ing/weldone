import React,{useMemo} from 'react';
import TemplateModelEditor from './TemplateModelEditor';
import {ENDPOINT_DIMENSIONS} from './templateGeometryRules.mjs';

const mm=value=>Number(value.toFixed(2))+' mm';

function geometryMarkers(template){
 const rules=template.requirementsMatch;
 const segments=template.segments;
 const markers=[['start','起点',segments[0]?.pathPoints?.[0]],['end','终点',segments.at(-1)?.pathPoints?.at(-1)]]
  .filter(([, ,position])=>position)
  .map(([key,label,position],index)=>{
   const facts=rules?.[key];
   const measurements=ENDPOINT_DIMENSIONS.flatMap(([dimension,name])=>{
    const value=facts?.[dimension]?.min;
    return Number.isFinite(value)?[name+' '+(dimension==='gap'?value.toFixed(1)+' mm':mm(value))]:[];
   });
   return {index,position,role:key,name:[label,facts?.type,...measurements].filter(Boolean).join(' · ')};
  });
 const value=rules?.edgeDistance?.min;
 if(Number.isFinite(value)){
  const path=(segments.find(segment=>segment.edgeDistance===value)??segments[0])?.pathPoints;
  if(path?.length>1){
   const i=Math.floor((path.length-1)/2);
   const position=path.length%2?path[i]:path[i].map((v,axis)=>(v+path[i+1][axis])/2);
   markers.push({index:2,position,role:'edge',name:'焊缝边缘距离 '+mm(value)});
  }
 }
 return markers;
}

export default function TemplateGeometryPreview({template}){
 const markers=useMemo(()=>geometryMarkers(template),[template]);
 const rules=template.requirementsMatch;
 return <section className="template-geometry-preview" aria-label="局部焊缝模型">
  <h3>局部焊缝模型</h3>
  <TemplateModelEditor template={template} featureMarkers={markers}/>
  {rules&&<p className="template-geometry-summary">{[rules.weldType,rules.machineCount===2?'双机焊接':'单机焊接'].join(' · ')}</p>}
 </section>;
}
