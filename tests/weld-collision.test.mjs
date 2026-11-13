import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {createWeldCollisionScene,detectWeldCollision} from '../src/weldCollision.mjs';
import {splitWeldWrap,weldWrapJunctions} from '../src/weldWrapJunctions.mjs';
import {installWrapSplit,undoLastSplit} from '../src/manualSplitModel.mjs';

const shape=(width,height,depth,x)=>new BoxGeometry(width,height,depth).translate(x,0,0);
const mesh=(geometry,name)=>({name,positions:geometry.attributes.position.array,indices:geometry.index.array});
const pose=(distance)=>({distance,head:{position:[distance,0,0],quaternion:[0,0,0,1]}});
const pass=(id,from,to)=>({id,startStation:from,endStation:to,toolPoses:[pose(from),pose(to)],posesAt:station=>[pose(station)]});
test('扫掠可发现两个无碰撞端点之间的薄板，并返回零件与里程',()=>{
 const plate=shape(.03,2,2,3.17);
 const scene=createWeldCollisionScene({origin:[0,0,0],meshes:[mesh(plate,'薄板')]},[shape(.08,.08,.08,0)]);
 try{
  assert.equal(scene.query(pose(0).head).collision,undefined);
  assert.equal(scene.query(pose(8).head).collision,undefined);
  const result=detectWeldCollision([pass('pass',0,8)],scene);
  assert.equal(result.ranges.length,1);
  assert(result.ranges[0][0]<3.17&&result.ranges[0][1]>3.17);
  assert.equal(result.passes[0].contact.part,'薄板');
  assert(Math.abs(result.passes[0].contact.point[0]-3.17)<.02);
 }finally{scene.dispose();plate.dispose();}
});
test('仅有近距离间隙时保留焊段并回传最近零件',()=>{
 const plate=shape(10,2,2,4).translate(0,1.1,0);
 const scene=createWeldCollisionScene({origin:[0,0,0],meshes:[mesh(plate,'侧板')]},[shape(.08,.08,.08,0)]);
 try{
  const result=detectWeldCollision([pass('pass',0,8)],scene);
  assert.deepEqual(result.ranges,[]);
  assert.equal(result.passes[0].closest.part,'侧板');
  assert(Math.abs(result.passes[0].closest.distance-.06)<1e-5);
 }finally{scene.dispose();plate.dispose();}
});
const segment=(a,b,length,flags={})=>({pathPoints:[a,b],length,position:'PB',geometry:'直线',...flags});
const wrapped={id:'W10001',name:'包角',enabled:true,closure:'open',length:25,position:'PB',weldType:'角焊缝',leg:4,
 endpointFacts:{start:{gap:1},end:{gap:2}},groove:{type:'无坡口'},segments:[
  segment([0,0,0],[10,0,0],10,{endWrapKind:'U'}),
  segment([10,0,0],[10,5,0],5,{startWrapKind:'U',endWrapKind:'U',strategyWrapKind:'U',strategyRole:'wrap'}),
  segment([10,5,0],[0,5,0],10,{startWrapKind:'U'})
 ]};
test('U 包角拆为两条 L，两条合计保留原焊缝长度并支持撤销',()=>{
 for(const id of [0,1]){
  const pieces=splitWeldWrap(wrapped,id,'L');
  assert.equal(pieces.length,2);
  assert.deepEqual(pieces.map(piece=>piece.topology),['L','L']);
  assert.equal(pieces.reduce((sum,piece)=>sum+piece.length,0),25);
  assert(pieces.every(piece=>weldWrapJunctions(piece).length===1));
  const ws={model:'fixture',selected:wrapped.id,welds:[wrapped]};
  const saved=installWrapSplit(ws,wrapped,pieces);
  assert.equal(saved.welds[0].splitInto.length,2);
  assert.deepEqual(undoLastSplit(saved).welds,ws.welds);
 }
});
test('不包角断开所选连接点，保留所有焊缝段；反向只改变显示顺序',()=>{
 assert.deepEqual(weldWrapJunctions({...wrapped,direction:'反向'}).map(joint=>joint.id),[1,0]);
 const pieces=splitWeldWrap(wrapped,1,'none');
 assert.deepEqual(pieces.map(piece=>piece.length),[15,10]);
 assert.deepEqual(pieces.map(piece=>piece.segments.length),[2,1]);
 assert.deepEqual(pieces.map(piece=>weldWrapJunctions(piece).map(joint=>joint.type)),[['L'],[]]);
 assert.equal(pieces[0].endpointFacts.start.gap,1);
 assert.equal(pieces[1].endpointFacts.end.gap,2);
});

test('机头回放沿规划里的焊速查询，模板没有策略采样时回退到本道焊速',async()=>{
 const {weldLayerLayout,weldLayerPassPaths}=await import('../src/weldLayerLayout.mjs');
 const weld={...wrapped,length:10,segments:[segment([0,0,0],[10,0,0],10)],speed:330};
 const layout=weldLayerLayout(weld,null,[],[],{});
 const [path]=weldLayerPassPaths(weld,layout);
 assert.equal(path.speedAt(0),330);
 assert.equal(path.speedAt(4),330);
 assert.equal(path.speedAt(10),330);
});

test('一键规划裁掉普通焊缝的已确认干涉区间，并重新检查剩余路径',async()=>{
 const {resolvePlanningCollisions}=await import('../src/planningCollision.mjs');
 const {planWorkspace}=await import('../src/weldMatching.mjs');
 const {ensureProcessLayers,newProcessEntry}=await import('../src/processParameterModel.mjs');
 const position='PB · 横角焊';
 const weld={...wrapped,position,length:100,leg:6,segments:[{...segment([0,0,0],[100,0,0],100),position}]};
 const applicability={deviceProfileId:'device-a',welderModel:'R450',robotModel:'M-20iD/25',material:'低碳钢',wireType:'实芯焊丝',wireDiameter:1.2,gas:'CO2',method:'MAG'};
 const p=ensureProcessLayers({...newProcessEntry(),recipeRevision:3,leg:6,name:'测试工艺',position,weldForms:['角焊缝'],arcTracking:false,applicability,
  start:{current:210,voltage:24,time:.5},weld:{current:200,voltage:24,speed:400},end:{current:180,voltage:20,time:.5}});
 const options={planningRevision:3,topologyVersion:1,weldPreprocessing:{},activeDevice:{id:'device-a',applicability},
  trackingParameters:{laserEnabled:false,arcEnabled:false},
  actionParameters:{flatPose:{advance:0,work:45,rotation:0}},
  interferenceEndParameters:{startAngle:0,endAngle:0,startDistance:0,endDistance:0}};
 const [planned]=planWorkspace([weld],[],[p],options);
 assert.equal(planned.planned,true);
 const scene={toolExtent:0,query(head){
  const x=head.position[0],distance=Math.max(0,45-x,x-55);
  return {distance,collision:distance===0,part:'模拟干涉体',point:[x,0,0]};
 }};
 const workspace={welds:[planned],templates:[],processLibrary:[p]};
 const result=await resolvePlanningCollisions(workspace,scene,options);
 assert.equal(result.collisionOriginals[0].id,weld.id);
 assert.equal(result.welds.length,2);
 assert(result.welds.every(part=>part.planned&&part.collisionFragment));
 assert(result.welds.every(part=>part.collisionState!=='检测到碰撞'));
 assert(result.welds[0].segments[0].pathPoints.at(-1)[0]<45);
 assert(result.welds[1].segments[0].pathPoints[0][0]>55);
 const retained=await resolvePlanningCollisions(workspace,scene,{...options,splitParameters:{autoDeleteUnavoidable:false}});
 assert.equal(retained.welds[0].id,weld.id);
 assert.equal(retained.welds[0].collisionState,'检测到碰撞');
 assert.equal(retained.welds[0].planned,false);
});

test('转动扫掠能发现两端均未接触的障碍物',()=>{
 const plate=shape(.04,.04,.3,0).translate(0,3,0);
 const tool=shape(.1,4,.1,0).translate(0,2,0);
 const scene=createWeldCollisionScene({origin:[0,0,0],meshes:[mesh(plate,'转动障碍')]},[tool]);
 const at=distance=>{
  const angle=(distance-2)*Math.PI/8;
  return {distance,position:[0,0,0],head:{position:[0,0,0],quaternion:[0,0,Math.sin(angle),Math.cos(angle)]}};
 };
 try{
  assert.equal(scene.query(at(0).head).collision,undefined);
  assert.equal(scene.query(at(4).head).collision,undefined);
  const result=detectWeldCollision([{...pass('turn',0,4),toolPoses:[at(0),at(4)],posesAt:station=>[at(station)]}],scene);
  assert.equal(result.passes[0].contact.part,'转动障碍');
  assert(result.ranges.some(([from,to])=>from<2&&to>2));
 }finally{scene.dispose();plate.dispose();}
});

test('连续平移检查封闭实体的内部区间',()=>{
 const block=shape(3,3,3,4);
 const scene=createWeldCollisionScene({origin:[0,0,0],meshes:[mesh(block,'封闭实体')]},[shape(.1,.1,.1,0)]);
 try{
  const result=detectWeldCollision([pass('solid',0,8)],scene);
  assert.equal(result.ranges.length,1);
  assert(result.ranges[0][0]<2.5&&result.ranges[0][1]>5.5);
 }finally{scene.dispose();block.dispose();}
});
