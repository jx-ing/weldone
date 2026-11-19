import {validateAssistantAction} from './assistantActions.mjs';

// Match the entire request. Questions, conditions and unfinished instructions
// stay in the chat path instead of being translated into a partial edit.
const simpleCommands = new Map([
  ['一键规划', 'run_planning'], ['开始一键规划', 'run_planning'], ['重新规划', 'run_planning'],
  ['导出到生产执行', 'export_task'], ['发布生产任务', 'publish_task'], ['发布任务', 'publish_task'],
  ['启动仿真', 'execution_run'], ['执行仿真', 'execution_run'], ['一键执行', 'execution_run'],
  ['终止仿真', 'execution_stop'], ['停止仿真', 'execution_stop'],
  ['导出统计CSV', 'stats_export_csv'], ['应用设备修改', 'device_apply_changes'],
]);

const weldTarget = '(W[0-9]{3,6}|当前焊缝|选中的焊缝|这条焊缝)';
const weldList = '(W[0-9]{3,6}(?:(?:\\s*[,，、和与]\\s*|\\s+)W[0-9]{3,6})*)';
const command = pattern => new RegExp('^' + pattern + '$', 'i');
const select = command('(?:选中|定位|选择)\\s*(?:焊缝\\s*)?' + weldTarget);
const batch = command('(启用|屏蔽|禁用|删除|合并|复检)\\s*(?:焊缝\\s*)?' + weldList);
const batchCurrent = command('(启用|屏蔽|禁用|删除|复检)\\s*(当前焊缝|选中的焊缝|这条焊缝)');
const postfix = command('(?:把|将)\\s*' + weldTarget + '\\s*(启用|屏蔽|禁用|删除|复检)');
const setLeg = command('(?:把|将)?\\s*' + weldTarget + '\\s*的?焊脚(?:尺寸|高度)?\\s*(?:改为|改成|设为|设置为|调到)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:mm|毫米)?');
const setName = command('(?:把|将)?\\s*' + weldTarget + '\\s*(?:重命名为|改名为)\\s*「([^「」\\n]+)」');
const wrap = command('(?:把|将)?\\s*' + weldTarget + '\\s*的?\\s*(?:段\\s*(\\d+)\\s*(起点|终点)?\\s*)?(?:U\\s*[形型]?\\s*包角)?\\s*(?:拆成|拆分成|拆分为|改成|改为)\\s*(?:两(?:个|条)?|2(?:个|条)?)\\s*L\\s*[形型]?\\s*包角');
const split = command('(?:把|将)?\\s*' + weldTarget + '\\s*在\\s*(?:距起点\\s*)?(\\d+(?:\\.\\d+)?)\\s*(?:mm|毫米)\\s*处?\\s*(?:打断|拆分)');
const apply = command('(?:给|对|为)?\\s*' + weldTarget + '\\s*(?:应用|使用)\\s*(模板|工艺参数|工艺)\\s*「([^「」\\n]+)」');
const createTemplate = command('(?:以|用)\\s*' + weldTarget + '\\s*(?:新建|创建)(?:焊接)?模板');
const selectExecution = command('选择执行焊缝\\s*' + weldTarget + '(?:\\s*道次\\s*「([^「」\\n]+)」)?');
const batchName = {启用: 'set_welds_enabled', 屏蔽: 'set_welds_enabled', 禁用: 'set_welds_enabled', 删除: 'delete_welds', 合并: 'merge_welds', 复检: 'recheck_welds'};
const undoKind = {上一步: 'auto', 编辑: 'auto', 打断: 'split', 包角拆分: 'split', 合并: 'merge', 几何处理: 'geometry'};

export function localAssistantAction(question, {selectedWeldId, page} = {}) {
  const input = question.trim().replace(/^(?:请(?:帮我)?|帮我)\s*/, '').replace(/[。！!]$/, '').trim();
  const action = validateAssistantAction;
  const id = value => /^W\d+$/i.test(value) ? value.toUpperCase() : selectedWeldId;
  const simple = simpleCommands.get(input.replace(/\s+/g, ''));
  if (simple) return action(simple, {});

  let match = /^(?:打开|进入|切换到)\s*(.+?)(?:模块|页面)?$/.exec(input);
  if (match) return action('open_module', {module: match[1]});
  if ((match = select.exec(input))) return action(page === '生产执行' ? 'execution_select' : 'select_weld', {weldId: id(match[1])});
  if ((match = selectExecution.exec(input))) return action('execution_select', {weldId: id(match[1]), passId: match[2]});
  if ((match = batch.exec(input) ?? batchCurrent.exec(input))) {
    const weldIds = match[2].toUpperCase().match(/W\d+/g) ?? [selectedWeldId];
    if (match[1] === '合并' && weldIds.length < 2) return null;
    return action(batchName[match[1]], {weldIds, enabled: match[1] === '启用'});
  }
  if ((match = postfix.exec(input))) return action(batchName[match[2]], {weldIds: [id(match[1])], enabled: match[2] === '启用'});
  if (/^复检全部(?:已规划)?焊缝$/.test(input)) return action('recheck_welds', {});
  if ((match = /^撤销(?:刚才的)?(上一步|编辑|打断|包角拆分|合并|几何处理)?$/.exec(input))) return action('undo_last', {kind: undoKind[match[1]]});
  if ((match = setLeg.exec(input))) return action('update_weld', {weldId: id(match[1]), leg: Number(match[2])});
  if ((match = setName.exec(input))) return action('update_weld', {weldId: id(match[1]), name: match[2]});
  if ((match = wrap.exec(input))) {
    const args = {weldId: id(match[1])};
    if (match[2]) args.segmentIndex = Number(match[2]);
    if (match[3]) args.side = match[3] === '终点' ? 'end' : 'start';
    return action('split_u_wrap_to_l', args);
  }
  if ((match = split.exec(input))) return action('split_weld_at', {weldId: id(match[1]), distance: Number(match[2])});
  if ((match = createTemplate.exec(input))) return action('create_template', {weldId: id(match[1])});
  if ((match = apply.exec(input))) {
    return match[2] === '模板' ? action('apply_template', {weldId: id(match[1]), templateName: match[3]}) :
      action('apply_process', {weldId: id(match[1]), processName: match[3]});
  }
  match = /^(?:把|将)?\s*(模板|工艺参数|工艺)\s*「([^「」\n]+)」\s*(?:重命名为|改名为)\s*「([^「」\n]+)」$/.exec(input);
  if (match) return match[1] === '模板' ? action('rename_template', {templateName: match[2], newName: match[3]}) :
    action('rename_process', {processName: match[2], newName: match[3]});
  match = /^删除\s*(模板|工艺参数|工艺)\s*「([^「」\n]+)」$/.exec(input);
  if (match) return match[1] === '模板' ? action('delete_template', {templateName: match[2]}) :
    action('delete_process', {processName: match[2]});
  return null;
}
