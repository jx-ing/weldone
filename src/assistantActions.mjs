// 助手可执行的本机操作清单。前端用于人工确认与描述，服务端用于工具定义与参数校验。
const WELD_ID = /^W[0-9]{3,6}$/;
const GROOVE_TYPES = ['V 形', '喇叭形', '无坡口'];
export const ASSISTANT_MODULES = ['工艺规划', '生产执行', '焊接模板库', '工艺参数库', '设备控制', '生产统计'];
const MODULE_ALIASES = {'工艺库': '工艺参数库', '工艺参数': '工艺参数库', '模板库': '焊接模板库', '统计': '生产统计'};

const text = (value, max) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed && trimmed.length <= max ? trimmed : null;
};
const weldId = value => text(value, 16) && WELD_ID.test(value.trim()) ? value.trim() : null;
const weldIds = value => {
  if (!Array.isArray(value) || !value.length || value.length > 50) return null;
  const ids = value.map(weldId);
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null;
};
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  ? value : null;

function fieldsOf(args) {
  const fields = {};
  if (args.name !== undefined) {
    const name = text(args.name, 60);
    if (!name) return null;
    fields.name = name;
  }
  if (args.leg !== undefined) {
    const leg = finite(args.leg, 0.1, 200);
    if (leg === null) return null;
    fields.leg = leg;
  }
  if (args.position !== undefined) {
    const position = text(args.position, 40);
    if (!position) return null;
    fields.position = position;
  }
  const grooveKeys = ['grooveType', 'grooveAngle', 'grooveDepth', 'rootGap', 'rootRadius'];
  if (grooveKeys.some(key => args[key] !== undefined)) {
    const groove = {};
    if (args.grooveType !== undefined) {
      const type = String(args.grooveType).trim() === 'V形' ? 'V 形' : args.grooveType;
      if (!GROOVE_TYPES.includes(type)) return null;
      groove.type = type;
    }
    if (args.grooveAngle !== undefined) {
      const angle = finite(args.grooveAngle, 0, 180);
      if (angle === null) return null;
      groove.angle = angle;
    }
    for (const [key, field, max] of [['grooveDepth', 'depth', 200], ['rootGap', 'rootGap', 100], ['rootRadius', 'rootRadius', 100]]) {
      if (args[key] === undefined) continue;
      const value = finite(args[key], 0, max);
      if (value === null) return null;
      groove[field] = value;
    }
    fields.groove = groove;
  }
  return Object.keys(fields).length ? fields : null;
}

export const ASSISTANT_ACTION_DEFINITIONS = [
  {
    name: 'select_weld',
    title: '选中焊缝',
    danger: false,
    description: '在结构树和模型中选中一条焊缝，只改变当前选择，不修改数据。',
    parameters: {
      type: 'object',
      properties: {weldId: {type: 'string', description: '焊缝编号，例如 W10004'}},
      required: ['weldId'],
    },
    validate: args => weldId(args.weldId) ? {weldId: args.weldId.trim()} : null,
  },
  {
    name: 'set_welds_enabled',
    title: '启用或屏蔽焊缝',
    danger: false,
    description: '批量启用或屏蔽焊缝，被屏蔽的焊缝不参与规划。',
    parameters: {
      type: 'object',
      properties: {
        weldIds: {type: 'array', items: {type: 'string'}, description: '焊缝编号列表，最多 50 条'},
        enabled: {type: 'boolean', description: 'true 启用，false 屏蔽'},
      },
      required: ['weldIds', 'enabled'],
    },
    validate: args => {
      const ids = weldIds(args.weldIds);
      return ids && typeof args.enabled === 'boolean' ? {weldIds: ids, enabled: args.enabled} : null;
    },
  },
  {
    name: 'update_weld',
    title: '修改焊缝属性',
    danger: false,
    description: '修改一条焊缝的名称、焊脚、焊接位置或坡口；修改后会重新匹配并复检。',
    parameters: {
      type: 'object',
      properties: {
        weldId: {type: 'string', description: '焊缝编号，例如 W10004'},
        name: {type: 'string', description: '新的焊缝名称'},
        leg: {type: 'number', description: '焊脚尺寸，单位 mm'},
        position: {type: 'string', description: '焊接位置，例如 转角、平焊、立焊'},
        grooveType: {type: 'string', enum: GROOVE_TYPES, description: '坡口类型'},
        grooveAngle: {type: 'number', description: '坡口角度，单位度'},
        grooveDepth: {type: 'number', description: '坡口深度，单位 mm'},
        rootGap: {type: 'number', description: '根部间隙，单位 mm'},
        rootRadius: {type: 'number', description: '根部半径，单位 mm'},
      },
      required: ['weldId'],
    },
    validate: args => {
      const id = weldId(args.weldId);
      const source = args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields)
        ? {...args, ...args.fields} : args;
      const fields = id && fieldsOf(source);
      return fields ? {weldId: id, fields} : null;
    },
  },
  {
    name: 'delete_welds',
    title: '删除焊缝',
    danger: true,
    description: '删除一条或多条焊缝，删除前的数据会保留在撤销记录中。',
    parameters: {
      type: 'object',
      properties: {weldIds: {type: 'array', items: {type: 'string'}, description: '要删除的焊缝编号列表'}},
      required: ['weldIds'],
    },
    validate: args => {
      const ids = weldIds(args.weldIds);
      return ids ? {weldIds: ids} : null;
    },
  },
  {
    name: 'merge_welds',
    title: '合并焊缝',
    danger: true,
    description: '把多条首尾相连的焊缝合并为一条，原焊缝保留并屏蔽。',
    parameters: {
      type: 'object',
      properties: {weldIds: {type: 'array', items: {type: 'string'}, description: '要合并的焊缝编号列表'}},
      required: ['weldIds'],
    },
    validate: args => {
      const ids = weldIds(args.weldIds);
      return ids ? {weldIds: ids} : null;
    },
  },
  {
    name: 'apply_template',
    title: '应用焊接模板',
    danger: false,
    description: '把焊接模板库中的模板应用到一条焊缝，会覆盖该焊缝的层道、点位和姿态。',
    parameters: {
      type: 'object',
      properties: {
        weldId: {type: 'string', description: '目标焊缝编号'},
        templateName: {type: 'string', description: '模板名称，必须与本机模板列表完全一致'},
      },
      required: ['weldId', 'templateName'],
    },
    validate: args => {
      const id = weldId(args.weldId), name = text(args.templateName, 80);
      return id && name ? {weldId: id, templateName: name} : null;
    },
  },
  {
    name: 'apply_process',
    title: '应用工艺参数',
    danger: false,
    description: '把工艺库中的工艺参数应用到一条焊缝，并保存为独立快照。',
    parameters: {
      type: 'object',
      properties: {
        weldId: {type: 'string', description: '目标焊缝编号'},
        processName: {type: 'string', description: '工艺参数名称，必须与本机工艺库列表完全一致'},
      },
      required: ['weldId', 'processName'],
    },
    validate: args => {
      const id = weldId(args.weldId), name = text(args.processName, 80);
      return id && name ? {weldId: id, processName: name} : null;
    },
  },
  {
    name: 'create_template',
    title: '新建焊接模板',
    danger: false,
    description: '以一条焊缝为来源新建焊缝模板，打开模板编辑器供用户补全并保存。',
    parameters: {
      type: 'object',
      properties: {weldId: {type: 'string', description: '作为模板来源的焊缝编号'}},
      required: ['weldId'],
    },
    validate: args => weldId(args.weldId) ? {weldId: args.weldId.trim()} : null,
  },
  {
    name: 'run_planning',
    title: '一键规划',
    danger: false,
    description: '对当前模型执行一键规划，重新提取、匹配并生成焊接路径。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
  {
    name: 'export_task',
    title: '导出到生产执行',
    danger: false,
    description: '把当前规划导出为生产执行任务。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
  {
    name: 'split_weld_at',
    title: '按里程打断',
    danger: true,
    description: '沿焊缝实际路径，在距起点指定毫米处把焊缝打断为两条；原焊缝保留并屏蔽。',
    parameters: {
      type: 'object',
      properties: {
        weldId: {type: 'string', description: '要打断的焊缝编号'},
        distance: {type: 'number', description: '距焊缝起点的毫米值，必须小于焊缝长度'},
      },
      required: ['weldId', 'distance'],
    },
    validate: args => {
      const id = weldId(args.weldId);
      const distance = finite(args.distance, 0.1, 1_000_000);
      return id && distance !== null ? {weldId: id, distance: Math.round(distance * 100) / 100} : null;
    },
  },
  {
    name: 'undo_last',
    title: '撤销上一步',
    danger: false,
    description: '撤销最近一次几何编辑：打断、合并或几何处理；没有可撤销记录时返回原因。',
    parameters: {
      type: 'object',
      properties: {
        kind: {type: 'string', enum: ['auto', 'split', 'merge', 'geometry'], description: '默认 auto，自动选择最近一次记录'},
      },
    },
    validate: args => {
      const kind = args.kind ?? 'auto';
      return ['auto', 'split', 'merge', 'geometry'].includes(kind) ? {kind} : null;
    },
  },
  {
    name: 'recheck_welds',
    title: '复检焊缝',
    danger: false,
    description: '对指定焊缝或全部已规划焊缝重新执行匹配与碰撞复检，并保存结果。',
    parameters: {
      type: 'object',
      properties: {weldIds: {type: 'array', items: {type: 'string'}, description: '不填表示全部已规划焊缝'}},
    },
    validate: args => {
      if (args.weldIds === undefined || args.weldIds === null) return {weldIds: null};
      const ids = weldIds(args.weldIds);
      return ids ? {weldIds: ids} : null;
    },
  },
  {
    name: 'publish_task',
    title: '发布生产任务',
    danger: false,
    description: '把当前规划发布或更新到生产执行；建议在复检通过后使用。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
  {
    name: 'split_u_wrap_to_l',
    title: 'U 形包角改 L 形',
    danger: true,
    description: '把焊缝上的一处 U 形包角拆成两个 L 形包角并重新规划；原焊缝保留并屏蔽。多处 U 形包角时可省略段号，由界面列出候选供操作员选择。',
    parameters: {
      type: 'object',
      properties: {
        weldId: {type: 'string', description: '焊缝编号'},
        segmentIndex: {type: 'integer', description: 'U 形包角短边所在段号，从 1 开始；只有一处时可省略'},
        side: {type: 'string', enum: ['start', 'end'], description: '包角位于该段的起点或终点，默认起点'},
      },
      required: ['weldId'],
    },
    validate: args => {
      const id = weldId(args.weldId);
      if (!id) return null;
      const result = {weldId: id};
      if (args.segmentIndex !== undefined) {
        if (!Number.isInteger(args.segmentIndex) || args.segmentIndex < 1 || args.segmentIndex > 1000) return null;
        result.segmentIndex = args.segmentIndex;
      }
      if (args.side !== undefined) {
        if (!['start', 'end'].includes(args.side)) return null;
        result.side = args.side;
      }
      return result;
    },
  },
  {
    name: 'open_module',
    title: '打开模块',
    danger: false,
    description: '切换到指定的功能模块页面，用于把用户带到需要操作的界面。',
    parameters: {
      type: 'object',
      properties: {module: {type: 'string', enum: ASSISTANT_MODULES, description: '目标模块名称'}},
      required: ['module'],
    },
    validate: args => {
      const name = MODULE_ALIASES[args.module] ?? args.module;
      return ASSISTANT_MODULES.includes(name) ? {module: name} : null;
    },
  },
  {
    name: 'rename_template',
    title: '重命名焊接模板',
    danger: false,
    description: '修改焊接模板库中一个模板的名称；不会改变已应用到焊缝的快照。',
    parameters: {
      type: 'object',
      properties: {
        templateName: {type: 'string', description: '现有模板名称，必须完全一致'},
        newName: {type: 'string', description: '新的模板名称'},
      },
      required: ['templateName', 'newName'],
    },
    validate: args => {
      const name = text(args.templateName, 80), newName = text(args.newName, 60);
      return name && newName && name !== newName ? {templateName: name, newName} : null;
    },
  },
  {
    name: 'delete_template',
    title: '删除焊接模板',
    danger: true,
    description: '从焊接模板库删除一个模板；已应用到焊缝的历史快照保持不变。',
    parameters: {
      type: 'object',
      properties: {templateName: {type: 'string', description: '要删除的模板名称，必须完全一致'}},
      required: ['templateName'],
    },
    validate: args => text(args.templateName, 80) ? {templateName: args.templateName.trim()} : null,
  },
  {
    name: 'rename_process',
    title: '重命名工艺参数',
    danger: false,
    description: '修改工艺库中一条工艺参数的名称；不会改变已应用的快照。',
    parameters: {
      type: 'object',
      properties: {
        processName: {type: 'string', description: '现有工艺名称，必须完全一致'},
        newName: {type: 'string', description: '新的工艺名称'},
      },
      required: ['processName', 'newName'],
    },
    validate: args => {
      const name = text(args.processName, 80), newName = text(args.newName, 60);
      return name && newName && name !== newName ? {processName: name, newName} : null;
    },
  },
  {
    name: 'delete_process',
    title: '删除工艺参数',
    danger: true,
    description: '从工艺库删除一条工艺参数；已应用到焊缝的历史快照保持不变。',
    parameters: {
      type: 'object',
      properties: {processName: {type: 'string', description: '要删除的工艺名称，必须完全一致'}},
      required: ['processName'],
    },
    validate: args => text(args.processName, 80) ? {processName: args.processName.trim()} : null,
  },
  {
    name: 'execution_select',
    title: '选择执行任务',
    danger: false,
    description: '在生产执行中选择已发布任务里的焊缝和道次，用于后续仿真。需先打开生产执行模块。',
    parameters: {
      type: 'object',
      properties: {
        weldId: {type: 'string', description: '已发布任务中的焊缝编号'},
        passId: {type: 'string', description: '可选的道次编号'},
      },
      required: ['weldId'],
    },
    validate: args => {
      const id = weldId(args.weldId);
      if (!id) return null;
      const result = {weldId: id};
      if (args.passId !== undefined) {
        const pass = text(args.passId, 60);
        if (!pass) return null;
        result.passId = pass;
      }
      return result;
    },
  },
  {
    name: 'execution_run',
    title: '执行仿真',
    danger: false,
    description: '在生产执行中对当前选中的焊缝道次启动一键执行仿真。需先打开生产执行模块并选好道次。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
  {
    name: 'execution_stop',
    title: '终止仿真',
    danger: false,
    description: '终止正在运行的生产执行仿真，并保留当前机械臂位置。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
  {
    name: 'stats_export_csv',
    title: '导出统计 CSV',
    danger: false,
    description: '导出生产统计当前筛选条件下的 CSV。需先打开生产统计模块。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
  {
    name: 'device_apply_changes',
    title: '应用设备修改',
    danger: false,
    description: '把设备控制中尚未应用的设备配置修改写入当前场景。需先打开设备控制模块。',
    parameters: {type: 'object', properties: {}},
    validate: () => ({}),
  },
];

export const ASSISTANT_TASK_LIMIT = 5;

const BY_NAME = new Map(ASSISTANT_ACTION_DEFINITIONS.map(definition => [definition.name, definition]));

export function assistantToolDefinitions() {
  return ASSISTANT_ACTION_DEFINITIONS.map(({name, description, parameters}) => ({
    type: 'function',
    function: {name, description, parameters},
  }));
}

export function validateAssistantAction(name, rawArguments) {
  const definition = BY_NAME.get(name);
  if (!definition) return null;
  let args = rawArguments;
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { return null; }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  try {
    const normalized = definition.validate(args);
    return normalized ? {name, arguments: normalized} : null;
  } catch {
    return null;
  }
}

export function assistantActionDefinition(name) {
  return BY_NAME.get(name) ?? null;
}

export function describeAssistantAction(action, labels = {}) {
  const args = action?.arguments ?? {};
  const label = id => labels[id] ? `${id}（${labels[id]}）` : id;
  switch (action?.name) {
    case 'select_weld': return `选中焊缝 ${label(args.weldId)}`;
    case 'set_welds_enabled': return `${args.enabled ? '启用' : '屏蔽'} ${args.weldIds?.map(label).join('、')}`;
    case 'update_weld': {
      const changed = [];
      if (args.fields?.name !== undefined) changed.push(`名称改为「${args.fields.name}」`);
      if (args.fields?.leg !== undefined) changed.push(`焊脚改为 ${args.fields.leg} mm`);
      if (args.fields?.position !== undefined) changed.push(`位置改为「${args.fields.position}」`);
      if (args.fields?.groove) changed.push('坡口参数');
      return `修改 ${label(args.weldId)}：${changed.join('，') || '属性'}`;
    }
    case 'delete_welds': return `删除 ${args.weldIds?.map(label).join('、')}`;
    case 'merge_welds': return `合并 ${args.weldIds?.map(label).join('、')}`;
    case 'apply_template': return `对 ${label(args.weldId)} 应用模板「${args.templateName}」`;
    case 'apply_process': return `对 ${label(args.weldId)} 应用工艺「${args.processName}」`;
    case 'create_template': return `以 ${label(args.weldId)} 为来源新建焊接模板`;
    case 'run_planning': return '执行一键规划';
    case 'export_task': return '导出到生产执行';
    case 'split_weld_at': return `把 ${label(args.weldId)} 在 ${args.distance} mm 处打断`;
    case 'undo_last': return `撤销最近一次${args.kind === 'split' ? '打断' : args.kind === 'merge' ? '合并' : args.kind === 'geometry' ? '几何处理' : '编辑'}`;
    case 'recheck_welds': return `复检 ${args.weldIds ? args.weldIds.map(label).join('、') : '全部已规划焊缝'}`;
    case 'publish_task': return '发布生产任务';
    case 'split_u_wrap_to_l': {
      const where = args.segmentIndex ? `段${args.segmentIndex}${args.side === 'end' ? '终点' : '起点'}` : 'U 形包角';
      return `把 ${label(args.weldId)} 的 ${where} 拆成两个 L 形包角`;
    }
    case 'open_module': return `切换到「${args.module}」`;
    case 'rename_template': return `把模板「${args.templateName}」重命名为「${args.newName}」`;
    case 'delete_template': return `删除模板「${args.templateName}」`;
    case 'rename_process': return `把工艺「${args.processName}」重命名为「${args.newName}」`;
    case 'delete_process': return `删除工艺「${args.processName}」`;
    case 'execution_select': return `选择执行焊缝 ${label(args.weldId)}${args.passId ? ` 道次 ${args.passId}` : ''}`;
    case 'execution_run': return '执行生产仿真';
    case 'execution_stop': return '终止生产仿真';
    case 'stats_export_csv': return '导出统计 CSV';
    case 'device_apply_changes': return '应用设备修改';
    default: return '本机操作';
  }
}
