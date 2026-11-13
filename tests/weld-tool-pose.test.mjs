import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {NANYANG_TOOL_CALIBRATION,resolveWeldToolPose} from '../src/weldToolPose.mjs';
import {prepareWeldSeamFrames} from '../src/weldSeamFrames.mjs';
import {pathLength} from '../src/manualWeldModel.mjs';
import {generateStrategyPlan} from '../src/strategyPlanning.mjs';
import {newWeldLayer,updateWeldLayoutPoint,weldLayerLayout,weldLayerPassPaths,weldLayerTreeGroups} from '../src/weldLayerLayout.mjs';

const position='PB · 横角焊';
const flatAngles={advance:12,work:40,rotation:15};
const close=(actual,expected)=>assert.ok(new Vector3(...actual).distanceTo(new Vector3(...expected))<1e-8,
 `${actual} ≠ ${expected}`);
const rotate=(direction,q)=>new Vector3(...direction).applyQuaternion(new Quaternion(...q)).toArray();
const segment=(points,extra={})=>({pathPoints:points,geometry:'直线',referenceNormal:[0,0,1],position,length:pathLength(points),...extra});
const weld=(segments,closed=false)=>({id:'W001',enabled:true,position,leg:6,closure:closed?'closed':'open',segments,
 length:segments.reduce((sum,item)=>sum+item.length,0)});
const process={id:'test',offset:{y:0,z:0},start:{},weld:{speed:300},end:{}};
const settings={topologyVersion:1,actionParameters:{lineStep:5,arcStep:5,flatPose:flatAngles},
 wrapParameters:{flatLPose:{work:65},uPose:{work:70}},weldPreprocessing:{}};
const layoutFor=target=>weldLayerLayout(target,{ready:false},[],[],settings);

test('三角度零位、正向与反向行走使用同一坐标约定',()=>{
 const line=segment([[0,0,0],[100,0,0]]);
 const forward=prepareWeldSeamFrames([line])(50);
 const reversed=prepareWeldSeamFrames([{...line,pathPoints:[...line.pathPoints].reverse()}])(50);
 const solve=(frame,pose)=>resolveWeldToolPose({...frame,pose});
 const base=solve(forward,{});
 close(base.wireAxis,[0,1,0]);
 close(solve(forward,{work:30}).wireAxis,[0,Math.sqrt(3)/2,.5]);
 for(const frame of [forward,reversed]){
  const advanced=solve(frame,{advance:30,work:40});
  assert.ok(Math.abs(new Vector3(...advanced.wireAxis).dot(new Vector3(...frame.tangent))-.5)<1e-8);
  const rolled=solve(frame,{advance:30,work:40,rotation:90});
  close(rolled.wireAxis,advanced.wireAxis);
  close(rolled.tcp.position,advanced.tcp.position);
  close(rotate([1,0,0],rolled.tcp.quaternion),rotate([0,1,0],advanced.tcp.quaternion));
 }
 const tip=new Vector3(...rotate(NANYANG_TOOL_CALIBRATION.wireTip,base.head.quaternion)).add(new Vector3(...base.head.position));
 close(tip.toArray(),base.tcp.position);
 assert.equal(base.contactDistance,null);
});

test('导电嘴标定和焊接距离齐全时按焊丝轴定位机头模型',()=>{
 const calibration={wireTip:[0,0,0],wireAxis:[0,0,1],referenceX:[1,0,0],contactTip:[0,0,12]};
 const sample={position:[100,20,5],tangent:[1,0,0],normal:[0,1,0],pose:{work:90},contactDistance:18};
 const solved=resolveWeldToolPose(sample,calibration);
 const tip=rotate(calibration.contactTip,solved.head.quaternion).map((value,i)=>value+solved.head.position[i]);
 close(tip,[100,20,23]);
 close(solved.tcp.position,[100,20,11]);
 assert.equal(solved.contactDistance,18);
});

test('整圆闭合时机头首尾重合，圆弧切向随几何旋转',()=>{
 const points=Array.from({length:33},(_,i)=>[60*Math.cos(i*Math.PI/16),60*Math.sin(i*Math.PI/16),0]);
 const target=weld([segment(points,{geometry:'圆弧'})],true);
 const [pass]=weldLayerPassPaths(target,layoutFor(target),generateStrategyPlan(target,process,settings));
 const a=pass.posesAt(0)[0],b=pass.posesAt(pass.endStation)[0],quarter=pass.posesAt(pass.endStation/4)[0];
 close(a.frame.tangent,[0,1,0]);
 close(quarter.frame.tangent,[-1,0,0]);
 close(a.wireAxis,b.wireAxis);
 close(a.head.position,b.head.position);
 assert.ok(Math.abs(new Quaternion(...a.head.quaternion).dot(new Quaternion(...b.head.quaternion)))>1-1e-9);
});

test('机头预览列出当前道的实际轨迹采样里程，不把模型顶点当成采样点',()=>{
 const target=weld([segment([[0,0,0],[7,0,0],[30,0,0]])]);
 const layout=layoutFor(target);
 const [noPlan]=weldLayerPassPaths(target,layout,null);
 assert.deepEqual(noPlan.sampleStations,[]);
 const plan=generateStrategyPlan(target,process,{...settings,actionParameters:{...settings.actionParameters,lineStep:10}});
 const [pass]=weldLayerPassPaths(target,layout,plan);
 assert.deepEqual(pass.sampleStations,[0,10,20,30]);
 assert.ok(pass.toolPoses.some(pose=>pose.distance===7));
 close(pass.posesAt(10)[0].position,[10,0,0]);
 const step5=generateStrategyPlan(target,process,settings);
 assert.deepEqual(weldLayerPassPaths(target,layout,step5)[0].sampleStations,[0,5,10,15,20,25,30]);
});

test('同一 L 形参考姿态按实际方向处理左右转及反向焊接，机头偏差小于 20°',()=>{
 const standard={advance:0,work:45,rotation:180};
 const config={...settings,actionParameters:{...settings.actionParameters,flatPose:standard},
  wrapParameters:{flatLPose:{advance:45,work:85,rotation:90}}};
 for(const sign of [1,-1])for(const direction of ['正向','反向']){
  const main=segment([[0,0,0],[100,0,0]]);
  const short=segment([[100,0,0],[100,sign*10,0]],{strategyRole:'wrap',strategyWrapKind:'L',startWrapKind:'L'});
  const target={...weld([main,short]),direction};
  const plan=generateStrategyPlan(target,process,config);
  const [preview]=weldLayerPassPaths(target,layoutFor(target),plan);
  const toQuat=pose=>new Quaternion().fromArray(pose.tcp.quaternion);
  const standardPose=toQuat(preview.posesAt(direction==='正向'?60:50)[0]);
  const midpoint=direction==='正向'?105:5;
  const planned=plan.passes[0].points.find(point=>point.distance===midpoint&&point.flatLWrap);
  assert.ok(planned);
  assert.ok(Math.abs(standardPose.angleTo(new Quaternion(...planned.orientation))*180/Math.PI-5)<1e-6);
  const stations=direction==='正向'?[70,90,99.9,100,102.5,105,110]:[0,2.5,5,9.9,10,20,40];
  for(const station of stations)assert.ok(standardPose.angleTo(toQuat(preview.posesAt(station)[0]))*180/Math.PI<20);
 }
 const target=weld([segment([[0,0,0],[100,0,0]]),segment([[100,0,0],[100,10,0]],{
  strategyRole:'wrap',strategyWrapKind:'L',startWrapKind:'L'})]);
 const clipped=generateStrategyPlan(target,process,{...config,wrapParameters:{flatLPose:{advance:0,work:0,rotation:0}}});
 const at=clipped.passes[0].points;
 const standardPose=new Quaternion(...at[0].orientation);
 const wrapped=at.find(point=>point.distance===105);
 assert.ok(Math.abs(standardPose.angleTo(new Quaternion(...wrapped.orientation))*180/Math.PI-19)<1e-6);
});

test('空间路径标架沿主板法向且不会因测量法向反号而翻转',()=>{
 const points=Array.from({length:25},(_,i)=>[35*Math.cos(i/8),35*Math.sin(i/8),i*2]);
 const curved=segment(points,{geometry:'曲线',referenceNormal:undefined});
 const target=weld([curved]);
 const referenceAt=(_,point)=>[point[0]*(point[2]===24?-1:1),point[1]*(point[2]===24?-1:1),0];
 const [pass]=weldLayerPassPaths(target,layoutFor(target),null,referenceAt);
 for(const [i,pose] of pass.toolPoses.entries()){
  assert.ok(Math.abs(new Vector3(...pose.frame.tangent).dot(new Vector3(...pose.frame.up)))<1e-8);
  if(i)assert.ok(new Vector3(...pose.frame.up).dot(new Vector3(...pass.toolPoses[i-1].frame.up))>.9);
 }
 assert.ok(new Vector3(...pass.toolPoses.at(-1).frame.up).dot(new Vector3(...pass.toolPoses[0].frame.up))<0);
});

test('包角控制姿态、点位偏移和第二层的机头位置都可按里程查询',()=>{
 const a=segment([[0,0,0],[100,0,0]]);
 const b=segment([[100,0,0],[100,10,0]],{strategyRole:'wrap',strategyWrapKind:'U'});
 const c=segment([[100,10,0],[0,10,0]]);
 const target=weld([a,b,c]);
 const strategy=generateStrategyPlan(target,process,settings);
 const middle=strategy.passes[0].points.find(point=>point.kind==='wrap'&&point.distance===105);
 assert.equal(middle.pose.work,70);
 const layout=layoutFor(target),layer=newWeldLayer(target,2);
 layer.height=5;
 layer.passes[0].offset={...layer.passes[0].offset,y:2,wire:4};
 const draft=updateWeldLayoutPoint([...layout,layer],layer.passes[0].id,{
  id:layer.passes[0].points[0].id,offset:{x:2,y:3,z:1},poseOffset:{advance:0,work:4,rotation:9}
 });
 const [base,derived]=weldLayerPassPaths(target,draft,strategy);
 assert.equal(base.posesAt(105)[0].angles.work,70);
 close(base.posesAt(105)[0].head.position,resolveWeldToolPose(middle).head.position);
 const [,group]=weldLayerTreeGroups(target,draft,process,strategy);
 const first=group.points.find(point=>point.kind==='start');
 const at=derived.posesAt(first.distance).find(pose=>pose.pointId===first.raw.id);
 close(at.head.position,first.toolPose.head.position);
 close(derived.positions[0],first.position);
 assert.ok(first.position[2]>6);
 assert.equal(at.angles.rotation,24);
 const lTarget=weld([a,{...b,strategyWrapKind:'L'}]);
 const lPlan=generateStrategyPlan(lTarget,process,settings);
 const [lPass]=weldLayerPassPaths(lTarget,layoutFor(lTarget),lPlan);
 const before=new Quaternion(...lPass.posesAt(60)[0].tcp.quaternion);
 assert.ok(before.angleTo(new Quaternion(...lPass.posesAt(105)[0].tcp.quaternion))*180/Math.PI<20);
});
