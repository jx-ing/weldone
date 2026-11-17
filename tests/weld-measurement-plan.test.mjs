import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION} from '../src/weldToolPose.mjs';
import {weldMeasurementPlan} from '../src/weldMeasurementPlan.mjs';
import {planFixedPhotoPose} from '../src/fixedPhotoPlanning.mjs';

const flatPose={advance:10,work:35,rotation:5};
const settings={deviceCapabilities:{laserPrecision:true},actionParameters:{flatPose},
 precisionParameters:{mixedScan:{scanDistance:8}}};
const weld={enabled:true,position:'PB',segments:[
 {position:'PB',geometry:'直线',pathPoints:[[0,0,0],[100,0,0]],referenceNormal:[0,0,1]},
 {position:'PB',geometry:'圆弧',pathPoints:[[100,0,0],[110,10,0],[110,20,0]],referenceNormal:[0,0,1]}
]};

function assertPhotoAimsAtTarget(point){
 const {head,tcp}=point.toolPose;
 const target=new Vector3(...point.target);
 const orientation=new Quaternion(...head.quaternion);
 const opticalAxis=new Vector3(0,0,-1).applyQuaternion(orientation);
 const tcpAxis=new Vector3(0,0,1).applyQuaternion(new Quaternion(...tcp.quaternion));
 assert.ok(opticalAxis.distanceTo(target.clone().sub(new Vector3(...point.opticalPosition)).normalize())<1e-6);
 assert.ok(tcpAxis.distanceTo(target.clone().sub(new Vector3(...point.position)).normalize())<1e-6);
 assert.ok(point.opticalPosition[2]>point.target[2]);
 assert.ok(point.position[2]>point.target[2]);
 const headAxis=new Vector3(...NANYANG_TOOL_CALIBRATION.wireAxis).normalize().applyQuaternion(orientation);
 assert.ok(headAxis.distanceTo(new Vector3(...point.weldNormal))<1e-6);
 assert.deepEqual(tcp.position,point.position);
}

test('推扫仅对起点和段连接点生成切向双点，反向扫描交换双点顺序',()=>{
 const scanSettings={precisionMethod:'laserSweep',measurementScope:'start'};
 const plan=weldMeasurementPlan({...weld,scanSettings},settings);
 assert.deepEqual(plan.paths.map(path=>path.length),[2,2]);
 const targets=plan.points.map(point=>new Vector3(...point.target));
 for(const [index,target] of [[0,[0,0,0]],[2,[100,0,0]]]){
  assert.ok(Math.abs(targets[index].distanceTo(targets[index+1])-16)<1e-8);
  assert.ok(targets[index].clone().lerp(targets[index+1],.5).distanceTo(new Vector3(...target))<1e-8);
 }
 assert.deepEqual(plan.points[0].target,[-8,0,0]);
 const reversed=weldMeasurementPlan({...weld,scanSettings:{...scanSettings,direction:'reverse'}},settings);
 assert.deepEqual(reversed.points.map(point=>point.target),[plan.points[1],plan.points[0],plan.points[3],plan.points[2]].map(point=>point.target));
});

test('定点拍照沿开口角平分线摆放机头，镜头照准且 TCP 位于焊缝上方',()=>{
 const plan=weldMeasurementPlan({...weld,scanSettings:{precisionMethod:'fixedPhoto',measurementScope:'start'}},
  {...settings,deviceCapabilities:{structuredLightPrecision:true}});
 assert.equal(plan.points.length,1);
 assert.deepEqual(plan.paths,[]);
 const [point]=plan.points;
 assertPhotoAimsAtTarget(point);
 assert.ok(new Vector3(...point.weldNormal).distanceTo(new Vector3(0,1,1).normalize())<1e-8);
 assert.ok(Math.abs(new Vector3(...point.opticalPosition).distanceTo(new Vector3(...point.target))-point.photoDistance)<1e-8);
});

test('相机 TCP 位于焊丝尖端沿出丝方向外延 150 mm',()=>{
 const delta=new Vector3(...NANYANG_CAMERA_PREVIEW.tcp).sub(new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip));
 const outward=new Vector3(...NANYANG_TOOL_CALIBRATION.wireAxis).normalize().negate();
 assert.ok(delta.distanceTo(outward.multiplyScalar(150))<1e-8);
});

test('寻位设置的拍照距离沿光轴生效，过近时保留几何允许的距离',()=>{
 const source={...weld,scanSettings:{measurementScope:'start'}};
 const photoSettings={...settings,deviceCapabilities:{structuredLightPrecision:true}};
 const photo=distance=>weldMeasurementPlan(source,{...photoSettings,
  precisionParameters:{structuredLightPhotoDistance:distance}}).points[0];
 const automatic=photo(null),far=photo(1100),near=photo(1);
 assert.ok(Math.abs(far.photoDistance-1100)<1e-8);
 assert.ok(near.photoDistance>1);
 assert.ok(near.photoDistance<=automatic.photoDistance);
 for(const point of [automatic,far,near]){
  assertPhotoAimsAtTarget(point);
  assert.deepEqual(point.toolPose.head.quaternion,automatic.toolPose.head.quaternion);
 }
 assert.deepEqual(weldMeasurementPlan(weld,{...settings,precisionParameters:{...settings.precisionParameters,structuredLightPhotoDistance:1100}}),
  weldMeasurementPlan(weld,settings));
});

test('定点拍照的位置偏移沿光轴应用，首尾仍照准各自焊道被测点',()=>{
 const photoSettings={...settings,deviceCapabilities:{structuredLightPrecision:true}};
 const adjustment={position:{x:12.34,y:6,z:25},angles:{advance:15}};
 const scanSettings={cameraAdjustments:{structuredLight:adjustment}};
 const original=weldMeasurementPlan(weld,photoSettings);
 const edited=weldMeasurementPlan({...weld,scanSettings},photoSettings);
 assert.equal(edited.points.length,2);
 for(const [i,point] of edited.points.entries()){
  const base=original.points[i];
  assert.deepEqual(point.target,base.target);
  const originalLens=new Vector3(...base.opticalPosition);
  const expected=originalLens.clone().add(new Vector3(...Object.values(adjustment.position)));
  assert.ok(new Vector3(...point.opticalPosition).distanceTo(expected)<originalLens.distanceTo(expected));
  assert.deepEqual(point.toolPose.head.quaternion,base.toolPose.head.quaternion);
  assertPhotoAimsAtTarget(point);
  const {head}=point.toolPose;
  const mapped=new Vector3(...NANYANG_CAMERA_PREVIEW.tcp).applyQuaternion(new Quaternion(...head.quaternion)).add(new Vector3(...head.position));
  assert.ok(mapped.distanceTo(new Vector3(...point.position))<1e-8);
 }
 assert.deepEqual(weldMeasurementPlan({...weld,scanSettings},settings),weldMeasurementPlan(weld,settings));
});

test('结构光取焊接旋转角，线激光仍取寻位标准姿态及空白轴默认值',()=>{
 const precisionParameters={...settings.precisionParameters,structuredLightPose:{advance:13,work:-10,rotation:21},laserPose:{advance:0,rotation:15}};
 const photoSettings={...settings,precisionParameters,deviceCapabilities:{structuredLightPrecision:true}};
 const effective=weldMeasurementPlan(weld,photoSettings,undefined,{weldingPoseAt:distance=>({
  wireAxis:[0,1,1],angles:{rotation:distance===0?180:-45}
 })});
 assert.deepEqual(effective.points.map(point=>point.toolPose.angles.rotation),[180,-45]);
 effective.points.forEach(assertPhotoAimsAtTarget);
 assert.equal(weldMeasurementPlan(weld,photoSettings).points[0].toolPose.angles.rotation,flatPose.rotation);
 const laser=weldMeasurementPlan(weld,{...settings,precisionParameters}).points[0];
 assert.deepEqual(laser.toolPose.angles,{advance:0,work:35,rotation:15});
});

test('定点拍照保持焊接旋转角，分别报告光路遮挡和机头干涉',()=>{
 const photoSettings={...settings,deviceCapabilities:{structuredLightPrecision:true}};
 const source={...weld,segments:weld.segments.slice(0,1),scanSettings:{measurementScope:'start'}};
 const axis=new Vector3(0,.75,.66).normalize();
 const scene={solidAt:([,y,z])=>y<0&&z>0&&y>-8,lineObstruction:(lens,target)=>{
  const view=new Vector3(...lens).sub(new Vector3(...target)).normalize();
  assert.ok(view.dot(axis)>=-1e-9);
  assert.ok(lens[1]>0);
  return null;
 },contact:()=>null};
 const calculate=checks=>weldMeasurementPlan(source,photoSettings,undefined,{
  weldingPoseAt:()=>({wireAxis:axis.toArray(),angles:{rotation:180}}),scene,...checks
 }).points[0];
 const result=calculate();
 assert.equal(result.photoCheck.state,'ready');
 assert.ok(result.photoCheck.angle<=90);
 assertPhotoAimsAtTarget(result);
 const occluded=calculate({scene:{...scene,lineObstruction:()=>({part:'立板'})}});
 assert.equal(occluded.photoCheck.state,'blocked');
 assert.ok(occluded.photoCheck.reasons.some(reason=>reason.includes('光路遮挡 · 立板')));
 const collided=calculate({scene:{...scene,contact:()=>({part:'底板'})}});
 assert.equal(collided.photoCheck.state,'blocked');
 assert.ok(collided.photoCheck.reasons.some(reason=>reason.includes('机头或相机盖干涉 · 底板')));
 assert.deepEqual(collided.toolPose.head.quaternion,result.toolPose.head.quaternion);
});

test('非直角接头沿 CAD 面法向的平分线，并绕焊丝轴应用焊接旋转角',()=>{
 const frame={tangent:[1,0,0],normal:[0,1,0],up:[0,0,1]};
 const segment={...weld.segments[0],subFaceNormal:[0,.8,.6]};
 const scene={solidAt:()=>false,lineObstruction:()=>null,contact:()=>null};
 const calculate=rotation=>planFixedPhotoPose(frame,segment,[0,0,0],{offset:new Vector3(),rotation,
  checks:{scene,weldingPose:{wireAxis:[1,0,1],angles:{rotation}}}});
 const result=calculate(15);
 assert.equal(result.photoCheck.state,'ready');
 assert.ok(result.photoCheck.angle<=90);
 assert.ok(new Vector3(...result.weldNormal).distanceTo(new Vector3(0,.8,1.6).normalize())<1e-8);
 assertPhotoAimsAtTarget(result);
 const rotated=calculate(60);
 assertPhotoAimsAtTarget(rotated);
 const delta=new Quaternion(...result.toolPose.head.quaternion).angleTo(new Quaternion(...rotated.toolPose.head.quaternion));
 assert.ok(Math.abs(delta-Math.PI/4)<1e-8);
});

test('按法向和焊接旋转角无法从焊缝上方拍照时标为待调整',()=>{
 const frame={tangent:[1,0,0],normal:[0,1,0],up:[0,0,-1]};
 const result=planFixedPhotoPose(frame,weld.segments[0],[0,0,0],{offset:new Vector3(),rotation:180});
 assert.equal(result.photoCheck.state,'blocked');
 assert.match(result.photoCheck.reasons[0],/无法位于被测点上方/);
 assert.equal(result.toolPose.angles.rotation,180);
});

test('连续扫描跨越所有段并保留曲线控制采样，反向可从终点开始',()=>{
 const scanSettings={precisionMethod:'continuous',measurementScope:'start',direction:'reverse'};
 const plan=weldMeasurementPlan({...weld,scanSettings},settings);
 const targets=plan.points.map(point=>point.target);
 assert.deepEqual(targets[0],[110,20,0]);
 assert.ok(targets.some(point=>Math.hypot(point[0]-110,point[1]-10)<1e-8));
 assert.deepEqual(targets.at(-1),[0,0,0]);
 assert.equal(plan.paths.length,1);
 assert.equal(plan.paths[0].length,plan.points.length);
 assert.equal(weldMeasurementPlan({...weld,scanSettings:{precisionMethod:'lineIntersection'}},settings),null);
});
