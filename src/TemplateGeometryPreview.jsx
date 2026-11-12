import React,{useMemo} from 'react';
import TemplateModelEditor from './TemplateModelEditor';
import {interpolate,vectorBetween} from './templateCaptureRange.mjs';
import {measureDistanceInterval} from './templateDistanceProfile.mjs';
import {validTemplateCover} from './templateCoverModel.mjs';

function cornerArm(points){
 const start=points[0],arm=[start];
 let remaining=15;
 for(let i=1;i<points.length&&remaining>0;i++){
  const length=Math.hypot(...vectorBetween(points[i-1],points[i]));
  if(length>remaining){arm.push(interpolate(points[i-1],points[i],remaining/length));break;}
  arm.push(points[i]);
  remaining-=length;
 }
 return arm;
}

function selectedGeometry(segments,distances,evidence,feature){
 if(!feature)return null;
 const [kind,index,key,intervalIndex]=feature.split(':');
 if(kind==='segment'){
  const segment=segments[Number(index)];
  if(!segment)return null;
  const data=evidence?.segments[Number(index)];
  const solid=key==='gap';
  const rule=distances?.[Number(index)]?.[solid?'solidGap':'baseplateEdge'];
  if(key==='edgeDistance'||solid&&rule){
   const profile=solid?data?.solidGap:data?.baseplate;
   if(rule?.mode==='continuous'){
    const intervals=intervalIndex===undefined?rule.intervals:[rule.intervals[Number(intervalIndex)]].filter(Boolean);
    const paths=intervals.flatMap(interval=>{
     const result=measureDistanceInterval(profile,interval.start,interval.end,true);
     if(!result)return [];
     const portion=[];
     let s=0;
     for(let i=1;i<segment.pathPoints.length;i++){
      const a=segment.pathPoints[i-1],b=segment.pathPoints[i],length=Math.hypot(...vectorBetween(a,b));
      if(length===0)continue;
      if(s+length>interval.start&&s<interval.end){
       if(!portion.length)portion.push(interpolate(a,b,Math.max(0,(interval.start-s)/length)));
       portion.push(interpolate(a,b,Math.min(1,(interval.end-s)/length)));
      }
      s+=length;
     }
     return [portion,...result.witnesses.map(hit=>[hit.from,hit.to])];
    });
    return {paths,points:[]};
   }
   const hit=profile?.nearest;
   return hit?{paths:[[hit.from,hit.to]],points:[hit.from,hit.to]}:{paths:[segment.pathPoints],points:[]};
  }
  const measurement=data?.gap;
  return {paths:[segment.pathPoints,...(key!=='geometry'&&measurement?[[measurement.from,measurement.to]]:[])],
   points:key!=='geometry'&&measurement?[measurement.to]:[]};
 }
 if(kind==='corner'){
  const before=segments[Number(index)],after=segments[Number(index)+1];
  if(!before||!after)return null;
  return {paths:[cornerArm([...before.pathPoints].reverse()),cornerArm(after.pathPoints)],points:[before.pathPoints.at(-1)]};
 }
 const point=kind==='start'?segments[0].pathPoints[0]:segments.at(-1).pathPoints.at(-1);
 const end=evidence?.[kind];
 const hit=index==='gap'||index==='edgeDistance'?end?.[index]:null;
 return {
  points:[point,...(index==='holeSize'?end?.holeBoundary??[]:hit?[hit.to]:[])],
  paths:hit?[[hit.from,hit.to]]:[]
 };
}

export default function TemplateGeometryPreview({template,evidence,feature,onCaptureReady,children}){
 const distances=template.requirementsMatch?.segmentDistances;
 const highlight=useMemo(()=>selectedGeometry(template.segments,distances,evidence,feature),[template.segments,distances,evidence,feature]);
 return <section className="template-geometry-preview" aria-label="局部焊缝模型" data-feature={feature??undefined} data-capture-range={JSON.stringify(template.requirementsMatch?.captureRange)}>
  <h3>局部焊缝模型</h3>
  <TemplateModelEditor template={template} previewOnly highlight={highlight} onCaptureReady={onCaptureReady}
   fallbackCover={validTemplateCover(template.cover,template.sourceWeld)?template.cover.dataUrl:undefined}/>
  {children}
 </section>;
}
