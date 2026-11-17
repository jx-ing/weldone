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
 wrapParameters:{flatLPoseOffset:{work:25},uPose:{work:70}},weldPreprocessing:{}};
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

test('同侧平角焊长直段反向时沿用立板侧的旋转角零位',()=>{
 const normal={subFaceNormal:[-1,0,0]};
 const welds=[
  weld([segment([[0,-8,0],[0,0,0]],{strategyRole:'wrap',strategyWrapKind:'L',endWrapKind:'L'}),
   segment([[0,0,0],[0,100,0]],normal)]),
  weld([segment([[0,100,0],[0,0,0]],normal)])
 ];
 const preview=rotation=>welds.map((target,index)=>{
  const cfg={...settings,actionParameters:{...settings.actionParameters,flatPose:{advance:0,work:45,rotation}}};
  const plan=generateStrategyPlan(target,process,cfg);
  const [pass]=weldLayerPassPaths(target,layoutFor(target),plan);
  return pass.posesAt(index===0?58:50)[0];
 });
 const zero=preview(0),rolled=preview(180);
 const head=pose=>new Quaternion(...pose.head.quaternion);
 assert.ok(1-Math.abs(head(zero[0]).dot(head(zero[1])))<1e-9);
 assert.ok(1-Math.abs(head(rolled[0]).dot(head(rolled[1])))<1e-9);
 const oldReference=resolveWeldToolPose({...rolled[1].frame,sectionRoll:false,position:rolled[1].position,pose:rolled[1].angles});
 assert.ok(1-Math.abs(head(rolled[1]).dot(head(oldReference)))<1e-9);
 for(let i=0;i<welds.length;i++){
  close(rolled[i].wireAxis,zero[i].wireAxis);
  close(rolled[i].tcp.position,zero[i].tcp.position);
  assert.ok(Math.abs(head(rolled[i]).angleTo(head(zero[i]))-Math.PI)<1e-8);
 }
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

test('闭合 U 形从正常段内起焊，正反向都完整走过两处短包角',()=>{
 const a=[0,0,0],b=[12,0,0],c=[12,100,0],d=[0,100,0];
 const short={strategyRole:'wrap',strategyWrapKind:'U',startWrapKind:'U',endWrapKind:'U'};
 const segments=[segment([a,b],short),segment([b,c]),segment([c,d],short),segment([d,a])];
 const config={...settings,actionParameters:{...settings.actionParameters,staggerDistance:12}};
 for(const direction of ['正向','反向']){
  const target={...weld(segments,true),direction};
  const layout=layoutFor(target);
  const plan=generateStrategyPlan(target,{...process,processLayers:[{passes:[process,process]}]},config);
  const [base,staggered]=plan.passes;
  const forward=direction==='正向',start=forward?62:50,startPoint=forward?[12,50,0]:[0,50,0];
  assert.equal(base.points[0].distance,start);
  assert.deepEqual(base.points[0].position,startPoint);
  assert.equal(staggered.loopStartStation,forward?62:12);
  const [pass]=weldLayerPassPaths(target,layout,plan);
  assert.equal(pass.startStation,start);
  assert.equal(pass.endStation,start+224);
  close(pass.toolPoses[0].position,startPoint);
  close(pass.toolPoses.at(-1).position,startPoint);
  close(pass.posesAtGeometryStation(forward?6:106)[0].position,forward?[6,0,0]:[6,100,0]);
  const [tree]=weldLayerTreeGroups(target,layout,process,plan);
  close(tree.points.find(p=>p.kind==='start').position,startPoint);
  const shifted=[{...layout[0],passes:[{...layout[0].passes[0],offset:{...layout[0].passes[0].offset,start:-50}}]}];
  const [offsetPass]=weldLayerPassPaths(target,shifted,plan);
  assert.equal(offsetPass.startStation,start);
  assert.equal(offsetPass.endStation,start+224);
 }
 const withL=weld([segments[0],{...segments[1],strategyRole:'wrap',strategyWrapKind:'L',endWrapKind:'L'},...segments.slice(2)],true);
 const lPlan=generateStrategyPlan(withL,process,config);
 const [lPass]=weldLayerPassPaths(withL,layoutFor(withL),lPlan);
 close(lPass.posesAt(lPass.startStation)[0].position,[12,50,0]);
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

test('L 形包角首尾镜像前进角与旋转角偏移，正反向都保留工作角偏移和主段标准姿态',()=>{
 const standard={advance:0,work:45,rotation:180};
 const config={...settings,actionParameters:{...settings.actionParameters,flatPose:standard}};
 const toQuat=pose=>new Quaternion().fromArray(pose.tcp.quaternion);
 const sameOrientation=(a,b)=>assert.ok(1-Math.abs(a.dot(b))<1e-9);
 for(const sign of [1,-1])for(const direction of ['正向','反向']){
  const main=segment([[0,0,0],[100,0,0]]);
  const short=segment([[100,0,0],[100,sign*8,0]],{strategyRole:'wrap',strategyWrapKind:'L',startWrapKind:'L'});
  const target={...weld([main,short]),direction};
  const reversed=direction==='反向';
  for(const [advance,work,rotation] of [[0,0,0],[0,0,80],[12,7,80]]){
   const plan=generateStrategyPlan(target,process,{...config,wrapParameters:{flatLPoseOffset:{advance,work,rotation}}});
   const [preview]=weldLayerPassPaths(target,layoutFor(target),plan);
   const mainPose=preview.posesAt(reversed?20:80)[0];
   const mainOrientation=toQuat(mainPose);
   const sign=reversed?-1:1;
   const mirroredPose={advance:sign*advance,work:45+work,rotation:180+sign*rotation};
   const expected=toQuat(resolveWeldToolPose({...mainPose.frame,position:mainPose.position,pose:mirroredPose}));
   const wrapStations=reversed?[0,2,4,7.9,8]:[100,100.1,103,105,108];
   for(const station of wrapStations)sameOrientation(toQuat(preview.posesAt(station)[0]),expected);
   for(const station of reversed?[8.01,9,12]:[95,99,99.99])
    sameOrientation(toQuat(preview.posesAt(station)[0]),mainOrientation);
   if(advance===0&&work===0)assert.ok(Math.abs(mainOrientation.angleTo(expected)*180/Math.PI-rotation)<1e-5);
  }
 }
});

test('关闭直线采样时两个 L 形包角之间仍使用主段标准姿态',()=>{
 const standard={advance:0,work:45,rotation:180};
 const config={...settings,actionParameters:{...settings.actionParameters,lineStepEnabled:false,flatPose:standard},
  wrapParameters:{flatLPoseOffset:{rotation:80}}};
 const target=weld([
  segment([[0,8,0],[0,0,0]],{strategyRole:'wrap',strategyWrapKind:'L',endWrapKind:'L'}),
  segment([[0,0,0],[100,0,0]]),
  segment([[100,0,0],[100,8,0]],{strategyRole:'wrap',strategyWrapKind:'L',startWrapKind:'L'})
 ]);
 const [preview]=weldLayerPassPaths(target,layoutFor(target),generateStrategyPlan(target,process,config));
 const pose=preview.posesAt(58)[0];
 const actual=new Quaternion().fromArray(pose.tcp.quaternion);
 const expected=new Quaternion().fromArray(resolveWeldToolPose({...pose.frame,position:pose.position,pose:standard}).tcp.quaternion);
 assert.ok(1-Math.abs(actual.dot(expected))<1e-9);
});

test('U 包角出口沿共享 TCP 姿态连续接入背侧正常焊接段',()=>{
 const common={referenceNormal:[0,0,1]};
 const target=weld([
  segment([[0,0,0],[100,0,0]],{...common,subFaceNormal:[0,-1,0],endWrapKind:'U'}),
  segment([[100,0,0],[100,12,0]],{...common,subFaceNormal:[1,0,0],strategyRole:'wrap',strategyWrapKind:'U',startWrapKind:'U',endWrapKind:'U'}),
  segment([[100,12,0],[0,12,0]],{...common,subFaceNormal:[0,1,0],startWrapKind:'U'})
 ]);
 for(const direction of ['正向','反向']){
  const directed={...target,direction};
  const plan=generateStrategyPlan(directed,process,settings);
  const [pass]=weldLayerPassPaths(directed,layoutFor(directed),plan);
  const pose=at=>new Quaternion().fromArray(pass.posesAt(at)[0].tcp.quaternion);
  for(const station of [100,112])assert.ok(pose(station-.01).angleTo(pose(station+.01))<.02);
 }
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
 assert.ok(before.angleTo(new Quaternion(...lPass.posesAt(105)[0].tcp.quaternion))*180/Math.PI<=35.000001);
});
