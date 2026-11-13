import {captureFrame,captureCorners} from './templateCaptureRange.mjs';
import {defaultPlanningTemplateName,geometryRulesFromWeld,shortSegmentRange} from './templateGeometryRules.mjs';
import {targetFromWeld,newWholeTemplateFromWeld} from './templateModel.mjs';
import {validStepModel} from './stepModelStore.mjs';

export function weldRegionBounds(weld,origin=[0,0,0],modelSpan=1000,range){
 const points=weld?.segments?.flatMap(segment=>segment.pathPoints||[]);
 if(!points?.length||points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v))))throw Error('所选焊缝缺少有效模型路径，无法截取封面');
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(const point of points)for(let i=0;i<3;i++){low[i]=Math.min(low[i],point[i]);high[i]=Math.max(high[i],point[i]);}
 const diagonal=Math.hypot(...high.map((v,i)=>v-low[i]));
 if(diagonal<=0)throw Error('所选焊缝路径长度无效');
 const margin=Math.max(diagonal*.25,Math.min(modelSpan*.02,100),(weld.leg||0)*5,10);
 const frame=range?captureFrame(weld.segments,points,range):undefined;
 const corners=frame?captureCorners(frame):null;
 const cad=corners?{
  min:low.map((_,i)=>Math.min(...corners.map(p=>p[i]))),
  max:high.map((_,i)=>Math.max(...corners.map(p=>p[i])))
 }:{min:low.map(v=>v-margin),max:high.map(v=>v+margin)};
 return {cad,frame,world:{min:[cad.min[0]-origin[0],cad.min[2]-origin[2],origin[1]-cad.max[1]],max:[cad.max[0]-origin[0],cad.max[2]-origin[2],origin[1]-cad.min[1]]}};
}
export function validTemplateCover(cover,source){
 return !!cover&&cover.kind==='weld-model-region'&&cover.width===640&&cover.height===400&&typeof cover.dataUrl==='string'&&cover.dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo')&&cover.dataUrl.length<750000&&cover.model===source?.model&&cover.weldId===source?.id&&Array.isArray(cover.parts)&&cover.parts.length>0&&cover.bounds?.min?.length===3&&cover.bounds?.max?.length===3&&cover.bounds.min.every((v,i)=>Number.isFinite(v)&&Number.isFinite(cover.bounds.max[i])&&v<cover.bounds.max[i]);
}
export function newPlanningTemplate(model,welds,weldId,cover,captureRange,neighborhood,stepModel,options){
 const template=newWholeTemplateFromWeld(model,welds,weldId,undefined,options);
 if(!validTemplateCover(cover,template.sourceWeld))throw Error('请在工艺规划中截取所选焊缝域模型后创建模板');
 if(stepModel){
  if(!validStepModel(stepModel))throw Error('来源 STEP 模型引用无效');
  template.sourceWeld.stepModel={sourceSha256:stepModel.sourceSha256};
 }
 const weld=targetFromWeld(welds.find(value=>value.id===weldId),options);
 return {...template,name:defaultPlanningTemplateName(weld),mode:'standard',requirementsMatch:geometryRulesFromWeld(weld,captureRange,neighborhood),segments:template.segments.map(({endpointFacts,edgeDistance,mainEdgeStart,mainEdgeEnd,laserTrackingClearance,...segment})=>({...segment,...shortSegmentRange(segment)})),createdFrom:'process-planning',cover:structuredClone(cover)};
}
