import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeIncludedAngleRange,planningSettingsErrors,geometryOptionsForPlanning} from '../src/planningConfiguration.mjs';
import {DEFAULT_GEOMETRY_OPTIONS,convertGeometryPlan,mergeFeatureWithinSize} from '../src/geometryProcessingModel.mjs';
import {intermittentRanges,applyPlanningPathSettings} from '../src/planningPathSettings.mjs';
import {mergeWeldPreview} from '../src/manualMergeModel.mjs';
const segment=(start,end)=>({geometry:'直线',pathPoints:[start,end],length:Math.hypot(...end.map((v,i)=>v-start[i])),position:'PB · 横角焊',joint:'T 形接头'});
const weld={id:'W001',name:'测试',processingKey:'test',source:'extracted',model:'111.step',enabled:true,closure:'open',leg:6,segments:[segment([0,0,0],[100,0,0]),segment([100,0,0],[100,200,0])],length:300,sourceEvidence:{unitKeys:['source']}};
test('旧转角换算为内夹角，明确新内夹角原值传给提取规则，数量禁用不再限组',()=>{
 assert.deepEqual(mergeIncludedAngleRange({angleMin:30,angleMax:75}),{angleMin:105,angleMax:150});
 assert.deepEqual(mergeIncludedAngleRange({angle:45}),{angleMin:135,angleMax:180});
 const mergeParameters={angleDefinition:'included',angleMin:100,angleMax:160,count:2,countEnabled:false,enabled:false,continuousOnly:true};
 assert.deepEqual(mergeIncludedAngleRange(mergeParameters),{angleMin:100,angleMax:160});
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters});
 assert.equal(options.mergeParams.夹角阈值下限,100);assert.equal(options.mergeParams.夹角阈值上限,160);assert.equal(options.maxMergeCount,undefined);assert.equal(options.automaticMerge,false);assert.equal(options.continuousOnly,true);
});
test('四类设置校验拒绝无效长度，禁用分段和间断焊允许留空',()=>{
 assert.deepEqual(planningSettingsErrors({splitParameters:{enabled:false,length:null},intermittentParameters:{enabled:false}}),[]);
 for(const settings of [{wrapParameters:{independentLength:-1}},{splitParameters:{enabled:true,length:0}},{intermittentParameters:{enabled:true,layout:'chain',mode:'uniform',weldLength:50,gapLength:0}},{mergeParameters:{countEnabled:true,count:null}}])assert.ok(planningSettingsErrors(settings).length);
 const settings={wrapParameters:{enabled:true,lDistanceRatio:'1/2',uPose:{advance:10,work:-20,rotation:30},independentLength:100},splitParameters:{enabled:true,length:80},intermittentParameters:{enabled:true,layout:'chain',mode:'endWeld',weldLength:50,gapLength:50}};
 assert.deepEqual(planningSettingsErrors(settings),[]);const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,JSON.parse(JSON.stringify(settings)));assert.equal(options.wrapDistanceRatio,.5);assert.deepEqual(options.splitParameters,settings.splitParameters);assert.deepEqual(options.intermittentParameters,{...settings.intermittentParameters,position:'PB'});
});
test('禁用自动合并保留每条源焊缝，连续性检查禁止延长线跨空白合并',()=>{
 const members=[{key:'a',id:'a',weldId:'a',points:[[0,0,0],[100,0,0]],length:100,weldingPosition:'PB',焊脚:6},{key:'b',id:'b',weldId:'b',points:[[105,0,0],[200,0,0]],length:95,weldingPosition:'PB',焊脚:6}],data={weldsData:{welds:members.map(m=>({id:m.id,properties:{坡口:{类型:'无坡口'}}}))}},plan={merges:{groups:[{id:'group',members,totalLength:195,connections:[]}],units:members,mergedUnitKeys:new Set(['a','b'])},splits:new Map()};
 for(const options of [{automaticMerge:false},{continuousOnly:true}]){const result=convertGeometryPlan(data,plan,options);assert.equal(result.length,2);assert.equal(result.reduce((sum,w)=>sum+w.length,0),195);}
 const other={...weld,id:'W002',segments:[segment([105,200,0],[200,200,0])],length:95};assert.match(mergeWeldPreview([weld,other],['W001','W002']).errors.join(),/不允许非连续焊缝合并/);
});
test('按真实折线路径分段，长度守恒且来源不变，禁用保持原数组',()=>{
 const original=structuredClone(weld),result=applyPlanningPathSettings([weld],{splitParameters:{enabled:true,length:80}});
 assert.deepEqual(result.map(w=>w.length),[80,80,80,60]);assert.equal(result.reduce((n,w)=>n+w.length,0),300);assert.deepEqual(result[1].segments[0].pathPoints[0],[80,0,0]);assert.deepEqual(result.at(-1).segments.at(-1).pathPoints.at(-1),[100,200,0]);assert.deepEqual(weld,original);
 const input=[weld];assert.equal(applyPlanningPathSettings(input),input);assert.equal(new Set(result.map(w=>w.processingKey)).size,4);
});
test('间断焊均分固定焊长和间隔，两段模式保留首尾，中部均分',()=>{
 const uniform=intermittentRanges(320,{mode:'uniform',weldLength:50,gapLength:50});assert.deepEqual(uniform,[[35,85],[135,185],[235,285]]);
 const end=intermittentRanges(320,{mode:'endWeld',weldLength:50,gapLength:50});assert.deepEqual(end,[[0,50],[135,185],[270,320]]);
 const result=applyPlanningPathSettings([weld],{intermittentParameters:{enabled:true,layout:'chain',mode:'endWeld',weldLength:50,gapLength:50}});assert.deepEqual(result.map(w=>w.length),[50,50,50]);assert.equal(result[0].sourceEvidence.pathSettings.start,0);assert.equal(result.at(-1).sourceEvidence.pathSettings.end,300);
 assert.throws(()=>intermittentRanges(300,{mode:'uniform',weldLength:0,gapLength:50}));assert.throws(()=>applyPlanningPathSettings([weld],{splitParameters:{enabled:true,length:.1}}),/超过500/);
});
test('间断焊仅处理平角焊，其他及混合位置保留连续路径并仍可独立分段',()=>{
 const intermittentParameters={enabled:true,position:'PB',layout:'chain',mode:'endWeld',weldLength:50,gapLength:50};
 const vertical={...structuredClone(weld),id:'W002',processingKey:'vertical',segments:weld.segments.map(s=>({...s,position:'PF · 立向上焊'}))};
 const mixed={...structuredClone(weld),id:'W003',processingKey:'mixed',segments:[weld.segments[0],vertical.segments[1]]};
 const unknown={...structuredClone(weld),id:'W004',processingKey:'unknown',segments:weld.segments.map(s=>({...s,position:'待确认'}))};
 const result=applyPlanningPathSettings([weld,vertical,mixed,unknown],{intermittentParameters});
 assert.equal(result.filter(w=>w.sourceEvidence.pathSettings?.intermittentApplied).length,3);
 for(const source of [vertical,mixed,unknown]){const kept=result.find(w=>w.processingKey===source.processingKey);assert.deepEqual(kept.segments,source.segments);assert.equal(kept.length,300);}
 const split=applyPlanningPathSettings([vertical],{intermittentParameters,splitParameters:{enabled:true,length:80}});
 assert.deepEqual(split.map(w=>w.length),[80,80,80,60]);assert.ok(split.every(w=>!w.sourceEvidence.pathSettings.intermittentApplied));
 assert.ok(planningSettingsErrors({intermittentParameters:{...intermittentParameters,position:'PF'}}).some(e=>e.includes('仅支持平角焊')));
});
test('过焊孔最大尺寸与间隙阈值独立保存和传入，留空保持原规则',()=>{
 const saved=JSON.parse(JSON.stringify({mergeParameters:{passHoleSize:30},splitParameters:{enabled:false,length:null,gapThreshold:80}}));
 assert.deepEqual(planningSettingsErrors(saved),[]);
 const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,saved);
 assert.equal(options.mergePassHoleSize,30);assert.equal(options.mergeParams.最长通过距离,30);assert.equal(options.mergeParams.最小通过高度,30);
 assert.equal(options.offsetThreshold,80);assert.equal(options.offset,80);assert.equal(options.extendThreshold,DEFAULT_GEOMETRY_OPTIONS.extendThreshold);
 assert.deepEqual(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,{mergeParameters:{passHoleSize:null},splitParameters:{gapThreshold:null}}),{...DEFAULT_GEOMETRY_OPTIONS,splitParameters:{gapThreshold:null}});
 for(const value of [-1,Infinity,NaN,'bad']){assert.ok(planningSettingsErrors({mergeParameters:{passHoleSize:value}}).length);assert.ok(planningSettingsErrors({splitParameters:{gapThreshold:value}}).length);}
 assert.deepEqual(planningSettingsErrors({mergeParameters:{passHoleSize:0},splitParameters:{gapThreshold:0}}),[]);
});
test('过焊孔尺寸边界包含，过大或未确认的孔阻止自动合并且保留源路径',()=>{
 const hole={特征类型:'圆',圆类型:'凹圆弧',L1:30,L2:12};
 assert.equal(mergeFeatureWithinSize(hole,30),true);assert.equal(mergeFeatureWithinSize({...hole,L1:30.01},30),false);assert.equal(mergeFeatureWithinSize({...hole,尺寸待确认:true},30),false);assert.equal(mergeFeatureWithinSize({...hole,L2:null},30),false);
 const members=[{key:'a',id:'a',weldId:'a',points:[[0,0,0],[100,0,0]],length:100,weldingPosition:'PB',焊脚:6,endFeatureProp:hole},{key:'b',id:'b',weldId:'b',points:[[100,0,0],[200,0,0]],length:100,weldingPosition:'PB',焊脚:6}],data={weldsData:{welds:members.map(m=>({id:m.id,properties:{坡口:{类型:'无坡口'}}}))}},plan={merges:{groups:[{id:'group',members,totalLength:200,connections:[]}],units:members,mergedUnitKeys:new Set(['a','b'])},splits:new Map()};
 assert.equal(convertGeometryPlan(data,plan,{mergePassHoleSize:30}).length,1);
 const rejected=convertGeometryPlan(data,plan,{mergePassHoleSize:29.99});assert.equal(rejected.length,2);assert.equal(rejected.reduce((n,w)=>n+w.length,0),200);assert.match(rejected[0].sourceEvidence.rejectedMergeReason,/过焊孔尺寸/);assert.equal(members[0].endFeatureProp.L1,30);
});
