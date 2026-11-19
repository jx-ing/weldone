import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_ACTION_DEFINITIONS, ASSISTANT_TASK_LIMIT, assistantToolDefinitions, validateAssistantAction,
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

test('按里程打断与撤销参数', () => {
  assert.deepEqual(
    validateAssistantAction('split_weld_at', {weldId: 'W10005', distance: 1234.567}),
    {name: 'split_weld_at', arguments: {weldId: 'W10005', distance: 1234.57}},
  );
  assert.equal(validateAssistantAction('split_weld_at', {weldId: 'W10005', distance: 0}), null);
  assert.equal(validateAssistantAction('split_weld_at', {weldId: 'W10005'}), null);
  assert.deepEqual(validateAssistantAction('undo_last', {}), {name: 'undo_last', arguments: {kind: 'auto'}});
  assert.deepEqual(validateAssistantAction('undo_last', {kind: 'merge'}), {name: 'undo_last', arguments: {kind: 'merge'}});
  assert.equal(validateAssistantAction('undo_last', {kind: 'everything'}), null);
  assert.equal(assistantActionDefinition('split_weld_at').danger, true);
});

test('复检与发布参数', () => {
  assert.deepEqual(validateAssistantAction('recheck_welds', {}), {name: 'recheck_welds', arguments: {weldIds: null}});
  assert.deepEqual(
    validateAssistantAction('recheck_welds', {weldIds: ['W10005']}),
    {name: 'recheck_welds', arguments: {weldIds: ['W10005']}},
  );
  assert.equal(validateAssistantAction('recheck_welds', {weldIds: ['bad']}), null);
  assert.deepEqual(validateAssistantAction('recheck_welds', {weldIds: null}), {name: 'recheck_welds', arguments: {weldIds: null}});
  assert.deepEqual(validateAssistantAction('publish_task', {}), {name: 'publish_task', arguments: {}});
  assert.ok(ASSISTANT_TASK_LIMIT >= 2 && ASSISTANT_TASK_LIMIT <= 10);
});

test('U 形包角拆分参数', () => {
  assert.deepEqual(
    validateAssistantAction('split_u_wrap_to_l', {weldId: 'W10006'}),
    {name: 'split_u_wrap_to_l', arguments: {weldId: 'W10006'}},
  );
  assert.deepEqual(
    validateAssistantAction('split_u_wrap_to_l', {weldId: 'W10006', segmentIndex: 2, side: 'start'}),
    {name: 'split_u_wrap_to_l', arguments: {weldId: 'W10006', segmentIndex: 2, side: 'start'}},
  );
  assert.equal(validateAssistantAction('split_u_wrap_to_l', {weldId: 'W10006', segmentIndex: 0}), null);
  assert.equal(validateAssistantAction('split_u_wrap_to_l', {weldId: 'W10006', segmentIndex: 2, side: 'middle'}), null);
  assert.equal(assistantActionDefinition('split_u_wrap_to_l').danger, true);
  assert.match(describeAssistantAction({name: 'split_u_wrap_to_l', arguments: {weldId: 'W10006', segmentIndex: 2, side: 'start'}}), /段2起点/);
});

test('模块导航与库管理参数', () => {
  assert.deepEqual(
    validateAssistantAction('open_module', {module: '工艺参数库'}),
    {name: 'open_module', arguments: {module: '工艺参数库'}},
  );
  assert.deepEqual(
    validateAssistantAction('open_module', {module: '工艺库'}),
    {name: 'open_module', arguments: {module: '工艺参数库'}},
  );
  assert.equal(validateAssistantAction('open_module', {module: '不存在'}), null);
  assert.deepEqual(
    validateAssistantAction('rename_template', {templateName: '旧模板', newName: '新模板'}),
    {name: 'rename_template', arguments: {templateName: '旧模板', newName: '新模板'}},
  );
  assert.equal(validateAssistantAction('rename_template', {templateName: '同名', newName: '同名'}), null);
  assert.deepEqual(
    validateAssistantAction('delete_process', {processName: '临时工艺'}),
    {name: 'delete_process', arguments: {processName: '临时工艺'}},
  );
  assert.equal(validateAssistantAction('delete_process', {processName: ''}), null);
  assert.equal(assistantActionDefinition('delete_template').danger, true);
});
