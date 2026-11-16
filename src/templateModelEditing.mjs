import {pathLength,pathGeometry} from './manualWeldModel.mjs';
import {directedWeld} from './weldDirectionGeometry.mjs';
import {reconcileTemplateGeometry} from './templateModel.mjs';
import {isDemoModel,validStepModel} from './stepModelStore.mjs';

export function hasTemplateModelPath(template){
 const source=template.sourceWeld;
 return !!source&&(isDemoModel(source)||validStepModel(source.stepModel))&&
  !!template.segments?.length&&template.segments.every(segment=>segment.pathPoints?.length>=2);
}
export function templatePathNodes(template){
 if(!hasTemplateModelPath(template))return [];
 const nodes=[{index:0,name:template.closure==='closed'?'闭合连接点':'起点',position:[...template.segments[0].pathPoints[0]]},...template.segments.slice(0,-1).map((segment,index)=>({index:index+1,name:`段连接点${index+1}`,position:[...segment.pathPoints.at(-1)]}))];
 if(template.closure!=='closed')nodes.push({index:template.segments.length,name:'终点',position:[...template.segments.at(-1).pathPoints.at(-1)]});
 return nodes;
}
export function templateGeometrySnapshot(template){return structuredClone({segments:template.segments,corners:template.corners,cornerCount:template.cornerCount,cornerReferenceNormal:template.cornerReferenceNormal,pathEditedIn3d:template.pathEditedIn3d});}
export function restoreTemplateGeometry(template,snapshot){return reconcileTemplateGeometry({...template,...structuredClone(snapshot)});}
export function moveTemplatePathNode(template,index,position){
 const node=templatePathNodes(template).find(node=>node.index===index);
 if(!node||position.length!==3||!position.every(Number.isFinite))throw Error('请选择有效焊缝点并填写有限的XYZ坐标');
 const delta=position.map((v,i)=>v-node.position[i]),count=template.segments.length;
 const segments=template.segments.map((segment,i)=>{
  const start=i===index,end=i+1===index||(template.closure==='closed'&&index===0&&i===count-1);
  if(!start&&!end)return segment;
  const total=pathLength(segment.pathPoints);let at=0;
  const points=segment.pathPoints.map((point,j)=>{if(j)at+=Math.hypot(...point.map((v,k)=>v-segment.pathPoints[j-1][k]));const t=at/total,weight=(start?1-t:0)+(end?t:0);return point.map((v,k)=>v+delta[k]*weight);});
  const length=pathLength(points);if(length<.1)throw Error('修改后焊缝段长度不能小于0.1 mm');
  const shape=pathGeometry(points);if(template.closure!=='closed'&&shape.geometry==='圆弧')shape.geometry='曲线';
  return {...segment,...shape,shape:shape.shape,pathPoints:points,length:Math.round(length*10000)/10000};
 });
 if(template.closure!=='closed'&&Math.hypot(...segments[0].pathPoints[0].map((v,i)=>v-segments.at(-1).pathPoints.at(-1)[i]))<.1)throw Error('开放焊缝起点和终点不能重合');
 const directed=directedWeld({segments,cornerAngles:template.corners.map(c=>c.standard),cornerReferenceNormal:template.cornerReferenceNormal});
 if(directed.cornerDirections.some(corner=>!Number.isFinite(corner.angle)))throw Error('当前修改不能形成有效的焊缝连接角');
 const corners=template.corners.map((corner,i)=>({...corner,...(directed.cornerDirections[i]?.angle!==undefined?{standard:directed.cornerDirections[i].angle,angleSide:directed.cornerDirections[i].angleSide}: {})}));
 return reconcileTemplateGeometry({...template,segments,corners,pathEditedIn3d:true});
}
