import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {LASER_WORKING_DISTANCE,laserCameraMount} from '../src/laserCameraMount.mjs';
import {NANYANG_TOOL_CALIBRATION} from '../src/weldToolPose.mjs';
import {deviceControlCapabilities,migrateDeviceControl} from '../src/deviceControlModel.mjs';
import {LASER_DIRECTION_ISSUE} from '../src/laserTrackingDirection.mjs';
import {generateBaseStrategyPlan,plannedTracking} from '../src/strategyPlanning.mjs';
import {weldTravelReversed} from '../src/weldDirectionGeometry.mjs';

const weld={id:'W1',enabled:true,position:'PB · 横角焊',leg:4,closure:'open',direction:'正向',segments:[
 {position:'PB · 横角焊',geometry:'直线',length:100,pathPoints:[[0,0,0],[0,100,0]],
  subFaceNormal:[-1,0,0],arcTracking:false,laserTracking:true}
]};
const dual=migrateDeviceControl({precisionCameras:{laser:{enabled:true},structuredLight:{enabled:true}}});
const settings=(side,rotation=180,control=dual)=>({
 deviceCapabilities:deviceControlCapabilities(control),laserMountSide:side,
 actionParameters:{flatPose:{advance:0,work:45,rotation}}
});

test('两种相机可同时提供寻位能力，激光跟踪依赖线激光设备',()=>{
 assert.deepEqual(deviceControlCapabilities(dual),{
  arcTracking:true,laserTracking:true,structuredLightPrecision:true,laserPrecision:true
 });
 const structured=migrateDeviceControl();
 assert.equal(deviceControlCapabilities(structured).laserTracking,false);
});

test('开启激光跟踪后按安装侧选定实际焊接方向，停用时恢复手动方向',()=>{
 const negative=settings('negativeX'),positive=settings('positiveX');
 const reversed=plannedTracking(weld,negative);
 assert.equal(reversed.laserTrackingDirection,'反向');
 assert.equal(weldTravelReversed(reversed),true);
 assert.equal(generateBaseStrategyPlan(reversed,negative).laserTrackingIssue,undefined);
 assert.equal(plannedTracking(weld,positive).laserTrackingDirection,'正向');
 const disabled=plannedTracking(reversed,settings('negativeX',180,migrateDeviceControl()));
 assert.equal(disabled.laserTrackingDirection,undefined);
 assert.equal(weldTravelReversed(disabled),false);
});

test('激光侧向与焊接方向垂直时标记方向冲突',()=>{
 const options=settings('negativeX',90);
 assert.equal(plannedTracking(weld,options).laserTrackingIssue,LASER_DIRECTION_ISSUE);
 assert.equal(generateBaseStrategyPlan(weld,options).laserTrackingIssue,LASER_DIRECTION_ISSUE);
});

test('同时开启跟踪时符合条件的焊缝优先激光，显式电弧选择仍生效',()=>{
 const automatic={...weld,segments:weld.segments.map(({arcTracking,laserTracking,...segment})=>({...segment,edgeDistance:50}))};
 const options={...settings('negativeX'),trackingParameters:{laserEnabled:true,arcEnabled:true,minLineLength:80,minEdgeWidth:10}};
 const tracked=plannedTracking(automatic,options).segments[0];
 assert.equal(tracked.effectiveLaserTracking,true);
 assert.equal(tracked.effectiveArcTracking,false);
 const arc=plannedTracking({...automatic,arcTracking:true,laserTracking:false},options).segments[0];
 assert.equal(arc.effectiveLaserTracking,false);
 assert.equal(arc.effectiveArcTracking,true);
});

test('线激光保留筒身侧装，内部光学偏转后在焊丝尖端水平外侧 40 mm 成像',()=>{
 const bytes=readFileSync(new URL('../public/models/pf400-laser/camera-body.stl',import.meta.url));
 const body=new STLLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 for(const [side,sign] of [['negativeX',-1],['positiveX',1]]){
  const {matrix,opticalMatrix,stripe,receiver,beam}=laserCameraMount(side);
  const mounted=body.clone().applyMatrix4(matrix);
  mounted.computeBoundingBox();
  const {min,max}=mounted.boundingBox;
  const innerX=sign>0?min.x:-max.x;
  assert.ok(innerX>42.5&&innerX<50);
  assert.ok(Math.abs((min.y+max.y)/2+80)<2);
  const sourceEmitter=new Vector3(41.16387,-105.65117,164.77784);
  const emitter=sourceEmitter.clone().applyMatrix4(matrix);
  const ray=new Vector3(...stripe).sub(emitter);
  const delta=new Vector3(...stripe).sub(new Vector3(...NANYANG_TOOL_CALIBRATION.wireTip));
  assert.ok(Math.abs(delta.x-sign*40)<1e-6&&Math.abs(delta.y)<1e-6);
  assert.ok(ray.distanceTo(new Vector3(...beam).multiplyScalar(LASER_WORKING_DISTANCE.nominal))<1e-6);
  assert.ok(sourceEmitter.clone().applyMatrix4(opticalMatrix).distanceTo(emitter)<1e-6);
  assert.ok(mounted.boundingBox.containsPoint(new Vector3(...receiver)));
  mounted.dispose();
 }
 body.dispose();
});
