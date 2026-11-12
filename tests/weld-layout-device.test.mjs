import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateDraft} from '../src/templateModel.mjs';
import {geometryRulesFromWeld,geometryRuleMismatches} from '../src/templateGeometryRules.mjs';
import {planningContext} from '../src/planningRequirements.mjs';
import {copyWeldLayersToTemplate,newWeldLayer,weldLayerLayout,weldLayerTreeGroups} from '../src/weldLayerLayout.mjs';

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

test('无过焊孔取 0 mm，端点间隙使用与匹配一致的一位小数',()=>{
 const weld={startHole:false,endHole:true,endpointFacts:{start:{hasHole:false,gap:0.00001396},end:{hasHole:true,gap:2.46,holeSize:6}}};
 const rules=geometryRulesFromWeld(weld);
 assert.deepEqual(rules.start.holeSize,{min:0,max:0});
 assert.deepEqual(rules.start.gap,{min:0,max:0});
 assert.deepEqual(rules.end.gap,{min:2.5,max:2.5});
 assert.deepEqual(rules.end.holeSize,{min:6,max:6});
 assert.deepEqual(geometryRuleMismatches(rules,weld),[]);
 assert.deepEqual(geometryRuleMismatches(rules,{...weld,endpointFacts:{...weld.endpointFacts,end:{...weld.endpointFacts.end,gap:2.44}}}),['终点间隙距离（模板 2.5 mm / 焊道 2.4 mm）']);
});
