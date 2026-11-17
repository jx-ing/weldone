import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceControlCapabilities} from '../src/deviceControlModel.mjs';
import * as devices from '../src/workstationDevices.mjs';

const scene=[
 {id:'arm-a',kind:'robot',brand:'FANUC',model:'A',bindings:[{role:'base',link:'a'}]},
 {id:'arm-b',kind:'robot',brand:'FANUC',model:'B',bindings:[{role:'base',link:'b'}]},
 {id:'laser-a',kind:'precision',brand:'英莱科技',robotId:'arm-a',bindings:[]},
 {id:'laser-b',kind:'precision',brand:'英莱科技',robotId:'arm-b',bindings:[]}
];
const capabilities=settings=>deviceControlCapabilities(devices.workstationPlanningControl(scene,settings));

test('场景中可增删按品牌识别的设备，新增无场景机器人不参与轨迹分配',()=>{
 let settings=devices.addWorkstationDevice(scene,{}, {kind:'precision',brand:'weijing',robotId:'arm-a',id:'photo'});
 settings=devices.addWorkstationDevice(scene,settings,{kind:'robot',id:'spare'});
 settings=devices.addWorkstationDevice(scene,settings,{kind:'coarse',id:'coarse'});
 assert.equal(devices.workstationSettingsError(scene,settings),'');
 assert.equal(capabilities(settings).structuredLightPrecision,true);
 assert.equal(capabilities(settings).laserPrecision,true);
 assert.deepEqual(devices.workstationPrecisionByRobot(scene,settings),{
  'arm-a':{laserPrecision:true,structuredLightPrecision:true},
  'arm-b':{laserPrecision:true,structuredLightPrecision:false}
 });
 assert.deepEqual(devices.workstationPlanningControl(scene,settings).enabledRobotIds,['arm-a','arm-b']);
 assert.ok(devices.workstationDeviceProfiles(scene,settings).some(d=>d.id==='spare'));
 assert.ok(devices.workstationDeviceProfiles(scene,settings).some(d=>d.id==='coarse'));
 settings=devices.removeWorkstationDevice(scene,settings,'photo');
 settings=devices.removeWorkstationDevice(scene,settings,'laser-a');
 assert.equal(capabilities(settings).structuredLightPrecision,false);
 assert.equal(capabilities(settings).laserPrecision,true);
 assert.equal(devices.workstationDeviceProfiles(scene,settings).some(d=>d.id==='laser-a'),false);
 const restored=devices.addWorkstationDevice(scene,settings,{kind:'precision',brand:'yinglai',robotId:'arm-a',id:'new'});
 assert.ok(devices.workstationDeviceProfiles(scene,restored).some(d=>d.id==='laser-a'));
});

test('未登记的精定位品牌不被当成线激光，双品牌场景按类型同时启用',()=>{
 const control=devices.workstationPlanningControl([...scene.slice(0,2),
  {id:'unknown',kind:'precision',brand:'未知',bindings:[]},
  {id:'photo',kind:'precision',brand:'伟景智能 Vizum',bindings:[]}
 ],{});
 assert.equal(deviceControlCapabilities(control).laserPrecision,false);
 assert.equal(deviceControlCapabilities(control).structuredLightPrecision,true);
});
