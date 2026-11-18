import {Matrix4,Quaternion,Vector3,MathUtils} from 'three';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION} from './weldToolPose.mjs';
import {settingsDefaults} from './planningSettingsModel.mjs';
import {workstationLaser} from './workstationLaserCalibration.mjs';
import {workstationPrecisionBrand} from './workstationDevices.mjs';

const cadToScene=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/2);
const degrees=180/Math.PI;
const angleWeight=.45;
const positionTolerance=.0015;
const angleTolerance=1/degrees;

export function workstationJoint(node){
 const joint=node.userData.urdfJoint;
 if(!['prismatic','revolute'].includes(joint?.type))return null;
 const axis=new Vector3().fromArray((joint.axis??'').trim().split(/\s+/).map(Number)).normalize();
 const [lower,upper,velocity]=['lower','upper','velocity'].map(name=>Number(joint.limits?.[name]));
 if(![axis.x,axis.y,axis.z,lower,upper,velocity].every(Number.isFinite)||!axis.lengthSq()||lower>upper||velocity<=0)return null;
 node.updateMatrix();
 return {name:joint.name,type:joint.type,axis,lower,upper,velocity,origin:node.matrix.clone(),
  position:node.position.clone(),rotation:node.quaternion.clone()};
}

export function workstationRobot(workstation,assignment,plannedRobots){
 const devices=workstation?.devices.filter(device=>device.kind==='robot'&&!device.configured)??[];
 const legacyIndex=assignment==='robot'?0:plannedRobots?.findIndex(robot=>robot.id===assignment)??-1;
 const enabled=device=>!plannedRobots||plannedRobots.some(robot=>robot.id===device.id)||
  plannedRobots.some((robot,index)=>!robot.id.startsWith('robot_')&&!devices.some(item=>item.id===robot.id)&&devices[index]===device);
 const device=assignment
  ? devices.find(item=>item.id===assignment)??(!assignment.startsWith('robot_')?devices[legacyIndex]:undefined)
  : devices.find(enabled);
 if(!device||!enabled(device))return null;
 const names=Object.fromEntries(device.bindings.map(binding=>[binding.role,binding.link]));
 const tcp=workstation.object.getObjectByProperty('name',names.welding_tcp);
 const base=workstation.object.getObjectByProperty('name',names.base);
 if(!tcp||!base)return null;
 const links=[];
 let onArm=true,hasBase=false;
 for(let node=tcp;node;node=node.parent){
  if(node===base){onArm=false;hasBase=true;}
  const joint=workstationJoint(node);
  if(!joint&&['prismatic','revolute'].includes(node.userData.urdfJoint?.type))return null;
  node.updateMatrix();
  links.unshift({origin:joint?.origin??node.matrix.clone(),joint,onArm});
  if(node===workstation.object)break;
 }
 const joints=links.flatMap(link=>link.joint?[link.joint]:[]);
 const arm=links.filter(link=>link.onArm&&link.joint).map(link=>link.joint);
 if(!hasBase||arm.length!==6)return null;
 return {id:device.id,label:`机械臂 ${devices.indexOf(device)+1} · ${device.model}`,links,joints,arm,
  laser:workstationLaser(workstation,device),structuredLight:workstationStructuredLight(workstation,device,tcp)};
}

export function workstationTarget(tcp,origin,placement,invertZ){
 // The viewer recenters CAD around its mesh origin. The workstation stays in the
 // original world coordinates, so undo that common translation after placement.
 const sceneOrigin=new Vector3().fromArray(origin).applyQuaternion(cadToScene);
 const placementRotation=placement?new Quaternion().fromArray(placement.quaternion):new Quaternion();
 const position=new Vector3().fromArray(tcp.position).applyQuaternion(cadToScene).sub(sceneOrigin);
 if(invertZ)position.y*=-1;
 position.applyQuaternion(placementRotation);
 if(placement)position.add(new Vector3().fromArray(placement.position));
 position.add(sceneOrigin).multiplyScalar(.001);
 const rotation=cadToScene.clone().multiply(new Quaternion().fromArray(tcp.quaternion));
 const x=new Vector3(1,0,0).applyQuaternion(rotation);
 const z=new Vector3(0,0,1).applyQuaternion(rotation);
 if(invertZ){x.y*=-1;z.y*=-1;}
 x.applyQuaternion(placementRotation);
 z.applyQuaternion(placementRotation);
 // Keep the wire and roll axes when the CAD display flips Z. A robot TCP
 // remains a right-handed frame even when its displayed workpiece is mirrored.
 const quaternion=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,z.clone().cross(x),z));
 return {position,quaternion};
}

export function workstationCadPosition(point,origin,placement,invertZ){
 const sceneOrigin=new Vector3().fromArray(origin).applyQuaternion(cadToScene);
 const position=point.clone().multiplyScalar(1000).sub(sceneOrigin);
 if(placement)position.sub(new Vector3(...placement.position))
  .applyQuaternion(new Quaternion(...placement.quaternion).invert());
 if(invertZ)position.y*=-1;
 return position.add(sceneOrigin).applyQuaternion(cadToScene.clone().invert());
}

export function moveWorkstationJoint(node,joint,value,delta=new Quaternion()){
 node.position.copy(joint.position);
 node.quaternion.copy(joint.rotation);
 if(joint.type==='prismatic')node.position.addScaledVector(joint.axis.clone().applyQuaternion(joint.rotation),value);
 else node.quaternion.multiply(delta.setFromAxisAngle(joint.axis,value));
}

export function workstationForward(robot,values){
 const matrix=new Matrix4(),motion=new Matrix4(),frames=[];
 for(const {origin,joint} of robot.links){
  matrix.multiply(origin);
  if(!joint)continue;
  const axis=joint.axis.clone().transformDirection(matrix);
  const pivot=new Vector3().setFromMatrixPosition(matrix);
  frames.push({axis,pivot});
  const value=values[joint.name]??0;
  if(joint.type==='prismatic')motion.makeTranslation(joint.axis.x*value,joint.axis.y*value,joint.axis.z*value);
  else motion.makeRotationAxis(joint.axis,value);
  matrix.multiply(motion);
 }
 return {position:new Vector3().setFromMatrixPosition(matrix),quaternion:new Quaternion().setFromRotationMatrix(matrix),frames};
}

function rotationError(target,current){
 const q=target.clone().multiply(current.clone().invert()).normalize();
 const s=Math.hypot(q.x,q.y,q.z);
 const angle=2*Math.atan2(s,Math.abs(q.w));
 return new Vector3(q.x,q.y,q.z).multiplyScalar(s<1e-12?0:Math.sign(q.w||1)*angle/s);
}

// The damped least-squares step follows the existing gantry robot solver.
function solveLinear(matrix,vector){
 const rows=matrix.map((row,i)=>[...row,vector[i]]);
 for(let i=0;i<vector.length;i++){
  let pivot=i;
  for(let k=i+1;k<rows.length;k++)if(Math.abs(rows[k][i])>Math.abs(rows[pivot][i]))pivot=k;
  [rows[i],rows[pivot]]=[rows[pivot],rows[i]];
  const scale=rows[i][i];
  for(let k=i;k<=rows.length;k++)rows[i][k]/=scale;
  for(let j=0;j<rows.length;j++){
   if(j===i)continue;
   const factor=rows[j][i];
   for(let k=i;k<=rows.length;k++)rows[j][k]-=factor*rows[i][k];
  }
 }
 return rows.map(row=>row.at(-1));
}

function dampedJointStep(joints,values,columns,error,damping){
 let free=columns.map((_,index)=>index);
 const deltas=Array(columns.length).fill(0);
 // Recompute after removing joints that can only move further past a limit.
 // Otherwise a saturated rail or wrist still absorbs part of the TCP error.
 while(free.length){
  const matrix=Array.from({length:6},(_,r)=>Array.from({length:6},(_,c)=>
   free.reduce((sum,i)=>sum+columns[i][r]*columns[i][c],r===c?damping**2:0)));
  const step=solveLinear(matrix,error);
  const remaining=free.filter(i=>{
   const joint=joints[i],value=values[joint.name];
   const delta=columns[i].reduce((sum,component,k)=>sum+component*step[k],0);
   if(delta<0&&value<=joint.lower+1e-8||delta>0&&value>=joint.upper-1e-8){deltas[i]=0;return false;}
   deltas[i]=delta;
   return true;
  });
  if(remaining.length===free.length)break;
  free=remaining;
 }
 return deltas;
}

export function solveWorkstationRobot(robot,target,seed={},iterations=100){
 const {joints}=robot;
 const values=Object.fromEntries(joints.map(joint=>[joint.name,MathUtils.clamp(seed[joint.name]??0,joint.lower,joint.upper)]));
 let best;
 for(let iteration=0;iteration<=iterations;iteration++){
  const pose=workstationForward(robot,values);
  const dp=target.position.clone().sub(pose.position),dr=rotationError(target.quaternion,pose.quaternion);
  const positionError=dp.length(),angleError=dr.length();
  const score=positionError**2+(angleWeight*angleError)**2;
  const reachable=positionError<=positionTolerance&&angleError<=angleTolerance;
  if(reachable||!best||score<best.score)best={values:{...values},positionError,angleError,score,reachable};
  if(reachable||iteration===iterations)break;
  const columns=joints.map((joint,index)=>{
   const {axis,pivot}=pose.frames[index];
   if(joint.type==='prismatic')return [...axis.toArray(),0,0,0];
   const linear=axis.clone().cross(pose.position.clone().sub(pivot));
   return [...linear.toArray(),...axis.clone().multiplyScalar(angleWeight).toArray()];
  });
  const damping=score>.01?.045:.008;
  const deltas=dampedJointStep(joints,values,columns,[...dp.toArray(),...dr.multiplyScalar(angleWeight).toArray()],damping);
  if(deltas.every(delta=>Math.abs(delta)<1e-10))break;
  joints.forEach((joint,i)=>{
   const limit=joint.type==='prismatic'?.25:.22;
   values[joint.name]=MathUtils.clamp(values[joint.name]+MathUtils.clamp(deltas[i],-limit,limit),joint.lower,joint.upper);
  });
 }
 return best;
}

const startingAngles=[
 [0,-.7,1.2,0,.9,0],[0,.6,-.8,0,-.9,0],
 [Math.PI/2,-.7,1.2,0,.8,0],[-Math.PI/2,-.7,1.2,0,.8,0],
 [0,1.4,.2,Math.PI/2,-1,0],[0,-1,2,-Math.PI/2,-.8,Math.PI/2],
];

function* startingSeeds(robot,target,current){
 yield current;
 const externalYaw=robot.joints.find(joint=>joint.type==='revolute'&&!robot.arm.includes(joint));
 for(const yaw of [0,Math.PI/2,-Math.PI/2,Math.PI]){
  for(const angles of startingAngles){
   const seed={...current,...Object.fromEntries(robot.arm.map((joint,i)=>[joint.name,angles[i]]))};
   if(externalYaw)seed[externalYaw.name]=MathUtils.clamp((current[externalYaw.name]??0)+yaw,externalYaw.lower,externalYaw.upper);
   const pose=workstationForward(robot,seed);
   const displacement=target.position.clone().sub(pose.position);
   robot.joints.forEach((joint,i)=>{
    if(joint.type==='prismatic')seed[joint.name]=MathUtils.clamp((seed[joint.name]??0)+.75*displacement.dot(pose.frames[i].axis),joint.lower,joint.upper);
   });
   yield seed;
  }
 }
}

function weldStations(pass){
 const {startStation,endStation}=pass;
 const length=endStation-startStation;
 const count=Math.ceil(length/15);
 return [...new Set([
  startStation,endStation,...pass.toolPoses.map(pose=>pose.distance),...pass.sampleStations,
  ...Array.from({length:Math.max(0,count-1)},(_,i)=>startStation+length*(i+1)/count)
 ])].filter(station=>station>=startStation&&station<=endStation).sort((a,b)=>a-b);
}

const wire=new Vector3().fromArray(NANYANG_TOOL_CALIBRATION.wireAxis).normalize();
const headX=new Vector3().fromArray(NANYANG_TOOL_CALIBRATION.referenceX);
const headToWeld=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(headX,wire.clone().cross(headX),wire));
const rapidSpeed=.25; // Nominal simulated Cartesian transfer speed, m/s.

function workstationStructuredLight(workstation,robot,tcp){
 for(const camera of workstation.devices.filter(device=>workstationPrecisionBrand(device)==='weijing')){
  if(camera.kind!=='precision'||camera.robotId!==robot.id)continue;
  if(camera.configured){
   const rotation=headToWeld.clone().invert();
   const origin=new Vector3(...NANYANG_CAMERA_PREVIEW.opticalOrigin)
    .sub(new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip)).applyQuaternion(rotation).multiplyScalar(.001);
   return {id:camera.id,origin,rotation};
  }
  const flange=workstation.object.getObjectByName(robot.bindings.find(binding=>binding.role==='flange')?.link);
  const optical=flange?.getObjectByName(camera.bindings.find(binding=>binding.role==='optical_origin')?.link);
  if(optical)return {id:camera.id,origin:tcp.worldToLocal(optical.getWorldPosition(new Vector3())),
   rotation:tcp.getWorldQuaternion(new Quaternion()).invert().multiply(optical.getWorldQuaternion(new Quaternion()))};
 }
 return null;
}

function workstationPhotoTarget(point,robot,targetFor){
 const {origin,rotation}=robot.structuredLight;
 const weldRotation=new Quaternion().fromArray(point.toolPose.head.quaternion).multiply(rotation.clone().invert());
 const target=targetFor({position:point.opticalPosition,quaternion:weldRotation.toArray()});
 target.position.sub(origin.clone().applyQuaternion(target.quaternion));
 return target;
}

export function workstationLaserTarget(point,robot,targetFor,scan){
 const rotation=new Quaternion().fromArray(point.toolPose.head.quaternion).multiply(headToWeld);
 const shifts=scan?.cameraAdjustments?.laser?.position;
 const offset=['x','y','z'].map(axis=>Number(shifts?.[axis])||0);
 const coordinates=point.target.map((value,index)=>value+offset[index]);
 const target=targetFor({position:coordinates,quaternion:rotation.toArray()});
 const fromWeldTcp=robot.laser.emitter.clone().addScaledVector(robot.laser.beam,point.workingDistance*.001);
 target.position.sub(fromWeldTcp.applyQuaternion(target.quaternion));
 return target;
}

function offsetTcp(pose,offset){
 const {tangent,normal}=pose.frame;
 const along=new Vector3().fromArray(tangent),across=new Vector3().fromArray(normal);
 const position=new Vector3().fromArray(pose.tcp.position)
  .addScaledVector(along,offset.x).addScaledVector(across,offset.y)
  .addScaledVector(along.clone().cross(across).normalize(),offset.z);
 return {...pose.tcp,position:position.toArray()};
}

function addLinear(targets,next,speed,poseAtStation){
 const previous=targets.at(-1);
 const travel=previous.position.distanceTo(next.position);
 const turn=previous.quaternion.angleTo(next.quaternion);
 const steps=Math.max(1,Math.ceil(travel/.015),Math.ceil(turn/(5/degrees)));
 for(let i=1;i<=steps;i++){
  const fraction=i/steps;
  const station=MathUtils.lerp(previous.station,next.station,fraction);
  const sampled=i<steps&&next.station>previous.station?poseAtStation?.(station):undefined;
  const pose=i===steps?next:sampled??{
   position:previous.position.clone().lerp(next.position,fraction),
   quaternion:previous.quaternion.clone().slerp(next.quaternion,fraction)
  };
  targets.push({...next,position:pose.position,quaternion:pose.quaternion,station,
   travelTime:targets.at(-1).position.distanceTo(pose.position)/speed});
 }
}

function cycleTargets(robot,pass,measurement,origin,placement,invertZ,options,scan){
 const targetFor=tcp=>workstationTarget(tcp,origin,placement,invertZ);
 const targets=[];
 const measurementPoints=measurement.points;
 const photo=measurement.camera==='structuredLight';
 const groups=photo?measurementPoints.map(point=>[point]):measurement.method==='continuous'?[measurementPoints]:
  measurement.paths.map((_,i)=>measurementPoints.slice(i*2,i*2+2));
 for(const [groupIndex,group] of groups.entries()){
  group.forEach((point,i)=>{
    const pose=photo?workstationPhotoTarget(point,robot,targetFor):workstationLaserTarget(point,robot,targetFor,scan);
    const target={...pose,station:point.distance,phase:i?'seeking':'positioning',
     capture:{group:groupIndex,distance:photo?point.photoDistance:point.workingDistance},
     ...(photo?{point:point.label??'定点拍照'}:{})};
   if(!i){
    targets.push(target);
    // Assign the measurement phase at the first sample even for short sweeps.
    targets.push({...target,phase:'seeking',travelTime:.2});
   }else addLinear(targets,target,(point.speed>0?point.speed/60000:.035));
  });
 }
 const {actionParameters:action}=settingsDefaults(options,options.deviceCapabilities);
 const start=pass.posesAt(pass.startStation)[0],end=pass.posesAt(pass.endStation).at(-1);
 if(!start||!end)return null;
 targets.push({...targetFor(offsetTcp(start,action.safeTransitionOffset)),station:pass.startStation,phase:'approaching',point:'起点安全过渡点'});
 addLinear(targets,{...targetFor(offsetTcp(start,action.safeApproachOffset)),station:pass.startStation,phase:'approaching',point:'起点安全接近段'},rapidSpeed);
 addLinear(targets,{...targetFor(start.tcp),station:pass.startStation,phase:'approaching',point:'进枪至焊接起点'},rapidSpeed);
 const weldPoseAt=station=>{
  const pose=pass.posesAt(station).at(-1);
  return pose?targetFor(pose.tcp):undefined;
 };
 for(const station of weldStations(pass)){
  const poses=pass.posesAt(station);
  if(!poses.length)return null;
  for(const {tcp} of poses){
   const speed=pass.speedAt?.(station);
   const destination={...targetFor(tcp),station,phase:'welding'};
   addLinear(targets,destination,speed>0?speed/60000:Math.max(.005,(pass.endStation-pass.startStation)*.001/12.5),weldPoseAt);
  }
 }
 for(const key of ['endSafeApproachOffset','endSafeTransitionOffset']){
  addLinear(targets,{...targetFor(offsetTcp(end,action[key])),station:pass.endStation,phase:'retracting'},rapidSpeed);
 }
 return targets;
}

function failedAt(target,solution){
 const {phase,point,station}=target;
 return {phase,point,station,positionError:solution.positionError,angleError:solution.angleError};
}

async function solveContinuousMotion(robot,targets,current,signal){
 // Anchor welding at its actual start, so the way in and the process motion
 // use one configuration. A seek block is anchored at its first measuring pose.
 const welding=targets.findIndex(target=>target.phase==='welding');
 const anchor=welding<0?0:welding-1;
 const seedTarget=welding<0?targets[anchor]:{...targets[anchor],point:'焊接起点'};
 const candidates=[];
 let bestStart;
 let bestFailure;
 for(const seed of startingSeeds(robot,seedTarget,current)){
  signal.throwIfAborted();
  const atStart=solveWorkstationRobot(robot,seedTarget,seed,165);
  await new Promise(resolve=>setTimeout(resolve,0));
  if(!bestStart||atStart.score<bestStart.score)bestStart=atStart;
  if(!atStart.reachable||candidates.some(values=>robot.joints.every(joint=>Math.abs(values[joint.name]-atStart.values[joint.name])<.05)))continue;
  candidates.push(atStart.values);
  const solutions=new Array(targets.length);
  solutions[anchor]=atStart;
  let failure;
  for(const direction of [-1,1]){
   for(let i=anchor+direction;i>=0&&i<targets.length;i+=direction){
    signal.throwIfAborted();
    const solution=solveWorkstationRobot(robot,targets[i],solutions[i-direction].values,125);
    if(!solution.reachable){failure={target:targets[i],solution,index:i};break;}
    solutions[i]=solution;
    if(i%8===0)await new Promise(resolve=>setTimeout(resolve,0));
   }
   if(failure)break;
  }
  if(!failure)return {solutions};
  if(!bestFailure||failure.index>bestFailure.index||failure.index===bestFailure.index&&failure.solution.score<bestFailure.solution.score)bestFailure=failure;
 }
 return {failure:bestFailure?failedAt(bestFailure.target,bestFailure.solution):failedAt(seedTarget,bestStart)};
}

export async function planWorkstationCycle({robot,pass,measurement,origin,placement,invertZ,options,scan,current,signal}){
 if(!measurement?.points.length)return {reason:'当前焊道缺少寻位轨迹'};
 const photo=measurement.camera==='structuredLight';
 const camera=photo?robot.structuredLight:measurement.camera==='laser'?robot.laser:null;
 if(!camera)return {reason:'当前机械臂缺少与寻位方式匹配的精定位相机'};
 if(photo){
  const failed=measurement.points.find(point=>point.photoCheck?.state!=='ready');
  if(failed)return {reason:[failed.label??'定点拍照',...(failed.photoCheck?.reasons??['拍照点未通过工件与机头检查'])].join(' · ')};
 }
 const targets=cycleTargets(robot,pass,measurement,origin,placement,invertZ,options,scan);
 if(!targets?.length)return {reason:'当前焊道缺少完整的 TCP 位姿'};
 const home=Object.fromEntries(robot.joints.map(joint=>[joint.name,MathUtils.clamp(current[joint.name]??0,joint.lower,joint.upper)]));
 const frames=[{station:targets[0].station,time:0,phase:'positioning',travelMm:0,values:{...current,...home}}];
 let position=workstationForward(robot,home).position;
 const blocks=[];
 for(const target of targets){
  if(target.travelTime===undefined)blocks.push([]);
  blocks.at(-1).push(target);
 }
 for(const block of blocks){
  const result=await solveContinuousMotion(robot,block,frames.at(-1).values,signal);
  if(result.failure)return result.failure;
  for(const [index,target] of block.entries()){
   const previous=frames.at(-1),solved=result.solutions[index];
   const jointTime=Math.max(...robot.joints.map(joint=>
    Math.abs(solved.values[joint.name]-previous.values[joint.name])/joint.velocity));
    const nextPosition=workstationForward(robot,solved.values).position;
   frames.push({station:target.station,phase:target.phase,time:previous.time+Math.max(.015,target.travelTime??.5,jointTime),
     travelMm:previous.travelMm+position.distanceTo(nextPosition)*1000,
     ...(target.phase==='seeking'&&target.capture?{capture:target.capture}:{}),
    values:{...previous.values,...solved.values}});
    position=nextPosition;
  }
 }
 return {frames,duration:frames.at(-1).time,cameraId:camera.id,camera:measurement.camera};
}

export function workstationPassFrame(plan,progress){
 if(!plan?.frames?.length)return null;
 const {frames,duration}=plan;
 const time=MathUtils.clamp(progress/100,0,1)*duration;
 let low=0,high=frames.length-1;
 while(high-low>1){
  const middle=(high+low)>>1;
  if(frames[middle].time<=time)low=middle;
  else high=middle;
 }
 const from=frames[low],to=frames[high];
 const fraction=to.time>from.time?(time-from.time)/(to.time-from.time):0;
 return {station:MathUtils.lerp(from.station,to.station,fraction),phase:to.phase,time,
  travelMm:MathUtils.lerp(from.travelMm??0,to.travelMm??0,fraction),
  values:Object.fromEntries(Object.entries(from.values).map(([name,value])=>[name,MathUtils.lerp(value,to.values[name],fraction)]))};
}
