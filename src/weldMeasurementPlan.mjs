import {Quaternion,Vector3} from 'three';
import {pathLength} from './manualWeldModel.mjs';
import {directedWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION,TORCH_ANGLE_KEYS,resolveWeldToolPose,weldTorchOrientation} from './weldToolPose.mjs';
import {weldPrecisionMethod} from './weldAttributeModel.mjs';

export const DEFAULT_SWEEP_OFFSET=10;
const EPS=1e-6;
const finiteOrZero=value=>Number.isFinite(value)?value:0;

function cameraToolPose(frame,target,distance,laser,standardAngles,angles,offset){
 const camera=NANYANG_CAMERA_PREVIEW;
 const workingDistance=laser?camera.laserWorkingDistance:camera.opticalOrigin[2]-NANYANG_TOOL_CALIBRATION.wireTip[2];
 const up=new Vector3(0,0,1);
 let orientation;
 if(laser){
  const placement={...frame,position:target,distance};
  orientation=pose=>new Quaternion().fromArray(resolveWeldToolPose({...placement,pose}).head.quaternion);
 }else{
  // In the overhead photo frame, zero angles point the camera's local -Z down.
  const [x,y]=frame.tangent,[nx,ny]=frame.normal;
  const horizontal=Math.hypot(x,y)>EPS?[x,y,0]:[nx,ny,0];
  orientation=pose=>weldTorchOrientation(horizontal,up.toArray(),pose);
 }
 const standardRotation=orientation(standardAngles);
 const viewingAxis=laser?up.clone().applyQuaternion(standardRotation).normalize():up;
 const opticalOrigin=new Vector3(...camera.opticalOrigin),tcp=new Vector3(...camera.tcp);
 const opticalToTcp=tcp.clone().sub(opticalOrigin).applyQuaternion(standardRotation);
 const position=new Vector3(...target).addScaledVector(viewingAxis,workingDistance).add(opticalToTcp).add(offset);
 const rotation=angles===standardAngles?standardRotation:orientation(angles);
 const headOrigin=position.clone().sub(tcp.applyQuaternion(rotation));
 const opticalPosition=opticalOrigin.applyQuaternion(rotation).add(headOrigin).toArray();
 return {position:position.toArray(),target,opticalPosition,toolPose:{head:{position:headOrigin.toArray(),quaternion:rotation.toArray()},angles}};
}

export function weldMeasurementPlan(weld,settings={},referenceNormalAt){
 if(!weld?.enabled||weld.mergedInto||weld.splitInto||weld.gapJoinError||verticalTraversal(weld.segments,weld.position)==='conflict')return null;
 const scan=weld.scanSettings??{};
 const method=weldPrecisionMethod(scan,settings.deviceCapabilities);
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
 const adjustment=scan.cameraAdjustments?.[camera];
 const cameraStandard=settings.precisionParameters?.[laser?'laserPose':'structuredLightPose'];
 const fallback=laser?settings.actionParameters?.flatPose:null;
 const standardAngles=Object.fromEntries(TORCH_ANGLE_KEYS.map(axis=>[axis,
  Number.isFinite(cameraStandard?.[axis])?cameraStandard[axis]:finiteOrZero(fallback?.[axis])]));
 const poseOffsets=TORCH_ANGLE_KEYS.map(axis=>finiteOrZero(adjustment?.angles?.[axis]));
 const angles=poseOffsets.some(Boolean)?Object.fromEntries(TORCH_ANGLE_KEYS.map((axis,i)=>[axis,standardAngles[axis]+poseOffsets[i]])):standardAngles;
 const offset=new Vector3(...['x','y','z'].map(axis=>finiteOrZero(adjustment?.position?.[axis])));
 const points=[],paths=[];
 function addPoint(frame,position,distance,label){
  const point={...cameraToolPose(frame,position,distance,laser,standardAngles,angles,offset),distance,label};
  points.push(point);
  return point;
 }
 const start=(index=0)=>sample(stations[index],index);
 if(method==='laserSweep'){
  const configured=settings.precisionParameters?.mixedScan?.scanDistance;
  const offset=Number.isFinite(configured)&&configured>=0?configured:DEFAULT_SWEEP_OFFSET;
  for(let index=0;index<segments.length;index++){
   const frame=start(index),station=stations[index];
   const name=index===0?'起点':`第 ${index}、${index+1} 段连接点`;
   const before={shift:-offset,label:'推扫前侧'},after={shift:offset,label:'推扫后侧'};
   const sweep=reverse?[after,before]:[before,after];
   paths.push(sweep.map(({shift,label})=>{
    const target=frame.position.map((axis,i)=>axis+frame.tangent[i]*shift);
    return addPoint(frame,target,station+shift,`${name} · ${label}`).position;
   }));
  }
 }else if(method==='fixedPhoto'){
  const startPhoto={frame:start(),station:0,label:'起点拍照'};
  const endPhoto={frame:sample(total,segments.length-1),station:total,label:'终点拍照'};
  const photos=scan.measurementScope==='start'||closed?[startPhoto]:reverse?[endPhoto,startPhoto]:[startPhoto,endPhoto];
  for(const {frame,station,label} of photos)addPoint(frame,frame.position,station,label);
 }else{
  const frames=segments.flatMap((segment,index)=>{
   const positions=segment.pathPoints;
   const from=stations[index],length=stations[index+1]-from;
   const step=segment.geometry==='直线'?settings.actionParameters?.lineStep:settings.actionParameters?.arcStep;
   const count=Math.min(256,Math.max(1,Math.ceil(length/(Number.isFinite(step)&&step>0?step:5))));
   const local=[0,length];
   let station=0;
   for(let i=1;i<positions.length-1;i++){
    station+=Math.hypot(...positions[i].map((value,j)=>value-positions[i-1][j]));
    local.push(station);
   }
   for(let i=1;i<count;i++)local.push(length*i/count);
   return local.sort((a,b)=>a-b).filter((at,i)=>i===0||at-local[i-1]>EPS)
    .map(at=>({frame:sample(from+at,index),distance:from+at}));
  });
  if(reverse)frames.reverse();
  paths.push(frames.map(({frame,distance},index)=>addPoint(frame,frame.position,distance,
   index===0?'扫描起点':index===frames.length-1?'扫描终点':`扫描点 ${index+1}`).position));
 }
 return {method,camera,points,paths};
}
