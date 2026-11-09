import test from 'node:test';
import assert from 'node:assert/strict';
import {templateProjectName,templateProjectGroups,createTemplateProject,selectTemplateProject,renameTemplateProject,deleteTemplateProject} from '../src/templateProjects.mjs';
import {newTemplate,migrateTemplate,matchTemplate} from '../src/templateModel.mjs';

test('项目分组兼容旧模板，排除历史局部模板，查看时不改写原数据',()=>{
 const records=[{type:'whole',name:'旧模板'},{type:'whole',project:'项目B'},{type:'whole',project:'项目B'},{type:'local',project:'历史项目'}];
 const snapshot=structuredClone(records);
 assert.deepEqual(templateProjectGroups(records,'项目A'),[{name:'项目A',count:1},{name:'项目B',count:2}]);
 assert.deepEqual(records,snapshot);
 assert.equal(templateProjectName({},' '),'本地项目');
 assert.deepEqual(templateProjectGroups([], '项目A'),[{name:'项目A',count:0}]);
});

test('项目归属随模板JSON与迁移保留，匹配结果与项目无关',()=>{
 const original={...newTemplate('whole'),name:'项目匹配验证'};
 const tagged={...original,project:'项目B'};
 const restored=migrateTemplate(JSON.parse(JSON.stringify(tagged)));
 assert.equal(restored.project,'项目B');
 const target={...original,id:'W001',enabled:true,completeStart:true,completeEnd:true,cornerAngles:original.corners.map(c=>c.standard)};
 assert.equal(matchTemplate(original,target).ok,true);
 assert.deepEqual(matchTemplate(tagged,target),matchTemplate(original,target));
});

test('空项目可持久化，重命名移动旧模板归属而不改变几何，重名被拒绝',()=>{
 const templates=[{id:'a',type:'whole',segments:[{length:50}]},{id:'b',type:'whole',project:'B'}],saved=JSON.stringify(templates);
 assert.deepEqual(createTemplateProject(templates,'A',undefined,'C').templateProjects,['A','B','C']);
 assert.throws(()=>createTemplateProject(templates,'A',undefined,' B '),/已存在/);
 const renamed=renameTemplateProject(templates,'A',['A','B','C'],'A','新项目');
 assert.deepEqual(renamed.templateProjects,['新项目','B','C']);assert.equal(renamed.project,'新项目');
 assert.equal(renamed.templates[0].project,'新项目');assert.strictEqual(renamed.templates[0].segments,templates[0].segments);
 assert.equal(JSON.stringify(templates),saved);
 assert.deepEqual(templateProjectGroups([], 'A', []),[]);
});
test('非空项目未经确认无法删除，确认清空仅删除该项目焊缝模板，最后一个项目可删除',()=>{
 const templates=[{id:'a',type:'whole'},{id:'b',type:'whole',project:'B'},{id:'c',type:'local',project:'A'}];
 assert.throws(()=>deleteTemplateProject(templates,'A',['A','B'],'A'),/确认/);
 const deleted=deleteTemplateProject(templates,'A',['A','B'],'A',true);
 assert.deepEqual(deleted.templates.map(t=>t.id),['b','c']);assert.deepEqual(deleted.templateProjects,['B']);
 assert.equal(templates.length,3);
 assert.deepEqual(deleteTemplateProject([],'A',['A'],'A').templateProjects,[]);
});

test('切换和新建项目先固定旧模板归属，规划创建的新模板使用当前项目',()=>{
 const templates=[{id:'old',type:'whole'},{id:'b',type:'whole',project:'B'}];
 const values=selectTemplateProject(templates,'A',['A','B'],'B');assert.equal(values.project,'B');assert.equal(values.templates[0].project,'A');
 assert.equal(templateProjectGroups(values.templates,values.project,values.templateProjects).find(p=>p.name==='A').count,1);
 const created=createTemplateProject(templates,'A',['A','B'],'C');assert.equal(created.project,'C');assert.equal(created.templates[0].project,'A');
 assert.equal(templates[0].project,undefined);
});
