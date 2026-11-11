import {DEFAULT_INTERFERENCE_DISTANCE} from './planningConfiguration.mjs';

export const MAX_PLANNING_WELDS = 2500;

export function roundWeldLeg(value) {
  return Number.isFinite(value) && value > 0 ? Math.max(0.5, Math.round(value * 2) / 2) : null;
}

export function weldPositionCode(value) {
  const position = String(value ?? '').trim();
  if (/^[A-Z]{2}(?:\s|$)/.test(position)) return position.slice(0, 2);
  if (['平角焊', '横角焊'].includes(position)) return 'PB';
  if (['立焊', '立角焊', '立向上焊'].includes(position)) return 'PF';
  if (position === '立向下焊') return 'PG';
  return position;
}

export function legacyWeldForm(value) {
  if (value === '搭接' || value === '搭接接头') return '搭接焊缝';
  if (value === '对接' || value === '对接接头') return '对接焊缝';
  return '角焊缝';
}

export function weldForm(weld) {
  return weld.weldType || legacyWeldForm(weld.joint ?? weld.segments?.[0]?.joint);
}

export function processWeldForms(recipe) {
  return recipe.weldForms ?? [recipe.joint === '端接接头' ? '其他焊缝' : legacyWeldForm(recipe.joint)];
}

export function normalizeCornerOffsets(offsets) {
  if(!offsets||typeof offsets!=='object'||Array.isArray(offsets))return offsets;
  return Object.fromEntries(Object.entries(offsets).map(([side,value])=>[side,value&&typeof value==='object'&&!Array.isArray(value)?null:value]));
}

function migrateProcessPass({crater,holeFill,...pass}) {
  if(pass.cornerOffsets!==undefined)pass.cornerOffsets=normalizeCornerOffsets(pass.cornerOffsets);
  return pass;
}

export function migrateProcessPasses(recipe) {
  const value=migrateProcessPass(recipe);
  if(Array.isArray(value.processLayers))value.processLayers=value.processLayers.map(layer=>({...layer,passes:layer.passes.map(migrateProcessPass)}));
  return value;
}

export function migrateProcessWeldForms(recipe) {
  const {joint,joints,...value}=migrateProcessPasses(recipe);
  return {...value,weldForms:processWeldForms(recipe)};
}

export function withoutLegacyJoint(value) {
  const {joint,...rest}=value;
  return rest;
}

export function planningContext(workspace) {
  return {
    ...workspace.planningSettings,
    planningRevision:3,
    deviceCapabilities:workspace.deviceCapabilities ?? {},
    activeDevice:workspace.processDeviceProfiles?.find(profile => profile.enabled) ?? null
  };
}

const deviceFields = ['welderModel','robotModel','material','wireType','wireDiameter','gas'];
export function belongsToDevice(process, profile) {
  if (!profile || !process.applicability) return false;
  const value = process.applicability;
  return value.deviceProfileId ? value.deviceProfileId === profile.id :
    deviceFields.every(key => (value[key] ?? '') === (profile.applicability[key] ?? ''));
}

export function strategyScopeIssue(weld, settings) {
  if (weld.templateRequired) return '合并段的工艺条件不同，仅支持焊接模板规划';
  const segments = weld.segments?.length ? weld.segments : [weld];
  if (!['角焊缝', '搭接焊缝'].includes(weldForm(weld)) ||
      segments.some(s => !['PB', 'PF', 'PG'].includes(weldPositionCode(s.position ?? weld.position))) ||
      !['无坡口', 'I形', 'I 形', 'V形', 'V 形', '喇叭形'].includes(weld.groove?.type ?? '无坡口')) {
    return '该焊缝超出策略规划范围，请创建或选择焊接模板';
  }
  const ends = settings.interferenceEndParameters ?? {};
  const vertical = segments.some(s => ['PF', 'PG'].includes(weldPositionCode(s.position ?? weld.position)));
  const limit = vertical ? ends.verticalStartDistance ?? 20 : Math.max(ends.startDistance ?? DEFAULT_INTERFERENCE_DISTANCE, ends.endDistance ?? DEFAULT_INTERFERENCE_DISTANCE);
  if (weld.length < limit) return '焊缝长度小于端点变姿态距离，仅支持焊接模板规划';
  return '';
}
