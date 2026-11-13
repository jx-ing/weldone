import {point,targetFromWeld,uid} from './templateModel.mjs';
import {clonePassPoints} from './templateLayers.mjs';
import {PASS_OFFSET_FIELDS,passOffsetValues,resolvePassPoint,validPassOffsets,weldTorchAxis} from './templatePassOffsets.mjs';
import {previewPath} from './weldPathGeometry.mjs';
import {distance,prepareManualWeldPath,horizontalWeldNormal} from './manualWeldModel.mjs';
import {weldControlPointError,weldPointTreeGroups} from './weldPlanningPoints.mjs';
import {weldPassLegDirections} from './weldPassMesh.mjs';

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
  (layer.offsetY===undefined||Number.isFinite(layer.offsetY))&&
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
  if(!byLayer.has(group.layerId))byLayer.set(group.layerId,{id:group.layerId,name:group.layerName,height:group.layerHeight??0,offsetY:group.layerOffsetY??0,passes:[]});
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
  ...layer,height:layer.height-baseLayer.height,offsetY:layer.offsetY-baseLayer.offsetY,passes:layer.passes.map(pass=>({
   ...pass,offset:addValues(pass.offset,base.offset,offsetKeys,-1),
   points:pass.points.map(p=>isEndpoint(p)?inheritEndpoint(p,base.points.find(a=>a.kind===p.kind),-1):p)
  }))
 });
}

function nextWeldLayoutNumber(items,unit){
 const pattern=new RegExp('^第 (\\d+) '+unit+'$');
 return items.reduce((max,item)=>Math.max(max,Number(pattern.exec(item.name)?.[1]??0)),0)+1;
}

export function newWeldPass(weld,count){
 const id=uid();
 const points=anchorsFor(weld.segments.length,id).map(p=>isEndpoint(p)?
  {...p,angles:{advance:0,work:0,rotation:0},tracking:''}:p);
 return {id,name:'第 '+count+' 道',offset:passOffsetValues(),points};
}

export function newWeldLayer(weld,count){
 return {id:uid(),name:'第 '+count+' 层',height:0,offsetY:0,passes:[newWeldPass(weld,1)]};
}

export const nextWeldLayer=(weld,layout)=>newWeldLayer(weld,nextWeldLayoutNumber(layout,'层'));
export const nextWeldPass=(weld,layer)=>newWeldPass(weld,nextWeldLayoutNumber(layer.passes,'道'));

export function removeWeldLayoutItem(layout,{type,layerId,passId,pointId}){
 const layer=layout.find(item=>item.id===layerId);
 if(!layer)return layout;
 if(type==='layer')return layer===layout[0]?layout:layout.filter(item=>item!==layer);
 const pass=layer.passes.find(item=>item.id===passId);
 if(!pass)return layout;
 if(type==='pass'){
  if(layer===layout[0]||layer.passes.length<=1)return layout;
  return layout.map(item=>item===layer?{...layer,passes:layer.passes.filter(item=>item!==pass)}:item);
 }
 if(type!=='point'||!pass.points.some(point=>point.id===pointId&&point.kind==='control'))return layout;
 return layout.map(item=>item===layer?{...layer,passes:layer.passes.map(item=>
  item===pass?{...pass,points:pass.points.filter(point=>point.id!==pointId)}:item)}:item);
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
 const baseY=baseLayer.offsetY??0,layerY=layer.offsetY??0;
 if(!derived)return {points:pass.points.map(pointPose),offset:{...pass.offset,y:(pass.offset.y??0)+layerY},height:layer.height,layerY};
 const points=pass.points.map(pointPose).map(p=>isEndpoint(p)?inheritEndpoint(p,pointPose(base.points.find(a=>a.kind===p.kind))):p);
 const offset=addValues(pass.offset,base.offset,offsetKeys);
 return {points,offset:{...offset,y:offset.y+layerY+baseY},height:layer.height+baseLayer.height,layerY:layerY+baseY};
}

export function weldLayerTreeGroups(weld,layout,process){
 if(!layout.length)return [];
 const target=targetFromWeld(weld),path=previewPath(target.segments,'xy',[],target.closure);
 return layout.flatMap((layer,i)=>layer.passes.map((pass,j)=>{
  const {points,offset,height}=passParameters(layout,layer,pass);
  return {id:pass.id,layerId:layer.id,layerName:layer.name,passName:pass.name,layerHeight:layer.height,layerOffsetY:layer.offsetY??0,passOffset:pass.offset,derived:i>0,
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

// Keep the CAD path's vertices and interpolate the authored point offsets along it.
export function weldLayerPassPaths(weld,layout){
 if(!weld?.enabled||layout.reduce((count,layer)=>count+layer.passes.length,0)<2||
  !weld.segments?.every(segment=>segment.pathPoints?.length>=2))return [];
 const target=targetFromWeld(weld),path=previewPath(target.segments,'xy',[],target.closure);
 const vertices=[0];
 const corners=[];
 for(const segment of target.segments){
  if(vertices.at(-1)>0)corners.push(vertices.at(-1));
  const points=segment.pathPoints;
  for(let i=1;i<points.length;i++)vertices.push(vertices.at(-1)+distance(points[i-1],points[i]));
 }
 if(path.totalLength<=1e-8)return [];
 const cornerStations=corners.flatMap(station=>[station-.0001,station+.0001]);
 const sample=prepareManualWeldPath(target.segments,target.cornerReferenceNormal);
 const frames=new Map();
 const frameAt=station=>{
  if(!frames.has(station)){
   const frame=sample(station);
   frames.set(station,{...frame,normal:horizontalWeldNormal(frame.tangent,frame.normal)});
  }
  return frames.get(station);
 };
 const referenceAt=(station,pose,offset,height)=>{
  const {position,tangent,normal}=frameAt(station);
  const wire=offset.wire?weldTorchAxis(tangent,normal,pose):[0,0,0];
  return position.map((value,index)=>value+normal[index]*(offset.y??0)+wire[index]*(offset.wire??0)+
   (index===2?height+(offset.z??0):0));
 };
 return layout.flatMap((layer,layerIndex)=>layer.passes.map((pass,passIndex)=>{
  const {points,offset,height}=passParameters(layout,layer,pass);
  const controls=points.map(point=>{
   const resolved=resolvePassPoint(target,point,points,offset,height,path);
   const reference=referenceAt(resolved.distance,resolved.angles,offset,height);
   return {kind:point.kind,station:resolved.distance,pose:resolved.angles,position:resolved.position,
    delta:resolved.position.map((value,i)=>value-reference[i])};
  }).sort((a,b)=>a.station-b.station);
  const start=controls.find(point=>point.kind==='start'),end=controls.find(point=>point.kind==='end');
  if(!start||!end||end.station<=start.station)return null;
  const ordered=controls.filter(point=>point.station>=start.station&&point.station<=end.station);
  const wireSamples=offset.wire?Array.from({length:63},(_,i)=>start.station+(end.station-start.station)*(i+1)/64):[];
  const stations=[...new Set([...vertices,...cornerStations,...wireSamples,...ordered.map(point=>point.station)])]
   .filter(station=>station>=start.station&&station<=end.station).sort((a,b)=>a-b);
  let index=0;
  const positions=stations.map(station=>{
   if(station===start.station)return start.position;
   if(station===end.station)return end.position;
   while(index+1<ordered.length&&ordered[index+1].station<station)index++;
   const left=ordered[index],right=ordered[index+1]??left;
   if(station===right.station)return right.position;
   const t=(station-left.station)/(right.station-left.station||1);
   const pose=Object.fromEntries(angles.map(key=>[key,left.pose[key]+(right.pose[key]-left.pose[key])*t]));
   return referenceAt(station,pose,offset,height).map((value,i)=>value+left.delta[i]+(right.delta[i]-left.delta[i])*t);
  });
  const leg=Number.isFinite(weld.leg)&&weld.leg>0?weld.leg:null;
  let segmentIndex=0;
  const sections=leg?stations.map(station=>{
   while(segmentIndex+1<path.frames.length&&path.frames[segmentIndex+1].distance<=station)segmentIndex++;
   const {tangent,normal}=frameAt(station);
   return weldPassLegDirections(tangent,target.segments[segmentIndex],normal);
  }):null;
  return {id:pass.id,layerId:layer.id,layerIndex,passIndex,positions,sections,leg};
 }).filter(Boolean));
}

export function copyWeldLayersToTemplate(template,layout,weld,process){
 if(!layout.length)return template;
 const normalize=value=>Math.abs(value)>360?value%360:value;
 const layers=layout.map((layer,i)=>({...layer,id:uid(),passes:layer.passes.map((pass,j)=>{
  const {points,offset,layerY}=passParameters(layout,layer,pass);
  const normalized=points.map(p=>{
   const angles=Object.fromEntries(Object.entries(p.angles).map(([key,value])=>[key,normalize(value+(offset[key]??0))]));
   const {processOffset,poseOffset,...point}=p;
   const {overrides}=pointProcessValues(p,baseProcessValues(weld,process,i,j,p.kind));
   return {...point,angles,overrides,...(isEndpoint(p)?{name:labels[p.kind]}:{})};
  });
  return {...pass,id:uid(),offset:{...offset,y:offset.y-layerY,advance:0,work:0,rotation:0},points:clonePassPoints(normalized)};
 }),height:layer===layout[0]?layer.height:layer.height+layout[0].height,
  offsetY:(layer.offsetY??0)+(layer===layout[0]?0:layout[0].offsetY??0)}));
 return {...template,layers,points:layers[0].passes[0].points};
}
