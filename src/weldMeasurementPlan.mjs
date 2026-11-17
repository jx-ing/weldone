import {MathUtils,Quaternion,Vector3} from 'three';
import {pathLength} from './manualWeldModel.mjs';
import {directedWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION,TORCH_ANGLE_KEYS,resolveWeldToolPose} from './weldToolPose.mjs';
import {weldMeasurementCapabilities,weldPrecisionMethod} from './weldAttributeModel.mjs';
import {measurementOrientation,planFixedPhotoPose} from './fixedPhotoPlanning.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {LASER_WORKING_DISTANCE,laserCameraMount} from './laserCameraMount.mjs';

export const DEFAULT_SWEEP_OFFSET=30;
const EPS=1e-6;
const vertical=new Vector3(0,0,1);
const finiteOrZero=value=>Number.isFinite(value)?value:0;
const offsetVector=value=>new Vector3(...['x','y','z'].map(axis=>finiteOrZero(value?.[axis])));

function laserToolPose(frame,segment,target,{rotation,anglesOffset,yaw,preferredDistance,optics}){
 const {angles,orientation}=measurementOrientation(frame,segment,target,rotation);
 if(anglesOffset&&Object.values(anglesOffset).some(Boolean)){
  for(const axis of TORCH_ANGLE_KEYS)angles[axis]+=finiteOrZero(anglesOffset[axis]);
  orientation.fromArray(resolveWeldToolPose({...frame,position:target,pose:angles}).head.quaternion);
 }
 if(yaw)orientation.premultiply(new Quaternion().setFromAxisAngle(vertical,MathUtils.degToRad(yaw)));
 const {min,nominal,max}=LASER_WORKING_DISTANCE;
 const requested=Number.isFinite(preferredDistance)&&preferredDistance>0?preferredDistance:nominal;
 const workingDistance=MathUtils.clamp(requested,min,max);
 const stripe=new Vector3(...optics.emitter).addScaledVector(new Vector3(...optics.beam),workingDistance);
 const headOrigin=new Vector3(...target).sub(stripe.applyQuaternion(orientation));
 const position=new Vector3(...NANYANG_CAMERA_PREVIEW.tcp).applyQuaternion(orientation).add(headOrigin);
 const opticalPosition=new Vector3(...optics.receiver).applyQuaternion(orientation).add(headOrigin).toArray();
 return {position:position.toArray(),target,opticalPosition,workingDistance,sweepYaw:yaw,
  toolPose:{head:{position:headOrigin.toArray(),quaternion:orientation.toArray()},angles}};
}

function sweepNormal(frame,segment){
 const project=point=>new Vector3(...point).setZ(0);
 const {weldNormal}=measurementOrientation(frame,segment,frame.position,0);
 const opening=weldNormal.setZ(0);
 if(opening.lengthSq()>EPS)return opening.normalize();
 const side=project(frame.normal);
 return (side.lengthSq()>EPS?side:project(frame.up)).normalize();
}

export function weldMeasurementPlan(weld,settings={},referenceNormalAt,measurementContext){
 if(!weld?.enabled||weld.mergedInto||weld.splitInto||weld.gapJoinError||verticalTraversal(weld.segments,weld.position)==='conflict')return null;
 const scan=weld.scanSettings??{};
 const method=weldPrecisionMethod(scan,weldMeasurementCapabilities(weld,settings));
 if(!['laserSweep','fixedPhoto','continuous'].includes(method))return null;
 const directed=directedWeld(weld);
 const segments=directed.segments;
 if(!segments.length||segments.some(segment=>!segment.pathPoints||pathLength(segment.pathPoints)<EPS))return null;
 const closed=directed.closure==='closed'||directed.closed===true;
 const sample=prepareWeldSeamFrames(segments,directed.cornerReferenceNormal,closed,referenceNormalAt);
 const stations=[0];
 for(const segment of segments)stations.push(stations.at(-1)+pathLength(segment.pathPoints));
 const total=stations.at(-1),reverse=scan.direction==='reverse';
 const laser=method!=='fixedPhoto';
 const camera=laser?'laser':'structuredLight';
 const optics=laser?laserCameraMount(settings.laserMountSide):null;
 const adjustment=scan.cameraAdjustments?.[camera];
 const offset=offsetVector(adjustment?.position);
 const local=scan.pointAdjustments?.[method];
 const custom=(Array.isArray(scan.customPoints?.[method])?scan.customPoints[method]:[])
  .filter(point=>typeof point?.id==='string'&&Number.isFinite(point.station)&&point.station>=0&&point.station<=total);
 const points=[],paths=[];
 function addPoint({frame,target,distance,label,id,sourceId,yaw,commandZ,speed}){
  const segment=segments[frame.segmentIndex];
  const weldingPose=measurementContext?.weldingPoseAt?.(distance);
  const rotation=finiteOrZero(weldingPose?.angles?.rotation??
   (weldPositionCode(segment.position)==='PF'?settings.actionParameters?.verticalPose:settings.actionParameters?.flatPose)?.rotation);
  const edits=local?.[id];
  const anglesOffset=laser?Object.fromEntries(TORCH_ANGLE_KEYS.map(axis=>[axis,
   finiteOrZero(adjustment?.angles?.[axis])+finiteOrZero(edits?.angles?.[axis])])):edits?.angles;
  const shiftedTarget=offsetVector(edits?.position).add(new Vector3(...target)).toArray();
  const pose=laser?laserToolPose(frame,segment,shiftedTarget,{rotation,anglesOffset,yaw,optics,
   preferredDistance:settings.precisionParameters?.laserWorkingDistance}):
   planFixedPhotoPose(frame,segment,shiftedTarget,{offset,rotation,angleOffsets:anglesOffset,preferredDistance:settings.precisionParameters?.structuredLightPhotoDistance,
    checks:measurementContext&&{scene:measurementContext.scene,error:measurementContext.error,weldingPose}});
  if(commandZ!==undefined){
   const dz=commandZ-pose.position[2]+finiteOrZero(edits?.position?.z);
   for(const xyz of [pose.position,pose.target,pose.opticalPosition,pose.toolPose.head.position])xyz[2]+=dz;
  }
  if(laser)for(const xyz of [pose.position,pose.opticalPosition,pose.toolPose.head.position]){
   xyz[0]+=offset.x;xyz[1]+=offset.y;xyz[2]+=offset.z;
  }
  const manualPose=offset.lengthSq()>EPS||Object.values(edits?.position??{}).some(Boolean)||Object.values(edits?.angles??{}).some(Boolean);
  const point={...pose,id,sourceId,distance,label,manualPose,...(speed!==undefined?{speed}:{})};
  points.push(point);
  return point;
 }
 const start=(index=0)=>sample(stations[index],index);
 if(method==='laserSweep'){
  const precision=settings.precisionParameters;
  const configured=precision?.mixedScan?.scanDistance;
  const horizontal=Number.isFinite(configured)&&configured>=0?configured:DEFAULT_SWEEP_OFFSET;
  const installSign=settings.robotMounting==='inverted'?-1:1;
  const anchors=segments.map((_,index)=>({frame:start(index),distance:stations[index],
   id:'sweep:'+index,label:index===0?'起点':'第 '+index+'、'+(index+1)+' 段连接点'}));
  for(const {id,station} of custom)anchors.push({frame:sample(station),distance:station,id,sourceId:id,label:'自定义点'});
  anchors.sort((a,b)=>reverse?b.distance-a.distance:a.distance-b.distance);
  for(const anchor of anchors){
   const {frame,distance,id,sourceId,label}=anchor,segment=segments[frame.segmentIndex];
   const normal=sweepNormal(frame,segment),across=new Vector3(-normal.y,normal.x,0);
   const center=new Vector3(...frame.position).addScaledVector(normal,horizontal);
   center.z+=installSign*27;
   const last=segment.pathPoints.at(-1);
   const tall=!sourceId&&weldPositionCode(segment.position)==='PF'&&Math.abs(last[2]-frame.position[2])>120;
   const gap=Math.abs(NANYANG_CAMERA_PREVIEW.tcp[2]-NANYANG_TOOL_CALIBRATION.wireTip[2]);
   const levels=tall?[
    {key:'lower',name:'下位',distance,z:frame.position[2]+installSign*(gap+20)},
    {key:'upper',name:'上位',distance:stations[frame.segmentIndex+1],z:last[2]+installSign*(gap-50)}
   ]:[{key:'local',name:'',distance}];
   if(reverse)levels.reverse();
   const sweep=reverse?[[-1,25],[1,-25]]:[[1,-25],[-1,25]];
   const speed=segment.geometry==='圆弧'?precision?.arcSweepSpeed??70:precision?.lineSweepSpeed??150;
   for(const level of levels)paths.push(sweep.map(([sign,yaw],index)=>addPoint({
    frame,target:center.clone().addScaledVector(across,sign*horizontal).toArray(),distance:level.distance,
    label:label+' · '+level.name+'推扫'+(index===0?'起点':'终点'),id:id+':'+level.key+':'+sign,sourceId,yaw,commandZ:level.z,speed
   }).position));
  }
 }else if(method==='fixedPhoto'){
  const photos=[{frame:start(),distance:0,label:'起点拍照',id:'photo:start'}];
  if(scan.measurementScope!=='start'&&!closed)photos.push({frame:sample(total,segments.length-1),distance:total,label:'终点拍照',id:'photo:end'});
  for(const {id,station} of custom)photos.push({frame:sample(station),distance:station,label:'自定义拍照点',id,sourceId:id});
  photos.sort((a,b)=>reverse?b.distance-a.distance:a.distance-b.distance);
  for(const photo of photos)addPoint({...photo,target:photo.frame.position});
 }else{
  const frames=segments.flatMap((segment,index)=>{
   const positions=segment.pathPoints;
   const from=stations[index],length=stations[index+1]-from;
   const step=segment.geometry==='直线'?settings.actionParameters?.lineStep:settings.actionParameters?.arcStep;
   const count=Math.min(256,Math.max(1,Math.ceil(length/(Number.isFinite(step)&&step>0?step:5))));
   const samples=[0,length];
   let station=0;
   for(let i=1;i<positions.length-1;i++){
    station+=Math.hypot(...positions[i].map((value,j)=>value-positions[i-1][j]));
    samples.push(station);
   }
   for(let i=1;i<count;i++)samples.push(length*i/count);
   return samples.sort((a,b)=>a-b).filter((at,i)=>i===0||at-samples[i-1]>EPS)
    .map(at=>({frame:sample(from+at,index),distance:from+at,id:'sample:'+index+':'+at.toFixed(6)}));
  });
  const insertion=new Set(custom.map(point=>point.station.toFixed(6)));
  const waypoints=frames.filter(point=>!insertion.has(point.distance.toFixed(6)));
  for(const {id,station} of custom)waypoints.push({frame:sample(station),distance:station,id,sourceId:id});
  waypoints.sort((a,b)=>a.distance-b.distance);
  if(reverse)waypoints.reverse();
  paths.push(waypoints.map(({frame,distance,id,sourceId},index)=>addPoint({frame,target:frame.position,distance,id,sourceId,
   label:sourceId?'自定义扫描点':index===0?'扫描起点':index===waypoints.length-1?'扫描终点':'扫描点 '+(index+1)}).position));
 }
 return {method,camera,points,paths,length:total};
}
