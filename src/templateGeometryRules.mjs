import {validTemplateCaptureRange} from './templateCaptureRange.mjs';
import {roundWeldLeg, weldForm} from './planningRequirements.mjs';
import {defaultDistanceInterval,measureDistanceInterval} from './templateDistanceProfile.mjs';

export const SHORT_SEGMENT_MM = 30;
export const ENDPOINT_TYPES = ['两面交','三面交'];
export const ENDPOINT_DIMENSIONS = [['holeSize','过焊孔尺寸'],['gap','间隙距离'],['edgeDistance','边缘距离']];
export const geometryConditionEnabled=(group,key,configured=group?.[key])=>group?.[key+'Enabled']??!!configured;
export const hasDistanceProfile=profile=>profile?.mode==='nearest'?!!profile.nearest:!!profile?.intervals?.length;
const segmentProfiles=[
 ['edgeDistance','baseplateEdge','baseplate','边缘距离','底板边缘'],
 ['gap','solidGap','solidGap','间隙','实体表面']
];

export function needsGeometryMeasurements(rules){
 return !!rules?.captureRange&&(
  rules.segmentDistances.some(segment=>segmentProfiles.some(([key,rule])=>
   geometryConditionEnabled(segment,key,segment[rule]?hasDistanceProfile(segment[rule]):segment[key])))||
  [rules.start,rules.end].some(endpoint=>ENDPOINT_DIMENSIONS.some(([key])=>geometryConditionEnabled(endpoint,key)))
 );
}

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

export const roundEndpointGap=value=>Number.isFinite(value)?Number(value.toFixed(1)):value;

export function updateDistanceIntervals(intervals,profile){
 return intervals.map(({start,end})=>{
  const measured=measureDistanceInterval(profile,start,end);
  return {start,end,distance:measured?{min:roundEndpointGap(measured.min),max:roundEndpointGap(measured.max)}:null};
 });
}

function distanceProfileRule(profile){
 const interval=defaultDistanceInterval(profile);
 const nearest=profile?.nearest;
 return {mode:'continuous',nearest:exactRange(roundEndpointGap(profile?.nearest?.distance)),
  closest:nearest?{station:nearest.station,distance:nearest.distance,boundary:nearest.kind}:null,
  intervals:updateDistanceIntervals(interval?[interval]:[],profile)};
}

export function savedGeometryRules(rules){
 if(!rules?.segmentDistances)return rules;
 return {...rules,segmentDistances:rules.segmentDistances.map(segment=>({...segment,
  ...Object.fromEntries(segmentProfiles.flatMap(([,key])=>{
   const profile=segment[key];
   if(!profile)return [];
   return [[key,profile.mode==='nearest'?
    {mode:profile.mode,nearest:profile.nearest,closest:profile.closest??null}:{mode:profile.mode,intervals:profile.intervals}]];
  }))
 }))};
}

function endpointHoleSize(facts,hasHole){
  if((facts?.hasHole??hasHole)===false)return 0;
  return facts?.holeSize;
}

export function geometryRulesFromWeld(weld,captureRange,neighborhood) {
  const endpoint = (value,hasHole,measured) => ({
    type:endpointType(value),
    holeSize:exactRange(roundEndpointGap(measured?measured.holeSize:endpointHoleSize(value,hasHole))),
    gap:exactRange(roundEndpointGap(measured?measured.gap?.distance:value?.gap)),
    edgeDistance:exactRange(roundEndpointGap(measured?.edgeDistance?.distance))
  });
  return {
    machineCount:weld.machineCount ?? 1,
    weldType:weldForm(weld),
    start:endpoint(weld.endpointFacts?.start,weld.startHole,neighborhood?.start),
    end:endpoint(weld.endpointFacts?.end,weld.endHole,neighborhood?.end),
    ...(captureRange?{captureRange:{...captureRange},segmentDistances:weld.segments.map((_,index)=>({
      baseplateEdge:distanceProfileRule(neighborhood?.segments[index]?.baseplate),
      solidGap:distanceProfileRule(neighborhood?.segments[index]?.solidGap)
    }))}:{edgeDistance:exactRange(weld.edgeDistance)})
  };
}

export function updateGeometryRuleMeasurements(current,previous,measured,neighborhood){
 const same=(a,b)=>a?.min===b?.min&&a?.max===b?.max;
 const useLatest=(value,before,after)=>same(value,before)?after:value;
 const endpoint=key=>({...current[key],...Object.fromEntries(ENDPOINT_DIMENSIONS.map(([dimension])=>
  [dimension,useLatest(current[key][dimension],previous[key][dimension],measured[key][dimension])]))});
 return {
  ...current,captureRange:measured.captureRange,start:endpoint('start'),end:endpoint('end'),
  segmentDistances:measured.segmentDistances.map((next,index)=>{
   const before=previous.segmentDistances[index],existing=current.segmentDistances[index];
   return {...existing,...Object.fromEntries(segmentProfiles.map(([,key,evidence])=>{
    const profile=existing[key];
    if(!profile)return [key,next[key]];
    return [key,{...next[key],mode:profile.mode,nearest:useLatest(profile.nearest,before[key]?.nearest,next[key].nearest),
     ...(profile.intervalsEdited?{intervalsEdited:true,intervals:updateDistanceIntervals(profile.intervals,neighborhood?.segments[index]?.[evidence])}:{})}];
   }))};
  })
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
  const check = (range,label,required=false) => {
    if ((required||range!=null) && (!Number.isFinite(range?.min) || !Number.isFinite(range?.max) || range.min < 0 || range.min > range.max)) errors.push(label+'须填写有效的最小值和最大值');
  };
  const checkCondition=(group,key,label)=>{
    if(geometryConditionEnabled(group,key))check(group[key],label,true);
  };
  if(rules?.captureRange){
    if(!validTemplateCaptureRange(rules.captureRange))errors.push('模板局部模型截取范围无效');
    if(!Array.isArray(rules.segmentDistances)||rules.segmentDistances.length!==template.segments.length||rules.segmentDistances.some(value=>!value||typeof value!=='object')){
      errors.push('距离条件须与焊缝段一一对应');
    }else rules.segmentDistances.forEach((segment,index)=>{
      for(const [key,rule,,label,surface] of segmentProfiles){
        const profile=segment[rule],name='第 '+(index+1)+' 段'+label;
        if(!profile){checkCondition(segment,key,name);continue;}
        if(!geometryConditionEnabled(segment,key,hasDistanceProfile(profile)))continue;
        if(!['continuous','nearest'].includes(profile.mode)||profile.mode==='continuous'&&!Array.isArray(profile.intervals)){
          errors.push(name+'记录方式无效');
        }else if(profile.mode==='nearest')check(profile.nearest,name,true);
        else if(!profile.intervals.length)errors.push(name+'须至少设置一个区间');
        else profile.intervals.forEach((interval,i)=>{
          const intervalName=name+'区间 '+(i+1);
          if(!Number.isFinite(interval?.start)||!Number.isFinite(interval.end)||interval.start<0||interval.end<=interval.start||
            interval.end>template.segments[index].length+.001)errors.push(intervalName+'须填写焊缝段长度内的有效起终点');
          else if(!interval.distance)errors.push(intervalName+'内未找到连续的'+surface);
          else check(interval.distance,intervalName);
        });
      }
    });
  }else checkCondition(rules,'edgeDistance','焊缝边缘距离');
  for (const [key,label] of [['start','起点'],['end','终点']]) {
    const endpoint = rules?.[key] ?? {};
    if (endpoint.type && !ENDPOINT_TYPES.includes(endpoint.type)) errors.push(label+'特征不支持');
    for (const [dimension,name] of ENDPOINT_DIMENSIONS) checkCondition(endpoint,dimension,label+name);
  }
  for (const [index,segment] of template.segments.entries()) {
    if (segment.length >= SHORT_SEGMENT_MM) continue;
    const saved = template.matchParameters?.segments?.[index] ?? segment;
    const max = saved.maxLength ?? shortSegmentRange(segment).maxLength;
    if (max > SHORT_SEGMENT_MM) errors.push(`第 ${index+1} 段匹配长度上限为 30 mm`);
  }
  return errors;
}

export function geometryRuleMismatches(rules,weld,neighborhood) {
  const reasons = [];
  const formatRange=({min,max},format=String)=>min===max?`${format(min)} mm`:`${format(min)}–${format(max)} mm`;
  const report=(label,expected,actual)=>reasons.push(`${label}（模板 ${expected} / 焊道 ${actual}）`);
  const scoped=!!rules.captureRange;
  const missing=scoped?(neighborhood?'截取范围内未命中':'缺少局部几何测量数据'):'未测得';
  const check = (group,key,value,label,format=String) => {
    if(!geometryConditionEnabled(group,key))return;
    const range=group[key];
    if(!range)return;
    if(!Number.isFinite(value)||value<range.min||value>range.max)report(label,formatRange(range,format),Number.isFinite(value)?`${format(value)} mm`:missing);
  };
  const machines=count=>count===1?'单机焊接':count===2?'双机焊接':`${count} 台设备`;
  if (rules.machineCount !== (weld.machineCount ?? 1)) report('焊接方式不一致',machines(rules.machineCount),machines(weld.machineCount??1));
  if (rules.weldType !== weldForm(weld)) report('焊缝形式不一致',rules.weldType,weldForm(weld));
  if(scoped)rules.segmentDistances.forEach((segment,index)=>{
    if(!weld.segments?.[index])return;
    const actual=neighborhood?.segments?.[index];
    for(const [key,rule,evidence,label,surface] of segmentProfiles){
      const profile=segment[rule],measuredProfile=actual?.[evidence],name='第 '+(index+1)+' 段'+label;
      if(!profile){
        check(segment,key,roundEndpointGap(actual?.[key==='edgeDistance'?'edge':'gap']?.distance),name);
        continue;
      }
      if(!geometryConditionEnabled(segment,key,hasDistanceProfile(profile)))continue;
      if(profile.mode==='nearest'){
        check({distance:profile.nearest},'distance',roundEndpointGap(measuredProfile?.nearest?.distance),name);
        continue;
      }
      profile.intervals.forEach(({start,end,distance},i)=>{
        const measured=measureDistanceInterval(measuredProfile,start,end);
        const min=roundEndpointGap(measured?.min),max=roundEndpointGap(measured?.max);
        if(distance&&(!measured||min<distance.min||max>distance.max)){
          report(name+'区间 '+(i+1)+'（沿段 '+start+'–'+end+' mm）',formatRange(distance),
            measured?formatRange({min,max}):measuredProfile?'该区间未找到连续'+surface:missing);
        }
      });
    }
  });
  else check(rules,'edgeDistance',weld.edgeDistance,'焊缝边缘距离');
  for (const [key,label] of [['start','起点'],['end','终点']]) {
    const actual = weld.endpointFacts?.[key] ?? {};
    const expected = rules[key] ?? {};
    const type=endpointType(expected);
    if (type && endpointType(actual) !== type) report(label+'特征不一致',type,endpointType(actual)||'未识别');
    const hole=endpointHoleSize(actual,weld[key+'Hole']);
    const holeRange=expected.holeSize;
    const measuredHole=scoped?(neighborhood?.[key]?.holeSize??(hole===0?0:null)):hole;
    const roundHole=holeRange&&[holeRange.min,holeRange.max].every(value=>roundEndpointGap(value)===value);
    check(expected,'holeSize',roundHole?roundEndpointGap(measuredHole):measuredHole,label+'过焊孔尺寸',roundHole?value=>value.toFixed(1):String);
    const range=expected.gap;
    const oneDecimal=range&&[range.min,range.max].every(value=>roundEndpointGap(value)===value);
    const gap=scoped?neighborhood?.[key]?.gap?.distance:actual.gap;
    check(expected,'gap',oneDecimal?roundEndpointGap(gap):gap,label+'间隙距离');
    check(expected,'edgeDistance',roundEndpointGap(neighborhood?.[key]?.edgeDistance?.distance),label+'边缘距离');
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
