import test from 'node:test';
import assert from 'node:assert/strict';
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
