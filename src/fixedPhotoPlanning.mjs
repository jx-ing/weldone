import {Quaternion,Vector3} from 'three';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION,resolveWeldToolPose,weldTorchFrame} from './weldToolPose.mjs';

const up=new Vector3(0,0,1);
const EPS=1e-6;
const radians=Math.PI/180;
const workingDistance=NANYANG_CAMERA_PREVIEW.opticalOrigin[2]-NANYANG_TOOL_CALIBRATION.wireTip[2];
const tcpClearance=1;

function openingSide(frame,segment,target,scene){
 const tangent=new Vector3(...frame.tangent);
 const above=up.clone().addScaledVector(tangent,-up.dot(tangent));
 if(above.lengthSq()<EPS)above.fromArray(frame.up);
 above.normalize();
 const across=above.clone().cross(tangent).normalize();
 const first=new Vector3(...segment.pathPoints[0]),last=new Vector3(...segment.pathPoints.at(-1));
 const inward=target.clone().addScaledVector(tangent,target.distanceToSquared(first)<=target.distanceToSquared(last)?.5:-.5);
 for(const center of [inward,target])for(const span of [.25,.5,1,2,4]){
  const probe=center.clone().addScaledVector(above,Math.min(.8,span/2));
  const solid=sign=>scene.solidAt(probe.clone().addScaledVector(across,sign*span).toArray());
  const forward=solid(1),backward=solid(-1);
  if(forward!==backward)return forward?across.negate():across;
 }
 // At a free end the probes may both miss the plate. Use its recorded face normal.
 const normal=segment.subFaceNormal&&new Vector3(...segment.subFaceNormal).normalize();
 return normal&&Math.abs(normal.dot(across))>.75?across.multiplyScalar(Math.sign(normal.dot(across))):null;
}

function openingBisector(frame,segment,target,side,scene){
 const tangent=new Vector3(...frame.tangent);
 const transverse=values=>new Vector3(...values).projectOnPlane(tangent).normalize();
 const main=transverse(frame.up),lateral=side??transverse(frame.normal);
 if(scene&&side)for(const distance of [.25,.5,1,2]){
  const probe=target.clone().addScaledVector(side,distance);
  const solid=sign=>scene.solidAt(probe.clone().addScaledVector(main,sign*distance).toArray());
  const above=solid(1),below=solid(-1);
  if(above!==below){
   if(above)main.negate();
   break;
  }
 }
 let sub=segment.subFaceNormal?transverse(segment.subFaceNormal):lateral.clone();
 if(Math.abs(sub.dot(lateral))<.2)sub=lateral.clone();
 if(sub.dot(lateral)<0)sub.negate();
 return main.add(sub).normalize();
}

export function measurementOrientation(frame,segment,target,rotation,scene){
 const targetPoint=new Vector3(...target);
 const side=scene?openingSide(frame,segment,targetPoint,scene):null;
 const weldNormal=openingBisector(frame,segment,targetPoint,side,scene);
 const section=weldTorchFrame(frame.tangent,frame.normal,frame.up);
 const work=Math.atan2(weldNormal.dot(new Vector3(...section.up)),weldNormal.dot(new Vector3(...section.normal)))/radians;
 const angles={advance:0,work,rotation};
 const headPose=resolveWeldToolPose({...section,sectionRoll:frame.sectionRoll,position:target,pose:angles});
 return {angles,orientation:new Quaternion(...headPose.head.quaternion),weldNormal,side};
}

export function planFixedPhotoPose(frame,segment,target,{offset,rotation,angleOffsets,preferredDistance,checks}){
 const camera=NANYANG_CAMERA_PREVIEW;
 const targetPoint=new Vector3(...target),scene=checks?.scene;
 const {angles,orientation,weldNormal,side}=measurementOrientation(frame,segment,target,rotation,scene);
 if(angleOffsets){
  for(const [axis,value] of Object.entries(angleOffsets))if(axis in angles&&Number.isFinite(value))angles[axis]+=value;
  orientation.fromArray(resolveWeldToolPose({...frame,position:target,pose:angles}).head.quaternion);
 }
 const axis=up.clone().applyQuaternion(orientation);
 const opticalOrigin=new Vector3(...camera.opticalOrigin);
 const relativeTcp=new Vector3(...camera.tcp).sub(opticalOrigin).applyQuaternion(orientation);
 const relativeWireTip=new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip).sub(opticalOrigin).applyQuaternion(orientation);
 const minTcpDistance=axis.z>EPS?(tcpClearance-relativeTcp.z)/axis.z:workingDistance;
 const outward=side?.dot(axis)??0;
 const minSideDistance=outward>EPS?-side.dot(relativeWireTip)/outward:0;
 const minDistance=Math.max(minTcpDistance,minSideDistance);
 const nominal=Number.isFinite(preferredDistance)&&preferredDistance>0?
  preferredDistance:Math.max(workingDistance,minDistance);
 const distance=Math.max(EPS,minDistance,nominal);
 const opticalPosition=targetPoint.clone().addScaledVector(axis,distance).add(offset);
 const headOrigin=opticalPosition.clone().sub(opticalOrigin.applyQuaternion(orientation));
 const position=opticalPosition.clone().add(relativeTcp);
 const toTarget=targetPoint.clone().sub(position).normalize();
 const tcpRotation=orientation.clone().premultiply(new Quaternion().setFromUnitVectors(axis,toTarget));
 const coordinates=position.toArray();
 const head={position:headOrigin.toArray(),quaternion:orientation.toArray()};
 const point={position:coordinates,target,opticalPosition:opticalPosition.toArray(),photoDistance:opticalPosition.distanceTo(targetPoint),weldNormal:weldNormal.toArray(),
  toolPose:{head,tcp:{position:coordinates,quaternion:tcpRotation.toArray()},angles}};
 const blocked=reason=>({...point,photoCheck:{state:'blocked',reasons:[reason]}});
 if(checks?.error)return blocked(checks.error);
 if(axis.z<=EPS||coordinates[2]<=target[2])return blocked('按焊缝法向和焊接旋转角摆放时，镜头或相机 TCP 无法位于被测点上方');
 if(!checks)return point;
 if(!scene)return {...point,photoCheck:{state:'checking',reasons:['正在加载板件与机头模型']}};
 const axisAtWeld=checks.weldingPose?.wireAxis;
 if(!axisAtWeld?.every(Number.isFinite)||Math.hypot(...axisAtWeld)<EPS||!Number.isFinite(checks.weldingPose.angles?.rotation))
  return blocked('缺少该拍照点的焊接姿态');
 const alignment=axis.dot(new Vector3(...axisAtWeld).normalize());
 if(alignment<-1e-10)return blocked('光轴与焊接焊丝轴的夹角超过 90°');
 if(side&&side.dot(opticalPosition.clone().sub(targetPoint))<=EPS)return blocked('镜头位于立板背侧');
 const obstruction=scene.lineObstruction(point.opticalPosition,target);
 if(obstruction)return blocked('光路遮挡 · '+obstruction.part);
 const collision=scene.contact(head);
 if(collision)return blocked('机头或相机盖干涉 · '+collision.part);
 return {...point,photoCheck:{state:'ready',angle:Math.acos(Math.min(1,Math.max(0,alignment)))/radians}};
}
