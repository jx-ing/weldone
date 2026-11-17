import {Quaternion,Vector3} from 'three';
import {DEFAULT_LASER_MOUNT_SIDE,LASER_MOUNT_SIDES,laserCameraMount} from './laserCameraMount.mjs';
import {pathLength} from './manualWeldModel.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {directedWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {NANYANG_TOOL_CALIBRATION,resolveWeldToolPose} from './weldToolPose.mjs';

export const LASER_DIRECTION_ISSUE='当前安装侧和焊接姿态无法让激光始终位于焊枪前方';

const wireTip=new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip);
const tcpX=new Vector3(...NANYANG_TOOL_CALIBRATION.referenceX);
const tcpZ=new Vector3(...NANYANG_TOOL_CALIBRATION.wireAxis).normalize();
const tcpY=tcpZ.clone().cross(tcpX);
const fanPlanes=new Map(LASER_MOUNT_SIDES.map(([side])=>{
 const {fanNormal,stripe}=laserCameraMount(side);
 const normal=new Vector3(...fanNormal);
 const gap=normal.dot(new Vector3(...stripe).sub(wireTip));
 return [side,{normal:new Vector3(normal.dot(tcpX),normal.dot(tcpY),normal.dot(tcpZ)),gap}];
}));

export function laserTrackingGeometry(weld,settings){
 if(!settings.laserTrackingByRobot)return settings.laserMountSide??DEFAULT_LASER_MOUNT_SIDE;
 const byRobot=settings.laserTrackingByRobot;
 const id=weld.assignedRobot??settings.planningRobots?.[0]?.id??Object.keys(byRobot)[0];
 const geometry=byRobot[id];
 if(!geometry||settings.robotMounting!=='inverted')return geometry??null;
 const reflect=([x,y,z])=>[x,-y,z];
 return {...geometry,normal:reflect(geometry.normal),nominal:reflect(geometry.nominal)};
}

export function laserTrackingSignature(weld,settings){
 if(!weld.segments?.some(segment=>segment.effectiveLaserTracking))return undefined;
 return JSON.stringify([weld.laserTrackingDirection??null,laserTrackingGeometry(weld,settings)]);
}

export function laserLeadsTravel(tcpRotation,tangent,geometry=DEFAULT_LASER_MOUNT_SIDE){
 const rotation=new Quaternion(...tcpRotation),travel=new Vector3(...tangent);
 if(!geometry)return false;
 if(typeof geometry==='object'){
  const nominal=new Vector3(...geometry.nominal).applyQuaternion(rotation);
  const direction=new Vector3(...geometry.normal).applyQuaternion(rotation).dot(travel);
  return nominal.dot(travel)>1e-6&&Math.abs(geometry.gap)>1e-6&&Math.sign(geometry.gap)*direction>1e-6;
 }
 const nominal=new Vector3(geometry==='positiveX'?1:-1,0,0).applyQuaternion(rotation);
 if(nominal.dot(travel)<=1e-6)return false;
 const {normal,gap}=fanPlanes.get(geometry)??fanPlanes.get(DEFAULT_LASER_MOUNT_SIDE);
 return Math.sign(gap)*normal.clone().applyQuaternion(rotation).dot(travel)>1e-6;
}

export function laserTravelDirection(weld,settings){
 const geometry=laserTrackingGeometry(weld,settings);
 const vertical=verticalTraversal(weld.segments,weld.position);
 if(vertical==='conflict')return;
 const first=weld.direction==='反向'?'反向':'正向';
 const directions=vertical?[vertical==='down'?'反向':'正向']:[first,first==='正向'?'反向':'正向'];
 return directions.find(direction=>{
  const {segments,closure,cornerReferenceNormal}=directedWeld({...weld,direction});
  const sample=prepareWeldSeamFrames(segments,cornerReferenceNormal,closure==='closed',
   settings.measureTemplateNeighborhood?.referenceNormalAt);
  let station=0;
  for(const [index,segment] of segments.entries()){
   if(!segment.pathPoints?.length)return false;
   const length=pathLength(segment.pathPoints);
   const start=station;
   station+=length;
   if(!segment.effectiveLaserTracking)continue;
   const standard=weldPositionCode(segment.position)==='PF'?settings.actionParameters?.verticalPose:settings.actionParameters?.flatPose;
   const angles={advance:standard?.advance??0,work:standard?.work??45,rotation:standard?.rotation??0};
   const distances=[0,length/2,length];
   let vertex=0;
   for(let i=1;i<segment.pathPoints.length-1;i++){
    const [a,b]=segment.pathPoints.slice(i-1,i+1);
    vertex+=Math.hypot(...a.map((value,axis)=>value-b[axis]));
    distances.push(vertex);
   }
   if(!distances.every(at=>{
    const frame=sample(start+at,index);
    return frame&&laserLeadsTravel(resolveWeldToolPose({...frame,pose:angles}).tcp.quaternion,frame.tangent,geometry);
   }))return false;
  }
  return true;
 });
}
