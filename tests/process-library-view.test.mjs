import test from 'node:test';import assert from 'node:assert/strict';import {PROCESS_CATEGORIES,queryProcesses,processCategory,processType} from '../src/processLibraryView.mjs';
const entries=[{id:'1',name:'8mm角焊',joint:'T 形接头',leg:8,position:'PB · 横角焊'},{id:'2',name:'9mm内角',joint:'角接头',leg:9,position:'PF · 立向上焊',processType:'inner'},{id:'3',name:'对接',joint:'对接接头',leg:8,position:'PB · 横角焊'},{id:'4',name:'搭接',joint:'搭接接头'},{id:'5',name:'端接',joint:'端接接头'}];const filters={name:'',type:'',position:'',leg:''};
test('工艺参数库仅提供角焊缝和搭接焊缝分类，历史接头归入其他接头',()=>{assert.deepEqual(PROCESS_CATEGORIES.map(c=>c.id),['fillet','lap']);assert.deepEqual(entries.map(processCategory),['fillet','fillet','other','lap','other']);assert.equal(processType(entries[0]),'常规');assert.equal(processType(entries[1]),'内角');});
test('名称类型位置焊脚组合筛选不污染原记录',()=>{const before=structuredClone(entries);assert.deepEqual(queryProcesses(entries,'fillet',{...filters,name:'9MM',type:'inner',leg:'9',position:'PF · 立向上焊'}).map(v=>v.id),['2']);assert.deepEqual(entries,before);assert.equal(queryProcesses(entries,'fillet',{...filters,type:'outer'}).length,0);});
test('旧记录参与常规类型查询且跨接头不混入',()=>{assert.deepEqual(queryProcesses(entries,'fillet',{...filters,type:'standard'}).map(v=>v.id),['1']);assert.deepEqual(queryProcesses(entries,'other',filters).map(v=>v.id),['3','5']);});
test('数值排序和名称排序均可反向且不改变库顺序',()=>{assert.deepEqual(queryProcesses(entries,'fillet',filters,{key:'leg',direction:'desc'}).map(v=>v.id),['2','1']);assert.deepEqual(queryProcesses(entries,'fillet',filters,{key:'name',direction:'asc'}).map(v=>v.id),['1','2']);assert.equal(entries[0].id,'1');});

test('坡口和焊道类型与现有筛选组合，兼容旧V形名称和单道记录，筛选不改写数据',()=>{
 const rows=[{...entries[0],id:'v1',groove:{type:'V形'}},{...entries[0],id:'v2',groove:{type:'V 形'},processLayers:[{passes:[{},{}]}]},{...entries[0],id:'bell',groove:{type:'喇叭形'},processLayers:[{passes:[{}]},{passes:[{}]}]},{...entries[0],id:'none',groove:{type:'无坡口'}}];
 const snapshot=structuredClone(rows);
 assert.deepEqual(queryProcesses(rows,'fillet',{groove:'V 形',weldType:'single',leg:'8'}).map(p=>p.id),['v1']);
 assert.deepEqual(queryProcesses(rows,'fillet',{groove:'V形',weldType:'multi'}).map(p=>p.id),['v2']);
 assert.deepEqual(queryProcesses(rows,'fillet',{weldType:'multi'}).map(p=>p.id),['v2','bell']);
 assert.deepEqual(queryProcesses(rows,'fillet',{groove:'无坡口'}).map(p=>p.id),['none']);
 assert.equal(queryProcesses(rows,'fillet',{groove:'喇叭形',weldType:'single'}).length,0);
 assert.deepEqual(queryProcesses(rows,'fillet',{}),rows);assert.deepEqual(rows,snapshot);
});
