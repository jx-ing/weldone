import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {Matrix4,Object3D,Quaternion,Vector3} from 'three';
import {
 moveWorkstationJoint,planWorkstationCycle,solveWorkstationRobot,workstationForward,
 workstationJoint,workstationPassFrame,workstationRobot,workstationTarget
} from '../src/workstationSimulation.mjs';
import {NANYANG_TOOL_CALIBRATION} from '../src/weldToolPose.mjs';
import {virtualFineCaptureFrames} from '../src/virtualWorkstationCamera.mjs';
import {importWorkstationScene} from '../src/workstationScene.mjs';

function readStation(){
 const buffer=fs.readFileSync(new URL('../public/models/rizhao-0514-workstation.glb',import.meta.url));
 const data=JSON.parse(buffer.toString('utf8',20,20+buffer.readUInt32LE(12)));
 const nodes=data.nodes.map(({name,matrix,extras})=>{
  const node=new Object3D();
  node.name=name;
  node.userData=extras??{};
  if(matrix)new Matrix4().fromArray(matrix).decompose(node.position,node.quaternion,node.scale);
  return node;
 });
 data.nodes.forEach((node,i)=>node.children?.forEach(child=>nodes[i].add(nodes[child])));
 const object=new Object3D();
 data.scenes[data.scene].nodes.forEach(index=>object.add(nodes[index]));
 const devices=data.nodes.find(node=>node.extras?.weldone).extras.weldone.devices.map(device=>({
  ...device,kind:device.type==='robot'?'robot':device.id.startsWith('fine')?'precision':device.type
 }));
 return {object,devices};
}

const station=readStation();
const rad=Math.PI/180;
const sceneToCad=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2);
const cadPoint=point=>point.clone().applyQuaternion(sceneToCad).multiplyScalar(1000).toArray();
const heading=new Vector3().fromArray(NANYANG_TOOL_CALIBRATION.wireAxis).normalize();
const headToWeld=new Quaternion().setFromUnitVectors(new Vector3(0,0,1),heading);
const seedFor=robot=>Object.fromEntries(robot.arm.map((joint,i)=>[joint.name,[.25,-.55,.85,.3,.7,-.4][i]]));

test('annotated robot FK matches the rendered workstation hierarchy for both arms',()=>{
 assert.equal(workstationRobot(station,'robot_01',[{id:'robot_02'}]),null);
 assert.equal(workstationRobot(station,undefined,[{id:'robot_02'}]).id,'robot_02');
 assert.equal(workstationRobot(station,undefined,[{id:'robot_99'}]),null);
 for(const id of ['robot_01','robot_02']){
  const robot=workstationRobot(station,id);
  const values=seedFor(robot);
  robot.joints.filter(joint=>joint.type==='prismatic').forEach((joint,i)=>values[joint.name]=i?.3:-1.2);
  const target=workstationForward(robot,values);
  const clone=station.object.clone(true);
  clone.traverse(node=>{
   const joint=workstationJoint(node);
   if(joint)moveWorkstationJoint(node,joint,values[joint.name]??0);
  });
  const link=station.devices.find(device=>device.id===id).bindings.find(binding=>binding.role==='welding_tcp').link;
  const tcp=clone.getObjectByName(link);
  assert.ok(tcp.getWorldPosition(new Vector3()).distanceTo(target.position)<1e-8);
  assert.ok(tcp.getWorldQuaternion(new Quaternion()).angleTo(target.quaternion)<1e-6);
  assert.equal(robot.laser.id,id==='robot_01'?'fine_vision_01':'fine_vision_02');
  const solution=solveWorkstationRobot(robot,target,Object.fromEntries(Object.entries(values).map(([name,value])=>[name,value*.8])));
  assert.ok(solution.reachable);
  assert.ok(solution.positionError<.0015);
  assert.ok(solution.angleError<rad);
 }
});

test('workpiece placement is applied in the same coordinates as the workstation view',()=>{
 const tcp={position:[160,260,360],quaternion:[0,0,0,1]};
 const origin=[100,200,300];
 const placement={position:[10,20,30],quaternion:[1,0,0,0]};
 const target=workstationTarget(tcp,origin,placement,false);
 assert.ok(target.position.distanceTo(new Vector3(.17,.26,-.11))<1e-12);
 const up=new Vector3(0,0,1).applyQuaternion(target.quaternion);
 assert.ok(up.distanceTo(new Vector3(0,-1,0))<1e-12);
});

test('a full cycle starts at the held joints and seeks, welds, and retracts in order',async()=>{
 const robot=workstationRobot(station,'robot_02');
 const current=seedFor(robot);
 current.manipulator_joint_2=.52;
 const home=workstationForward(robot,current);
 const weldRotation=sceneToCad.clone().multiply(home.quaternion);
 const points=[0,20].map(distance=>{
  const position=home.position.clone().add(new Vector3(distance*.001,0,0));
  const strike=robot.laser.emitter.clone().addScaledVector(robot.laser.beam,.4035).applyQuaternion(home.quaternion).add(position);
  return {
   distance,target:cadPoint(strike),workingDistance:403.5,speed:150,
   toolPose:{head:{quaternion:weldRotation.clone().multiply(headToWeld.clone().invert()).toArray()}}
  };
 });
 const findPose=distance=>{
  const position=cadPoint(home.position.clone().add(new Vector3(distance*.001,0,0)));
  return {distance,frame:{tangent:[1,0,0],normal:[0,1,0]},tcp:{position,quaternion:weldRotation.toArray()}};
 };
 const pass={startStation:0,endStation:20,toolPoses:[0,20].map(findPose),sampleStations:[10],posesAt:distance=>[findPose(distance)]};
 const measurement={method:'laserSweep',camera:'laser',points,paths:[[points[0].target,points[1].target]]};
 const zero={x:0,y:0,z:0};
 const options={actionParameters:{safeApproachOffset:zero,safeTransitionOffset:zero,endSafeApproachOffset:{x:0,y:0,z:8},endSafeTransitionOffset:{x:0,y:0,z:18}}};
 const request={robot,pass,measurement,origin:[0,0,0],options,current,signal:new AbortController().signal};
 const plan=await planWorkstationCycle(request);
 assert.ok(plan.frames,JSON.stringify(plan));
 assert.deepEqual([...new Set(plan.frames.map(frame=>frame.phase))],['positioning','seeking','approaching','welding','retracting']);
 const start=workstationPassFrame(plan,0),end=workstationPassFrame(plan,100);
 for(const name in current)assert.equal(start.values[name],current[name]);
 assert.equal(end.values.manipulator_joint_2,current.manipulator_joint_2);
 for(const [index,frame] of plan.frames.entries()){
  for(const joint of robot.joints){
   const value=frame.values[joint.name];
   assert.ok(value>=joint.lower&&value<=joint.upper);
   if(index){
    const previous=plan.frames[index-1];
    assert.ok(Math.abs(value-previous.values[joint.name])<=(frame.time-previous.time)*joint.velocity+1e-9);
   }
  }
 }
 const endPose=workstationForward(robot,end.values);
 const lastWeld=workstationForward(robot,plan.frames.findLast(frame=>frame.phase==='welding').values);
 assert.ok(endPose.position.distanceTo(lastWeld.position)>.016);
 const repeated=await planWorkstationCycle({...request,current:end.values});
 assert.ok(repeated.frames,JSON.stringify(repeated));
 assert.deepEqual(workstationPassFrame(repeated,0).values,end.values);
 const missing=await planWorkstationCycle({...request,measurement:null});
 assert.equal(missing.reason,'当前焊道缺少寻位轨迹');
 const calibration={origin:new Vector3(.025,.06,.12),rotation:headToWeld.clone().invert()};
 const optical=home.position.clone().add(calibration.origin.clone().applyQuaternion(home.quaternion));
 const photo={distance:0,opticalPosition:cadPoint(optical),photoCheck:{state:'ready'},
  toolPose:{head:{quaternion:weldRotation.clone().multiply(calibration.rotation).toArray()}}};
 const photoRequest={...request,robot:{...robot,laser:null,structuredLight:{id:'photo',...calibration}},
  measurement:{method:'fixedPhoto',camera:'structuredLight',points:[photo],paths:[[photo.opticalPosition]]}};
 const photographed=await planWorkstationCycle(photoRequest);
 assert.ok(photographed.frames,JSON.stringify(photographed));
 assert.ok(photographed.frames.some(frame=>frame.phase==='seeking'));
 assert.equal(photographed.cameraId,'photo');
 const sceneBytes=fs.readFileSync(new URL('../public/models/rizhao-0514-workstation.glb',import.meta.url));
 const captureStation=await importWorkstationScene(new File([sceneBytes],'workstation.glb'));
 const profiles=virtualFineCaptureFrames(plan,workstationRobot(captureStation,robot.id),request.origin);
 assert.ok(profiles.length>1&&profiles.every(profile=>profile.kind==='laser'&&profile.distance===403.5));
 const images=virtualFineCaptureFrames(photographed,photoRequest.robot,request.origin);
 assert.equal(images.length,1);
 assert.equal(images[0].kind,'photo');
 assert.ok(new Vector3(...images[0].origin).distanceTo(new Vector3(...photo.opticalPosition))<1.6);
 const blocked=await planWorkstationCycle({...photoRequest,measurement:{...photoRequest.measurement,
  points:[{...photo,photoCheck:{state:'blocked',reasons:['光路遮挡 · 立板']}}]}});
 assert.match(blocked.reason,/光路遮挡 · 立板/);
});
