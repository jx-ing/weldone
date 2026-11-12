import test from 'node:test';
import assert from 'node:assert/strict';
import {createManualWeld} from '../src/manualWeldModel.mjs';
import {newWholeTemplateFromWeld,newTemplate,point,validateTemplate,migrateDraft} from '../src/templateModel.mjs';
import {addPass} from '../src/templateLayers.mjs';
import {analyzeWeldMatch,localTemplateWindows} from '../src/weldMatching.mjs';
import {weldPlanningPointGroups,weldPointTreeGroups,includeWeldControlPoints} from '../src/weldPlanningPoints.mjs';
const settings={name:'点位焊道',leg:6,joint:'T 形接头',position:'PB · 横角焊',groove:{type:'无坡口',angle:0,depth:0}};
function weld(){return createManualWeld([],[{points:[[0,0,0],[100,0,0]]},{points:[[100,0,0],[100,100,0]]}],settings);}
test('未匹配时按焊接方向显示完整起终点和段连接点，反向时正确交换坐标',()=>{
 const w=weld(),before=structuredClone(w),groups=weldPlanningPointGroups(w);assert.equal(groups.length,1);assert.deepEqual(groups[0].points.map(p=>p.name),['起点','段连接点1','终点']);assert.deepEqual(groups[0].points.map(p=>p.position),[[0,0,0],[100,0,0],[100,100,0]]);
 const reverse=weldPlanningPointGroups({...w,direction:'反向'})[0].points;assert.deepEqual(reverse.map(p=>p.position),[[100,100,0],[100,0,0],[0,0,0]]);assert.deepEqual(w,before);
});
test('匹配后无需应用即显示全部层道的模板点、人工点及各道偏移，且不写入焊道',()=>{
 const w=weld();let t={...newWholeTemplateFromWeld('111.step',[w],w.id),name:'点位模板'};
 const manual={...point('control',1,0,'人工点'),referenceId:t.points.find(p=>p.kind==='junction').id,offset:{x:15,y:3,z:4}};t.points.push(manual);t.layers[0].passes[0].points=t.points;t=addPass(t,t.layers[0].id);t.layers[0].passes[1].offset={y:7,z:2};
 const before=structuredClone(w),decision=analyzeWeldMatch(w,[t]),groups=weldPlanningPointGroups(w,decision);assert.equal(decision.route,'whole');assert.equal(groups.length,3);assert.deepEqual(groups.map(g=>g.points.length),[3,4,4]);assert.equal(new Set(groups.flatMap(g=>g.points.map(p=>p.id))).size,11);
 assert.deepEqual(groups[1].points.find(p=>p.name==='人工点').position,[97,15,4]);assert.deepEqual(groups[2].points.find(p=>p.name==='人工点').position,[90,15,6]);assert.deepEqual(w,before);assert.equal(w.templateSnapshot,undefined);
});
test('失配或停用模板不会显示旧快照的点，闭合起终点坐标重合但仍分别显示',()=>{
 const w=weld(),t={...newWholeTemplateFromWeld('111.step',[w],w.id),name:'旧模板'},old={...w,templateSnapshot:t,controlPoints:[{name:'过期点'}]};
 assert.equal(weldPlanningPointGroups({...old,leg:9},undefined,[t]).length,1);assert.equal(weldPlanningPointGroups(old,undefined,[{...t,enabled:false}]).length,1);
 const closed=createManualWeld([],[{points:[[0,0,0],[100,0,0]]},{points:[[100,0,0],[100,100,0]]},{points:[[100,100,0],[0,0,0]]}],settings),points=weldPlanningPointGroups(closed)[0].points;assert.equal(points.length,4);assert.deepEqual(points[0].position,points.at(-1).position);assert.notEqual(points[0].id,points.at(-1).id);
});
test('局部模板各窗口点使用实际目标模型坐标和原段序号',()=>{
 const w=weld(),t={...newTemplate('local'),name:'局部点'},windows=localTemplateWindows(t,w);assert.equal(windows.length,1);
 const groups=weldPlanningPointGroups(w,{locals:windows});assert.equal(groups.length,2);assert.equal(groups[1].points.length,3);assert.deepEqual(groups[1].points.map(p=>p.position),[[90,0,0],[100,0,0],[100,10,0]]);assert.ok(groups[1].points.every(p=>Number.isInteger(p.segment)&&p.segment>=1&&p.segment<=2));
});

test('点位覆盖跟随原始几何并随草稿持久化，重规划到不同位置时不套用旧覆盖',()=>{
 const point={kind:'start',name:'起弧',distance:0,position:[0,0,0],pose:{work:0},orientation:[0,0,0,1]};
 const w={...weld(),planned:true,strategyPlan:{passes:[{layerIndex:0,passIndex:0,points:[point]}]}};
 const {overrideKey}=weldPlanningPointGroups(w)[1].points[0];
 w.planningPointOverrides={[overrideKey]:{x:12,work:30}};
 const saved=JSON.parse(JSON.stringify(w)),adjusted=weldPlanningPointGroups(saved)[1].points[0];
 assert.deepEqual(adjusted.position,[12,0,0]);
 assert.equal(adjusted.pose.work,30);
 assert.notDeepEqual(adjusted.orientation,point.orientation);
 saved.strategyPlan.passes[0].points[0].position=[1,0,0];
 assert.deepEqual(weldPlanningPointGroups(saved)[1].points[0].position,[1,0,0]);
});

test('结构树只显示焊缝、模板和人工点，选中层道可读取实际偏移',()=>{
 const w={...weld(),planned:true,strategyPlan:{passes:[{layerIndex:0,passIndex:0,points:[{name:'策略起弧'}]}]}};
 const t={...newWholeTemplateFromWeld('111.step',[w],w.id),name:'层道模板'};
 t.layers[0].height=3;t.layers[0].passes[0].offset={y:2,z:1};
 const anchors=weldPointTreeGroups(w,{route:'automatic'})[0].points;
 const decision=analyzeWeldMatch(w,[t]);
 const pass=weldPointTreeGroups(w,decision)[1];
 assert.equal(pass.layerHeight,3);assert.equal(pass.passOffset.y,2);
 w.manualControlPoints=[{...point('control',1,0,'焊缝新增点'),referenceId:anchors[0].id,groupId:pass.id,offset:{x:10,y:4,z:5},overrides:{current:220}}];
 const groups=weldPointTreeGroups(JSON.parse(JSON.stringify(w)),decision);
 assert.equal(groups.flatMap(group=>group.points).some(item=>item.source==='strategy'),false);
 const manual=groups[1].points.find(item=>item.source==='manual');
 assert.deepEqual(manual.position,[10,6,9]);
 const template=includeWeldControlPoints(t,w,groups);
 assert.deepEqual(validateTemplate(template),[]);
 assert.equal(template.layers[0].passes[0].points.find(item=>item.name==='焊缝新增点').overrides.current,220);
 assert.equal(weldPointTreeGroups(w,{whole:template}).flatMap(group=>group.points).filter(item=>item.name==='焊缝新增点').length,1);
});

test('导入旧草稿将过焊孔和打断从端点类型迁出，保留原始几何事实',()=>{
 const w={...weld(),endpointFacts:{start:{type:'三面交过焊孔',holeSize:16},end:{type:'边缘打断'}}};
 const saved=migrateDraft({model:w.model,welds:[w],templates:[]}).welds[0];
 assert.deepEqual(saved.endpointFacts.start,{type:'三面交',junctionType:'三面交',holeSize:16,hasHole:true});
 assert.deepEqual(saved.endpointFacts.end,{type:null,breakReason:'边缘打断'});
});
