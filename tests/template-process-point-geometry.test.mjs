import test from 'node:test';
import assert from 'node:assert/strict';
import {newWholeTemplateFromWeld,point,applyTemplateToWeld} from '../src/templateModel.mjs';
import {templateProcessNodes,moveTemplateProcessPoint,processPointDirection,moveTemplateProcessPointInDirection,projectedDragDistance,processPointSnapshot,restoreProcessPointPositions} from '../src/templateProcessPointGeometry.mjs';
import {sampleManualWeldPath} from '../src/manualWeldModel.mjs';
import {addPass,updatePass} from '../src/templateLayers.mjs';

function template(points=[[0,0,0],[100,0,0]]){const source={id:'W001',name:'工艺点源焊缝',completeStart:true,completeEnd:true,closure:'open',leg:6,segments:[{geometry:points.length===2?'直线':'曲线',length:points.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,j)=>v-points[i][j])),0),pathPoints:points,referenceNormal:[0,0,1],joint:'T 形接头',position:'PB · 横角焊'}],cornerAngles:[],groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false};return {...newWholeTemplateFromWeld('111.step',[source],'W001'),cornerReferenceNormal:[0,0,1]};}
const near=(actual,expected)=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<.01,`${actual} != ${expected}`));
test('三维工艺点坐标转换为局部偏移，同时包含当前道及层高度',()=>{
 const t={...template(),passOffset:{y:5,z:7}},next=moveTemplateProcessPoint(t,0,[10,25,37]);near(templateProcessNodes(next)[0].position,[10,25,37]);near(Object.values(next.points[0].offset),[10,20,30]);assert.strictEqual(next.segments,t.segments);assert.deepEqual(t.points[0].offset,{x:0,y:0,z:0});
});
test('人工控制点遵从参考点并保留姿态跟踪和工艺覆盖',()=>{
 const t=template();t.points[0].offset={x:10,y:2,z:3};const control={...point('control',1,0,'人工点'),referenceId:t.points[0].id,offset:{x:15,y:4,z:5},tracking:'激光跟踪',overrides:{current:225}};t.points.push(control);
 near(templateProcessNodes(t)[2].position,[25,6,8]);const moved=moveTemplateProcessPoint(t,2,[35,16,18]);near(templateProcessNodes(moved)[2].position,[35,16,18]);assert.deepEqual(moved.points[0],t.points[0]);assert.equal(moved.points[2].referenceId,control.referenceId);assert.equal(moved.points[2].tracking,'激光跟踪');assert.deepEqual(moved.points[2].overrides,{current:225});
 const snapshot=processPointSnapshot(t),restored=restoreProcessPointPositions({...moved,points:moved.points.map(p=>p.id===control.id?{...p,name:'新名称'}:p)},snapshot);assert.equal(restored.points[2].name,'新名称');assert.deepEqual(restored.points[2].offset,control.offset);
});
test('曲线工艺点移动通过真实弧长和法向反算，参数可往返',()=>{
 const pts=Array.from({length:33},(_,i)=>[100*Math.cos(i/32*Math.PI/2),100*Math.sin(i/32*Math.PI/2),0]),t=template(pts);t.points[0].offset={x:30,y:5,z:2};const desired={...t,points:t.points.map((p,i)=>i===0?{...p,offset:{x:45,y:8,z:6}}:p)},target=templateProcessNodes(desired)[0].position,next=moveTemplateProcessPoint(t,0,target);near(templateProcessNodes(next)[0].position,target);near(['x','y','z'].map(k=>next.points[0].offset[k]),[45,8,6]);
});
test('仅修改当前道，无效参考或不可达方向不会写入错误坐标',()=>{
 let t=template();t=addPass(t,t.layers[0].id,t.layers[0].passes[0].id);const first=structuredClone(t.layers[0].passes[0]),second=t.layers[0].passes[1],current={...t,points:second.points,passOffset:{y:3,z:4}},moved=moveTemplateProcessPoint(current,0,[10,13,14]),saved=updatePass(t,second.id,{points:moved.points});assert.deepEqual(saved.layers[0].passes[0],first);assert.equal(saved.layers[0].passes[1].points[0].offset.x,10);
 const noReference={...template(),points:[...template().points,point('control',1,0,'未绑定点')]};assert.throws(()=>moveTemplateProcessPoint(noReference,2,[1,2,3]),/基准点/);
 const vertical=template([[0,0,0],[0,0,100]]);near(templateProcessNodes(moveTemplateProcessPoint(vertical,0,[5,0,10]))[0].position,[5,0,10]);assert.throws(()=>moveTemplateProcessPoint(vertical,0,[0,5,10]),/偏移方向/);
});
test('沿曲线方向拖动使用真实弧长，并在当前位置更新水平垂直方向',()=>{
 const pts=Array.from({length:65},(_,i)=>[100*Math.cos(i/64*Math.PI/2),100*Math.sin(i/64*Math.PI/2),0]),t=template(pts),before=processPointDirection(t,0,'y'),next=moveTemplateProcessPointInDirection(t,0,'x',75);
 assert.deepEqual(next.points[0].offset,{x:75,y:0,z:0});near(templateProcessNodes(next)[0].position,sampleManualWeldPath(t.segments,75,t.cornerReferenceNormal).position);
 const along=processPointDirection(next,0,'x'),normal=processPointDirection(next,0,'y');assert.ok(Math.abs(along.reduce((sum,v,i)=>sum+v*normal[i],0))<1e-10);assert.ok(Math.hypot(...before.map((v,i)=>v-normal[i]))>.5);assert.equal(normal[2],0);assert.strictEqual(next.segments,t.segments);
});
test('倾斜焊缝的横向拖动保持水平，竖直拖动仅改变高度，应用位置与编辑器一致',()=>{
 const t=template([[0,0,0],[60,40,80]]);t.cornerReferenceNormal=[0,1,0];t.segments[0].referenceNormal=[0,1,0];t.points[0].offset={x:25,y:2,z:3};t.passOffset={y:4,z:7};
 const before=templateProcessNodes(t)[0].position,lateral=moveTemplateProcessPointInDirection(t,0,'y',9),after=templateProcessNodes(lateral)[0].position,normal=processPointDirection(t,0,'y'),along=processPointDirection(t,0,'x');
 near(after,before.map((v,i)=>v+normal[i]*9));assert.equal(after[2],before[2]);assert.ok(Math.abs(along.reduce((sum,v,i)=>sum+v*normal[i],0))<1e-10);assert.deepEqual(lateral.points[0].offset,{x:25,y:11,z:3});
 const vertical=moveTemplateProcessPointInDirection(lateral,0,'z',-2.5);near(templateProcessNodes(vertical)[0].position,[after[0],after[1],after[2]-2.5]);assert.deepEqual(vertical.points[0].offset,{x:25,y:11,z:.5});
 const pass={...vertical.layers[0].passes[0],points:vertical.points,offset:{y:4,z:7}},recipe={...vertical,name:'倾斜焊缝模板',layers:[{...vertical.layers[0],height:0,passes:[pass]}]},source={...recipe,id:'W001',completeStart:true,completeEnd:true,cornerAngles:[]};
 const applied=applyTemplateToWeld(source,recipe);near(Object.values(applied.controlPoints[0].position),templateProcessNodes(vertical)[0].position);
});
test('竖直焊缝的沿焊缝与竖直偏移各自独立，人工点保留基准和其他工艺值',()=>{
 const t=template([[0,0,0],[0,0,100]]),control={...point('control',1,0,'控制点'),referenceId:t.points[0].id,offset:{x:12,y:3,z:4},tracking:'激光跟踪',overrides:{current:220}};t.points.push(control);
 const along=moveTemplateProcessPointInDirection(t,2,'x',5),vertical=moveTemplateProcessPointInDirection(t,2,'z',5);near(templateProcessNodes(along)[2].position,templateProcessNodes(vertical)[2].position);assert.deepEqual(along.points[2].offset,{x:17,y:3,z:4});assert.deepEqual(vertical.points[2].offset,{x:12,y:3,z:9});assert.strictEqual(along.points[0],t.points[0]);assert.equal(along.points[2].referenceId,control.referenceId);assert.equal(along.points[2].tracking,'激光跟踪');assert.deepEqual(along.points[2].overrides,{current:220});
 near(processPointDirection(t,2,'y'),[1,0,0]);assert.throws(()=>moveTemplateProcessPointInDirection({...t,points:[...t.points,point('control')]},3,'y',2),/基准点/);assert.throws(()=>moveTemplateProcessPointInDirection(t,2,'view',2),/方向/);
});
test('屏幕拖动按当前方向投影还原毫米，忽略垂直于该方向的鼠标分量',()=>{
 assert.equal(projectedDragDistance([40,20],[2,1]),20);assert.equal(projectedDragDistance([50,0],[2,1]),20);assert.equal(projectedDragDistance([-40,-20],[2,1]),-20);assert.throws(()=>projectedDragDistance([10,10],[0,0]),/旋转视图/);
});
