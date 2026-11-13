import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFrame,insideCapture,clipCapturePolyline} from '../src/templateCaptureRange.mjs';
import {createTemplateNeighborhoodMeasurer} from '../src/templateNeighborhood.mjs';
import {geometryRulesFromWeld,geometryRuleMismatches,updateGeometryRuleMeasurements,updateDistanceIntervals,savedGeometryRules} from '../src/templateGeometryRules.mjs';
import {measureBaseplateEdges,measureBaseplateEndpoint} from '../src/templateBaseplateEdges.mjs';
import {distanceProfile,measureDistanceInterval} from '../src/templateDistanceProfile.mjs';
import {newPlanningTemplate} from '../src/templateCoverModel.mjs';
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

function cornerSolids(subjectBoxes){
 const values=[],parts=[];
 for(const [id,boxes] of [['main',[[[-30,-30,-4],[30,30,0]]]],['sub',subjectBoxes]]){
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
 return createTemplateNeighborhoodMeasurer({parts,mesh:new Float32Array(values),edges:{edges:[]},sourceWelds:[]});
}

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
  ['to-side',[[2,3,-2],[6,3,-2],[4,5,-2]]],
  ['before',[[-3,-2,-2],[-3,2,-2],[-3,0,2]]],
  ...extra
 ];
 const parts=triangles.map(([id,points],index)=>({id,vertexOffset:index*3,vertexCount:3,solidCount:1,
  bbox:{min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))}
 }));
 const mesh=new Float32Array(triangles.flatMap(([,points])=>points.flatMap(p=>[...p,0,0,1])));
 const edges={edges:[{partId:'main',faceIndex:0,boundaryId:'edge',wire:'outer',points:[[0,3,0],[10,3,0]]}]};
 const sourceWelds=[{id:'cad-weld',mainPartId:'main',mainFaceIndex:0,subPartId:'sub',subFaceIndex:0,segments:[{index:1}],properties:{}}];
 return {parts,mesh,edges,sourceWelds};
}

test('范围同时约束段边缘、下方实体及端点间隙，未命中为不限',()=>{
 const measure=createTemplateNeighborhoodMeasurer(source());
 const target=weld();
 const wide=measure(target,range);
 assert.equal(wide.segments[0].edge.distance,3);
 assert.equal(wide.segments[0].gap.distance,6);
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
 assert.deepEqual(saved.solidGap.intervals.map(interval=>interval.distance),[{min:6,max:6}]);
 assert.deepEqual(geometryRuleMismatches(rules,target,wide),[]);
 assert.equal(geometryRuleMismatches(rules,target,none).length,3);
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

test('每段沿各自底板方向测实体间隙，分别计算最近点与连续区间',()=>{
 const target=weld([segment([[0,0,0],[10,0,0]]),segment([[10,0,0],[10,10,0]])]);
 const geometry=source([['second-solid',[[9,1,-2],[11,1,-2],[10,9,-4]]]]);
 const measure=createTemplateNeighborhoodMeasurer(geometry);
 const evidence=measure(target,range);
 const [first,second]=evidence.segments.map(segment=>segment.solidGap);
 assert.equal(first.nearest.distance,6);
 assert.equal(second.nearest.distance,2);
 const interval=measureDistanceInterval(second,2,8);
 assert(Math.abs(interval.min-2.25)<1e-6&&Math.abs(interval.max-3.75)<1e-6);
 const rules=geometryRulesFromWeld(target,range,evidence);
 rules.segmentDistances[1].solidGap={mode:'nearest',nearest:{min:3,max:4}};
 assert.deepEqual(geometryRuleMismatches(rules,target,evidence),['第 2 段间隙（模板 3–4 mm / 焊道 2 mm）']);
 rules.segmentDistances[1].gapEnabled=false;
 assert.deepEqual(geometryRuleMismatches(rules,target,evidence),[]);

 const rotate=([x,y,z])=>[x,-z,y];
 const offset=geometry.parts.find(part=>part.id==='below').vertexOffset*6;
 const mesh=new Float32Array(geometry.mesh);
 for(let i=offset;i<offset+18;i+=6)mesh.set(rotate(Array.from(mesh.slice(i,i+3))),i);
 const part=geometry.parts.find(part=>part.id==='below');
 const parts=[{...part,bbox:{min:[part.bbox.min[0],-part.bbox.max[2],part.bbox.min[1]],max:[part.bbox.max[0],-part.bbox.min[2],part.bbox.max[1]]}}];
 const sourceWelds=geometry.sourceWelds.map(weld=>({...weld,properties:{焊缝段:[{主板面:{类型:'平面',法向:[0,-1,0]}}]}}));
 const rotated=createTemplateNeighborhoodMeasurer({...geometry,mesh,parts,sourceWelds});
 assert.equal(rotated(weld(),{...range,across:7}).segments[0].solidGap.nearest.distance,6);
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
 assert.equal(matchTemplate(template,target,{measureTemplateNeighborhood:(w,requested)=>measure(w,{...requested,below:2})}).ok,false);
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
