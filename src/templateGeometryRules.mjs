import {roundWeldLeg, weldForm} from './planningRequirements.mjs';

export const SHORT_SEGMENT_MM = 30;
export const ENDPOINT_TYPES = ['两面交','三面交'];
export const ENDPOINT_DIMENSIONS = [['holeSize','过焊孔尺寸'],['gap','间隙距离']];

export function endpointType(facts){
  const junction=facts?.junctionType;
  if(ENDPOINT_TYPES.includes(junction))return junction;
  const type=facts?.type;
  return ENDPOINT_TYPES.find(value=>type===value||type===value+'过焊孔')??'';
}

export function normalizeEndpointFacts(facts){
  if(!facts)return facts;
  const normalize=endpoint=>{
    if(!endpoint)return endpoint;
    const type=endpointType(endpoint)||null;
    const breakReason=endpoint.breakReason??(endpoint.type?.endsWith?.('打断')?endpoint.type:null);
    const legacyHole=type&&endpoint.type===type+'过焊孔';
    return {...endpoint,type,...(type?{junctionType:type}:{}),...(breakReason?{breakReason}:{}),
      ...(legacyHole&&endpoint.hasHole===undefined?{hasHole:true}:{})};
  };
  return {...facts,start:normalize(facts.start),end:normalize(facts.end)};
}

function exactRange(value) {
  return Number.isFinite(value) && value >= 0 ? {min:value,max:value} : null;
}

export function geometryRulesFromWeld(weld) {
  const endpoint = value => ({
    type:endpointType(value),
    ...Object.fromEntries(ENDPOINT_DIMENSIONS.map(([key])=>[key,exactRange(value?.[key])]))
  });
  return {
    machineCount:weld.machineCount ?? 1,
    weldType:weldForm(weld),
    start:endpoint(weld.endpointFacts?.start),
    end:endpoint(weld.endpointFacts?.end),
    edgeDistance:exactRange(weld.edgeDistance)
  };
}

export function shortSegmentRange(segment) {
  return segment.length < SHORT_SEGMENT_MM ? {
    minLength:Math.max(.1,segment.length - 5),
    maxLength:Math.min(SHORT_SEGMENT_MM,segment.length + 5)
  } : {minLength:.1,maxLength:null};
}

export function geometryRuleErrors(template) {
  const rules = template.requirementsMatch;
  if (!rules&&!template.shortSegmentMatch) return [];
  const errors = [];
  if (rules&&![1,2].includes(rules.machineCount)) errors.push('请选择单机或双机焊接');
  if (rules&&!['角焊缝','搭接焊缝','对接焊缝'].includes(rules.weldType)) errors.push('请选择焊缝形式');
  const check = (range,label) => {
    if (range != null && (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min < 0 || range.min > range.max)) errors.push(label+'须填写有效的最小值和最大值');
  };
  check(rules?.edgeDistance,'焊缝边缘距离');
  for (const [key,label] of [['start','起点'],['end','终点']]) {
    const endpoint = rules?.[key] ?? {};
    if (endpoint.type && !ENDPOINT_TYPES.includes(endpoint.type)) errors.push(label+'特征不支持');
    for (const [dimension,name] of ENDPOINT_DIMENSIONS) check(endpoint[dimension],label+name);
  }
  for (const [index,segment] of template.segments.entries()) {
    if (segment.length >= SHORT_SEGMENT_MM) continue;
    const saved = template.matchParameters?.segments?.[index] ?? segment;
    const max = saved.maxLength ?? shortSegmentRange(segment).maxLength;
    if (max > SHORT_SEGMENT_MM) errors.push(`第 ${index+1} 段匹配长度上限为 30 mm`);
  }
  return errors;
}

export function geometryRuleMismatches(rules,weld) {
  const reasons = [];
  const check = (range,value,label) => {
    if (range && (!Number.isFinite(value) || value < range.min || value > range.max)) reasons.push(label+'不在模板匹配范围内');
  };
  if (rules.machineCount !== (weld.machineCount ?? 1)) reasons.push('单机／双机条件不一致');
  if (rules.weldType !== weldForm(weld)) reasons.push('焊缝形式不一致');
  check(rules.edgeDistance,weld.edgeDistance,'焊缝边缘距离');
  for (const [key,label] of [['start','起点'],['end','终点']]) {
    const actual = weld.endpointFacts?.[key] ?? {};
    const expected = rules[key] ?? {};
    const type=endpointType(expected);
    if (type && endpointType(actual) !== type) reasons.push(label+'特征不一致');
    for (const [dimension,name] of ENDPOINT_DIMENSIONS) check(expected[dimension],actual[dimension],label+name);
  }
  return reasons;
}

export function defaultPlanningTemplateName(weld) {
  const position = String(weld.position ?? '').split(' · ').at(-1).replace('横角焊','平角焊');
  return [`${roundWeldLeg(weld.leg)}mm`,position,endpointType(weld.endpointFacts?.start) || '起点待确认',endpointType(weld.endpointFacts?.end) || '终点待确认'].join('-');
}

export function templateGeometryKey(template) {
  return JSON.stringify([
    template.leg,template.closure,template.groove,template.startHole,template.endHole,template.requirementsMatch,
    template.segments.map(s=>[s.position,s.geometry,Math.round(s.length*10)/10]),
    template.corners.map(c=>[c.standard,c.angleSide])
  ]);
}
