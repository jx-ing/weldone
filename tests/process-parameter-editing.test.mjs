import test from 'node:test';
import assert from 'node:assert/strict';
import {editOptionalProcessValues} from '../src/processParameterEditing.mjs';
import {newProcessFeaturePoint} from '../src/processFeaturePoints.mjs';

test('移除启用列后填写点位即参与应用，清空参数后恢复未使用',()=>{
 const original=newProcessFeaturePoint();
 const configured=editOptionalProcessValues(original,{job:0},'job');
 assert.equal(configured.enabled,true);
 assert.equal(original.enabled,false);
 assert.equal(editOptionalProcessValues(configured,{job:null},'job').enabled,false);
 const dormant={...original,job:8,voltage:24};
 assert.equal(editOptionalProcessValues(dormant,{time:0},'synergic').enabled,false);
 assert.equal(editOptionalProcessValues(original,{current:0},'separate').enabled,true);
 assert.equal(editOptionalProcessValues(original,{weave:{enabled:true,pattern:'triangle'}},'job').enabled,true);
});
