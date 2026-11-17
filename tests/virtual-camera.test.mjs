import assert from 'node:assert/strict';
import test from 'node:test';
import {Quaternion,Vector3} from 'three';
import {parsePointCloud} from '../src/pointCloudModel.mjs';
import {CAPTURE_SPACING_MM,COARSE_CAPTURE_SPACING_MM,pointCloudPly,sampleVisibleWorkpiece} from '../src/virtualCameraSampling.mjs';
import {workstationCadPosition,workstationTarget} from '../src/workstationSimulation.mjs';

const plate=z=>({positions:[-10,-10,z,10,-10,z,10,10,z,-10,10,z],indices:[0,1,2,0,2,3]});
const laser=y=>({kind:'laser',group:0,origin:[0,y,10],forward:[0,0,-1],right:[1,0,0],distance:10,range:20,width:4,
 receivers:[[-2,y,10],[2,y,10]]});

test('精定位线激光扫过工件后得到多条轮廓，0.5 mm 去重且保存标准 PLY',async()=>{
 const model={origin:[0,0,0],meshes:[plate(0)]};
 const line=sampleVisibleWorkpiece(model,[laser(-2)]);
 const cloud=sampleVisibleWorkpiece(model,[laser(-2),laser(2)]);
 const rows=new Set();
 for(let index=1;index<cloud.length;index+=3)rows.add(Math.round(cloud[index]/CAPTURE_SPACING_MM));
 assert.equal(rows.size,9);
 assert.ok(cloud.length>line.length*5);
 const parsed=parsePointCloud('粗定位.ply',await pointCloudPly(cloud).arrayBuffer());
 assert.equal(parsed.count,cloud.length/3);
 assert.deepEqual(parsed.size,[4,4,0]);
});

test('粗定位以 3 mm 跨多个扫描带保留完整点云，PLY 使用实际采样间距',async()=>{
 const spacing=COARSE_CAPTURE_SPACING_MM;
 const frames=[-5,5].flatMap((x,group)=>[-12,12].map(y=>({...laser(y),group,origin:[x,y,10],
  width:16,stripHalfWidth:5,receivers:[[x-2,y,10],[x+2,y,10]]})));
 const model={origin:[0,0,0],meshes:[plate(0)]};
 const cloud=sampleVisibleWorkpiece(model,frames,spacing);
 const rows=new Set();
 for(let i=1;i<cloud.length;i+=3)rows.add(cloud[i]);
 assert.equal(rows.size,7);
 const file=await pointCloudPly(cloud,spacing).arrayBuffer();
 assert.match(new TextDecoder().decode(file.slice(0,120)),/3 mm voxel pitch/);
 const parsed=parsePointCloud('粗定位.ply',file);
 assert.equal(parsed.count,cloud.length/3);
 assert.deepEqual(parsed.size.slice(0,2),[16,18]);
 assert.ok(parsed.size[2]<1e-8);
});

test('虚拟相机只采集每条光路的第一层可见表面，且工件摆放逆变换可往返',()=>{
 const frames=[{...laser(0),kind:'photo',up:[0,1,0],width:5,height:5}];
 const points=sampleVisibleWorkpiece({origin:[0,0,0],meshes:[plate(0),plate(3)]},frames);
 assert.ok(points.length>0);
 assert.ok(points.every((value,index)=>index%3!==2||Math.abs(value-3)<1e-5));
 const target=[480,-40,15],origin=[420,-100,2];
 const placement={position:[25,5,-10],quaternion:new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.7).toArray()};
 const tcp=workstationTarget({position:target,quaternion:[0,0,0,1]},origin,placement,true);
 assert.ok(workstationCadPosition(tcp.position,origin,placement,true).distanceTo(new Vector3(...target))<1e-8);
});
