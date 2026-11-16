import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFrame,insideCapture,clipCapturePolyline} from '../src/templateCaptureRange.mjs';
import {createTemplateNeighborhoodMeasurer} from '../src/templateNeighborhood.mjs';
import {geometryRulesFromWeld,geometryRuleErrors,geometryRuleMismatches,geometryRulesWithMeasuredAvailability,needsGeometryMeasurements,updateGeometryRuleMeasurements,updateDistanceIntervals,savedGeometryRules} from '../src/templateGeometryRules.mjs';
import {measureBaseplateEdges,measureBaseplateEndpoint} from '../src/templateBaseplateEdges.mjs';
import {distanceProfile,measureDistanceInterval} from '../src/templateDistanceProfile.mjs';
import {newPlanningTemplate,templateMeasurementWeld} from '../src/templateCoverModel.mjs';
import {reverseWeldTraversal} from '../src/weldDirectionGeometry.mjs';
import {applyTemplateToWeld,matchTemplate,targetFromWeld} from '../src/templateModel.mjs';
import {BoxGeometry} from 'three';

const range={along:4,across:4,above:2,below:7};
const segment=(points,values={})=>({
 geometry:'直线',position:'PB · 横角焊',length:10,pathPoints:points,sourceWeldId:'cad-weld',mainPartId:'main',subPartId:'sub',
 ...values
});
const weld=(segments=[segment([[0,0,0],[10,0,0]])])=>({
 id:'W001',enabled:true,model:'111.step',name:'测试焊缝',completeStart:true,completeEnd:true,leg:6,weldType:'角焊缝',
 closure:'open',segments,cornerAngles:segments.length===2?[90]:[],position:'PB · 横角焊',
 groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false
});

test('每个边缘和间隙区间分别参与匹配，保存并重算后保留选择',()=>{
 const profile=(first,second)=>distanceProfile([[0,4,first],[6,10,second]].map(([start,end,distance])=>({
  start,end,from:[start,0,0],to:[start,distance,0],endFrom:[end,0,0],endTo:[end,distance,0]
 })),null,10);
 const measurements=(edge,gap)=>({start:{holeSize:0},end:{holeSize:0},segments:[{baseplate:edge,solidGap:gap}]});
 const target=weld(),original=measurements(profile(2,3),profile(4,5));
 const changed=measurements(profile(2,8),profile(4,9));
 const rules=geometryRulesFromWeld(target,range,original),[segmentRules]=rules.segmentDistances;
 for(const key of ['baseplateEdge','solidGap']){
  segmentRules[key].intervals=updateDistanceIntervals([{start:0,end:4},{start:6,end:10,enabled:false}],
   original.segments[0][key==='baseplateEdge'?'baseplate':key]);
 }
 const reloaded=JSON.parse(JSON.stringify(savedGeometryRules(rules)));
 assert.deepEqual(geometryRuleMismatches(reloaded,target,changed),[]);
 const [stored]=reloaded.segmentDistances;
 stored.baseplateEdge.intervals[1].enabled=true;
 assert.match(geometryRuleMismatches(reloaded,target,changed).join(''),/边缘距离区间 2/);
 stored.baseplateEdge.intervals[1].enabled=false;
 stored.solidGap.intervals[1].enabled=true;
 stored.gapEnabled=false;
 assert.match(geometryRuleMismatches(reloaded,target,changed).join(''),/间隙区间 2/);
 const absent=measurements(profile(2,3),null);
 const previous=geometryRulesFromWeld(target,range,original),next=geometryRulesFromWeld(target,range,absent);
 const draft=updateGeometryRuleMeasurements(reloaded,previous,next,absent);
 assert.deepEqual(draft.segmentDistances[0].solidGap.intervals.map(interval=>interval.enabled),[undefined,true]);
 const unavailable=geometryRulesWithMeasuredAvailability(draft,absent).segmentDistances[0].solidGap.intervals[1];
 assert.equal(unavailable.enabled,false);
 assert.equal(draft.segmentDistances[0].solidGap.intervals[1].enabled,true);
 stored.solidGap.intervals[1]={start:null,end:null,distance:null,enabled:false};
 stored.baseplateEdge.intervals[0].enabled=false;
 assert.equal(needsGeometryMeasurements(reloaded),false);
 assert.deepEqual(geometryRuleErrors({...target,requirementsMatch:reloaded}),[]);
});

test('实测显示为零的端点尺寸退出匹配，独立实体间隙仍可按最近点匹配',()=>{
 const evidence={start:{holeSize:0,gap:{distance:.013},edgeDistance:{distance:35}},end:{holeSize:0},segments:[{
  baseplate:{nearest:{distance:2,station:0},spans:[]},solidGap:{nearest:{distance:0,station:0},spans:[]}
 }]};
 const rules=geometryRulesFromWeld(weld(),range,evidence);
 Object.assign(rules.segmentDistances[0],{edgeDistanceEnabled:true,gapEnabled:true});
 assert.equal(rules.segmentDistances[0].solidGap.mode,'nearest');
 assert.equal(rules.start.holeSizeEnabled,false);
 assert.equal(rules.start.gapEnabled,false);
 rules.start.gapEnabled=true;
 rules.end.gapEnabled=true;
 const active=geometryRulesWithMeasuredAvailability(rules,evidence);
 assert.equal(active.segmentDistances[0].edgeDistanceEnabled,false);
 assert.equal(active.segmentDistances[0].gapEnabled,true);
 assert.equal(active.end.gapEnabled,false);
 assert.equal(active.start.gapEnabled,false);
 assert.deepEqual(active.start.edgeDistance,{min:35,max:35});
 assert.deepEqual(active.start.gap,{min:0,max:0});
 assert.deepEqual(active.start.holeSize,{min:0,max:0});
 assert.equal(rules.segmentDistances[0].edgeDistanceEnabled,true);
 assert.equal(geometryRulesWithMeasuredAvailability(rules,null),rules);
});

test('过焊孔匹配范围用实测尺寸补全，保存后可随模板复测，缩小截取范围时停用',()=>{
 const target={...weld(),startHole:true,endpointFacts:{
  start:{junctionType:'三面交',hasHole:true,holeSize:35,openingBoundaryPoints:[[-1,0,0],[-2,1,0]]},
  end:{junctionType:'两面交',hasHole:false}
 }};
 const measure=createTemplateNeighborhoodMeasurer({parts:[],mesh:new Float32Array(),edges:{edges:[]},sourceWelds:[]});
 const measured=measure(target,range);
 assert.equal(measured.start.holeSize,35);
 const cover={kind:'weld-model-region',dataUrl:'data:image/png;base64,iVBORw0KGgo',width:640,height:400,model:'111.step',weldId:target.id,
  bounds:{min:[-5,-5,-7],max:[15,15,3]},parts:[0]};
 const template=JSON.parse(JSON.stringify(newPlanningTemplate(target.model,[target],target.id,cover,range,measured)));
 const saved=template.requirementsMatch;
 assert.equal(measure(template,range).start.holeSize,35);
 saved.start={...saved.start,holeSize:null,holeSizeEnabled:true};
 const hydrated=geometryRulesWithMeasuredAvailability(saved,measured);
 assert.deepEqual(hydrated.start.holeSize,{min:35,max:35});
 const custom={...hydrated,start:{...hydrated.start,holeSize:{min:34,max:36}}};
 assert.deepEqual(geometryRulesWithMeasuredAvailability(custom,measured).start.holeSize,{min:34,max:36});
 const outside=measure(template,{...range,along:.5});
 assert.equal(outside.start.holeSize,null);
 assert.equal(geometryRulesWithMeasuredAvailability(hydrated,outside).start.holeSizeEnabled,false);
 const {endpointFacts,...legacy}=template;
 assert.equal(measure(legacy,range).start.holeSize,null);
 assert.equal(measure(templateMeasurementWeld(legacy,reverseWeldTraversal(targetFromWeld(target))),range).start.holeSize,35);
});

function boxParts(groups){
 const values=[],parts=[];
 for(const [id,boxes] of Object.entries(groups)){
  const vertexOffset=values.length/6;
  for(const [min,max] of boxes){
   const size=max.map((v,i)=>v-min[i]),center=min.map((v,i)=>(v+max[i])/2);
   const box=new BoxGeometry(...size).toNonIndexed();
   const positions=box.getAttribute('position'),normals=box.getAttribute('normal');
   for(let i=0;i<positions.count;i++){
    values.push(positions.getX(i)+center[0],positions.getY(i)+center[1],positions.getZ(i)+center[2],
     normals.getX(i),normals.getY(i),normals.getZ(i));
   }
   box.dispose();
  }
  const bounds={min:[0,1,2].map(i=>Math.min(...boxes.map(([min])=>min[i]))),max:[0,1,2].map(i=>Math.max(...boxes.map(([,max])=>max[i])))};
  parts.push({id,vertexOffset,vertexCount:values.length/6-vertexOffset,solidCount:boxes.length,bbox:bounds});
 }
 return {parts,mesh:new Float32Array(values),edges:{edges:[]},sourceWelds:[]};
}

function cornerSolids(subjectBoxes,supportBoxes=[[[-30,-30,-4],[30,30,0]]]){
 return createTemplateNeighborhoodMeasurer(boxParts({main:supportBoxes,sub:subjectBoxes}));
}

test('立焊转平焊在支撑板边缘用相邻焊缝段确认外露侧',()=>{
 const segments=[
  segment([[0,0,0],[0,0,10]],{position:'PF · 立向上焊',referenceNormal:[0,-1,0]}),
  segment([[0,0,10],[5,0,10]],{referenceNormal:[0,-1,0],length:5})
 ];
 // The vertex lies just beyond the support mesh's top edge, within the rounded weld geometry.
 const support=[[[-20,0,-15],[20,6,9.995]]];
 const measure=cornerSolids([[[0,-8,-5],[10,0,10]]],support);
 const source=weld(segments);
 const options={measureTemplateNeighborhood:measure};
 const cover={kind:'weld-model-region',dataUrl:'data:image/png;base64,iVBORw0KGgo',width:640,height:400,
  model:source.model,weldId:source.id,bounds:{min:[-2,-8,-2],max:[7,6,12]},parts:[0]};
 const template=newPlanningTemplate(source.model,[source],source.id,cover,undefined,undefined,undefined,options);
 for(const direction of ['正向','反向']){
  const target={...source,direction};
  const [corner]=targetFromWeld(target,options).cornerDirections;
  assert.equal(corner.cornerSource,'solid');
  assert.equal(corner.angleSide,'outer');
  assert.equal(corner.angle,270);
  assert.equal(matchTemplate(template,target,options).ok,true);
 }
});

test('用实体区分混合内外角，倒序匹配保留起收弧角色及物理转角点',()=>{
 const segments=[
  segment([[-10,0,0],[0,0,0]],{referenceNormal:[0,0,1]}),
  segment([[0,0,0],[0,10,0]],{referenceNormal:[0,0,1]}),
  segment([[0,10,0],[10,10,0]],{referenceNormal:[0,0,1]})
 ];
 // First turn: the upper-left quadrant contains material. Second turn: only the lower-right quadrant is open.
 const measure=cornerSolids([[[-8,0,0],[0,18,6]],[[0,10,0],[18,18,6]]]);
 const options={measureTemplateNeighborhood:measure};
 const source={...weld(segments),cornerAngles:[90,90]};
 const cover={kind:'weld-model-region',dataUrl:'data:image/png;base64,iVBORw0KGgo',width:640,height:400,model:source.model,weldId:source.id,
  bounds:{min:[-10,-2,-2],max:[12,12,8]},parts:[0]};
 const template=newPlanningTemplate(source.model,[source],source.id,cover,undefined,undefined,undefined,options);
 assert.deepEqual(template.corners.map(corner=>[corner.angleSide,corner.standard]),[['outer',270],['inner',90]]);
 template.points.find(point=>point.kind==='start').overrides.current=211;
 template.points.find(point=>point.kind==='end').overrides.current=155;
 const junction=template.points.find(point=>point.kind==='junction'&&point.segment===1);
 junction.overrides.current=197;
 const target={...source,direction:'反向'};
 const measured=targetFromWeld(target,options);
 assert.deepEqual(measured.cornerAngles,[90,270]);
 assert.deepEqual(measured.cornerDirections.map(corner=>corner.turn),[90,-90]);
 assert.equal(matchTemplate(template,target,options).reversed,true);
 const applied=applyTemplateToWeld(target,template,options);
 assert.equal(applied.direction,'反向');
 for(const [kind,x,y,current] of [['start',10,10,211],['end',-10,0,155]]){
  const point=applied.controlPoints.find(point=>point.kind===kind);
  assert.deepEqual([point.position.x,point.position.y,point.overrides.current],[x,y,current]);
 }
 const mapped=applied.controlPoints.find(point=>point.id===junction.id);
 assert.deepEqual([mapped.segment,mapped.position.x,mapped.position.y,mapped.overrides.current],[2,0,0,197]);
 // A condition on the source segment's first 3 mm is evaluated at the corresponding end of the reversed segment.
 template.requirementsMatch={
  ...geometryRulesFromWeld(targetFromWeld(source,options),range),
  segmentDistances:[{baseplateEdge:{mode:'continuous',intervals:[{start:0,end:3,distance:{min:4,max:4}}]}},{},{}]
 };
 const measuredIntervals=[];
 const directionalMeasure=Object.assign((path)=>{
  const first=path.segments[0].pathPoints[0];
  measuredIntervals.push(first);
  const distance=first[0]===-10?4:9;
  const baseplate=distanceProfile([{start:0,end:10,from:[0,0,0],to:[0,distance,0],endFrom:[10,0,0],endTo:[10,distance,0]}],null,10);
  return {segments:[{baseplate},{},{}]};
 },{measureCorner:measure.measureCorner});
 assert.equal(matchTemplate(template,target,{measureTemplateNeighborhood:directionalMeasure}).reversed,true);
 assert.deepEqual(measuredIntervals,[[10,10,0],[-10,0,0]]);
});

test('截取坐标系随焊缝方向和平移变化，线段按同一范围裁切',()=>{
 const s=segment([[100,200,30],[100,210,30]]);
 const frame=captureFrame([s],s.pathPoints,range);
 assert(insideCapture(frame,[103,211,24]));
 assert(!insideCapture(frame,[105,211,24]));
 assert.deepEqual(clipCapturePolyline(frame,[[90,205,30],[110,205,30]]),[[[96,205,30],[104,205,30]]]);
});

function source(extra=[]){
 const triangles=[
  ['main',[[0,-2,-1],[10,-2,-1],[5,2,-1]]],
  ['below',[[4.3,-.1,-6],[4.5,-.1,-6],[4.4,.2,-6]]],
  ['outward',[[4.3,3,-1],[4.5,3,-1],[4.4,3,1]]],
  ['to-side',[[2,3,-2],[6,3,-2],[4,5,-2]]],
  ['before',[[-3,-2,-2],[-3,2,-2],[-3,0,2]]],
  ...extra
 ];
 const parts=triangles.map(([id,points],index)=>({id,vertexOffset:index*3,vertexCount:3,solidCount:1,
  bbox:{min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))}
 }));
 const mesh=new Float32Array(triangles.flatMap(([,points])=>points.flatMap(p=>[...p,0,0,1])));
 const edges={edges:[{partId:'main',faceIndex:0,boundaryId:'edge',wire:'outer',points:[[0,3,0],[10,3,0]]}]};
 const sourceWelds=[{id:'cad-weld',mainPartId:'main',mainFaceIndex:0,subPartId:'sub',subFaceIndex:0,segments:[{index:1}],
  properties:{焊缝段:[{主板面:{类型:'平面',法向:[0,0,1]},副板面:{类型:'平面',法向:[0,1,0]}}]}}];
 return {parts,mesh,edges,sourceWelds};
}

test('范围同时约束段边缘、向外间隙及端点间隙，未命中为不限',()=>{
 const measure=createTemplateNeighborhoodMeasurer(source());
 const target=weld();
 const wide=measure(target,range);
 assert.equal(wide.segments[0].baseplate.nearest.distance,3);
 assert.equal(wide.segments[0].gap.distance,3);
 assert.equal(wide.start.gap.distance,3);
 assert.equal(wide.start.holeSize,0);
 assert.equal(wide.end.gap,null);
 assert.equal(wide.start.edgeDistance,null);
 assert.equal(wide.end.edgeDistance,null);
 const narrow={...range,along:2,across:2,below:5};
 const none=measure(target,narrow);
 assert.equal(none.segments[0].baseplate.nearest,null);
 assert.deepEqual(none.segments[0].baseplate.spans,[]);
 assert.equal(none.segments[0].gap,null);
 assert.equal(none.start.gap,null);
 const rules=geometryRulesFromWeld(target,range,wide);
 const [saved]=savedGeometryRules(rules).segmentDistances;
 assert.deepEqual(saved.baseplateEdge,{mode:'continuous',intervals:[{start:0,end:10,distance:{min:3,max:3}}]});
 assert.equal(saved.solidGap.mode,'continuous');
 assert.deepEqual(saved.solidGap.intervals.map(interval=>interval.distance),[{min:3,max:3}]);
 assert.deepEqual(geometryRuleMismatches(rules,target,wide),[]);
 assert.equal(geometryRuleMismatches(rules,target,none).length,3);
});

test('曲线上逐点限制边缘和间隙搜索，别处扩大截取包围框不放宽本处范围',()=>{
 const points=[[0,0,0],[10,0,0],[10,10,-10]];
 const s=segment(points,{geometry:'曲线',length:10+Math.sqrt(200)});
 const target=weld([s]);
 const geometry=source();
 geometry.parts=geometry.parts.filter(part=>part.id==='outward');
 geometry.edges.edges[0].points=[[1,3,0],[6,3,0]];
 const measure=createTemplateNeighborhoodMeasurer(geometry);
 const [wide]=measure(target,range).segments;
 assert.equal(wide.baseplate.nearest.distance,3);
 assert.equal(wide.solidGap.nearest.distance,3);
 const narrow={...range,across:.2,below:.2};
 const frame=captureFrame([s],points,narrow);
 assert.ok(insideCapture(frame,[1,3,0]));
 assert.ok(insideCapture(frame,[4.4,3,0]));
 const [local]=measure(target,narrow).segments;
 assert.deepEqual(local.baseplate.spans,[]);
 assert.equal(local.baseplate.nearest,null);
 assert.deepEqual(local.solidGap.spans,[]);
 assert.equal(local.solidGap.nearest,null);
});

test('端点只沿首尾各自的外向切线寻找截取范围内的第一个孔边或板边',()=>{
 const target=weld([
  segment([[0,0,0],[0,0,0],[10,0,0]]),
  segment([[10,0,0],[15,10,0],[15,10,0]])
 ]);
 const geometry=source();
 const boundary=(wire,points,extra={})=>({partId:'main',faceIndex:0,wire,points,...extra});
 geometry.edges.edges.push(
  boundary('outer',[[-4,-1,0],[-4,1,0]]),
  boundary('inner',[[-2,-1,0],[-1,1,0],[-1,2,0]],{closed:true}),
  boundary('outer',[[1,-1,0],[1,1,0]]),
  boundary('inner',[[-.5,-1,.5],[-.5,1,.5]]),
  boundary('inner',[[-.5,-1,0],[-.5,1,0]],{faceIndex:1}),
  boundary('outer',[[16,12,0],[18,12,0]])
 );
 const measure=createTemplateNeighborhoodMeasurer(geometry);
 const evidence=measure(target,range);
 assert.deepEqual(evidence.start.edgeDistance,{from:[0,0,0],to:[-1.5,0,0],distance:1.5,kind:'hole'});
 assert.deepEqual(evidence.end.edgeDistance,{from:[15,10,0],to:[16,12,0],distance:Math.sqrt(5),kind:'plate'});
 const reverse=measure(targetFromWeld({...target,direction:'反向'}),range);
 assert.deepEqual(reverse.start.edgeDistance,evidence.end.edgeDistance);
 assert.deepEqual(reverse.end.edgeDistance,evidence.start.edgeDistance);
 const narrow=measure(target,{...range,along:.5});
 assert.equal(narrow.start.edgeDistance,null);
 assert.equal(narrow.end.edgeDistance,null);
 const rules=geometryRulesFromWeld(target,range,evidence);
 assert.deepEqual(rules.start.edgeDistance,{min:1.5,max:1.5});
 assert.deepEqual(rules.end.edgeDistance,{min:2.2,max:2.2});
 assert.deepEqual(geometryRuleMismatches(rules,target,evidence),[]);
 assert(geometryRuleMismatches(rules,target,narrow).some(reason=>reason.startsWith('起点边缘距离')));
});

test('沿端点切线重合的底板边界取最先到达的位置',()=>{
 const s=segment([[0,0,0],[10,0,0]]);
 const origin=s.pathPoints[0],direction=[-1,0,0],frame=captureFrame([s],s.pathPoints,range);
 const geometry=source();
 geometry.edges.edges.push({partId:'main',faceIndex:0,wire:'outer',points:[[-6,0,0],[-4,0,0]]});
 const measure=()=>measureBaseplateEndpoint(origin,direction,geometry.sourceWelds[0],geometry.edges,frame);
 assert.deepEqual(measure(),{from:origin,to:[-4,0,0],distance:4,kind:'plate'});
});

test('间隙沿各段外侧测第一次命中，共用最近点与连续区间',()=>{
 const target=weld([segment([[0,0,0],[10,0,0]]),segment([[10,0,0],[10,10,0]],{sourceWeldId:'second-weld'})]);
 const geometry=source([
  ['second-near-a',[[12,1,-1],[14,9,-1],[14,9,1]]],
  ['second-near-b',[[12,1,-1],[14,9,1],[12,1,1]]],
  ['second-far',[[14,1,-2],[14,9,-2],[14,5,2]]],
  ['second-inward',[[9,1,-2],[9,9,-2],[9,5,2]]]
 ]);
 geometry.sourceWelds.push({...geometry.sourceWelds[0],id:'second-weld',
  properties:{焊缝段:[{主板面:{类型:'平面',法向:[0,0,1]},副板面:{类型:'平面',法向:[1,0,0]}}]}});
 const measure=createTemplateNeighborhoodMeasurer(geometry);
 const evidence=measure(target,range);
 const [first,second]=evidence.segments.map(segment=>segment.solidGap);
 assert.equal(first.nearest.distance,3);
 assert.equal(second.nearest.distance,2);
 assert.deepEqual(second.nearest.to,[12,1,0]);
 const interval=measureDistanceInterval(second,2,8);
 assert(Math.abs(interval.min-2.25)<1e-6&&Math.abs(interval.max-3.75)<1e-6);
 const rules=geometryRulesFromWeld(target,range,evidence);
 rules.segmentDistances[1].solidGap={mode:'nearest',nearest:{min:3,max:4}};
 assert.deepEqual(geometryRuleMismatches(rules,target,evidence),['第 2 段间隙（模板 3–4 mm / 焊道 2 mm）']);
 rules.segmentDistances[1].gapEnabled=false;
 assert.deepEqual(geometryRuleMismatches(rules,target,evidence),[]);

});

test('曲线按相邻板材逐点判断外侧，反向仍命中同一侧且忽略偏离底板平面的实体',()=>{
 const geometry=boxParts({
  sub:[[[0,0,0],[10,10,4]]],
  outside:[[[2,-3,-1],[8,-2,1]],[[13,2,-1],[14,8,1]]],
  offPlane:[[[2,-1,1],[8,-.5,2]],[[11,2,-2],[12,8,-1]]],
  inward:[[[2,1,-1],[8,1.5,1]],[[8.5,2,-1],[9,8,1]]]
 });
 const faces={主板面:{类型:'平面',法向:[0,0,1]},副板面:{类型:'曲面'}};
 geometry.sourceWelds=[{...source().sourceWelds[0],properties:{焊缝段:[faces]}}];
 const measure=createTemplateNeighborhoodMeasurer(geometry);
 const target=weld([segment([[0,0,0],[10,0,0],[10,10,0]],{geometry:'曲线',length:20})]);
 const profile=measure(target,range).segments[0].solidGap;
 assert.deepEqual(profile.spans,[{start:2,end:8},{start:12,end:18}]);
 assert.deepEqual(profile.nearest.to,[2,-2,0]);
 assert.ok(Math.abs(measureDistanceInterval(profile,3,7).max-2)<1e-5);
 assert.ok(Math.abs(measureDistanceInterval(profile,13,17).max-3)<1e-5);
 const reversed=measure(weld([segment([...target.segments[0].pathPoints].reverse(),{geometry:'曲线',length:20})]),range).segments[0].solidGap;
 assert.ok(Math.abs(measureDistanceInterval(reversed,3,7).max-3)<1e-5);
 assert.ok(Math.abs(measureDistanceInterval(reversed,13,17).max-2)<1e-5);
 assert.equal(measure(target,{...range,across:1.5}).segments[0].solidGap.nearest,null);
});

test('模板只保留整条焊缝端点尺寸，分段范围使用模板自身的截取设置匹配',()=>{
 const target=weld([
  segment([[0,0,0],[10,0,0]],{endpointFacts:{start:{hasHole:false,gap:3},end:{holeSize:2,gap:1}}}),
  segment([[10,0,0],[10,10,0]])
 ]);
 target.endpointFacts={start:{hasHole:false,type:'两面交'},end:{hasHole:false,type:'三面交'}};
 const cover={kind:'weld-model-region',dataUrl:'data:image/png;base64,iVBORw0KGgo',width:640,height:400,model:'111.step',weldId:'W001',
  bounds:{min:[-5,-5,-7],max:[15,15,3]},parts:[0]};
 const measure=createTemplateNeighborhoodMeasurer(source());
 const template=newPlanningTemplate('111.step',[target],target.id,cover,range,measure(target,range));
 template.name='两段模板';
 assert.equal(template.corners.length,1);
 assert.equal(template.requirementsMatch.segmentDistances.length,2);
 assert(template.segments.every(s=>!Object.hasOwn(s,'endpointFacts')));
 assert.deepEqual(template.requirementsMatch.start.holeSize,{min:0,max:0});
 assert.equal(matchTemplate(template,target,{measureTemplateNeighborhood:measure}).ok,true);
 assert.equal(matchTemplate(template,target,{measureTemplateNeighborhood:(w,requested)=>measure(w,{...requested,across:2})}).ok,false);
 const first=template.requirementsMatch.segmentDistances[0],start=template.requirementsMatch.start;
 first.edgeDistanceEnabled=false;
 first.gapEnabled=false;
 start.holeSizeEnabled=false;
 start.gapEnabled=false;
 start.edgeDistanceEnabled=false;
 // Disabled measurements retain their values, including edits outside the actual geometry.
 start.holeSize={min:42,max:42};
 start.edgeDistance={min:99,max:99};
 const options={measureTemplateNeighborhood:(w,requested)=>measure(w,{...requested,below:2})};
 assert.equal(matchTemplate(template,target,options).ok,true);
 start.edgeDistanceEnabled=true;
 assert.throws(()=>applyTemplateToWeld(target,template,options),error=>
  error.reasons.length===1&&error.reasons[0]==='起点边缘距离（模板 99 mm / 焊道 截取范围内未命中）');
});

test('实时重算只更新自动测量条件并保持用户手动修改',()=>{
 const measure=createTemplateNeighborhoodMeasurer(source()),target=weld();
 const initial=geometryRulesFromWeld(target,range,measure(target,range));
 const manual={...initial,segmentDistances:[{...initial.segmentDistances[0],baseplateEdge:{
  ...initial.segmentDistances[0].baseplateEdge,mode:'nearest',nearest:{min:2,max:4}
 }}]};
 const nextRange={...range,along:2,across:2,below:5};
 const recalculated=geometryRulesFromWeld(target,nextRange,measure(target,nextRange));
 const updated=updateGeometryRuleMeasurements(manual,initial,recalculated);
 assert.deepEqual(updated.captureRange,nextRange);
 assert.deepEqual(savedGeometryRules(updated).segmentDistances,[{
  baseplateEdge:{mode:'nearest',nearest:{min:2,max:4},closest:null},solidGap:{mode:'continuous',intervals:[]}
 }]);
 assert.equal(updated.start.gap,null);
 assert.deepEqual(updated.start.holeSize,{min:0,max:0});

 const [manualSegment]=manual.segmentDistances;
 manualSegment.gapEnabled=true;
 manualSegment.solidGap={...manualSegment.solidGap,intervals:[{start:4.36,end:4.44,distance:{min:3,max:3}}]};
 const outside=measure(target,nextRange);
 const narrowed=updateGeometryRuleMeasurements(manual,initial,recalculated,outside);
 assert.equal(geometryRulesWithMeasuredAvailability(narrowed,outside).segmentDistances[0].gapEnabled,false);
 const inside=measure(target,range);
 const restored=updateGeometryRuleMeasurements(narrowed,recalculated,initial,inside);
 const [restoredSegment]=savedGeometryRules(geometryRulesWithMeasuredAvailability(restored,inside)).segmentDistances;
 assert.equal(restoredSegment.gapEnabled,true);
 assert.deepEqual(restoredSegment.solidGap.intervals,manualSegment.solidGap.intervals);
 assert.equal(restoredSegment.solidGap.intervalsEdited,true);
});

test('仅底板孔边和板边参与，连续距离计算两个边界之间切换时的最大距离',()=>{
 const s=segment([[0,0,0],[10,0,0]]);
 const edge=(partId,faceIndex,wire,points)=>({partId,faceIndex,wire,points});
 const edges={edges:[
  edge('main',0,'inner',[[0,1,0],[4,3,0]]),
  edge('main',0,'outer',[[0,3,0],[4,1,0]]),
  edge('main',0,'outer',[[6,3,0],[10,3,0]]),
  edge('main',0,'outer',[[0,0,0],[10,0,0]]),
  edge('main',1,'inner',[[0,.1,0],[10,.1,0]]),
  edge('main',0,'unknown',[[0,.1,0],[10,.1,0]]),
  edge('sub',0,'outer',[[0,.1,0],[10,.1,0]])
 ]};
 const profile=measureBaseplateEdges(s,source().sourceWelds[0],edges,captureFrame([s],s.pathPoints,range));
 assert.equal(measureBaseplateEndpoint(s.pathPoints[0],[-1,0,0],source().sourceWelds[0],edges,captureFrame([s],s.pathPoints,range)).distance,0);
 assert.deepEqual(profile.spans,[{start:0,end:4},{start:6,end:10}]);
 assert.equal(profile.nearest.distance,1);
 assert.equal(profile.nearest.kind,'hole');
 const measured=measureDistanceInterval(profile,0,4,true);
 assert.equal(measured.min,1);
 assert(Math.abs(measured.max-2)<1e-6);
 assert(measured.witnesses.some(hit=>hit.kind==='plate'));
 assert.equal(measureDistanceInterval(profile,1,7),null);
 assert.deepEqual(updateDistanceIntervals([{start:1,end:3},{start:7,end:9}],profile),[
  {start:1,end:3,distance:{min:1.5,max:2}},
  {start:7,end:9,distance:{min:3,max:3}}
 ]);
});
