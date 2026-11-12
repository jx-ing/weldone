import {directedWeld} from './weldDirectionGeometry.mjs';
import {applyTemplateToWeld,targetFromWeld,TRACKING,OVERRIDES,uid} from './templateModel.mjs';
import {analyzeWeldMatch} from './weldMatching.mjs';
import {Euler,Quaternion} from 'three';
import {resolvePassPoint,passOffsetValues} from './templatePassOffsets.mjs';
import {clonePassPoints} from './templateLayers.mjs';
import {previewPath} from './weldPathGeometry.mjs';

const xyz=value=>Array.isArray(value)?[...value]:value&&[value.x,value.y,value.z];
const validPosition=position=>position?.length===3&&position.every(Number.isFinite);
const axes=['x','y','z'];
const poseAxes=['advance','work','rotation'];
const radians=Math.PI/180;
const localRotation=pose=>new Quaternion().setFromEuler(new Euler(
 (pose.work??0)*radians,(pose.advance??0)*radians,(pose.rotation??0)*radians,'XYZ'
));
function editablePoint(point,key,weld){
 if(!validPosition(point.position))return point;
 const overrideKey=JSON.stringify([key,point.kind,point.distance,point.position]);
 const override=weld.planningPointOverrides?.[overrideKey]??{};
 const original=point.pose??point.angles??{};
 const pose={...original};
 for(const axis of poseAxes)if(Number.isFinite(override[axis]))pose[axis]=override[axis];
 const position=point.position.map((value,index)=>value+(Number.isFinite(override[axes[index]])?override[axes[index]]:0));
 const orientation=Array.isArray(point.orientation)&&poseAxes.some(axis=>Number.isFinite(override[axis]))?
  new Quaternion().fromArray(point.orientation).multiply(localRotation(original).invert()).multiply(localRotation(pose)).toArray():point.orientation;
 return {...point,overrideKey,override,originalPose:original,position,pose,...(orientation?{orientation}:{})};
}
export function weldPlanningPointGroups(weld,decision,templates=[],processLibrary=[],options={}){
 if(!weld?.segments?.length)return [];
 const path=directedWeld(weld),segments=path.segments,anchors=[];
 const add=(kind,name,index,position)=>anchors.push({id:`${weld.id}:weld:${kind}:${index}`,name,kind,source:'weld',segment:(path.sourceSegmentIndices?.[index]??index)+1,position:validPosition(position)?[...position]:null});
 add('start','起点',0,segments[0].pathPoints?.[0]);
 segments.slice(0,-1).forEach((segment,index)=>add('junction','段连接点'+(index+1),index,segment.pathPoints?.at(-1)));
 add('end','终点',segments.length-1,segments.at(-1).pathPoints?.at(-1));
 const groups=[{id:weld.id+':weld',name:'当前焊道',points:anchors}];
 if(options.includeStrategyPoints!==false&&weld.planned&&weld.strategyPlan?.passes){
  for(const pass of weld.strategyPlan.passes){
   const id=`${weld.id}:strategy:${pass.layerIndex}:${pass.passIndex}`;
   groups.push({id,name:`策略规划 · 第${pass.layerIndex+1}层 / 第${pass.passIndex+1}道`,points:pass.points.map((point,index)=>editablePoint(
    {...point,id:id+':'+index,source:'strategy',layerIndex:pass.layerIndex,passIndex:pass.passIndex},
    ['strategy',pass.layerIndex,pass.passIndex,index],weld
   ))});
  }
  return groups;
 }
 const match=decision||analyzeWeldMatch(weld,templates,processLibrary,options);
 const matches=match.whole?[{template:match.whole,target:weld,key:'whole'}]:(match.locals||[]).map((window,index)=>({...window,key:'local:'+index}));
 for(const {template,target,key,segmentIndices} of matches){
  let applied;try{applied=applyTemplateToWeld(target,template,options);}catch{continue;}
  applied.layers.forEach((layer,layerIndex)=>layer.passes.forEach((pass,passIndex)=>{
   const groupId=`${weld.id}:${key}:${template.id}:${layer.id}:${pass.id}`;
   groups.push({id:groupId,name:`${template.name} · 第${layerIndex+1}层 / 第${passIndex+1}道`,templateName:template.name,layerId:weld.id+':'+key+':'+template.id+':'+layer.id,layerName:layer.name,passName:pass.name,layerHeight:layer.height,passOffset:pass.offset,points:pass.controlPoints.map(point=>{const position=xyz(point.position);return editablePoint({...point,id:groupId+':'+point.id,originalId:point.id,source:'template',templateName:template.name,layerIndex,passIndex,segment:segmentIndices?segmentIndices[(point.actualSegment||point.segment)-1]+1:point.originalSegment||point.actualSegment||point.segment,position:validPosition(position)?position:null},[key,template.id,layer.id,pass.id,point.id],weld);})});
  }));
 }
 return groups;
}

export function weldControlPointError(point,anchors){
 if(!point.name?.trim()||point.name.trim().length>40)return '请输入不超过 40 个字符的点位名称';
 if(!anchors.some(anchor=>anchor.id===point.referenceId&&validPosition(anchor.position)))return '请选择有模型坐标的基准点';
 if(!axes.every(axis=>Number.isFinite(point.offset?.[axis])))return '请输入有效的 XYZ 偏移';
 if(!poseAxes.every(axis=>Number.isFinite(point.angles?.[axis])&&Math.abs(point.angles[axis])<=360))return '姿态角度须在 −360° 至 360° 之间';
 if(!TRACKING.includes(point.tracking))return '请选择有效的跟踪方式';
 if(Object.entries(point.overrides??{}).some(([key,value])=>!Object.hasOwn(OVERRIDES,key)||!Number.isFinite(value)||value<OVERRIDES[key][2]))return '请输入有效的工艺覆盖值';
 return '';
}

export function weldPointTreeGroups(weld,decision,templates,processLibrary,options){
 const groups=weldPlanningPointGroups(weld,decision,templates,processLibrary,{...options,includeStrategyPoints:false});
 if(!groups.length)return groups;
 const root=groups[0];
 if(groups.length===1){
  const layers=(weld.processParameters??decision?.process)?.processLayers;
  for(const [layerIndex,layer] of (layers??[]).entries()){
   const layerId=weld.id+':process:'+layer.id;
   for(const [passIndex,pass] of layer.passes.entries())groups.push({
    id:layerId+':'+pass.id,layerId,layerName:layer.name||('第 '+(layerIndex+1)+' 层'),
    passName:pass.name||('第 '+(passIndex+1)+' 道'),layerHeight:layer.height??0,passOffset:pass.offset,points:[],
   });
  }
 }
 const records=Array.isArray(weld.manualControlPoints)?weld.manualControlPoints:[];
 if(!records.length)return groups;
 const target=targetFromWeld(weld);
 const anchors=root.points.map((anchor,index)=>({...anchor,segment:Math.max(1,index),percent:anchor.kind==='start'?0:100}));
 const path=previewPath(target.segments,'xy',[],target.closure);
 const copied=new Set(groups.flatMap(group=>group.points.map(point=>point.sourceWeldPointId).filter(Boolean)));
 for(const point of records){
  if(copied.has(point?.id))continue;
  if(!point||typeof point.id!=='string'||typeof point.name!=='string')continue;
  const group=groups.find(item=>item.id===point.groupId)??root;
  const reference=anchors.find(anchor=>anchor.id===point.referenceId);
  const result={...point,source:'manual',referenceName:reference?.name,position:null,pose:point.angles};
  if(reference&&!weldControlPointError(point,anchors)){
   const resolved=resolvePassPoint(target,point,[...anchors,point],group.passOffset,group.layerHeight,path);
   result.position=validPosition(resolved.position)?resolved.position:null;
   result.pose=resolved.angles;
   result.distance=resolved.distance;
  }
  group.points.push(result);
 }
 return groups;
}

export function includeWeldControlPoints(template,weld,groups){
 const anchors=groups[0]?.points.filter(point=>point.source==='weld')??[];
 const records=(Array.isArray(weld.manualControlPoints)?weld.manualControlPoints:[]).filter(point=>
  point&&typeof point.name==='string'&&!weldControlPointError(point,anchors)
 );
 if(!records.length)return template;
 const selectedPasses=groups.filter(group=>group.layerId&&records.some(point=>point.groupId===group.id));
 const passes=selectedPasses.length?selectedPasses:[{id:groups[0]?.id,layerName:'第 1 层',passName:'第 1 道',layerHeight:0}];
 const layerMap=new Map();
 for(const [index,group] of passes.entries()){
  if(!layerMap.has(group.layerId))layerMap.set(group.layerId,{id:uid(),name:group.layerName,height:group.layerHeight??0,passes:[]});
  const points=clonePassPoints(template.points);
  for(const record of records){
   const groupExists=selectedPasses.some(pass=>pass.id===record.groupId);
   if(groupExists?record.groupId!==group.id:index!==0)continue;
   const anchorIndex=anchors.findIndex(anchor=>anchor.id===record.referenceId);
   const anchor=anchors[anchorIndex];
   const reference=points.find(point=>point.kind===anchor.kind&&point.segment===Math.max(1,anchorIndex));
   if(!reference)continue;
   const {groupId,...point}=record;
   points.push({...structuredClone(point),id:uid(),sourceWeldPointId:record.id,referenceId:reference.id,segment:reference.segment,percent:reference.percent});
  }
  layerMap.get(group.layerId).passes.push({id:uid(),name:group.passName,offset:passOffsetValues(group.passOffset),points});
 }
 const layers=[...layerMap.values()];
 return {...template,layers,points:layers[0].passes[0].points};
}
