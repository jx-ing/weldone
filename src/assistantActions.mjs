// 助手可执行的本机操作清单。前端用于人工确认与描述，服务端用于工具定义与参数校验。
const WELD_ID = /^W[0-9]{3,6}$/;
const GROOVE_TYPES = ['V 形', '喇叭形', '无坡口'];

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
];

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
    default: return '本机操作';
  }
}
