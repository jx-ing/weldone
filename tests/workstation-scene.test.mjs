import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Matrix4, Quaternion, Vector3} from 'three';
import {matchesWorkstationWelder, workstationWelders} from '../src/processDeviceModel.mjs';
import {workstationDeviceProfiles, workstationPlanningControl} from '../src/workstationDevices.mjs';
import {enabledPlanningRobots} from '../src/deviceControlModel.mjs';
import {workpiecePoseFor} from '../src/stepModelStore.mjs';
import {planningTaskDocument, readPlanningTask} from '../src/planningTask.mjs';
import {createWorkstationToolPreview,workstationDisplayObject} from '../src/workstationToolVisuals.mjs';
import {workstationTrackingPlanes} from '../src/workstationLaserCalibration.mjs';
import {LASER_DIRECTION_ISSUE,laserLeadsTravel,laserTrackingGeometry} from '../src/laserTrackingDirection.mjs';
import {weldPathTrackingIssue} from '../src/weldLayerLayout.mjs';
import {plannedTracking} from '../src/strategyPlanning.mjs';
import {NANYANG_TOOL_CALIBRATION} from '../src/weldToolPose.mjs';
import {configureWorkstation,importWorkstationScene} from '../src/workstationScene.mjs';
import {planVirtualCoarseScan} from '../src/virtualWorkstationCamera.mjs';

const glb = await readFile(new URL('../public/models/rizhao-0514-workstation.glb', import.meta.url));
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)));
const {scene} = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
const devices = scene.children[0].userData.weldone.devices.map(device => ({...device,
  kind: device.type === 'camera' ? (device.id.startsWith('coarse') ? 'coarse' : 'precision') : device.type,
}));

test('导入 GLB 使用文件内容识别场景，保留标注设备并拒绝普通文件',async()=>{
  const imported=await importWorkstationScene(new File([glb],'工作站副本.glb'));
  assert.equal(imported.fileName,'工作站副本.glb');
  assert.match(imported.sceneKey,/^[a-f0-9]{64}$/);
  assert.deepEqual(imported.devices.map(device=>device.id),devices.map(device=>device.id));
  assert.ok(Object.values(imported.laserTrackingByRobot).some(Boolean));
  await assert.rejects(importWorkstationScene(new File(['plain text'],'错误.glb')),/设备标注的 GLB/);
});

test('GLB 内置两个三棱锥，平台复用各自几何，移除粗定位相机时隐藏视野',async()=>{
  const imported=await importWorkstationScene(new File([glb],'工作站.glb'));
  const camera=imported.devices.find(device=>device.kind==='coarse');
  const {visualObject}=configureWorkstation(imported);
  const removed=configureWorkstation(imported,{removedDeviceIds:[camera.id]});
  for(const eye of ['left','right']){
    const {link,visual}=camera.bindings.find(binding=>binding.role===eye+'_field_of_view');
    const receiver=camera.bindings.find(binding=>binding.role===eye+'_imager');
    const cone=imported.object.getObjectByName(link).getObjectByName(visual);
    const position=cone.geometry.attributes.position;
    assert.equal(position.count,4);
    assert.equal(cone.geometry.index.count,12);
    assert.ok(cone.children[0].isLineSegments);
    assert.equal(cone.children[0].geometry.index.count,12);
    const apex=cone.localToWorld(new Vector3().fromBufferAttribute(position,0));
    assert.ok(apex.distanceTo(imported.object.getObjectByName(receiver.link).getWorldPosition(new Vector3()))<1e-6);
    assert.equal(visualObject.getObjectsByProperty('name',visual).length,1);
    assert.equal(visualObject.getObjectByName(visual).geometry,cone.geometry);
    assert.equal(visualObject.getObjectByName(visual).userData.coarseCameraId,camera.id);
    assert.equal(removed.visualObject.getObjectByName(visual).visible,false);
  }
  assert.equal(imported.object.getObjectByName('overlay_coarse_working_profile'),undefined);
});

test('旧版 GLB 的合并视野由平台替换为双目三棱锥',async()=>{
  const imported=await importWorkstationScene(new File([glb],'工作站.glb'));
  const camera=imported.devices.find(device=>device.kind==='coarse');
  const legacy={role:'field_of_view',link:'coarse_camera_body',visual:'overlay_coarse_working_profile'};
  const bindings=camera.bindings.filter(binding=>!binding.role.endsWith('_field_of_view'));
  const body=imported.visualObject.getObjectByName(legacy.link);
  body.remove(body.getObjectByName('粗定位右目视野'));
  body.getObjectByName('粗定位左目视野').name=legacy.visual;
  const devices=imported.devices.map(device=>device===camera?{...device,bindings:[...bindings,legacy]}:device);
  const {visualObject}=configureWorkstation({...imported,devices});
  assert.equal(visualObject.getObjectByName(legacy.visual).visible,false);
  for(const side of ['左','右']){
    const cone=visualObject.getObjectByName('粗定位'+side+'目视野');
    assert.equal(cone.geometry.attributes.position.count,4);
    assert.equal(cone.geometry.index.count,12);
    assert.ok(cone.children[0].isLineSegments);
  }
});

test('扫描推荐跟随 a1a 摆放，使用单轴起止值和覆盖全宽的多个扫描带',()=>{
  const workstation={object:scene,devices};
  const model={origin:[789.015,117.2578,435.5],size:[9354.499,2811.2971,1129]};
  const placement=workpiecePoseFor({model:'a1a.step'});
  const original=planVirtualCoarseScan(workstation,model,placement,false);
  const translated=planVirtualCoarseScan(workstation,model,{...placement,position:[0,0,500]},false);
  assert.ok(original.depthCovered);
  assert.ok(original.stripCount>1);
  assert.notDeepEqual(translated.recommended,original.recommended);
  const frames=original.scanning(...original.recommended);
  assert.equal(frames.length,2*original.stripCount);
  assert.ok(frames.every(frame=>frame.receivers.length===2));
  assert.ok(frames[0].origin[1]<model.origin[1]-model.size[1]/2);
  assert.ok(frames[1].origin[1]>model.origin[1]+model.size[1]/2);
  const first=frames[0],last=frames.at(-1);
  assert.ok(first.origin[0]-first.stripHalfWidth<model.origin[0]-model.size[0]/2);
  assert.ok(last.origin[0]+last.stripHalfWidth>model.origin[0]+model.size[0]/2);
});

test('粗定位的激光和双目光学中心绕光轴旋转 90°，相机壳体保留', () => {
  const expected = new Matrix4().makeRotationZ(-Math.PI / 2);
  const camera = json.nodes.find(node => node.extras?.urdfLink === 'coarse_camera_body');
  const children = camera.children.map(index => json.nodes[index]);
  for (const name of ['overlay_coarse_laser', 'overlay_coarse_receiver_left', 'overlay_coarse_receiver_right',
    'coarse_receiver_left', 'coarse_receiver_right', 'coarse_laser_emitter']) {
    const matrix = new Matrix4().fromArray(children.find(node => node.name === name).matrix);
    const x = new Vector3(1, 0, 0);
    assert.ok(x.clone().transformDirection(matrix).distanceTo(x.transformDirection(expected)) < 1e-10);
  }
  const housing = children.find(node => node.name === 'coarse_camera_body');
  assert.deepEqual(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(housing.matrix)).toArray(), [0, 0, 0]);
});

test('工作站和规划回显共用原机头，焊枪直接落在法兰且场景标定保持一致', () => {
  const display=workstationDisplayObject(scene,devices);
  const previewScene={object:scene,visualObject:display,devices};
  function flangePoints(root,id){
    const torch=root.getObjectByName('torch_'+id),flange=torch.parent.parent;
    flange.updateWorldMatrix(true,true);
    const inverse=flange.matrixWorld.clone().invert();
    const points=[];
    torch.traverse(node=>{
      if(!node.isMesh)return;
      const positions=node.geometry.attributes.position;
      const toFlange=inverse.clone().multiply(node.matrixWorld);
      for(let i=0;i<positions.count;i++)points.push(new Vector3().fromBufferAttribute(positions,i).applyMatrix4(toFlange));
    });
    return points;
  }
  for(const [side,robot] of [['A','robot_01'],['B','robot_02']]){
    const original=flangePoints(scene,side),mounted=flangePoints(display,side);
    const rear=Math.min(...original.map(point=>point.z));
    assert.ok(rear>.02);
    assert.ok(Math.abs(Math.min(...mounted.map(point=>point.z)))<1e-7);
    for(const [i,point] of original.entries()){
      if(point.z>=rear+.018)assert.ok(point.distanceTo(mounted[i])<1e-9);
    }
    for(const name of ['welding_tcp_','fine_measurement_tcp_','fine_eye_','fine_laser_emitter_','fine_nominal_profile_']){
      const a=scene.getObjectByName(name+side),b=display.getObjectByName(name+side);
      a.updateWorldMatrix(true,false);b.updateWorldMatrix(true,false);
      assert.deepEqual(a.matrixWorld.toArray(),b.matrixWorld.toArray());
    }
    const preview=createWorkstationToolPreview(previewScene,robot);
    const anchor=preview.object.getObjectByName('welding_tcp_'+side);
    const position=new Vector3(.2,.3,.4),rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7);
    preview.object.position.copy(position);
    preview.object.quaternion.copy(rotation);
    assert.ok(anchor.getWorldPosition(new Vector3()).distanceTo(position)<1e-9);
    assert.ok(anchor.getWorldQuaternion(new Quaternion()).angleTo(rotation)<1e-6);
  }
});
test('场景设备控制包含机械臂和相机，工艺库只匹配麦格米特焊机', () => {
  assert.equal(devices.length, 7);
  assert.equal(workstationDeviceProfiles(devices).length, 5);
  assert.deepEqual(enabledPlanningRobots(workstationPlanningControl(devices)).map(robot => robot.id), ['robot_01', 'robot_02']);
  const welders = workstationWelders(devices);
  assert.deepEqual(welders, [{brand: '麦格米特', model: 'Artsen Pro 500PR'}]);
  assert.ok(matchesWorkstationWelder({applicability: {welderBrand: 'MEGMEET', welderModel: 'Artsen pro 500 PR'}}, welders));
  assert.ok(!matchesWorkstationWelder({applicability: {welderBrand: '林肯', welderModel: 'Artsen Pro 500PR'}}, welders));
  assert.ok(matchesWorkstationWelder({applicability: {welderModel: 'R450'}}, []));
});

test('两个样件默认倒装，手动摆放随 PF 任务往返', () => {
  for (const model of ['a1a.step', '111.step']) {
    assert.deepEqual(workpiecePoseFor({model}).quaternion, [1, 0, 0, 0]);
  }
  assert.equal(workpiecePoseFor({model: 'new.step'}), undefined);
  const workpiecePose = {position: [200, 5, -800], quaternion: [0, 0, 0, 1]};
  const task = planningTaskDocument({model: 'a1a.step', workpiecePose, workstationSettings: {profiles: {}}});
  assert.equal(task.workstationSettings, undefined);
  assert.deepEqual(workpiecePoseFor(readPlanningTask(JSON.stringify(task))), workpiecePose);
});

test('激光领前使用所分配机械臂的实际光面，倒装后仍验证最终焊道姿态',()=>{
  const lasers=workstationTrackingPlanes({object:scene,devices});
  const options={laserTrackingByRobot:lasers};
  const a={assignedRobot:'robot_01'},b={assignedRobot:'robot_02'};
  const orientation=[0,0,0,1],travel=[0,1,0];
  assert.ok(laserLeadsTravel(orientation,travel,laserTrackingGeometry(a,options)));
  assert.ok(!laserLeadsTravel(orientation,travel,laserTrackingGeometry(b,options)));
  assert.ok(laserLeadsTravel(orientation,travel,laserTrackingGeometry(b,{...options,robotMounting:'inverted'})));
  const weld={enabled:true,position:'PB · 横角焊',leg:4,closure:'open',direction:'正向',segments:[{
    position:'PB · 横角焊',geometry:'直线',length:110,pathPoints:[[0,0,0],[0,110,0]],subFaceNormal:[-1,0,0],laserTracking:true,
  }]};
  const settings={...options,deviceCapabilities:{laserPrecision:true,laserTracking:true},
    actionParameters:{flatPose:{advance:0,work:45,rotation:90}}};
  assert.equal(plannedTracking({...weld,...a},settings).laserTrackingDirection,'正向');
  assert.equal(plannedTracking({...weld,...b},settings).laserTrackingDirection,'反向');
  const path={startStation:0,endStation:100,toolPoses:[],sampleStations:[],travelAt:()=>travel,
    trackingAt:()=>'激光跟踪',posesAt:station=>[{tcp:{quaternion:station===50?[0,0,1,0]:orientation}}]};
  assert.equal(weldPathTrackingIssue(a,[path],options),LASER_DIRECTION_ISSUE);
  assert.equal(weldPathTrackingIssue(a,[{...path,posesAt:()=>[{tcp:{quaternion:orientation}}]}],options),undefined);
});
