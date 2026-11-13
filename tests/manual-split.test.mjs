import test from 'node:test';import assert from 'node:assert/strict';
import {separateWeldSegments,splitWeldPreview,splitSelectedWeld,undoLastSplit,weldPointDistance} from '../src/manualSplitModel.mjs';
import {pathLength,validManualWeldPath} from '../src/manualWeldModel.mjs';
import {validWeldProcessParameters} from '../src/processParameterModel.mjs';
const seg=(points,extra={})=>({pathPoints:points,length:pathLength(points),geometry:'直线',joint:'T 形接头',position:'PB · 横角焊',...extra});
const weld={id:'W10042',name:'测试焊道',source:'manual',model:'111.step',enabled:true,planned:true,closure:'open',length:200,leg:6,position:'PB · 横角焊',joint:'T 形接头',segments:[seg([[0,0,0],[100,0,0]]),seg([[100,0,0],[100,100,0]])],groove:{type:'无坡口',angle:0,depth:0},current:200,voltage:22,speed:300,template:'旧模板',processParameters:{untrusted:'old'},startHole:true,endHole:true};
test('手动打断按真实路径长度切分，保留原始数据并可撤销，清除新焊道工艺快照',()=>{
 const d={model:'111.step',selected:weld.id,welds:[weld],templates:['unchanged']},next=splitSelectedWeld(d,weld.id,125),children=next.welds.slice(1);
 assert.deepEqual(children.map(w=>w.length),[125,75]);assert.deepEqual(children[0].segments.at(-1).pathPoints.at(-1),[100,25,0]);assert.deepEqual(children[1].segments[0].pathPoints[0],[100,25,0]);assert.equal(children[0].startHole,true);assert.equal(children[0].endHole,false);assert.equal(children[1].endHole,true);
 assert.equal(next.welds[0].enabled,false);assert.equal(weld.enabled,true);assert.ok(children.every(w=>validManualWeldPath(w)&&validWeldProcessParameters(w)&&!w.planned&&!w.processParameters&&!w.template));
 assert.deepEqual(undoLastSplit(JSON.parse(JSON.stringify(next))).welds,d.welds);assert.deepEqual(next.templates,d.templates);
});
test('段连接点、曲线折线采样和闭合开口按实际几何处理，拒绝端点和过短新段',()=>{
 assert.deepEqual(splitWeldPreview(weld,100).lengths,[100,100]);assert.equal(weldPointDistance(weld,[105,25,0]),125);
 const curved={...weld,segments:[seg([[0,0,0],[30,40,0],[60,40,0]],{geometry:'曲线'})]};assert.deepEqual(splitWeldPreview(curved,25).pieces[0][0].pathPoints.at(-1),[15,20,0]);
 const closed={...weld,closure:'closed',length:400,segments:[seg([[0,0,0],[100,0,0]]),seg([[100,0,0],[100,100,0]]),seg([[100,100,0],[0,100,0]]),seg([[0,100,0],[0,0,0]])]},opened=splitSelectedWeld({model:'111.step',selected:closed.id,welds:[closed]},closed.id,50).welds.at(-1);
 assert.equal(opened.closure,'open');assert.equal(opened.length,400);assert.deepEqual(opened.segments[0].pathPoints[0],[50,0,0]);assert.deepEqual(opened.segments.at(-1).pathPoints.at(-1),[50,0,0]);
 for(const at of [0,200,NaN,99.95])assert.throws(()=>splitWeldPreview(weld,at));
});
test('后续操作受到撤销依赖保护，未知工艺焊道打断不虚构工艺',()=>{
 const source={...weld,leg:null,speed:null,source:'extracted'},next=splitSelectedWeld({model:'111.step',welds:[source],selected:source.id},source.id,100),child=next.welds[1];assert.equal(child.leg,null);assert.equal(child.speed,null);
 const chained={...next,welds:next.welds.map(w=>w.id===child.id?{...w,mergedInto:'W999'}:w)};assert.throws(()=>undoLastSplit(chained),/后续/);assert.throws(()=>splitSelectedWeld(next,source.id,10),/启用/);
});

test('任意勾选的焊缝段独立拆出，连续保留段成组，全部拆分可撤销',()=>{
 const original={...weld,segments:Array.from({length:5},(_,index)=>seg([[index*20,0,0],[(index+1)*20,0,0]])),length:100};
 const draft={model:'111.step',selected:original.id,welds:[original]};
 const result=separateWeldSegments(draft,original.id,[3,1]);
 assert.equal(result.welds[0].enabled,false);
 assert.deepEqual(result.welds.slice(1).map(item=>item.segments[0].pathPoints[0][0]),[0,20,40,60,80]);
 assert.equal(result.welds.find(item=>item.id===result.selected).segments[0].pathPoints[0][0],20);
 const contiguous=separateWeldSegments(draft,original.id,[2,4]);
 assert.deepEqual(contiguous.welds.slice(1).map(item=>item.segments.length),[2,1,1,1]);
 const all=separateWeldSegments(draft,original.id,[0,1,2,3,4]);
 assert(all.welds.slice(1).every(item=>item.segments.length===1&&validManualWeldPath(item)));
 assert.deepEqual(undoLastSplit(JSON.parse(JSON.stringify(all))).welds,draft.welds);
});

test('焊缝段拆分恢复合并前的端点和段焊脚，闭合剩余段沿接头连续',()=>{
 const a=seg([[0,0,0],[100,0,0]]),b=seg([[100,0,0],[100,100,0]]),c=seg([[100,100,0],[0,100,0]]),d=seg([[0,100,0],[0,0,0]]);
 const closed={...weld,closure:'closed',segments:[a,b,c,d],length:400};
 const workspace={model:'111.step',welds:[closed],selected:closed.id};
 const separated=separateWeldSegments(workspace,closed.id,[1]);
 assert.deepEqual(separated.welds[1].segments.map(segment=>segment.pathPoints),[c.pathPoints,d.pathPoints,a.pathPoints]);
 const merged={...weld,source:'manual-merge',segments:[a,b],
  mergeIntersections:[{beforeSegment:1,afterSegment:2,beforeEndpoint:[95,0,0],afterEndpoint:[100,4,0]}]};
 const split=separateWeldSegments({...workspace,welds:[merged]},merged.id,[0,1]);
 assert.deepEqual(split.welds.slice(1).map(item=>item.segments[0].pathPoints),[[[0,0,0],[95,0,0]],[[100,4,0],[100,100,0]]]);
 assert.deepEqual(split.welds.slice(1).map(item=>item.length),[95,96]);
});
