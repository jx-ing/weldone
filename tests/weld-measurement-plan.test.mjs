import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {NANYANG_CAMERA_PREVIEW,NANYANG_TOOL_CALIBRATION} from '../src/weldToolPose.mjs';
import {weldMeasurementPlan} from '../src/weldMeasurementPlan.mjs';

const flatPose={advance:10,work:35,rotation:5};
const settings={deviceCapabilities:{laserPrecision:true},actionParameters:{flatPose},
 precisionParameters:{mixedScan:{scanDistance:8}}};
const weld={enabled:true,position:'PB',segments:[
 {position:'PB',geometry:'直线',pathPoints:[[0,0,0],[100,0,0]],referenceNormal:[0,0,1]},
 {position:'PB',geometry:'圆弧',pathPoints:[[100,0,0],[110,10,0],[110,20,0]],referenceNormal:[0,0,1]}
]};

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

test('定点拍照为每个测量目标生成一个正上方朝下的相机点',()=>{
 const plan=weldMeasurementPlan({...weld,scanSettings:{precisionMethod:'fixedPhoto',measurementScope:'start'}},
  {...settings,deviceCapabilities:{structuredLightPrecision:true}});
 assert.equal(plan.points.length,1);
 assert.deepEqual(plan.paths,[]);
 const [point]=plan.points,{head}=point.toolPose;
 assert.deepEqual(point.opticalPosition.slice(0,2),point.target.slice(0,2));
 assert.ok(point.opticalPosition[2]>point.target[2]);
 const cameraFocus=[...NANYANG_CAMERA_PREVIEW.opticalOrigin];
 cameraFocus[2]=NANYANG_TOOL_CALIBRATION.wireTip[2];
 const mapped=new Vector3(...cameraFocus).applyQuaternion(new Quaternion(...head.quaternion)).add(new Vector3(...head.position));
 assert.ok(mapped.distanceTo(new Vector3(...point.target))<1e-8);
 assert.ok(new Vector3(...point.opticalPosition).distanceTo(mapped)>300);
});

test('相机 TCP 位于焊丝尖端沿出丝方向外延 150 mm',()=>{
 const delta=new Vector3(...NANYANG_CAMERA_PREVIEW.tcp).sub(new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip));
 const outward=new Vector3(...NANYANG_TOOL_CALIBRATION.wireAxis).normalize().negate();
 assert.ok(delta.distanceTo(outward.multiplyScalar(150))<1e-8);
});

test('相机位置独立于角度，偏移应用到当前相机的完整测量轨迹',()=>{
 const photoSettings={...settings,deviceCapabilities:{structuredLightPrecision:true}};
 const adjustment={position:{x:12.34,y:-6,z:8},angles:{advance:15}};
 const scanSettings={cameraAdjustments:{structuredLight:adjustment}};
 const original=weldMeasurementPlan(weld,photoSettings);
 const edited=weldMeasurementPlan({...weld,scanSettings},photoSettings);
 assert.equal(edited.points.length,2);
 for(const [i,point] of edited.points.entries()){
  const base=original.points[i];
  assert.deepEqual(point.target,base.target);
  assert.deepEqual(point.position,base.position.map((value,axis)=>value+[12.34,-6,8][axis]));
  assert.notDeepEqual(point.toolPose.head.quaternion,base.toolPose.head.quaternion);
  assert.equal(point.toolPose.angles.advance,15);
  const {head}=point.toolPose;
  const mapped=new Vector3(...NANYANG_CAMERA_PREVIEW.tcp).applyQuaternion(new Quaternion(...head.quaternion)).add(new Vector3(...head.position));
  assert.ok(mapped.distanceTo(new Vector3(...point.position))<1e-8);
 }
 assert.deepEqual(weldMeasurementPlan({...weld,scanSettings},settings),weldMeasurementPlan(weld,settings));
});

test('寻位设置的标准姿态分别驱动结构光和线激光，空白轴沿用各自默认值',()=>{
 const precisionParameters={...settings.precisionParameters,structuredLightPose:{advance:13,work:-10,rotation:21},laserPose:{advance:0,rotation:15}};
 const photoSettings={...settings,precisionParameters,deviceCapabilities:{structuredLightPrecision:true}};
 const defaultPhoto=weldMeasurementPlan(weld,{...photoSettings,precisionParameters:{}}).points[0];
 const photo=weldMeasurementPlan(weld,photoSettings).points[0];
 assert.ok(new Vector3(...photo.opticalPosition).distanceTo(new Vector3(...defaultPhoto.opticalPosition))<1e-8);
 assert.deepEqual(photo.toolPose.angles,{advance:13,work:-10,rotation:21});
 assert.notDeepEqual(photo.toolPose.head.quaternion,defaultPhoto.toolPose.head.quaternion);
 const laser=weldMeasurementPlan(weld,{...settings,precisionParameters}).points[0];
 assert.deepEqual(laser.toolPose.angles,{advance:0,work:35,rotation:15});
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
