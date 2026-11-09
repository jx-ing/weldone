import test from 'node:test';
import assert from 'node:assert/strict';
import {patchWeldGroup,patchWeldSegment,patchWeldGroove,segmentName} from '../src/weldAttributeModel.mjs';
test('组属性同时更新各段，单段特征跟踪和包角独立保存，保留几何和原对象',()=>{
 const weld={segments:[{joint:'T 形接头',position:'PB · 横角焊',length:100,pathPoints:[[0,0,0],[100,0,0]],tracking:'无跟踪'},{joint:'T 形接头',position:'PB · 横角焊',length:80,pathPoints:[[100,0,0],[100,80,0]],tracking:'电弧跟踪'}]};
 const group=patchWeldGroup(weld,'joint','搭接接头');assert.deepEqual(group.map(s=>s.joint),['搭接接头','搭接接头']);assert.equal(weld.segments[0].joint,'T 形接头');assert.strictEqual(group[0].pathPoints,weld.segments[0].pathPoints);
 const segments=patchWeldSegment(weld,0,'tracking','激光跟踪');assert.equal(segments[0].tracking,'激光跟踪');assert.strictEqual(segments[1],weld.segments[1]);assert.equal(segments[0].length,100);
});
test('坡口钝边和根部半径分别保存，切换无坡口清零尺寸且保留来源元数据',()=>{
 const weld={groove:{type:'单边 V 形',angle:45,depth:10,rootGap:0,rootRadius:3,rootFace:2,source:'manual'}};
 const groove=patchWeldGroove(weld,'rootFace',4);assert.equal(groove.rootRadius,3);assert.equal(groove.rootFace,4);assert.equal(weld.groove.rootFace,2);
 assert.deepEqual(patchWeldGroove(weld,'type','无坡口'),{type:'无坡口',angle:0,depth:0,rootGap:0,rootRadius:0,rootFace:0,source:'manual'});
});

test('段选择和标题使用实际焊道编号，多段编号保持真实ID并标注段序号',()=>{
 assert.equal(segmentName({id:'W10059',segments:[{}]},0),'W10059');
 assert.equal(segmentName({id:'W10002',segments:[{},{}]},0),'W10002 · 第1段');
 assert.equal(segmentName({id:'W10002',segments:[{},{}]},1),'W10002 · 第2段');
});

test('起终点包角逐段独立编辑和持久化，旧特征与整体包角元数据不被错误映射',()=>{
 const weld={segments:[{startFeature:'三面交',endFeature:'自由端',wrapMode:'full',length:100},{length:80}]};
 let segments=patchWeldSegment(weld,0,'startWrapMode','half');
 segments=patchWeldSegment({...weld,segments},0,'endWrapMode','full');
 assert.equal(segments[0].startWrapMode,'half');assert.equal(segments[0].endWrapMode,'full');assert.strictEqual(segments[1],weld.segments[1]);
 assert.equal(segments[0].startFeature,'三面交');assert.equal(segments[0].endFeature,'自由端');assert.equal(segments[0].length,100);
 assert.deepEqual(JSON.parse(JSON.stringify(segments)),segments);assert.equal(weld.segments[0].startWrapMode,undefined);
});
