import {Quaternion,Vector3} from 'three';
import {DEFAULT_LASER_MOUNT_SIDE} from './laserCameraMount.mjs';
import {pathLength} from './manualWeldModel.mjs';
import {weldPositionCode} from './planningRequirements.mjs';
import {directedWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {prepareWeldSeamFrames} from './weldSeamFrames.mjs';
import {resolveWeldToolPose} from './weldToolPose.mjs';

export const LASER_DIRECTION_ISSUE='当前安装侧和焊接姿态无法让激光始终位于焊枪前方';

export function laserLeadsTravel(tcpRotation,tangent,side=DEFAULT_LASER_MOUNT_SIDE){
 return new Vector3(side==='positiveX'?1:-1,0,0)
  .applyQuaternion(new Quaternion(...tcpRotation)).dot(new Vector3(...tangent))>1e-6;
}

export function laserTravelDirection(weld,settings){
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
    return frame&&laserLeadsTravel(resolveWeldToolPose({...frame,pose:angles}).tcp.quaternion,frame.tangent,settings.laserMountSide);
   }))return false;
  }
  return true;
 });
}
