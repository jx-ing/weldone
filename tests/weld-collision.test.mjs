import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {createWeldCollisionScene,detectWeldCollision} from '../src/weldCollision.mjs';
import {applyWeldWrapEdits,endpointWrapAt,materializeEndpointWraps,splitWeldWrap,weldWrapJunctions} from '../src/weldWrapJunctions.mjs';
import {installWrapSplit,undoLastSplit} from '../src/manualSplitModel.mjs';
import {resolvePlanningCollisions} from '../src/planningCollision.mjs';
import {weldLayerLayout} from '../src/weldLayerLayout.mjs';

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

test('拍照光路检查在拍照点前命中立板，但不把目标表面算作遮挡',()=>{
 const surface=shape(2,2,2,4),tool=shape(1,1,1,0);
 const scene=createWeldCollisionScene({origin:[10,20,30],meshes:[mesh(surface,'立板')]},[tool]);
 try{
  assert.equal(scene.lineObstruction([10,20,30],[13,20,30]),null);
  assert.equal(scene.lineObstruction([10,20,30],[17,20,30]).part,'立板');
  assert.equal(scene.solidAt([14,20,30]),true);
 }finally{scene.dispose();surface.dispose();}
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

test('包角碰撞报告干涉，开启普通焊缝打断也保留 U 形和 L 形包角',async()=>{
 const flag={continuousOpeningWrap:true};
 const opening={...wrapped,topology:'L',length:15,segments:[
  segment([0,0,0],[10,0,0],10,{endWrapKind:'L',endpointFacts:{end:flag}}),
  segment([10,0,0],[10,5,0],5,{startWrapKind:'L',endpointFacts:{start:flag}})
 ]};
 const scene={toolExtent:0,query:head=>({distance:0,collision:true,part:'干涉板',point:head.position})};
 for(const weld of [wrapped,opening])for(const [autoDeleteUnavoidable,checkOnly] of [[false,false],[true,false],[true,true]]){
  const workspace={welds:[{...weld,planned:true,pointLayout:weldLayerLayout(weld)}],templates:[],processLibrary:[]};
  const options={splitParameters:{autoDeleteUnavoidable},requireCollisionVerification:true};
  const result=await resolvePlanningCollisions(workspace,scene,options,undefined,{checkOnly});
  assert.deepEqual(result.welds.map(row=>row.id),[weld.id]);
  assert.equal(result.welds[0].collisionState,'检测到碰撞');
  assert.equal(result.welds[0].weldingOrder,null);
  assert.deepEqual(result.welds[0].segments,weld.segments);
  assert.equal(result.counts.trimmed,0);
  assert.deepEqual(result.collisionOriginals,[]);
 }
});
test('U 包角改为两个 L 时，两端按板厚比例加调整偏移分别取长并允许重叠',()=>{
 const source={...wrapped,segments:wrapped.segments.map(segment=>({...segment,subplateThickness:5}))};
 const halves=splitWeldWrap(source,0,'L',{lDistanceRatio:'1/2'});
 const overlaps=splitWeldWrap(source,0,'L',{lDistanceRatio:'2/3'});
 const adjusted=splitWeldWrap(source,0,'L',{lDistanceRatio:'1/2',lDistanceOffset:1.5});
 assert.deepEqual(halves.map(weld=>weld.length),[12.5,12.5]);
 assert.deepEqual(adjusted.map(weld=>weld.length),[14,14]);
 const first=overlaps[0].segments.at(-1),second=overlaps[1].segments[0];
 assert(Math.abs(first.length-10/3)<.0001);
 assert(Math.abs(second.length-10/3)<.0001);
 assert(first.pathPoints.at(-1)[1]>second.pathPoints[0][1]);
 assert(overlaps.every(weld=>weldWrapJunctions(weld).length===1));
});

test('端点 U 改 L 应用后产生两条有独立编号的 L，自动规划不会重新生成旧 U',()=>{
 const settings={lDistanceRatio:'2/3'};
 const main={...wrapped,closure:'open',segments:[{...wrapped.segments[2],startWrapKind:null,
  subplateThickness:5,startWrapEdit:{kind:'U',edges:[[[10,5,0],[10,0,0]],[[10,0,0],[0,0,0]]]}}]};
 const source=materializeEndpointWraps(main,settings);
 const end=endpointWrapAt(source,source.segments.length-1,'start');
 assert.equal(end.value,'U');
 assert.equal(end.junction.canUseU,true);
 const edited={...source,pendingWrapEdits:[{id:end.junction.id,type:'L'}]};
 assert.equal(endpointWrapAt(edited,source.segments.length-1,'start').value,'L');
 const children=applyWeldWrapEdits(edited,edited.pendingWrapEdits,settings);
 const saved=installWrapSplit({model:'fixture',selected:source.id,welds:[source]},source,children);
 assert.equal(saved.welds[0].enabled,false);
 assert.deepEqual(saved.welds.slice(1).map(child=>child.topology),['L','L']);
 assert.equal(new Set(saved.welds.slice(1).map(child=>child.id)).size,2);
 for(const child of saved.welds.slice(1)){
  assert.equal(child.segments.length,2);
  assert.equal(materializeEndpointWraps(child,settings),child);
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
  interferenceEndParameters:{startAngle:38,endAngle:38,startDistance:35,endDistance:35}};
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
 assert.equal(result.counts.trimmed,1);
 const {disableShortPlanningWelds}=await import('../src/strategyGeometry.mjs');
 const [a,b]=disableShortPlanningWelds(result.welds,50);
 assert.deepEqual([a.id,b.id],result.welds.map(weld=>weld.id));
 assert([a,b].every(weld=>!weld.enabled&&weld.disabledByMinWeldLength&&weld.weldingOrder===null));
 const exact=result.welds[0].length-.0001;
 assert.equal(disableShortPlanningWelds(result.welds,exact)[0].enabled,true);
 assert(result.welds.every(part=>part.strategyPlan.passes[0].points.every(point=>point.pose.advance===0)));
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
