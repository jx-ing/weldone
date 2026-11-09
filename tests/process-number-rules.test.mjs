import test from 'node:test';
import assert from 'node:assert/strict';
import {processNumberAttributes,processNumberError} from '../src/processNumberRules.mjs';

test('电流电压修正与JOB只允许正整数',()=>{
 for(const key of ['current','voltage','correction','job'])assert.deepEqual(processNumberAttributes(key),{min:1,step:1,'data-process-number-kind':'integer'});
 for(const value of ['0','-1','1.2','NaN','Infinity'])assert.notEqual(processNumberError(value,'integer'),'');
 for(const value of ['1','220','999'])assert.equal(processNumberError(value,'integer'),'');
});
test('动作时间必须为正数且最多两位小数，空白可选行不参与校验',()=>{
 assert.deepEqual(processNumberAttributes('time'),{min:.01,step:.01,'data-process-number-kind':'time'});
 for(const value of ['0','-0.01','0.001','1.234'])assert.notEqual(processNumberError(value,'time'),'');
 for(const value of ['0.01','0.29','1','1.2','1.23'])assert.equal(processNumberError(value,'time'),'');
 assert.equal(processNumberError('','integer',false),'');
 assert.notEqual(processNumberError('','integer',true),'');
});
test('全部摆弧数值必须大于零且最多一位小数',()=>{
 assert.deepEqual(processNumberAttributes('weave'),{min:.1,step:.1,'data-process-number-kind':'weave'});
 for(const value of ['0','-1','0.01','1.23'])assert.notEqual(processNumberError(value,'weave'),'');
 for(const value of ['0.1','1','2.5'])assert.equal(processNumberError(value,'weave'),'');
 assert.notEqual(processNumberError('','weave',true),'');
});
