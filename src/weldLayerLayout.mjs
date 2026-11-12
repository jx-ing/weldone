import {point,targetFromWeld,uid} from './templateModel.mjs';
import {clonePassPoints} from './templateLayers.mjs';
import {PASS_OFFSET_FIELDS,passOffsetValues,resolvePassPoint,validPassOffsets} from './templatePassOffsets.mjs';
import {previewPath} from './weldPathGeometry.mjs';
import {weldControlPointError,weldPointTreeGroups} from './weldPlanningPoints.mjs';

const axes=['x','y','z'];
const angles=['advance','work','rotation'];
const isEndpoint=p=>p.kind==='start'||p.kind==='end';
const addValues=(a,b,keys,sign=1)=>Object.fromEntries(keys.map(key=>[key,(a?.[key]??0)+sign*(b?.[key]??0)]));
const offsetKeys=PASS_OFFSET_FIELDS.map(([key])=>key);
const labels={start:'起点',end:'终点'};
const anchorKey=p=>p.kind==='junction'?'junction:'+p.segment:p.kind;

function anchorsFor(count,passId,previous=[]){
 const anchors=[['start',1,0,'起点'],...Array.from({length:count-1},(_,i)=>['junction',i+1,100,'段连接点'+(i+1)]),['end',count,100,'终点']];
 return anchors.map(([kind,segment,percent,name])=>{
  const anchor=previous.find(p=>anchorKey(p)===anchorKey({kind,segment}));
  return {...(anchor??point(kind,segment,percent,name)),id:anchor?.id??passId+':'+anchorKey({kind,segment}),segment,percent};
 });
}

function reconcilePoints(count,pass){
 const anchors=anchorsFor(count,pass.id,pass.points);
 const controls=pass.points.filter(p=>p.kind==='control').map(p=>{
  const reference=anchors.find(a=>a.id===p.referenceId)??anchors.find(a=>a.segment===p.segment&&a.percent===p.percent)??anchors[0];
  return {...p,referenceId:reference.id,segment:reference.segment,percent:reference.percent};
 });
 return [...anchors,...controls];
}

function fromGroup(group,root,weld,count){
 const source=group?.definition??[];
 const id=group?.layerId?group.id:weld.id+':pass:1';
 const anchors=anchorsFor(count,id,group?.localSegments?[]:source);
 const byKey=new Map(anchors.map(p=>[anchorKey(p),p]));
 const controls=[];
 for(const p of source.filter(p=>p.kind==='control')){
  const previous=source.find(a=>a.id===p.referenceId);
  const index=group.localSegments?.[previous?.segment-1];
  const reference=Number.isInteger(index)?byKey.get('junction:'+(index+1))??byKey.get('end'):byKey.get(anchorKey(previous??{kind:'start'}));
  if(!reference)continue;
  const {autoRole,...control}=p;
  const offset=previous?.kind==='midpoint'&&Number.isInteger(index)?
   {...p.offset,x:p.offset.x-weld.segments[index].length/2}:p.offset;
  controls.push({...control,offset,referenceId:reference.id,segment:reference.segment,percent:reference.percent});
 }
 for(const p of group?.points??[]){
  if(p.source!=='manual'||!p.position)continue;
  const index=root.points.findIndex(a=>a.id===p.referenceId);
  const original=root.points[index];
  const reference=original&&byKey.get(anchorKey({kind:original.kind,segment:Math.max(1,index)}));
  if(!reference)continue;
  const {position,pose,source,referenceName,distance,groupId,...control}=p;
  controls.push({...control,referenceId:reference.id,segment:reference.segment,percent:reference.percent});
 }
 return {id,name:group?.passName||'第 1 道',offset:passOffsetValues(group?.passOffset),points:[...anchors,...controls]};
}

function inheritEndpoint(endpoint,base,sign=1){
 return {...endpoint,offset:addValues(endpoint.offset,base.offset,axes,sign),angles:addValues(endpoint.angles,base.angles,angles,sign),
  ...(sign===1?{tracking:endpoint.tracking||base.tracking,overrides:{...base.overrides,...endpoint.overrides}}:{})};
}

export function validWeldLayerLayout(layout){
 if(layout===undefined)return true;
 if(!Array.isArray(layout)||!layout.length||layout[0]?.passes?.length!==1)return false;
 const validId=item=>typeof item?.id==='string'&&item.id.length>0;
 const uniqueIds=items=>items.every(validId)&&new Set(items.map(item=>item.id)).size===items.length;
 return uniqueIds(layout)&&layout.every(layer=>typeof layer.name==='string'&&Number.isFinite(layer.height)&&
  Array.isArray(layer.passes)&&layer.passes.length&&uniqueIds(layer.passes)&&layer.passes.every(pass=>{
   if(typeof pass.name!=='string'||!validPassOffsets(pass.offset)||!Array.isArray(pass.points)||pass.points.length>500||!uniqueIds(pass.points))return false;
   const anchors=pass.points.filter(p=>['start','end','junction'].includes(p.kind)).map(p=>({...p,position:[0,0,0]}));
   return pass.points.every(p=>['start','end','junction','control'].includes(p.kind)&&
    Number.isInteger(p.segment)&&p.segment>=1&&Number.isFinite(p.percent)&&p.percent>=0&&p.percent<=100&&
    !weldControlPointError(p,anchors));
  }));
}

export function weldLayerLayout(weld,decision,templates,processLibrary,options){
 if(!weld?.segments?.length)return [];
 const count=weld.segments.length;
 if(weld.pointLayout?.length)return weld.pointLayout.map(layer=>({...layer,passes:layer.passes.map(pass=>({...pass,points:reconcilePoints(count,pass)}))}));
 const groups=weldPointTreeGroups(weld,decision,templates,processLibrary,options),root=groups[0];
 const byLayer=new Map();
 for(const group of groups.slice(1)){
  if(!byLayer.has(group.layerId))byLayer.set(group.layerId,{id:group.layerId,name:group.layerName,height:group.layerHeight??0,passes:[]});
  byLayer.get(group.layerId).passes.push(fromGroup(group,root,weld,count));
 }
 const layers=[...byLayer.values()];
 const rootPass=fromGroup(root,root,weld,count);
 if(!layers.length)layers.push({id:weld.id+':layer:1',name:'第 1 层',height:0,passes:[rootPass]});
 else layers[0].passes[0].points.push(...rootPass.points.filter(p=>p.kind==='control').map(p=>{
  const origin=rootPass.points.find(a=>a.id===p.referenceId);
  const ref=layers[0].passes[0].points.find(a=>anchorKey(a)===anchorKey(origin));
  return {...p,referenceId:ref.id};
 }));
 const baseLayer=layers[0],base=baseLayer.passes[0];
 if(baseLayer.passes.length>1){
  const passes=baseLayer.passes.splice(1);
  layers.splice(1,0,{id:baseLayer.id+':remaining',name:baseLayer.name+'（后续道）',height:baseLayer.height,passes});
 }
 return layers.map((layer,index)=>index===0?layer:{
  ...layer,height:layer.height-baseLayer.height,passes:layer.passes.map(pass=>({
   ...pass,offset:addValues(pass.offset,base.offset,offsetKeys,-1),
   points:pass.points.map(p=>isEndpoint(p)?inheritEndpoint(p,base.points.find(a=>a.kind===p.kind),-1):p)
  }))
 });
}

export function newWeldPass(weld,count){
 const id=uid();
 const points=anchorsFor(weld.segments.length,id).map(p=>isEndpoint(p)?
  {...p,angles:{advance:0,work:0,rotation:0},tracking:''}:p);
 return {id,name:'第 '+count+' 道',offset:passOffsetValues(),points};
}

export function newWeldLayer(weld,count){
 return {id:uid(),name:'第 '+count+' 层',height:0,passes:[newWeldPass(weld,1)]};
}

function baseProcessValues(weld,process,i,j,kind){
 const layers=process?.processLayers;
 const pass=layers?.[i]?.passes?.[j]??layers?.[0]?.passes?.[0]??process;
 const phase=kind==='start'||kind==='end'?kind:'weld';
 const arc=pass?.[phase]??pass?.weld;
 return {
  ...(pass?.weave?.enabled?pass.weave:{}),
  current:arc?.current??weld?.current,voltage:arc?.voltage??weld?.voltage,
  speed:pass?.weld?.speed??weld?.speed
 };
}

function pointProcessValues(point,defaults){
 const base={...defaults,...point.overrides};
 const overrides={...point.overrides};
 for(const [key,delta] of Object.entries(point.processOffset??{}))overrides[key]=(base[key]??0)+delta;
 return {base,overrides};
}

function pointPose(point){
 return point.poseOffset?{...point,angles:addValues(point.angles,point.poseOffset,angles)}:point;
}

function passParameters(layout,layer,pass){
 const baseLayer=layout[0],base=baseLayer.passes[0],derived=pass!==base;
 if(!derived)return {points:pass.points.map(pointPose),offset:pass.offset,height:layer.height};
 const points=pass.points.map(pointPose).map(p=>isEndpoint(p)?inheritEndpoint(p,pointPose(base.points.find(a=>a.kind===p.kind))):p);
 return {points,offset:addValues(pass.offset,base.offset,offsetKeys),height:layer.height+baseLayer.height};
}

export function weldLayerTreeGroups(weld,layout,process){
 if(!layout.length)return [];
 const target=targetFromWeld(weld),path=previewPath(target.segments,'xy',[],target.closure);
 return layout.flatMap((layer,i)=>layer.passes.map((pass,j)=>{
  const {points,offset,height}=passParameters(layout,layer,pass);
  return {id:pass.id,layerId:layer.id,layerName:layer.name,passName:pass.name,layerHeight:layer.height,passOffset:pass.offset,derived:i>0,
   points:points.map((p,index)=>{
    const value=resolvePassPoint(target,p,points,offset,height,path);
    const {base:processBase,overrides}=pointProcessValues(p,baseProcessValues(weld,process,i,j,p.kind));
    const source=p.kind==='control'?'manual':'weld';
    const referenceName=points.find(a=>a.id===p.referenceId)?.name;
    return {...p,id:pass.id+':'+p.id,raw:pass.points[index],groupId:pass.id,source,referenceName,position:value.position,pose:value.angles,overrides,processBase};
   })
  };
 }));
}

export function weldPointBasePosition(weld,layout,groupId,id){
 const layer=layout.find(item=>item.passes.some(pass=>pass.id===groupId));
 if(!layer)return undefined;
 const pass=layer.passes.find(item=>item.id===groupId),raw=pass.points.find(p=>p.id===id);
 if(!raw)return undefined;
 const {points,offset,height}=passParameters(layout,layer,pass);
 const p=points.find(p=>p.id===id);
 const neutral={...p,offset:addValues(p.offset,raw.offset,axes,-1)};
 return resolvePassPoint(targetFromWeld(weld),neutral,points.map(p=>p.id===id?neutral:p),offset,height).position;
}

export function copyWeldLayersToTemplate(template,layout,weld,process){
 if(!layout.length)return template;
 const normalize=value=>Math.abs(value)>360?value%360:value;
 const layers=layout.map((layer,i)=>({...layer,id:uid(),passes:layer.passes.map((pass,j)=>{
  const {points,offset}=passParameters(layout,layer,pass);
  const normalized=points.map(p=>{
   const angles=Object.fromEntries(Object.entries(p.angles).map(([key,value])=>[key,normalize(value+(offset[key]??0))]));
   const {processOffset,poseOffset,...point}=p;
   const {overrides}=pointProcessValues(p,baseProcessValues(weld,process,i,j,p.kind));
   return {...point,angles,overrides,...(isEndpoint(p)?{name:labels[p.kind]}:{})};
  });
  return {...pass,id:uid(),offset:{...offset,advance:0,work:0,rotation:0},points:clonePassPoints(normalized)};
 }),height:layer===layout[0]?layer.height:layer.height+layout[0].height}));
 return {...template,layers,points:layers[0].passes[0].points};
}
