import test from 'node:test';
import assert from 'node:assert/strict';
import {addDeviceProfile,enabledPlanningRobots,deviceControlError,migrateDeviceControl} from '../src/deviceControlModel.mjs';
import {assignWeldingOrder} from '../src/strategyGeometry.mjs';
import {partitionWelds,DEFAULT_ALLOCATION} from '../src/multiRobotAllocation.mjs';

const arm1={id:'robot',label:'机械臂 1'},arm2={id:'r2',label:'机械臂 2'};
const robots=[arm1,arm2];
const make=(id,a,b)=>({id,model:'demo',enabled:true,planned:true,position:'PB',
 segments:[{position:'PB',pathPoints:[a,b]}]});
const welds=[
 {...make('W10001',[0,0,0],[30,0,0]),endpointFacts:{start:{boundaryKind:'free-edge'},end:{wrap:true}}},
 make('W10002',[3960,0,0],[4000,0,0]),
 make('W10003',[2000,0,0],[2000,160,0]),
 make('W10004',[2002,0,0],[2002,140,0]),
 make('W10005',[0,200,0],[4000,200,0])
];

test('设备可选择任一或两台机械臂，旧配置默认使用主机械臂',()=>{
 const initial=addDeviceProfile(migrateDeviceControl(),'robot','r2');
 assert.deepEqual(enabledPlanningRobots(initial).map(robot=>robot.id),['robot']);
 const dual={...initial,enabledRobotIds:['robot','r2']};
 assert.equal(deviceControlError(dual),'');
 assert.deepEqual(enabledPlanningRobots(dual).map(robot=>robot.id),['robot','r2']);
 assert.deepEqual(enabledPlanningRobots({...dual,enabledRobotIds:['r2']}).map(robot=>robot.id),['r2']);
 assert.match(deviceControlError({...dual,enabledRobotIds:[]}),/至少选择/);
});

test('分区保留独占任务，共享区按任务量分配，跨区整道也有归属',()=>{
 const result=partitionWelds(welds,robots,DEFAULT_ALLOCATION);
 const byId=new Map(result.map(task=>[task.weldId,task]));
 assert.equal(byId.get('W10001').robotId,'robot');
 assert.equal(byId.get('W10001').seconds,30/6+3+2);
 assert.equal(byId.get('W10002').robotId,'r2');
 assert.deepEqual(byId.get('W10003').candidates,['robot','r2']);
 const shared=partitionWelds(welds.slice(0,-1),robots,DEFAULT_ALLOCATION).filter(task=>task.candidates.length===2);
 assert.equal(new Set(shared.map(task=>task.robotId)).size,2);
 assert.equal(byId.get('W10003').robotId,'robot');
 assert.equal(byId.get('W10004').robotId,'robot');
 assert.deepEqual(byId.get('W10005').candidates,[]);
 assert.ok(robots.some(robot=>robot.id===byId.get('W10005').robotId));
 const manual=partitionWelds(welds,robots,{overrides:{[byId.get('W10005').key]:'r2'}}).find(task=>task.weldId==='W10005');
 assert.equal(manual.robotId,'r2');
 assert.equal(manual.manual,true);
 const orders=assignWeldingOrder(welds,{planningRobots:robots});
 assert.ok(orders.every(weld=>weld.assignedRobot&&weld.weldingOrder!==null));
 assert.ok(assignWeldingOrder(orders,{planningRobots:[arm1]}).every(weld=>weld.weldingOrder!==null&&weld.assignedRobot===undefined));
});

test('各机械臂都无法单独覆盖整道时按实际路径覆盖长度分配',()=>{
 const bent=make('W10006',[1000,0,0],[3000,0,0]);
 bent.segments[0].pathPoints.push([3000,0,500]);
 const tasks=partitionWelds([...welds,bent],robots,{overlap:0});
 const task=tasks.find(item=>item.weldId===bent.id);
 assert.deepEqual(task.candidates,[]);
 assert.equal(task.robotId,'r2');
});
