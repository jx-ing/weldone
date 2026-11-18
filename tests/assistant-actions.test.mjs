import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_ACTION_DEFINITIONS, assistantToolDefinitions, validateAssistantAction,
  describeAssistantAction, assistantActionDefinition,
} from '../src/assistantActions.mjs';

test('工具清单包含全部可执行操作', () => {
  const tools = assistantToolDefinitions();
  assert.equal(tools.length, ASSISTANT_ACTION_DEFINITIONS.length);
  for (const name of ['select_weld', 'set_welds_enabled', 'update_weld', 'delete_welds', 'merge_welds',
    'apply_template', 'apply_process', 'create_template', 'run_planning', 'export_task']) {
    assert.ok(tools.some(tool => tool.function.name === name), name);
  }
  assert.ok(tools.every(tool => tool.type === 'function' && tool.function.parameters.type === 'object'));
});

test('校验焊缝编号与批量启停', () => {
  assert.deepEqual(validateAssistantAction('select_weld', {weldId: 'W10004'}), {name: 'select_weld', arguments: {weldId: 'W10004'}});
  assert.equal(validateAssistantAction('select_weld', {weldId: '10004'}), null);
  assert.deepEqual(
    validateAssistantAction('set_welds_enabled', {weldIds: ['W10004', 'W10005'], enabled: false}),
    {name: 'set_welds_enabled', arguments: {weldIds: ['W10004', 'W10005'], enabled: false}},
  );
  assert.equal(validateAssistantAction('set_welds_enabled', {weldIds: [], enabled: true}), null);
  assert.equal(validateAssistantAction('set_welds_enabled', {weldIds: ['W1', 'W1'], enabled: true}), null);
  assert.equal(validateAssistantAction('set_welds_enabled', {weldIds: ['W10004'], enabled: 'yes'}), null);
});

test('修改焊缝接受原始参数与已归一化参数', () => {
  const raw = validateAssistantAction('update_weld', {weldId: 'W10004', name: '立板焊缝', leg: 6});
  assert.deepEqual(raw, {name: 'update_weld', arguments: {weldId: 'W10004', fields: {name: '立板焊缝', leg: 6}}});
  const normalized = validateAssistantAction('update_weld', raw.arguments);
  assert.deepEqual(normalized, raw);
  assert.equal(validateAssistantAction('update_weld', {weldId: 'W10004'}), null);
  assert.equal(validateAssistantAction('update_weld', {weldId: 'W10004', leg: -1}), null);
  assert.equal(validateAssistantAction('update_weld', {weldId: 'W10004', grooveType: 'X 形'}), null);
});

test('坡口类型接受 V形 别名并归一化', () => {
  const action = validateAssistantAction('update_weld', {weldId: 'W10004', grooveType: 'V形', grooveAngle: 45, grooveDepth: 3});
  assert.equal(action.arguments.fields.groove.type, 'V 形');
  assert.equal(action.arguments.fields.groove.angle, 45);
  assert.equal(action.arguments.fields.groove.depth, 3);
});

test('模板与工艺需要完整名称', () => {
  assert.deepEqual(
    validateAssistantAction('apply_template', {weldId: 'W10004', templateName: '角焊缝模板'}),
    {name: 'apply_template', arguments: {weldId: 'W10004', templateName: '角焊缝模板'}},
  );
  assert.equal(validateAssistantAction('apply_template', {weldId: 'W10004'}), null);
  assert.equal(validateAssistantAction('apply_process', {weldId: 'W10004', processName: ''}), null);
});

test('无参数操作与未知操作', () => {
  assert.deepEqual(validateAssistantAction('run_planning', {}), {name: 'run_planning', arguments: {}});
  assert.deepEqual(validateAssistantAction('export_task', '{}'), {name: 'export_task', arguments: {}});
  assert.equal(validateAssistantAction('drop_database', {}), null);
  assert.equal(validateAssistantAction('update_weld', 'not json'), null);
});

test('操作描述与风险标记', () => {
  assert.equal(
    describeAssistantAction({name: 'set_welds_enabled', arguments: {weldIds: ['W10004'], enabled: false}}, {W10004: '机械臂1'}),
    '屏蔽 W10004（机械臂1）',
  );
  assert.match(describeAssistantAction({name: 'update_weld', arguments: {weldId: 'W10004', fields: {leg: 6, name: '立板'}}}), /焊脚改为 6 mm/);
  assert.equal(assistantActionDefinition('delete_welds').danger, true);
  assert.equal(assistantActionDefinition('select_weld').danger, false);
});
