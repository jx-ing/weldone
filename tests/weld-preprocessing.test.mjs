import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWeldWrap,preprocessExtractedWelds} from '../src/weldPreprocessing.mjs';
import {settingsDefaults,serializeSettings} from '../src/planningSettingsModel.mjs';
import {mergeSelectedWelds} from '../src/manualMergeModel.mjs';
import {applyWeldWrapEdits,endpointWrapAt,endpointWrapEdge,materializeEndpointWraps,overlappingEndpointWrap,weldWrapJunctions} from '../src/weldWrapJunctions.mjs';
import {directedWeld} from '../src/weldDirectionGeometry.mjs';
import {planWorkspace} from '../src/weldMatching.mjs';
import {generateStrategyPlan} from '../src/strategyPlanning.mjs';

const rules={maxHolePlateThickness:8,minCornerHoleSize:5,outerClearance:2,maxWrapPlateThickness:12};
const merge={angleMin:60,angleMax:120,maxGroove:1};
const facts={junctionType:'三面交',hasHole:true,holeSize:6,plateThickness:8};
const segment=(a,b,extra={})=>({geometry:'直线',pathPoints:[a,b],length:Math.hypot(...a.map((v,i)=>v-b[i])),position:'PB',mainPartId:'base',subPartId:'rib',subplateThickness:8,weldLeg:6,...extra});
const weld=(id,segments,extra={})=>({id,name:id,processingKey:'unit:'+id,sourceEvidence:{unitKeys:[id]},enabled:true,closure:'open',direction:'正向',segments,length:segments.reduce((n,s)=>n+s.length,0),position:segments[0].position,leg:6,weldType:'角焊缝',groove:{type:'无坡口',angle:0,depth:0},...extra});

test('端部删除保留仅有过焊孔尺寸或板厚限制的焊缝',()=>{
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
 assert.deepEqual(result.flatMap(w=>w.sourceEvidence.unitKeys),['W1','W2','W4','W6','W7','W8']);
 assert.equal(result.find(w=>w.id==='W7').segments.length,1);
});

test('槽隙和转角范围限制合并，合并后的真实路径再按实体间隙区间打断',()=>{
 const a=weld('W1',[segment([0,0,0],[9.5,0,0])]);
 const b=weld('W2',[segment([10,.5,0],[10,10,0])]);
 const calls=[];
 const result=preprocessExtractedWelds([a,b],rules,merge,{
  oppositeCornerRanges(s){
   calls.push(s.pathPoints);
   if(s.pathPoints[0][1]!==0||s.pathPoints[0][0]!==10)return [];
   return [{start:2,end:3.5}];
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
 assert.deepEqual(result.map(w=>w.length),[5,5,2]);
 assert.equal(result[0].endpointFacts.end.breakReason,'过焊孔打断');
 assert.equal(result[1].endpointFacts.start.hasHole,true);
 const priorJoin={...through,segments:[segment([0,0,0],[5,0,0]),segment([5,0,0],[10,0,0])]};
 assert.deepEqual(preprocessExtractedWelds([priorJoin,opening],rules,merge).map(w=>w.length),[5,5,2]);
});

test('跨孔与外角空间在合并前判定，实际槽隙与合并总长分别限制',()=>{
 const a=weld('W1',[segment([0,0,0],[20,0,0])]);
 const b=weld('W2',[segment([20,0,0],[20,30,0])]);
 const loose={...merge,maxGroove:10};
 const withHole=(w,side,value)=>({...w,endpointFacts:{[side]:value}});
 assert.equal(preprocessExtractedWelds([withHole(a,'end',facts),withHole(b,'start',facts)],rules,loose).length,2);
 const small={...facts,junctionType:'两面交',holeSize:5};
 assert.equal(preprocessExtractedWelds([withHole(a,'end',small),withHole(b,'start',small)],rules,loose).length,2);
 assert.equal(preprocessExtractedWelds([a,b],rules,{...loose,maxLength:49.9}).length,2);
 assert.equal(preprocessExtractedWelds([a,b],rules,{...loose,maxLength:50}).length,1);
 assert.equal(preprocessExtractedWelds([a,b],rules,loose,{measureCorner:()=> 'outer',
  outerCornerClearance:()=>({distance:1,partId:'opposite'})}).length,2);
 const separated=[weld('W3',[segment([0,0,0],[12,0,0])]),weld('W4',[segment([20,8,0],[20,30,0])])];
 assert.equal(preprocessExtractedWelds(separated,rules,loose).length,2);
 const short=weld('W5',[segment([20,2,0],[20,8,0])]);
 const [joined]=preprocessExtractedWelds([a,short],rules,loose,{measureCorner:()=> 'outer'});
 assert.equal(joined.segments.at(-1).strategyWrapKind,undefined);
});

test('符合连续条件的过焊孔连接判断为 L 并保留完整路径',()=>{
 const opening={...facts,junctionType:'两面交',holeSize:6};
 const left=weld('W1',[segment([0,0,0],[19.8,0,0])],{endpointFacts:{end:opening}});
 const right=weld('W2',[segment([20,.2,0],[20,25,0])],{endpointFacts:{start:opening}});
 const wrap={lDistanceRatio:'1/2'};
 const [joined]=preprocessExtractedWelds([left,right],rules,merge,{measureCorner:()=> 'inner'},wrap);
 assert.equal(joined.topology,'L');
 assert.deepEqual(joined.segments.map(segment=>segment.length),[20,25]);
 for(const direction of ['正向','反向']){
  const path=directedWeld({...joined,direction});
  assert.equal(path.segments[0].endWrapKind,'L');
  assert.equal(path.segments[1].startWrapKind,'L');
  const plan=generateStrategyPlan({...joined,direction},{start:{},weld:{},end:{}},{topologyVersion:1,weldPreprocessing:rules,wrapParameters:wrap});
  assert.ok(plan.passes[0].points.some(point=>point.name==='L形包角'&&point.position.every((value,i)=>value===[20,0,0][i])));
  assert.equal(plan.passes[0].points.at(-1).distance,45);
 }
 const connector=[segment([0,0,0],[20,0,0],{endpointFacts:{end:opening}}),segment([20,0,0],[20,8,0]),segment([20,8,0],[0,8,0])];
 const rows=preprocessExtractedWelds([weld('W3',connector)],rules,merge,{measureCorner:()=> 'outer'},wrap);
 assert.equal(rows.length,1);
 assert.equal(rows[0].topology,'L');
 assert.equal(rows[0].length,48);
 assert.equal(rows[0].segments[1].strategyWrapKind,'L');
 for(const rejection of [{...rules,minCornerHoleSize:6},{...rules,maxHolePlateThickness:7.9}]){
  assert.equal(preprocessExtractedWelds([left,right],rejection,merge,undefined,wrap).length,2);
 }
 const measuredOpening={...opening,openingBoundaryPoints:[[4,0,0],[6,0,0]]};
 const witness=weld('W4',[segment([4,0,0],[4,2,0],{endpointFacts:{start:measuredOpening}})]);
 for(const segments of [[segment([0,0,0],[10,0,0])],[segment([0,0,0],[5,0,0]),segment([5,0,0],[10,0,0])]]){
  const [continuous]=preprocessExtractedWelds([weld('W5',segments),witness],rules,merge,undefined,wrap);
  assert.equal(continuous.topology,'L');
  assert.equal(continuous.length,10);
  assert.deepEqual(continuous.segments.map(segment=>segment.length),[5,5]);
  assert.equal(continuous.segments[0].endWrapKind,'L');
 }
});

test('端点包角从真实相接板边生成，可回退且和反向焊接一致',()=>{
 const base=segment([0,0,0],[20,0,0]);
 const edge=endpointWrapEdge(base,'end',[[20,8,0],[20,0,0]]);
 assert.deepEqual(edge,[[20,0,0],[20,8,0]]);
 assert.equal(endpointWrapEdge(base,'end',[[21,8,0],[21,0,0]]),null);
 const edited=weld('W1',[{...base,endWrapEdit:{kind:'L',edges:[edge]}}]);
 const settings={lDistanceRatio:'1/2'};
 const withWrap=materializeEndpointWraps(edited,settings);
 assert.equal(withWrap.length,24);
 assert.equal(withWrap.segments[1].strategyWrapKind,'L');
 assert.equal(materializeEndpointWraps(withWrap,settings).length,24);
 assert.equal(endpointWrapAt({...withWrap,direction:'反向'},0,'start').value,'L');
 const neighbor=weld('W2',[segment([20,2,0],[20,7,0])]);
 assert.equal(overlappingEndpointWrap(withWrap,[neighbor]).id,'W2');
 withWrap.segments[0].endWrapEdit={kind:'none'};
 assert.equal(materializeEndpointWraps(withWrap,settings).length,20);
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

test('两个外角的外侧焊缝方向不构成 U 时分别为 L 形包角',()=>{
 const segments=[segment([0,0,0],[20,0,0]),segment([20,0,0],[20,8,0]),segment([20,8,0],[20,8,20])];
 const result=preprocessExtractedWelds([weld('W1',segments)],rules,merge,{measureCorner:()=> 'outer'},{lDistanceRatio:'1/2'});
 assert.deepEqual(result.map(weld=>weld.topology),['L','L']);
 assert.deepEqual(result.map(weld=>weld.length),[24,24]);
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
 assert.equal(path.segments[0].endWrapKind,'vertical');
 const slope=segment(upper,[10,0,0],{position:'PF'});
 const unrestricted={angleMin:0,angleMax:180,maxGroove:1};
 assert.equal(preprocessExtractedWelds([weld('W3',[vertical]),weld('W4',[slope])],rules,unrestricted).length,2);
 const down=segment(upper,lower,{position:'PF'});
 const joined=preprocessExtractedWelds([weld('W5',[down]),weld('W6',[segment(upper,top)])],rules,unrestricted);
 assert.equal(joined.length,1);
 assert.deepEqual(directedWeld(joined[0]).segments.map(segment=>segment.pathPoints),[[lower,upper],[upper,top]]);
});

test('焊脚设置迁移旧固定值并独立保存计算系数，规划按 0.5 mm 取整',()=>{
 const settings=settingsDefaults({topologyVersion:1,weldPreprocessing:{},actionParameters:{defaultLegs:{flat:{enabled:true,height:6}}}});
 assert.equal(settings.actionParameters.defaultLegs.flat.mode,'fixed');
 assert.equal(settings.actionParameters.defaultLegs.vertical.coefficient,.7);
 settings.actionParameters.defaultLegs.flat={...settings.actionParameters.defaultLegs.flat,mode:'coefficient',coefficient:'0.8'};
 const saved=serializeSettings(settings);
 assert.equal(saved.actionParameters.defaultLegs.flat.coefficient,.8);
 const w=weld('W1',[segment([0,0,0],[1,0,0])],{calculatedLeg:true,leg:9.6});
 for(const [raw,rounded] of [[9.6,9.5],[11.4,11.5],[11.2,11],[11.3,11.5]]){
  assert.equal(planWorkspace([{...w,leg:raw}],[],[],{...saved,planningRevision:3})[0].leg,rounded);
 }
});


test('立焊起点孔记录在立焊上时，删除同接头的下端短段并按设定距离规划上包角',()=>{
 const bottom=weld('bottom',[segment([-8,0,0],[0,0,0],{position:'待确认'})]);
 const upright=weld('upright',[segment([0,0,20],[0,0,0],{position:'PF',endpointFacts:{end:facts}})]);
 const upper=weld('upper',[segment([-8,0,20],[0,0,20])]);
 const separate=weld('separate',[segment([0,0,0],[0,7,0],{mainPartId:'other-base',subPartId:'other'})]);
 const measure={measureCorner:()=> 'outer'};
 const values={verticalDistance:5,verticalLPose:{advance:8,work:25,rotation:40}};
 const result=preprocessExtractedWelds([bottom,upright,upper,separate],rules,merge,measure,values);
 assert.equal(result.length,2);
 const [joined]=result;
 const path=directedWeld(joined);
 assert.deepEqual(path.segments.map(s=>[s.position,s.length,s.strategyWrapKind]),[['PF',20,undefined],['PB',5,'vertical']]);
 assert.equal(path.segments[0].startWrapKind,null);
 assert.equal(joined.topology,'vertical');
 assert.equal(joined.templateRequired,false);
 const process={start:{},weld:{},end:{},angles:{}};
 const plan=generateStrategyPlan(joined,process,{topologyVersion:1,weldPreprocessing:rules,wrapParameters:values});
 const wrap=plan.passes[0].points.find(point=>point.name==='立焊上包角'&&point.distance>20);
 assert(wrap);
 assert.equal(plan.passes[0].points.at(-1).distance,25);
 assert(Math.abs(wrap.pose.advance-8)<1e-8&&Math.abs(wrap.pose.work-25)<1e-8&&Math.abs(wrap.pose.rotation-40)<1e-8);
 assert.deepEqual(settingsDefaults({wrapParameters:{flatLPose:{advance:null}}}).wrapParameters.flatLPose,{advance:-42.01,work:42.97,rotation:114.18});
});

test('内部 L 形短段按设置取长，余下路径保留为另一条焊道',()=>{
 const segments=[segment([0,0,0],[20,0,0]),segment([20,0,0],[20,8,0]),segment([20,8,0],[40,8,0])];
 const firstOnly={measureCorner:({after})=>after.pathPoints[0][1]===0?'outer':'inner'};
 const result=preprocessExtractedWelds([weld('w',segments)],rules,merge,firstOnly,{lDistanceRatio:'1/2',lDistanceOffset:1.5});
 assert.equal(result.length,2);
 assert.deepEqual(result.map(weld=>weld.segments.map(s=>[s.length,s.strategyWrapKind])),[[[20,undefined],[5.5,'L']],[[2.5,undefined],[20,undefined]]]);
 const custom=preprocessExtractedWelds([weld('w',segments)],rules,merge,firstOnly,{lDistanceCustomRatio:.375,lDistanceOffset:1.5});
 assert.deepEqual(custom.map(weld=>weld.segments.map(s=>[s.length,s.strategyWrapKind])),[[[20,undefined],[3,'L']],[[5,undefined],[20,undefined]]]);
 const zero=preprocessExtractedWelds([weld('w',segments)],rules,merge,firstOnly,{lDistanceCustomRatio:0});
 assert.deepEqual(zero.map(weld=>weld.segments.map(s=>[s.length,s.strategyWrapKind])),[[[20,undefined],[8,undefined],[20,undefined]]]);
});

test('手动合并识别多组包角，连接点按焊接方向排列并可以一次应用多处编辑',()=>{
 const path=[[0,0,0],[20,0,0],[20,8,0],[0,8,0],[0,16,0],[20,16,0]];
 const source=path.slice(1).map((point,index)=>weld('W00'+(index+1),[segment(path[index],point)],{model:'111.step'}));
 const settings={planningRevision:3,topologyVersion:1,weldPreprocessing:{},measureTemplateNeighborhood:{measureCorner:()=> 'outer'}};
 const merged=mergeSelectedWelds({model:'111.step',welds:source,selected:source[0].id},source.map(w=>w.id),settings).welds.at(-1);
 assert.deepEqual(weldWrapJunctions(merged).map(joint=>[joint.index,joint.kind,joint.canUseU]),[[0,'U',true],[1,'U',true],[2,'U',true],[3,'U',true]]);
 const fragments=applyWeldWrapEdits(merged,[{id:0,type:'L'},{id:1,type:'L'},{id:2,type:'none'}],{lDistanceRatio:'2/3'});
 assert.equal(fragments.length,3);
 assert.deepEqual(fragments.map(fragment=>weldWrapJunctions(fragment).map(joint=>joint.kind)),[['L'],['L'],['L']]);
 const vertical=[weld('W001',[segment([0,0,30],[0,0,0],{position:'PF'})],{model:'111.step',leg:8}),
  weld('W002',[segment([0,0,30],[8,0,30])],{model:'111.step'})];
 const upright=mergeSelectedWelds({model:'111.step',welds:vertical,selected:'W001'},['W001','W002'],settings).welds.at(-1);
 assert.deepEqual(directedWeld(upright).segments.map(s=>s.strategyWrapKind),[undefined,'vertical']);
 assert.equal(upright.templateRequired,false);
});
