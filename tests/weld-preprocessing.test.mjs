import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWeldWrap,preprocessExtractedWelds} from '../src/weldPreprocessing.mjs';
import {settingsDefaults,serializeSettings} from '../src/planningSettingsModel.mjs';
import {directedWeld} from '../src/weldDirectionGeometry.mjs';
import {planWorkspace} from '../src/weldMatching.mjs';

const rules={maxHolePlateThickness:8,minCornerHoleSize:5,outerClearance:2,maxWrapPlateThickness:12};
const merge={angleMin:60,angleMax:120,maxGroove:1};
const facts={junctionType:'三面交',hasHole:true,holeSize:6,plateThickness:8};
const segment=(a,b,extra={})=>({geometry:'直线',pathPoints:[a,b],length:Math.hypot(...a.map((v,i)=>v-b[i])),position:'PB',mainPartId:'base',subPartId:'rib',subplateThickness:8,weldLeg:6,...extra});
const weld=(id,segments,extra={})=>({id,name:id,processingKey:'unit:'+id,sourceEvidence:{unitKeys:[id]},enabled:true,closure:'open',direction:'正向',segments,length:segments.reduce((n,s)=>n+s.length,0),position:segments[0].position,leg:6,weldType:'角焊缝',groove:{type:'无坡口',angle:0,depth:0},...extra});

test('先按已测量的端部条件删除，再合并，边界值和普通短焊缝保留',()=>{
 const terminal=(id,start,end,endpoint,position)=>weld(id,[segment(start,end,{position:position??'PB',terminalThicknessWeld:true})],{endpointFacts:{start:endpoint}});
 const values=[
  terminal('W1',[0,0,0],[5,0,0],{...facts,plateThickness:8.1}),
  terminal('W2',[5,0,0],[5,10,0],facts),
  terminal('W3',[20,0,0],[20,0,1],facts,'PF'),
  terminal('W4',[30,0,0],[31,0,0],{...facts,holeSize:4.9}),
  terminal('W5',[40,0,0],[41,0,0],{gap:1.9}),
  terminal('W6',[50,0,0],[51,0,0],{...facts,holeSize:5,gap:2}),
  weld('W7',[segment([60,0,0],[60.04,0,0])],{endpointFacts:{start:{...facts,holeSize:0,gap:0}}}),
  terminal('W8',[80,0,10],[80,0,0],facts,'PF')
 ];
 const result=preprocessExtractedWelds(values,rules,merge);
 assert.deepEqual(result.map(w=>w.id),['W2','W6','W7','W8']);
 assert.equal(result[2].segments.length,1);
});

test('槽隙和转角范围限制合并，合并后的真实路径再按实体间隙区间打断',()=>{
 const a=weld('W1',[segment([0,0,0],[9.5,0,0])]);
 const b=weld('W2',[segment([10,.5,0],[10,10,0])]);
 const calls=[];
 const result=preprocessExtractedWelds([a,b],rules,merge,{
  segmentClearance(s){
   calls.push(s.pathPoints);
   if(s.pathPoints[0][1]!==0||s.pathPoints[0][0]!==10)return null;
   return {pieces:[{start:2,end:5,from:[10,2,0],to:[10,2,1],endFrom:[10,5,0],endTo:[10,5,3]}]};
  }
 });
 assert.deepEqual(calls[0].at(-1),[10,0,0]);
 assert.equal(result.length,2);
 assert.deepEqual(result.map(w=>w.length),[12,6.5]);
 assert.equal(result[0].endpointFacts.end.breakReason,'间隙打断');
 assert.equal(result[1].endpointFacts.start.breakReason,'间隙打断');
 assert.equal(preprocessExtractedWelds([a,b],rules,{...merge,maxGroove:.4}).length,2);
 assert.equal(preprocessExtractedWelds([a,b],rules,{...merge,angleMin:95}).length,2);
});

test('焊缝段跨越已测三面交过焊孔时从孔中间切开，端点仍保留孔信息',()=>{
 const opening=weld('W2',[segment([4,0,0],[4,-2,0],{terminalThicknessWeld:true,endpointFacts:{start:{...facts,holeSize:3,openingBoundaryPoints:[[4,0,0],[6,0,0]]}}})]);
 const through=weld('W1',[segment([0,0,0],[10,0,0])]);
 const result=preprocessExtractedWelds([through,opening],rules,merge);
 assert.deepEqual(result.map(w=>w.length),[5,5]);
 assert.equal(result[0].endpointFacts.end.breakReason,'过焊孔打断');
 assert.equal(result[1].endpointFacts.start.hasHole,true);
});

test('连续两个物理外角是 U，单个物理外角是 L，反向不改变包角段',()=>{
 const segments=[segment([0,0,0],[20,0,0]),segment([20,0,0],[20,8,0]),segment([20,8,0],[0,8,0])];
 const w=weld('W1',segments),outer=()=> 'outer';
 for(const direction of ['正向','反向']){
  const u=classifyWeldWrap({...w,direction},12,outer);
  assert.equal(u.topology,'U');
  assert.equal(u.segments[1].strategyWrapKind,'U');
  const l=classifyWeldWrap({...w,segments:segments.slice(0,2),direction},12,outer);
  assert.equal(l.topology,'L');
  assert.equal(l.segments[1].strategyWrapKind,'L');
 }
 assert.equal(classifyWeldWrap(w,8,outer).topology,undefined);
 assert.equal(classifyWeldWrap(w,12,()=>null).topology,undefined);
});

test('混合焊缝立焊起点不包角，两个立焊不能合并成需要向下焊的路径',()=>{
 const lower=[0,0,0],upper=[0,0,20],side=[5,0,0],top=[5,0,20];
 const vertical=segment(lower,upper,{position:'PF'});
 const outer=()=> 'outer';
 const fromBottom=classifyWeldWrap(weld('W1',[segment(side,lower),vertical]),12,outer);
 assert.equal(fromBottom.segments[0].endWrapKind,null);
 assert.equal(fromBottom.segments[1].startWrapKind,null);
 assert.equal(fromBottom.segments[0].strategyWrapKind,undefined);
 const fromTop=preprocessExtractedWelds([weld('W2',[segment(top,upper),segment(upper,lower,{position:'PF'})])],rules,merge,{measureCorner:outer});
 const path=directedWeld(fromTop[0]);
 assert.deepEqual(path.segments[0].pathPoints,[lower,upper]);
 assert.equal(path.segments[0].startWrapKind,null);
 assert.equal(path.segments[0].endWrapKind,'L');
 const slope=segment(upper,[10,0,0],{position:'PF'});
 const unrestricted={angleMin:0,angleMax:180,maxGroove:1};
 assert.equal(preprocessExtractedWelds([weld('W3',[vertical]),weld('W4',[slope])],rules,unrestricted).length,2);
 const down=segment(upper,lower,{position:'PF'});
 const joined=preprocessExtractedWelds([weld('W5',[down]),weld('W6',[segment(upper,top)])],rules,unrestricted);
 assert.equal(joined.length,1);
 assert.deepEqual(directedWeld(joined[0]).segments.map(segment=>segment.pathPoints),[[lower,upper],[upper,top]]);
});

test('焊脚设置迁移旧固定值并独立保存计算系数，规划不将计算值取整',()=>{
 const settings=settingsDefaults({topologyVersion:1,weldPreprocessing:{},actionParameters:{defaultLegs:{flat:{enabled:true,height:6}}}});
 assert.equal(settings.actionParameters.defaultLegs.flat.mode,'fixed');
 assert.equal(settings.actionParameters.defaultLegs.vertical.coefficient,.7);
 settings.actionParameters.defaultLegs.flat={...settings.actionParameters.defaultLegs.flat,mode:'coefficient',coefficient:'0.8'};
 const saved=serializeSettings(settings);
 assert.equal(saved.actionParameters.defaultLegs.flat.coefficient,.8);
 const w=weld('W1',[segment([0,0,0],[1,0,0])],{calculatedLeg:true,leg:9.6});
 assert.equal(planWorkspace([w],[],[],{...saved,planningRevision:3})[0].leg,9.6);
});
