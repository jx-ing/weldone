import test from 'node:test';
import assert from 'node:assert/strict';
import {localAssistantAction} from '../src/localAssistantCommands.mjs';
import {assistantRecheckResult} from '../src/assistantRecheck.mjs';

test('明确的离线指令生成现有业务操作的提案', () => {
  const cases = [
    ['请打开生产统计', 'open_module', {module: '生产统计'}],
    ['选中 W10001', 'select_weld', {weldId: 'W10001'}],
    ['启用 W10001 和 w10002', 'set_welds_enabled', {weldIds: ['W10001', 'W10002'], enabled: true}],
    ['把 W10005 屏蔽', 'set_welds_enabled', {weldIds: ['W10005'], enabled: false}],
    ['把 W10001 的焊脚改为 6.5 mm', 'update_weld', {weldId: 'W10001', fields: {leg: 6.5}}],
    ['删除焊缝 W10001', 'delete_welds', {weldIds: ['W10001']}],
    ['合并 W10001、W10002', 'merge_welds', {weldIds: ['W10001', 'W10002']}],
    ['对 W10001 应用模板「T 01」', 'apply_template', {weldId: 'W10001', templateName: 'T 01'}],
    ['为 W10001 应用工艺「P 01」', 'apply_process', {weldId: 'W10001', processName: 'P 01'}],
    ['以 W10001 新建模板', 'create_template', {weldId: 'W10001'}],
    ['一键规划', 'run_planning', {}],
    ['导出到生产执行', 'export_task', {}],
    ['把 W10001 在距起点 12.5 mm 处打断', 'split_weld_at', {weldId: 'W10001', distance: 12.5}],
    ['撤销刚才的包角拆分', 'undo_last', {kind: 'split'}],
    ['复检 W10001', 'recheck_welds', {weldIds: ['W10001']}],
    ['发布生产任务', 'publish_task', {}],
    ['W10001拆成两个L形包角', 'split_u_wrap_to_l', {weldId: 'W10001'}],
    ['把 W10006 的段2起点 U 形包角拆成两个 L 形包角', 'split_u_wrap_to_l', {weldId: 'W10006', segmentIndex: 2, side: 'start'}],
    ['模板「T1」重命名为「T2」', 'rename_template', {templateName: 'T1', newName: 'T2'}],
    ['删除模板「T1」', 'delete_template', {templateName: 'T1'}],
    ['工艺「P1」改名为「P2」', 'rename_process', {processName: 'P1', newName: 'P2'}],
    ['删除工艺「P1」', 'delete_process', {processName: 'P1'}],
    ['选择执行焊缝 W10001 道次「PASS-1」', 'execution_select', {weldId: 'W10001', passId: 'PASS-1'}],
    ['启动仿真', 'execution_run', {}],
    ['停止仿真', 'execution_stop', {}],
    ['导出统计 CSV', 'stats_export_csv', {}],
    ['应用设备修改', 'device_apply_changes', {}],
  ];
  for (const [question, name, args] of cases) {
    assert.deepEqual(localAssistantAction(question), {name, arguments: args}, question);
  }
});

test('当前选择仅在上下文中有有效焊缝编号时解析', () => {
  assert.equal(localAssistantAction('屏蔽当前焊缝'), null);
  assert.deepEqual(localAssistantAction('屏蔽当前焊缝', {selectedWeldId: 'W120'}), {
    name: 'set_welds_enabled', arguments: {weldIds: ['W120'], enabled: false},
  });
  assert.equal(localAssistantAction('选中 W10001', {page: '生产执行'}).name, 'execution_select');
});

test('未识别、歧义、条件或无效参数不生成部分操作', () => {
  for (const question of ['如何删除 W10001？', '不要删除 W10001', '删除 W10001 吗？', '假如删除 W10001',
    '复检 W10001 通过后发布', '屏蔽 W10001，然后处理剩下的', '删除模板「T」之后会怎样',
    '删除 W、W10001', '合并 W10001', '合并 W10001、W10001', '打开无此模块',
    '把 W10001 的焊脚改为 6000 mm', '把 W10001 在 0 毫米处拆分']) {
    assert.equal(localAssistantAction(question), null, question);
  }
});

test('复检回执要求所有目标都已校验，并区分碰撞和间隙警告', () => {
  const ids = new Set(['W10001']);
  const result = (collisionVerified, collisionState) =>
    assistantRecheckResult([{id: 'W10001', collisionVerified, collisionState}], ids);
  assert.equal(assistantRecheckResult([], ids).ok, false);
  for (const state of ['未检测', '检测到碰撞', '局部未能判定']) {
    assert.deepEqual(result(false, state), {ok: false, message: '复检未通过：W10001 · ' + state});
  }
  assert.deepEqual(result(true, '未发现碰撞'), {ok: true, message: '已复检 1 条焊缝，未发现碰撞'});
  assert.match(result(true, '间隙不足').message, /间隙不足：W10001/);
});
