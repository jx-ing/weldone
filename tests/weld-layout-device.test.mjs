import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,Vector3} from 'three';
import {applyTemplateToWeld,migrateDraft,newWholeTemplateFromWeld,point} from '../src/templateModel.mjs';
import {geometryRulesFromWeld,geometryRuleMismatches} from '../src/templateGeometryRules.mjs';
import {planningContext} from '../src/planningRequirements.mjs';
import {copyWeldLayersToTemplate,newWeldLayer,nextWeldLayer,nextWeldPass,removeWeldLayoutItem,updateWeldLayoutPoint,validWeldLayerLayout,weldLayerLayout,weldLayerPassPaths,weldLayerTreeGroups,weldPointPosition} from '../src/weldLayerLayout.mjs';
import {orientWeldSections,weldPassMeshGeometry,weldSectionSigns,weldSegmentPass,weldSolidTest} from '../src/weldPassMesh.mjs';

test('规划设备能力独立于工艺库设备，旧相机配置可迁移',()=>{
 const profile={id:'library',enabled:true,applicability:{welderModel:'库设备'},hardware:{
  trackingModes:['laser'],precisionCameras:{laser:{enabled:true},structuredLight:{enabled:false}}
 }};
 const migrated=migrateDraft({templates:[],processDeviceProfiles:[profile]});
 assert.equal(migrated.deviceControl.robot.welderModel,'库设备');
 assert.equal(migrated.deviceControl.precisionCamera.brand,'yinglai');
 assert.equal(Object.hasOwn(migrated,'planningDevice'),false);
 const deviceControl={...migrated.deviceControl,robot:{...migrated.deviceControl.robot,welderModel:'规划设备',trackingModes:['arc']}};
 const context=planningContext({...migrated,deviceControl});
 assert.equal(context.activeDevice.applicability.welderModel,'库设备');
 assert.equal(context.deviceCapabilities.arcTracking,true);
 assert.equal(context.deviceCapabilities.laserTracking,false);
 assert.equal(context.deviceCapabilities.laserPrecision,true);
 assert.equal(context.deviceCapabilities.structuredLightPrecision,false);
 assert.deepEqual(profile.hardware.trackingModes,['laser']);
});

test('后续层道直接继承第一道的起终点与姿态，并叠加自身偏移',()=>{
 const weld={id:'W001',enabled:true,closure:'open',segments:[{geometry:'直线',length:100,pathPoints:[[0,0,0],[100,0,0]]}]};
 const layout=weldLayerLayout(weld,{ready:false},[],[],{});
 assert.equal(layout[0].passes.length,1);
 const second=newWeldLayer(weld,2);
 second.height=3;
 second.passes[0].offset.z=4;
 const base=layout[0].passes[0];
 base.points.find(p=>p.kind==='start').offset.z=5;
 base.points.find(p=>p.kind==='start').angles.advance=12;
 base.points.find(p=>p.kind==='end').offset.z=6;
 layout.push(second);
 const [first,derived]=weldLayerTreeGroups(weld,layout);
 assert.deepEqual(first.points[0].position,[0,0,5]);
 assert.deepEqual(derived.points[0].position,[0,0,12]);
 assert.deepEqual(derived.points[1].position,[100,0,13]);
 assert.equal(derived.points[0].pose.advance,12);
 const copy=copyWeldLayersToTemplate({},layout);
 assert.equal(copy.layers[1].passes[0].points[0].offset.z,5);
 assert.equal(copy.layers[1].passes[0].points[0].tracking,'无跟踪');
 assert.notEqual(copy.layers[1].passes[0].points[0].id,derived.points[0].raw.id);
});

test('层道轨迹使用实际高度和偏移，保留 CAD 折点并经过手动控制点',()=>{
 const weld={id:'W002',enabled:true,closure:'open',segments:[{geometry:'曲线',pathPoints:[[0,0,0],[50,0,5],[100,0,0]]}]};
 const layout=weldLayerLayout(weld,{ready:false},[],[],{});
 assert.deepEqual(weldLayerPassPaths(weld,layout)[0].positions,weld.segments[0].pathPoints);
 const second=nextWeldLayer(weld,layout);
 layout.push(second);
 second.height=3;
 const pass=second.passes[0];
 Object.assign(pass.offset,{y:2,z:4,start:5,end:-5});
 const [start]=pass.points;
 pass.points.push({...point('control',1,0,'中间控制点'),referenceId:start.id,offset:{x:25,y:0,z:1}});
 const [base,derived]=weldLayerPassPaths(weld,layout);
 const [,group]=weldLayerTreeGroups(weld,layout);
 assert.deepEqual(base.positions,weld.segments[0].pathPoints);
 assert.deepEqual(derived.positions[0],group.points.find(point=>point.kind==='start').position);
 assert.deepEqual(derived.positions.at(-1),group.points.find(point=>point.kind==='end').position);
 assert(derived.positions.some(position=>position.every((value,index)=>value===group.points.at(-1).position[index])));
 const bend=derived.positions.find(position=>position[0]===50);
 assert(Math.abs(bend[1]-2)<1e-9);
 assert(bend[2]>12&&bend[2]<13);
});

test('单道位置偏移预览带动焊道，经过同一里程处的偏移控制点',()=>{
 const weld={id:'W006',enabled:true,leg:4,closure:'open',segments:[{geometry:'直线',pathPoints:[[0,0,0],[100,0,0]]}]};
 const saved=weldLayerLayout(weld,{ready:false},[],[],{});
 const [pass]=saved[0].passes;
 const start=pass.points[0];
 const preview=updateWeldLayoutPoint(saved,pass.id,{id:start.id,offset:{x:5,y:3,z:4}});
 const expected=[5,3,4];
 assert.deepEqual(weldPointPosition(weld,preview,pass.id,start.id),expected);
 assert.deepEqual(weldLayerPassPaths(weld,preview)[0].positions,[expected,[100,0,0]]);
 assert.deepEqual(weldLayerPassPaths(weld,saved)[0].positions,weld.segments[0].pathPoints);
 const control={...point('control',1,0),referenceId:start.id,offset:{x:0,y:10,z:0}};
 const withControl=updateWeldLayoutPoint(preview,pass.id,control,true);
 assert.deepEqual(weldLayerPassPaths(weld,withControl)[0].positions,[expected,[5,13,4],[100,0,0]]);
});

test('删除新增层、道和手动点位，保留自动锚点并避免重用现有名称',()=>{
 const weld={id:'W003',enabled:true,closure:'open',segments:[{geometry:'直线',pathPoints:[[0,0,0],[100,0,0]]}]};
 const layout=weldLayerLayout(weld,{ready:false},[],[],{});
 const [base]=layout;
 const extra=nextWeldLayer(weld,layout);
 layout.push(extra,nextWeldLayer(weld,[...layout,extra]));
 const pass=nextWeldPass(weld,extra);
 extra.passes.push(pass,nextWeldPass(weld,{passes:[...extra.passes,pass]}));
 const [anchor]=pass.points;
 const control={...point('control',1,0,'控制点'),referenceId:anchor.id};
 pass.points.push(control);
 const item={layerId:extra.id,passId:pass.id};
 assert.equal(removeWeldLayoutItem(layout,{type:'layer',layerId:base.id}),layout);
 assert.equal(removeWeldLayoutItem(layout,{type:'point',...item,pointId:anchor.id}),layout);
 const withoutPoint=removeWeldLayoutItem(layout,{type:'point',...item,pointId:control.id});
 assert.equal(withoutPoint[1].passes[1].points.length,2);
 assert.equal(pass.points.length,3);
 const withoutPass=removeWeldLayoutItem(withoutPoint,{type:'pass',...item});
 assert.equal(nextWeldPass(weld,withoutPass[1]).name,'第 4 道');
 const withoutLayer=removeWeldLayoutItem(withoutPass,{type:'layer',...item});
 assert.equal(nextWeldLayer(weld,withoutLayer).name,'第 4 层');
 assert(validWeldLayerLayout(withoutLayer));
});

test('层水平偏移叠加到各道，复制到模板并重新匹配时保持实际位置',()=>{
 const weld={id:'W004',name:'测试焊缝',model:'test.step',enabled:true,leg:6,position:'PB · 横角焊',closure:'open',
  startHole:false,endHole:false,completeStart:true,completeEnd:true,cornerAngles:[],groove:{type:'无坡口',angle:0,depth:0},
  segments:[{geometry:'直线',length:100,pathPoints:[[0,0,0],[100,0,0]],position:'PB · 横角焊'}]};
 const layout=weldLayerLayout(weld,{ready:false},[],[],{});
 const [base]=layout,extra=nextWeldLayer(weld,layout);
 layout.push(extra);
 base.offsetY=2;
 base.passes[0].offset.y=1;
 extra.offsetY=5;
 extra.height=4;
 extra.passes[0].offset.y=-2;
 extra.passes.push(nextWeldPass(weld,extra));
 const expected=[[0,3,0],[0,6,4],[0,8,4]];
 assert.deepEqual(weldLayerTreeGroups(weld,layout).map(group=>group.points[0].position),expected);
 assert.deepEqual(weldLayerPassPaths(weld,layout).map(pass=>pass.positions[0]),expected);
 const template=copyWeldLayersToTemplate(newWholeTemplateFromWeld(weld.model,[weld],weld.id),layout,weld);
 template.name='层水平偏移测试';
 const applied=applyTemplateToWeld(weld,template);
 assert.deepEqual(applied.layers.flatMap(layer=>layer.passes.map(pass=>Object.values(pass.controlPoints[0].position))),expected);
 const restored=weldLayerLayout(weld,{whole:template},[template],[],{});
 assert.deepEqual(weldLayerTreeGroups(weld,restored).map(group=>group.points[0].position),expected);
});

test('焊道三角截面沿接头两面展开，两个焊脚的实际长度相等',()=>{
 const weld={id:'W005',enabled:true,leg:6,closure:'open',segments:[{geometry:'直线',pathPoints:[[0,0,0],[100,0,0]],
  referenceNormal:[0,0,1],subFaceNormal:[0,-1,0]}]};
 const layout=weldLayerLayout(weld,{ready:false},[],[],{});
 layout.push(nextWeldLayer(weld,layout));
 const [pass]=weldLayerPassPaths(weld,layout);
 const geometry=weldPassMeshGeometry(pass,point=>new Vector3(...point));
 const points=geometry.attributes.position.array;
 const cap=Array.from(points.slice(-18,-9)).map(value=>value===0?0:value);
 assert.deepEqual(cap,[0,0,0,0,-6,0,0,0,6]);
 assert.equal(geometry.index.count,24);
});

test('三角焊脚避开两块零件实体，即使两侧面的法向均反向',()=>{
 const bottom=new BoxGeometry(100,40,8).translate(0,0,-4);
 const upright=new BoxGeometry(80,8,20).translate(0,-4,10);
 const contains=weldSolidTest([{geometry:bottom},{geometry:upright}]);
 const world=point=>new Vector3(...point);
 assert(contains(world([0,-1,1])));
 assert(contains(world([0,1,-1])));
 assert(!contains(world([0,1,1])));
 for(const pathPoints of [[[-40,0,0],[40,0,0]],[[40,0,0],[-40,0,0]]]){
  const pass=weldSegmentPass({pathPoints,referenceNormal:[0,0,-1],subFaceNormal:[0,-1,0]},6);
  const oriented=orientWeldSections(pass,[weldSectionSigns(pass,contains,world)]);
  const geometry=weldPassMeshGeometry(oriented,world);
  const cap=Array.from(geometry.attributes.position.array.slice(-18,-9)).map(value=>value||0);
  assert.deepEqual(cap,[pathPoints[0][0],0,0,pathPoints[0][0],6,0,pathPoints[0][0],0,6]);
 }
});

test('过焊孔尺寸和端点间隙按一位小数记录并匹配，无过焊孔显示 0.0 mm',()=>{
 const weld={startHole:false,endHole:true,endpointFacts:{start:{hasHole:false,gap:0.00001396},end:{hasHole:true,gap:2.46,holeSize:6.04}}};
 const rules=geometryRulesFromWeld(weld);
 assert.deepEqual(rules.start.holeSize,{min:0,max:0});
 assert.deepEqual(rules.start.gap,{min:0,max:0});
 assert.deepEqual(rules.end.gap,{min:2.5,max:2.5});
 assert.deepEqual(rules.end.holeSize,{min:6,max:6});
 assert.deepEqual(geometryRuleMismatches(rules,weld),[]);
 assert.deepEqual(geometryRuleMismatches(rules,{...weld,endpointFacts:{...weld.endpointFacts,end:{...weld.endpointFacts.end,gap:2.44}}}),['终点间隙距离（模板 2.5 mm / 焊道 2.4 mm）']);
 assert.deepEqual(geometryRuleMismatches(rules,{...weld,endpointFacts:{...weld.endpointFacts,start:{hasHole:true,holeSize:7,gap:0}}}),['起点过焊孔尺寸（模板 0.0 mm / 焊道 7.0 mm）']);
});
