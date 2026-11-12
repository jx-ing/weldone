import test from 'node:test';
import assert from 'node:assert/strict';
import {weldRegionBounds,newPlanningTemplate,validTemplateCover} from '../src/templateCoverModel.mjs';
import {migrateTemplate} from '../src/templateModel.mjs';
import {hasTemplateModelPath} from '../src/templateModelEditing.mjs';
const weld=(id='W001',offset=0)=>({id,name:'测试焊缝',enabled:true,completeStart:true,completeEnd:true,closure:'open',leg:6,segments:[{position:'PB · 横角焊',joint:'T 形接头',geometry:'直线',length:100,pathPoints:[[offset,0,0],[offset+100,0,0]]}],cornerAngles:[],groove:{type:'无坡口',angle:0,depth:0},startHole:false,endHole:false});
const cover=()=>({kind:'weld-model-region',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAEACAYAAAB0',width:640,height:400,model:'111.step',weldId:'W001',bounds:{min:[-50,-50,-50],max:[150,50,50]},parts:[0,1]});
test('焊缝域使用真实路径和模型坐标，区域随选中焊缝移动',()=>{
 const a=weldRegionBounds(weld(),[10,20,30],1000),b=weldRegionBounds(weld('W002',1000),[10,20,30],1000);
 assert.ok(a.cad.min[0]<0&&a.cad.max[0]>100);assert.ok(b.cad.min[0]>a.cad.max[0]);
 assert.equal(a.world.min[0],a.cad.min[0]-10);assert.equal(a.world.min[1],a.cad.min[2]-30);assert.equal(a.world.min[2],20-a.cad.max[1]);
 assert.throws(()=>weldRegionBounds({...weld(),segments:[{pathPoints:[]}]}),/路径/);
});
test('新建模板必须绑定当前选择的焊缝及模型截图，拒绝错源或非截图封面',()=>{
 const w=weld();assert.equal(validTemplateCover(cover(),{model:'111.step',id:w.id}),true);
 for(const invalid of [null,{...cover(),weldId:'W999'},{...cover(),model:'other'},{...cover(),parts:[]},{...cover(),dataUrl:'https://example.com/image.png'}])assert.throws(()=>newPlanningTemplate('111.step',[w],w.id,invalid),/截取/);
 assert.throws(()=>newPlanningTemplate('111.step',[w],'W999',cover()),/提取焊道或选择已有焊道/);
});
test('封面独立保存并可随模板JSON往返，修改原截图不影响已建模板',()=>{
 const image=cover(),value=newPlanningTemplate('111.step',[weld()],'W001',image);value.name='来源模板';image.parts.push(9);assert.deepEqual(value.cover.parts,[0,1]);
 const restored=migrateTemplate(JSON.parse(JSON.stringify(value)));assert.deepEqual(restored.cover,value.cover);assert.equal(restored.createdFrom,'process-planning');assert.equal(restored.sourceWeld.id,'W001');
});
test('新建模板保存导入 STEP 的来源指纹，恢复后仍可打开局部三维模型',()=>{
 const model='T形接头.step',source=weld(),stepModel={sourceSha256:'a'.repeat(64)};
 const value=newPlanningTemplate(model,[source],source.id,{...cover(),model},undefined,undefined,stepModel);
 value.name='外部模型模板';
 stepModel.sourceSha256='b'.repeat(64);
 const restored=migrateTemplate(JSON.parse(JSON.stringify(value)));
 assert.deepEqual(restored.sourceWeld.stepModel,{sourceSha256:'a'.repeat(64)});
 assert.equal(hasTemplateModelPath(restored),true);
 assert.equal(validTemplateCover(restored.cover,restored.sourceWeld),true);
 assert.equal(hasTemplateModelPath({...restored,sourceWeld:{...restored.sourceWeld,stepModel:undefined}}),false);
});
