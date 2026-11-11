import {directedWeld} from './weldDirectionGeometry.mjs';
import {applyTemplateToWeld} from './templateModel.mjs';
import {analyzeWeldMatch} from './weldMatching.mjs';
import {Euler,Quaternion} from 'three';

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
 if(weld.planned&&weld.strategyPlan?.passes){
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
  let applied;try{applied=applyTemplateToWeld(target,template);}catch{continue;}
  applied.layers.forEach((layer,layerIndex)=>layer.passes.forEach((pass,passIndex)=>{
   const groupId=`${weld.id}:${key}:${template.id}:${layer.id}:${pass.id}`;
   groups.push({id:groupId,name:`${template.name} · 第${layerIndex+1}层 / 第${passIndex+1}道`,templateName:template.name,points:pass.controlPoints.map(point=>{const position=xyz(point.position);return editablePoint({...point,id:groupId+':'+point.id,originalId:point.id,source:'template',templateName:template.name,layerIndex,passIndex,segment:segmentIndices?segmentIndices[(point.actualSegment||point.segment)-1]+1:point.originalSegment||point.actualSegment||point.segment,position:validPosition(position)?position:null},[key,template.id,layer.id,pass.id,point.id],weld);})});
  }));
 }
 return groups;
}
