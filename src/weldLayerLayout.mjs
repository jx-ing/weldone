import {point,targetFromWeld,uid} from './templateModel.mjs';
import {clonePassPoints} from './templateLayers.mjs';
import {PASS_OFFSET_FIELDS,effectivePassPoints,passOffsetValues,resolvePassPoint,validPassOffsets,weldTorchAxis} from './templatePassOffsets.mjs';
import {previewPath} from './weldPathGeometry.mjs';
import {distance} from './manualWeldModel.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {Quaternion} from 'three';
import {resolveWeldToolPose,weldTorchAngles,weldTorchFrame} from './weldToolPose.mjs';
import {weldControlPointError,weldPointTreeGroups} from './weldPlanningPoints.mjs';
import {weldPassLegDirections,weldSectionSide} from './weldPassMesh.mjs';

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
 for(const definition of [group,...(group.localGroups??[])])for(const p of (definition.definition??[]).filter(p=>p.kind==='control')){
  const previous=definition.definition.find(a=>a.id===p.referenceId);
  const index=definition.localSegments?.[previous?.segment-1];
  const reference=Number.isInteger(index)?byKey.get('junction:'+(index+1))??byKey.get('end'):byKey.get(anchorKey(previous??{kind:'start'}));
  if(!reference)continue;
  const {autoRole,...control}=p;
  const offset=previous?.kind==='midpoint'&&Number.isInteger(index)?
   {...p.offset,x:p.offset.x-weld.segments[index].length/2}:p.offset;
  const id=definition===group?control.id:definition.id+':'+control.id;
  controls.push({...control,id,offset,referenceId:reference.id,segment:reference.segment,percent:reference.percent});
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
 return {id,name:group?.passName||'第 1 道',offset:passOffsetValues(group?.passOffset),points:[...anchors,...controls],
  ...(group.processPassIndex?{processPassIndex:group.processPassIndex}:{})};
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
 const saved=weld.pointLayout;
 const defaultPass=saved?.length===1&&saved[0].id===weld.id+':layer:1'&&saved[0].passes.length===1?saved[0].passes[0]:null;
 const restore=()=>saved.map(layer=>({...layer,passes:layer.passes.map(pass=>({...pass,points:reconcilePoints(count,pass)}))}));
 if(saved?.length&&!defaultPass)return restore();
 const groups=weldPointTreeGroups(weld,decision,templates,processLibrary,options),root=groups[0];
 if(defaultPass&&!groups[1]?.processPassIndex)return restore();
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
  layers.splice(1,0,{id:baseLayer.id+':remaining',name:baseLayer.name+'（后续道）',height:baseLayer.height,offsetY:baseLayer.offsetY,passes});
 }
 const layout=layers.map((layer,index)=>index===0?layer:{
  ...layer,height:layer.height-baseLayer.height,offsetY:layer.offsetY-baseLayer.offsetY,passes:layer.passes.map(pass=>({
   ...pass,offset:addValues(pass.offset,base.offset,offsetKeys,-1),
   points:pass.points.map(p=>isEndpoint(p)?inheritEndpoint(p,base.points.find(a=>a.kind===p.kind),-1):p)
  }))
 });
 if(defaultPass&&base.processPassIndex){
  baseLayer.height+=saved[0].height;
  baseLayer.offsetY+=(saved[0].offsetY??0);
  base.points=reconcilePoints(count,defaultPass);
  for(const key of offsetKeys)if(defaultPass.offset?.[key])base.offset[key]=defaultPass.offset[key];
 }
 return layout;
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

// Geometry anchors store the nominal angles from point(). A strategy path supplies
// the base pose at the resolved station; keep authored point and pass deltas.
const nominalAnchorPose=point().angles;
function strategyPoseAt(layout,pass,path,plan){
 const [layerIndex,passIndex]=pass.processPassIndex??layout[0].passes[0].processPassIndex??[0,0];
 const motion=plan?.passes?.find(p=>p.layerIndex===layerIndex&&p.passIndex===passIndex)?.points;
 if(!motion?.length)return undefined;
 const closed=path.closed,total=path.totalLength;
 const near=1e-5;
 const byStation=new Map();
 const phasePriority={weld:0,start:1,end:1,corner:2,wrap:2};
 for(const point of motion){
  const at=closed&&total>0&&point.distance>=total-near?0:point.distance;
  const previous=byStation.get(at);
  if(!previous||point.flatLWrap&&!previous.flatLWrap||(phasePriority[point.kind]??0)>(phasePriority[previous.kind]??0))byStation.set(at,point);
 }
 const samples=[...byStation].sort(([a],[b])=>a-b);
 function sample(station){
  const at=closed&&total>0?((station%total)+total)%total:station;
  let lo=0,hi=samples.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(samples[mid][0]<at-near)lo=mid+1;else hi=mid;}
  const [rightAt,right]=samples[lo]??(closed?[samples[0][0]+total,samples[0][1]]:[]);
  const [leftAt,left]=samples[lo-1]??(closed?[samples.at(-1)[0]-total,samples.at(-1)[1]]:[]);
  if(right&&Math.abs(rightAt-at)<=near)return right;
  if(!left||!right)return left??right;
  const t=(at-leftAt)/(rightAt-leftAt);
  const interpolateWrap=(left.flatLWrap||right.flatLWrap)&&left.orientation&&right.orientation&&left.up&&right.up;
  let pose=Object.fromEntries(angles.map(key=>[key,(left.pose?.[key]??0)*(1-t)+(right.pose?.[key]??0)*t]));
  const pathOffset=axes.map((_,i)=>(left.pathOffset?.[i]??0)*(1-t)+(right.pathOffset?.[i]??0)*t);
  const blend=key=>axes.map((_,i)=>left[key][i]*(1-t)+right[key][i]*t);
  const transition=left.up&&right.up&&(left.kind==='corner'||right.kind==='corner'||interpolateWrap);
  const frame=transition&&Math.hypot(...blend('tangent'))>1e-8?
   weldTorchFrame(blend('tangent'),blend('normal'),blend('up')):{};
  if(interpolateWrap){
   const orientation=new Quaternion().fromArray(left.orientation).slerp(new Quaternion().fromArray(right.orientation),t);
   if(!frame.up){
    const {tangent,normal,up}=right.flatLWrap?right:left;
    Object.assign(frame,{tangent,normal,up});
   }
   pose=weldTorchAngles(frame,orientation);
  }
  return {pose,pathOffset,wireOffset:(left.wireOffset??0)*(1-t)+(right.wireOffset??0)*t,...frame};
 }
 const resolve=(point,station)=>{
  const base=sample(station);
  if(!base)return undefined;
  const {tangent,normal,up,pathOffset,wireOffset}=base;
  // Old saved plans used a horizontal frame. Use the current geometric
  // frame unless the saved point carries an explicit section reference.
  return {angles:point.kind==='control'?point.angles:addValues(base.pose,addValues(point.angles,nominalAnchorPose,angles,-1),angles),
   ...(up?{tangent,normal,up}:{}),pathOffset,wireOffset};
 };
 resolve.sample=sample;
 resolve.stations=samples.map(([station])=>station);
 resolve.speedAt=station=>{
  const at=closed&&total>0?((station%total)+total)%total:station;
  let lo=0,hi=samples.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(samples[mid][0]<=at)lo=mid;else hi=mid-1;}
  return samples[lo][1].parameters?.speed;
 };
 return resolve;
}

function passFrameSampler(target,referenceAt){
 if(target.segments.every(segment=>segment.pathPoints?.length>=2))
  return prepareWeldSeamFrames(target.segments,target.cornerReferenceNormal,target.closure==='closed',referenceAt);
}

export function weldLayerTreeGroups(weld,layout,process,plan=weld?.strategyPlan,referenceAt){
 if(!layout.length)return [];
 const target=targetFromWeld(weld),path=previewPath(target.segments,'xy',[],target.closure);
 const frameAt=passFrameSampler(target,referenceAt);
 return layout.flatMap((layer,i)=>layer.passes.map((pass,j)=>{
  const {points,offset,height}=passParameters(layout,layer,pass);
  const poseAt=strategyPoseAt(layout,pass,path,plan);
  const processOffsetBase=pass.processPassIndex&&i>0?layout[0].passes[0].offset:undefined;
  const passOffset=processOffsetBase?addValues(pass.offset,processOffsetBase,offsetKeys):pass.offset;
  return {id:pass.id,layerId:layer.id,layerName:layer.name,passName:pass.name,layerHeight:layer.height,layerOffsetY:layer.offsetY??0,passOffset,processOffsetBase,derived:i>0,
   points:points.map((p,index)=>{
    const value=resolvePassPoint(target,p,points,offset,height,path,poseAt,frameAt);
    const [layerIndex,passIndex]=pass.processPassIndex??[i,j];
    const {base:processBase,overrides}=pointProcessValues(p,baseProcessValues(weld,process,layerIndex,passIndex,p.kind));
    const source=p.kind==='control'?'manual':'weld';
    const referenceName=points.find(a=>a.id===p.referenceId)?.name;
    return {...p,id:pass.id+':'+p.id,raw:pass.points[index],groupId:pass.id,source,referenceName,
     position:value.position,tangent:value.tangent,normal:value.normal,pose:value.angles,distance:value.distance,toolPose:value.toolPose,overrides,processBase};
   })
  };
 }));
}

export function weldPointPlacement(weld,layout,groupId,id,baseOnly=false,plan=weld?.strategyPlan,referenceAt){
 const layer=layout.find(item=>item.passes.some(pass=>pass.id===groupId));
 if(!layer)return undefined;
 const pass=layer.passes.find(item=>item.id===groupId),raw=pass.points.find(p=>p.id===id);
 if(!raw)return undefined;
 const {points,offset,height}=passParameters(layout,layer,pass);
 const target=targetFromWeld(weld),path=previewPath(target.segments,'xy',[],target.closure);
 const frameAt=passFrameSampler(target,referenceAt);
 const poseAt=strategyPoseAt(layout,pass,path,plan);
 const p=points.find(p=>p.id===id);
 if(!baseOnly)return resolvePassPoint(target,p,points,offset,height,path,poseAt,frameAt);
 const neutral={...p,offset:addValues(p.offset,raw.offset,axes,-1)};
 return resolvePassPoint(target,neutral,points.map(p=>p.id===id?neutral:p),offset,height,path,poseAt,frameAt);
}

export function weldPointPosition(weld,layout,groupId,id,baseOnly=false,plan=weld?.strategyPlan,referenceAt){
 return weldPointPlacement(weld,layout,groupId,id,baseOnly,plan,referenceAt)?.position;
}

export function updateWeldLayoutPoint(layout,passId,record,add=false){
 return layout.map(layer=>{
  if(!layer.passes.some(pass=>pass.id===passId))return layer;
  return {...layer,passes:layer.passes.map(pass=>{
   if(pass.id!==passId)return pass;
   const points=add?[...pass.points,record]:pass.points.map(point=>point.id===record.id?{...point,...record}:point);
   return {...pass,points};
  })};
 });
}

// Keep the CAD path's vertices and interpolate the authored point offsets along it.
export function weldLayerPassPaths(weld,layout,plan=weld?.strategyPlan,referenceNormalAt,process=weld?.processParameters){
 if(!weld?.enabled||!layout.length||
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
 const frameAt=passFrameSampler(target,referenceNormalAt);
 const frameFor=(station,strategy)=>{
  const frame=frameAt(station);
  return strategy?.up?{...frame,tangent:strategy.tangent,normal:strategy.normal,up:strategy.up}:frame;
 };
 const referenceAt=(station,pose,offset,height,strategy,frame=frameFor(station,strategy))=>{
  const wireOffset=(offset.wire??0)+(strategy?.wireOffset??0);
  const wire=wireOffset?weldTorchAxis(frame.tangent,frame.normal,pose,frame.up):[0,0,0];
  return frame.position.map((value,index)=>value+frame.offsetNormal[index]*(offset.y??0)+wire[index]*wireOffset+
   (index===2?height+(offset.z??0):0)+(strategy?.pathOffset?.[index]??0));
 };
 return layout.flatMap((layer,layerIndex)=>layer.passes.map((pass,passIndex)=>{
  const {points,offset,height}=passParameters(layout,layer,pass);
  const speed=baseProcessValues(weld,process,layerIndex,passIndex,'weld').speed;
  const poseAt=strategyPoseAt(layout,pass,path,plan);
  const controls=points.map(point=>{
   const resolved=resolvePassPoint(target,point,points,offset,height,path,poseAt,frameAt);
   const strategy=poseAt?.sample(resolved.distance);
   const reference=referenceAt(resolved.distance,resolved.angles,offset,height,strategy);
   return {id:point.id,kind:point.kind,station:resolved.distance,pose:resolved.angles,position:resolved.position,
    toolPose:resolved.toolPose,angleOffset:addValues(resolved.angles,strategy?.pose,angles,-1),
    delta:resolved.position.map((value,i)=>value-reference[i])};
  }).sort((a,b)=>a.station-b.station);
  const start=controls.find(point=>point.kind==='start'),end=controls.find(point=>point.kind==='end');
  if(!start||!end||end.station<=start.station)return null;
  const firstStation=controls[0].station,lastStation=controls.at(-1).station;
  const byStation=new Map([[start.station,[start]]]);
  for(const control of controls){
   if(control===start)continue;
   const {station}=control;
   if(!byStation.has(station))byStation.set(station,[]);
   if(control!==end)byStation.get(station).push(control);
  }
  byStation.get(end.station).push(end);
  const ordered=[...byStation].sort(([a],[b])=>a-b);
  const wireSamples=offset.wire?Array.from({length:63},(_,i)=>start.station+(end.station-start.station)*(i+1)/64):[];
  const stations=[...new Set([...vertices,...cornerStations,...wireSamples,...byStation.keys(),...(poseAt?.stations??[])])]
   .filter(station=>station>=firstStation&&station<=lastStation).sort((a,b)=>a-b);
  const sampleStations=poseAt?.stations.filter(station=>station>=start.station&&station<=end.station)??[];
  function posesAt(station){
   if(!Number.isFinite(station)||station<firstStation||station>lastStation)return [];
   if(byStation.has(station))return byStation.get(station).map(point=>({...point.toolPose,pointId:point.id}));
   let lo=0,hi=ordered.length-1;
   while(hi-lo>1){const mid=(hi+lo)>>1;if(ordered[mid][0]<station)lo=mid;else hi=mid;}
   const [leftStation,leftPoints]=ordered[lo],[rightStation,rightPoints]=ordered[hi];
   const left=leftPoints.at(-1),right=rightPoints[0],t=(station-leftStation)/(rightStation-leftStation);
   const strategy=poseAt?.sample(station);
   const pose=Object.fromEntries(angles.map(key=>[key,strategy?
    (strategy.pose?.[key]??0)+left.angleOffset[key]+(right.angleOffset[key]-left.angleOffset[key])*t:
    left.pose[key]+(right.pose[key]-left.pose[key])*t]));
   const frame=frameFor(station,strategy);
   const position=referenceAt(station,pose,offset,height,strategy,frame)
    .map((value,i)=>value+left.delta[i]+(right.delta[i]-left.delta[i])*t);
   return [resolveWeldToolPose({...frame,position,pose,distance:station})];
  }
  const samples=stations.flatMap(station=>posesAt(station)).filter((entry,i,all)=>!i||distance(entry.position,all[i-1].position)>1e-8);
  if(samples.length<2)return null;
  const positions=samples.map(sample=>sample.position);
  const leg=Number.isFinite(weld.leg)&&weld.leg>0?weld.leg:null;
  let segmentIndex=0;
  const segmentIndices=[];
  const sections=leg?samples.map(({distance:station})=>{
   while(segmentIndex+1<path.frames.length&&path.frames[segmentIndex+1].distance<=station)segmentIndex++;
   segmentIndices.push(target.sourceSegmentIndices?.[segmentIndex]??segmentIndex);
   const {tangent}=frameAt(station);
   const segment=target.segments[segmentIndex];
   return weldPassLegDirections(tangent,segment,weldSectionSide(tangent,segment.referenceNormal??target.cornerReferenceNormal));
  }):null;
  const speedAt=station=>{
   const control=points.find(point=>point.id===ordered.findLast(([distance])=>distance<=station)?.[1].at(-1)?.id);
   const baseline=control?.overrides?.speed??poseAt?.speedAt(station)??speed;
   return Number.isFinite(baseline)?baseline+(control?.processOffset?.speed??0):null;
  };
  return {id:pass.id,layerId:layer.id,layerIndex,passIndex,positions,sections,segmentIndices,leg,
   startStation:start.station,endStation:end.station,sampleStations,toolPoses:samples,posesAt,speedAt};
 }).filter(Boolean));
}

export function copyWeldLayersToTemplate(template,layout,weld,process,plan=weld?.strategyPlan,referenceAt){
 if(!layout.length)return template;
 const target=plan&&targetFromWeld(weld);
 const path=target&&previewPath(target.segments,'xy',[],target.closure);
 const frameAt=target&&passFrameSampler(target,referenceAt);
 const normalize=value=>Math.abs(value)>360?value%360:value;
 const layers=layout.map((layer,i)=>({...layer,id:uid(),passes:layer.passes.map((pass,j)=>{
  const {points,offset,layerY,height}=passParameters(layout,layer,pass);
  const poseAt=path&&strategyPoseAt(layout,pass,path,plan);
  const normalized=effectivePassPoints(points,offset).map((adjusted,index)=>{
   const p=points[index];
   const effective=poseAt?resolvePassPoint(target,p,points,offset,height,path,poseAt,frameAt).angles:adjusted.angles;
   const angles=Object.fromEntries(Object.entries(effective).map(([key,value])=>[key,normalize(value)]));
   const {processOffset,poseOffset,...point}=p;
   const {overrides}=pointProcessValues(p,baseProcessValues(weld,process,i,j,p.kind));
   return {...point,angles,overrides,...(isEndpoint(p)?{name:labels[p.kind]}:{})};
  });
  return {...pass,id:uid(),offset:{...offset,y:offset.y-layerY,advance:0,work:0,rotation:0},points:clonePassPoints(normalized)};
 }),height:layer===layout[0]?layer.height:layer.height+layout[0].height,
  offsetY:(layer.offsetY??0)+(layer===layout[0]?0:layout[0].offsetY??0)}));
 return {...template,layers,points:layers[0].passes[0].points};
}
