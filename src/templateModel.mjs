import {geometryRuleErrors,geometryRuleMismatches,shortSegmentRange,SHORT_SEGMENT_MM} from './templateGeometryRules.mjs';
import {GROOVE_TYPES,grooveType,grooveValue,validGroove} from './grooveModel.mjs';
import {normalizeLegacyMergeGaps} from './mergeIntersectionGeometry.mjs';
import {directedWeld} from './weldDirectionGeometry.mjs';
import {curveDimensions} from './curveDimensions.mjs';
import { previewPath, previewPoint, samplePath, segmentShape } from './weldPathGeometry.mjs';
import { syncControlPoints, isAnchor } from './templatePointAnchors.mjs';
import {validPassOffsets,resolvePassPoint} from './templatePassOffsets.mjs';
import {ensureLayers} from './templateLayers.mjs';
import {CORNER_SIDES,cornerSide,cornerMeasuredAngle} from './templateCornerAngles.mjs';
import {templateForMatching,matchingParameterShapeErrors} from './templateMatchingParameters.mjs';
import {sampleManualWeldPath,horizontalWeldNormal} from './manualWeldModel.mjs';
export const POSITIONS = ['PA · 平焊', 'PB · 横角焊', 'PC · 横焊', 'PD · 仰角焊', 'PE · 仰焊', 'PF · 立向上焊', 'PG · 立向下焊'];
export const JOINTS = ['T 形接头', '对接接头', '搭接接头', '角接接头', '端接接头'];
export const GEOMETRIES = ['直线', '圆弧', '曲线'];
export const GROOVES = GROOVE_TYPES;
export const TRACKING = ['无跟踪', '电弧跟踪', '激光跟踪'];
export const OVERRIDES = { current: ['电流', 'A', 0.1], voltage: ['电压', 'V', 0.1], speed: ['速度', 'mm/min', 0.1], amplitude: ['摆动幅度', 'mm', 0], frequency: ['摆动频率', 'Hz', 0], dwellLeft: ['左停留', 's', 0], dwellRight: ['右停留', 's', 0] };
export const uid = () => crypto.randomUUID();
export const segment = (source = {}) => ({ position: source.position || POSITIONS[1], joint: source.joint || JOINTS[0], geometry: source.geometry || '直线', length: source.length ?? 100, ...(source.minLength!==undefined?{minLength:source.minLength}:{}),...(source.maxLength!==undefined?{maxLength:source.maxLength}:{}) });
export const point = (kind = 'control', seg = 1, percent = 50, name = '控制点1') => ({ id: uid(), kind, name, segment: seg, percent, ...(kind==='control'?{referenceId:''}:{}), offset: { x: 0, y: 0, z: 0 }, angles: { advance: 0, rotation: 0, work: 45 }, tracking: '无跟踪', overrides: {} });
export const defaultCorner = () => ({ standard: 90, tolerance: 5 });
export const geometryOptions = closure => closure === 'closed' ? ['直线', '曲线', '圆弧'] : ['直线', '曲线'];
export const isModelWholeTemplate = t => t.type==='whole'&&!!t.sourceWeld;
export const segmentLengthTolerance = (t,s) => s.lengthTolerance ?? t.tolerance ?? 10;
export function independentWeldTemplate(template){
  if(template.type!=='whole')return template;
  const {baseProcessId,baseProcessSnapshot,baseProcess,...rest}=template;
  return rest;
}
export const segmentMinLength = (t,s) => s.minLength!==undefined?s.minLength:t.type==='local'?(t.minLength??30):.1;
export const segmentMaxLength = (_t,s) => s.maxLength===undefined?null:s.maxLength;
export function withoutLocalLengthBounds(t){if(t.type!=='local')return t;const {minLength,maxLength,...rest}=t;return {...rest,segments:t.segments.map(({minLength,maxLength,...segment})=>segment)};}
export function reconcileTemplateGeometry(t) {
  t=syncControlPoints(t);
  if(t.closure !== 'closed'||isModelWholeTemplate(t)) return ensureLayers(t);
  const path=previewPath(t.segments,'xy',t.corners,'closed');
  const segments=t.segments.map((s,i)=>{
    const f=path.frames[i];
    if(s.geometry==='圆弧'||t.segments.length===1&&s.geometry==='曲线'||i===t.segments.length-1) return {...s,length:Math.round(f.length*1000)/1000,...(s.geometry==='圆弧'?{shape:{...segmentShape(s,t.segments.length===1),radius:f.radius}}:s.geometry==='曲线'&&s.shape?.chordLength!==undefined?{shape:{...s.shape,chordLength:curveDimensions(f.samples).chordLength}}:{})};
    return s;
  });
  const corners=t.type==='whole'?t.corners:t.corners.map((c,i)=>i===segments.length-2?{...c,standard:Math.round(path.frames[i+1].cornerStandard*100)/100}:c);
  return ensureLayers({...t,segments,corners});
}
export function changeTemplateClosure(t,closure) {
  let next={...t,closure,segments:t.segments.map(s=>closure==='open'&&s.geometry==='圆弧'?{...s,geometry:'曲线',shape:{bend:30,direction:'left'}}:s)};
  if(closure==='closed'&&next.segments.every(s=>s.geometry==='直线')&&next.segments.length<3){next=resizeSegments(next,3);next=resizeCorners(next,2);next.corners=next.corners.map(()=>({standard:60,tolerance:5}));}
  return reconcileTemplateGeometry(next);
}
export function changeTemplateSegment(t,index,values) {
  let next={...t,segments:t.segments.map((s,i)=>i===index?{...s,...values}:s)};
  if(values.shape&&['bend','width','height','radius','arcAngle','chordLength','maxDeviation'].some(k=>values.shape[k]!==undefined&&!Number.isFinite(values.shape[k])))return ensureLayers(syncControlPoints(next));
  if(next.closure==='closed'&&next.segments.every(s=>s.geometry==='直线')&&next.segments.length<3) return changeTemplateClosure(next,'closed');
  const s=next.segments[index];
  if(s.geometry==='圆弧'){
    const shape=segmentShape(s,next.segments.length===1),length=shape.radius*shape.arcAngle*Math.PI/180;
    next.segments[index]={...s,shape,length};
  }
  return reconcileTemplateGeometry(next);
}
export function changeCurveDimensions(t,index,values){
  const segment=t.segments[index];if(segment.geometry!=='曲线'||segment.pathPoints?.length)return t;
  const single=t.closure==='closed'&&t.segments.length===1,closing=t.closure==='closed'&&index===t.segments.length-1&&!single;
  const frame=previewPath(t.segments,'xy',t.corners,t.closure).frames[index],measured=curveDimensions(frame.samples);
  const shape={...segmentShape(segment,single),chordLength:measured.chordLength,maxDeviation:measured.maxDeviation,...values};
  if(single){shape.chordLength=0;if(Number.isFinite(shape.maxDeviation)&&shape.maxDeviation>0&&measured.maxDeviation>0){const ratio=shape.maxDeviation/measured.maxDeviation;shape.width*=ratio;shape.height*=ratio;}}
  if(closing)shape.chordLength=measured.chordLength;
  const next=changeTemplateSegment(t,index,{shape});
  if(Number.isFinite(shape.chordLength)&&Number.isFinite(shape.maxDeviation)&&shape.maxDeviation>=0){const length=previewPath(next.segments,'xy',next.corners,next.closure).frames[index].length;return {...next,segments:next.segments.map((s,i)=>i===index?{...s,length}:s)};}
  return next;
}
export function deleteTemplateCorner(t,index) {
  if(index<0||index>=t.corners.length)return t;
  return reconcileTemplateGeometry({...t,cornerCount:t.cornerCount-1,corners:t.corners.filter((_,i)=>i!==index)});
}
export function resizeCorners(t, count) {
  return { ...t, cornerCount: count, corners: Array.from({ length: count }, (_, i) => t.corners?.[i] ? { ...t.corners[i] } : defaultCorner()) };
}
export function addTemplateCorner(t) {
  const max = t.type === 'local' ? 3 : 30;
  if (t.cornerCount >= max - 1) return t;
  const count = t.cornerCount + 1;
  return reconcileTemplateGeometry(resizeCorners(t.segments.length < count + 1 ? resizeSegments(t, count + 1) : t, count));
}
export function newTemplate(type = 'whole', source = {}) {
  const segments = source.segments?.length ? source.segments.map(s => segment(s)) : type === 'local' ? [segment(source), segment(source)] : [segment(source)];
  const cornerCount = type === 'local' ? segments.length - 1 : 0;
  const closure=source.closure|| (segments.some(s=>s.geometry==='圆弧')?'closed':'open');
  const result=syncControlPoints({ ...(type==='local'?{localControlPointsVersion:1,baseProcessId:''}:{}), id: uid(), name: '', type, closure, mode: 'standard', leg: source.leg ?? 6, cornerCount, corners: Array.from({ length: cornerCount }, defaultCorner), segments, groove: { type: '无坡口', angle: 0, depth: 0 }, startHole: false, endHole: false, tolerance: 10, points: [point('start', 1, 0, '起点'), point('end', segments.length, 100, '终点')], current: source.current ?? 210, voltage: source.voltage ?? 24.5, speed: source.speed ?? 340, joint: segments[0].joint, position: segments[0].position });
  return closure==='closed'?changeTemplateClosure(withoutLocalLengthBounds(result),'closed'):ensureLayers(withoutLocalLengthBounds(result));
}
export function wholeWeldSourceIssues(model,weld) {
  if(typeof model!=='string'||!model.trim())return ['请先加载模型并提取焊道'];
  if(!weld)return ['请先提取焊道或选择已有焊道'];
  const issues=[];
  if(typeof weld.id!=='string'||!weld.id.trim()||typeof weld.name!=='string')issues.push('所选焊道缺少有效编号或名称');
  if(weld.completeStart!==true||weld.completeEnd!==true)issues.push('所选焊道必须具有完整起点和终点');
  if(!Array.isArray(weld.segments)||!weld.segments.length||weld.segments.length>30)issues.push('所选焊道缺少有效的焊缝段数据');
  else if(!weld.segments.every(s=>s&&POSITIONS.includes(s.position)&&JOINTS.includes(s.joint)&&geometryOptions(weld.closure).includes(s.geometry)&&Number.isFinite(s.length)&&s.length>=.1))issues.push('请完善所选焊道各段的焊接位置、接头、几何类型和长度');
  if(!['open','closed'].includes(weld.closure))issues.push('所选焊道缺少开放／闭合属性');
  if(!Number.isFinite(weld.leg)||weld.leg<.5||!Number.isInteger(weld.leg*2))issues.push('所选焊道缺少有效焊脚，步长应为 0.5 mm');
  if(!Array.isArray(weld.cornerAngles)||weld.cornerAngles.length>(weld.segments?.length||0)-1||!weld.cornerAngles.every(a=>Number.isFinite(a)&&a>=0&&a<=360))issues.push('所选焊道缺少有效转角数据');
  if(!validGroove(weld.groove))issues.push('所选焊道缺少有效坡口数据');
  if(typeof weld.startHole!=='boolean'||typeof weld.endHole!=='boolean')issues.push('所选焊道缺少起点或终点过焊孔信息');
  if(weld.closure==='closed'&&Array.isArray(weld.segments)&&weld.segments.every(s=>s?.geometry==='直线')&&weld.segments.length<3)issues.push('闭合直线焊道至少需要三段');
  return issues;
}
export function newWholeTemplateFromWeld(model,welds,weldId,copy) {
  const original=welds.find(w=>w.id===weldId),issues=wholeWeldSourceIssues(model,original);
  if(issues.length)throw Error(issues.join('；'));
  const weld=targetFromWeld(original);
  if(weld.cornerDirections?.some(c=>c.reason))throw Error('所选焊道路径几何无效');
  const t={...newTemplate('whole'),name:copy?`${copy.name.slice(0,72)} · 副本`:'',sourceWeld:{model,id:weld.id,name:weld.name},...(weld.cornerReferenceNormal?{cornerReferenceNormal:structuredClone(weld.cornerReferenceNormal)}:{}),closure:weld.closure,leg:weld.leg,mode:'exact',segments:weld.segments.map(s=>({...structuredClone(s),lengthTolerance:10})),cornerCount:weld.cornerAngles.length,corners:weld.cornerAngles.map((standard,i)=>({standard,tolerance:5,angleSide:weld.cornerDirections?.[i]?.angleSide==='outer'?'outer':standard>180?'outer':'inner'})),groove:structuredClone(weld.groove),startHole:weld.startHole,endHole:weld.endHole};
  t.joint=t.segments[0].joint;t.position=t.segments[0].position;
  if(copy){t.points=structuredClone(copy.points);t.layers=structuredClone(copy.layers);}
  return independentWeldTemplate(ensureLayers(syncControlPoints(t)));
}
export function migrateTemplate(t) {
  if (t.type) {
    const { angleMin, angleMax, ...result } = structuredClone(t);
    if (result.corners === undefined) {
      const standard = ((angleMin ?? 0) + (angleMax ?? 180)) / 2;
      const tolerance = ((angleMax ?? 180) - (angleMin ?? 0)) / 2;
      result.corners = Array.from({ length: result.cornerCount }, () => ({ standard, tolerance }));
    }
    if(result.closure===undefined) result.closure=result.segments.some(s=>s.geometry==='圆弧')?'closed':'open';
    if(result.type==='whole')result.segments=result.segments.map(s=>({...s,lengthTolerance:s.lengthTolerance??result.tolerance??10}));
    return ensureLayers(syncControlPoints(result,true));
  }
  const result = { ...newTemplate('whole', t), ...t };
  result.segments=result.segments.map(s=>({...s,lengthTolerance:s.lengthTolerance??result.tolerance??10}));
  result.points.forEach(p => { p.overrides = { current: t.current, voltage: t.voltage, speed: t.speed }; });
  return ensureLayers(syncControlPoints(result,true));
}
export function migrateDraft(v) { return { ...v, processLibrary:v.processLibrary??[], processDeviceProfiles:v.processDeviceProfiles??[], welds: v.welds?.map(w => v.model === '肋板组件 A' ? { ...w, completeStart:w.completeStart??true,completeEnd:w.completeEnd??true,closure:w.closure??'open',segments:w.segments??[segment(w)],cornerAngles:w.cornerAngles??[],groove:w.groove??{type:'无坡口',angle:0,depth:0},startHole:w.startHole??false,endHole:w.endHole??false } : normalizeLegacyMergeGaps(w)), templates: v.templates.map(migrateTemplate), fixedTemplates: (v.fixedTemplates || []).map(f=>{
  const migratePoints=points=>syncControlPoints({type:'local',segments:Array.from({length:f.segmentCount},()=>segment()),points},true,true).points.map(({id,kind,name,segment,percent,referenceId,location,anchorRole,autoRole})=>({id,kind,name,segment,percent,...(anchorRole?{anchorRole}:{}),...(autoRole?{autoRole}:{}),...(referenceId!==undefined?{referenceId}:{}),...(location?{location}: {})}));
  return {...f,...(f.definition?{definition:migrateTemplate(f.definition)}:{}),points:migratePoints(f.points),...(f.layers?{layers:f.layers.map(l=>({...l,passes:l.passes.map(p=>({...p,points:migratePoints(p.points)}))}))}:{})};
}) }; }
export function resizeSegments(t, count) {
  return ensureLayers(syncControlPoints({ ...resizeCorners(t, Math.min(t.cornerCount, count - 1)), segments: Array.from({ length: count }, (_, i) => t.segments[i] || segment()), points: t.points }));
}
const finite = (v, min = -Infinity, max = Infinity) => Number.isFinite(v) && v >= min && v <= max;
export function validatePoints(points, count, layoutOnly = false, type) {
  const errors = [];
  if (!Array.isArray(points) || points.length > 500) return ['最多允许 500 个点位'];
  if (new Set(points.map(p => p.id)).size !== points.length) errors.push('点位编号不能重复');
  const local=type==='local'||type===undefined&&points.some(p=>p.anchorRole!==undefined);
  if(local){
    if(points.some(p=>['start','end'].includes(p.kind)||['leading','trailing'].includes(p.anchorRole))||points.filter(p=>p.kind==='junction').length!==count-1||Array.from({length:count-1},(_,i)=>i+1).some(i=>points.filter(p=>p.kind==='junction'&&p.segment===i&&p.percent===100).length!==1))errors.push('局部模板仅在相邻焊缝段之间保留自动段连接点，首尾不设置');
  }else{
    if (points.filter(p => p.kind === 'start').length !== 1 || points.filter(p => p.kind === 'end').length !== 1) errors.push('必须保留唯一的起点和终点');
    if(points.filter(p=>p.kind==='junction').length!==count-1||Array.from({length:count-1},(_,i)=>i+1).some(i=>points.filter(p=>p.kind==='junction'&&p.segment===i&&p.percent===100).length!==1))errors.push('每个焊缝段连接位置需要一个自动段连接点');
  }
  if(points.some(p=>p.kind==='midpoint'&&(type==='whole'||count!==3||p.segment!==2||p.percent!==50))||points.filter(p=>p.kind==='midpoint').length>1)errors.push('中间段中间点仅用于三段局部模板的第二段50%位置');
  for (const p of points) {
    if((p.kind==='control'||p.referenceId!==undefined)&&!points.some(a=>isAnchor(a)&&a.id===p.referenceId))errors.push(`${p.name||'人工控制点'}：请选择有效基准点`);
    {const seen=new Set([p.id]);let ref=p;while(ref?.referenceId&&ref.referenceId!==ref.id){if(seen.has(ref.referenceId)){errors.push('控制点参考点不能循环引用');break;}seen.add(ref.referenceId);ref=points.find(a=>a.id===ref.referenceId);}}
    if(p.location?.along!==undefined&&!finite(p.location.along))errors.push('点位沿焊道位置无效');
    if (p.location !== undefined && (!p.location || !['normal', 'height'].every(k => finite(p.location[k])))) errors.push('点位骨架的垂直位置或高度无效');
    if (!p.name?.trim() || !['start', 'end', 'junction', 'midpoint', 'control'].includes(p.kind) || !Number.isInteger(p.segment) || !finite(p.segment, 1, count) || !finite(p.percent, 0, 100)) errors.push('点位名称、所属段或位置无效');
    if (p.kind === 'start' && (p.segment !== 1 || p.percent !== 0) || p.kind === 'end' && (p.segment !== count || p.percent !== 100)) errors.push('起点和终点必须位于模板两端');
    if (!layoutOnly && (!p.offset || !p.angles || !['x', 'y', 'z'].every(k => finite(p.offset[k])) || !['advance', 'rotation', 'work'].every(k => finite(p.angles[k], -360, 360)) || !TRACKING.includes(p.tracking))) errors.push('点位偏移、姿态或跟踪模式无效');
    if (!layoutOnly && (!p.overrides || Object.entries(p.overrides).some(([k, v]) => !OVERRIDES[k] || !finite(v, OVERRIDES[k][2])))) errors.push('工艺覆盖参数无效');
  }
  return [...new Set(errors)];
}
export function validateTemplate(t) {
  if (!t || !Array.isArray(t.segments)) return ['模板结构不正确'];
  const e = [], n = t.segments.length;
  if(t.matchParameters!==undefined){const shapeErrors=matchingParameterShapeErrors(t);e.push(...shapeErrors);if(!shapeErrors.length)e.push(...validateTemplate(templateForMatching(t)).map(error=>'匹配参数：'+error));}
  if(t.localControlPointsVersion!==undefined&&t.localControlPointsVersion!==1)e.push('局部工艺控制点版本无效');
  if(t.type==='local'&&t.localControlPointsVersion===1){for(const points of [t.points,...(t.layers||[]).flatMap(l=>(l.passes||[]).map(p=>p.points))]){if(!Array.isArray(points))continue;if(n>=2&&['before','after'].some(role=>points.filter(p=>p.kind==='control'&&p.autoRole===role).length!==1))e.push('局部模板需要连接点前、后各一个初始工艺控制点');if(points.filter(p=>p.kind==='midpoint').length!==(n===3?1:0))e.push('三段局部模板需要中间段中间点');}}
  if(t.enabled!==undefined&&typeof t.enabled!=='boolean')e.push('模板启用状态无效');
  if(t.baseProcessId!==undefined&&typeof t.baseProcessId!=='string')e.push('基础工艺编号无效');
  if(t.localConditionsVersion!==undefined&&t.localConditionsVersion!==1)e.push('局部模板匹配条件版本无效');
  if(t.type==='local'&&t.localConditionsVersion===1&&!t.baseProcessId)e.push('局部模板必须挂载已有的工艺参数方案，请选择方案以带入焊脚');
  if (typeof t.id !== 'string' || !t.name?.trim() || t.name.length > 80) e.push('请输入 1–80 字模板名称');
  if (!['whole', 'local'].includes(t.type) || n < 1 || n > (t.type === 'local' ? 3 : 30)) e.push('局部模板最多 3 段，焊缝模板最多 30 段');
  if(!['open','closed'].includes(t.closure)) e.push('请选择开放或闭合');
  if (!finite(t.leg, 0.5) || !Number.isInteger(t.leg * 2)) e.push('焊脚必须为正数，步长 0.5 mm');
  if (!Number.isInteger(t.cornerCount) || !finite(t.cornerCount, 0, n - 1)) e.push('转角数量必须为 0 到 n−1 的整数');
  if (!Array.isArray(t.corners) || t.corners.length !== t.cornerCount) e.push('每个转角需要一组标准角度与角度容差');
  else t.corners.forEach((c,i)=>{if(c?.angleSide!==undefined&&!Object.hasOwn(CORNER_SIDES,c.angleSide))e.push(`转角 ${i+1} 请选择内角或外角`);if(c?.pathStandard!==undefined&&!finite(c.pathStandard,0,360))e.push(`转角 ${i+1} 形状角度无效`);});
  if(Array.isArray(t.corners))t.corners.forEach((c, i) => { if (!c || !finite(c.standard, 0, 360) || !finite(c.tolerance, 0, 360)) e.push(`转角 ${i + 1} 的标准角度与角度容差必须在 0–360°之间`); });
  if (!['standard', 'exact'].includes(t.mode) || !finite(t.tolerance, 0)) e.push('匹配模式或长度误差无效');
  if(t.type==='whole')t.segments.forEach((s,i)=>{if(!finite(segmentLengthTolerance(t,s),0))e.push(`第 ${i+1} 段长度容差必须为大于等于 0 的数值`);});
  if(t.sourceWeld&&(!isModelWholeTemplate(t)||!t.sourceWeld.model?.trim()||!t.sourceWeld.id?.trim()||typeof t.sourceWeld.name!=='string'))e.push('焊缝模板的来源焊道信息无效');
  if (!t.segments.every(s => POSITIONS.includes(s.position) && JOINTS.includes(s.joint) && GEOMETRIES.includes(s.geometry) && finite(s.length, 0.1))) e.push('请完善每段的焊接位置、接头类型、几何类型和正数长度');
  if(!t.segments.every(s=>geometryOptions(t.closure).includes(s.geometry)))e.push('开放焊道仅支持直线、曲线；圆弧仅可用于闭合焊道');
  t.segments.forEach((s,i)=>{const shape=segmentShape(s,t.closure==='closed'&&n===1);if(s.geometry!=='直线'&&(!['left','right'].includes(shape.direction)||!finite(shape.bend,0,100)||!finite(shape.width,.1)||!finite(shape.height,.1)))e.push(`第 ${i+1} 段形状参数无效`);if(s.geometry==='圆弧'&&(!finite(shape.radius,.1)||!finite(shape.arcAngle,1,360)))e.push(`第 ${i+1} 段圆弧半径或角度无效`);});
  t.segments.forEach((s,i)=>{if(s.shape&&[['bend',0,100],['width',.1,1e6],['height',.1,1e6],['radius',.1,1e6],['arcAngle',1,360]].some(([k,min,max])=>s.shape[k]!==undefined&&!finite(s.shape[k],min,max)))e.push(`第 ${i+1} 段形状参数需填写有效数值`);});
  t.segments.forEach((s,i)=>{if(s.geometry==='曲线'&&s.shape){if(s.shape.chordLength!==undefined&&!finite(s.shape.chordLength,t.closure==='closed'&&n===1?0:.1))e.push(`第 ${i+1} 段弦长无效`);if(s.shape.maxDeviation!==undefined&&!finite(s.shape.maxDeviation,t.closure==='closed'&&n===1?.1:0))e.push(`第 ${i+1} 段最大偏离距离无效`);}});
  if(t.closure==='closed'&&t.segments.every(s=>s.geometry==='直线')&&n<3)e.push('闭合直线轮廓至少需要三段');
  if (!validGroove(t.groove)) e.push('坡口参数无效');
  if (typeof t.startHole !== 'boolean' || typeof t.endHole !== 'boolean') e.push('过焊孔条件无效');
  if(t.type==='whole')t.segments.forEach((s,i)=>{const min=segmentMinLength(t,s),max=segmentMaxLength(t,s);if(!finite(min,.1))e.push(`第 ${i+1} 段适用最小长度必须大于等于0.1 mm`);if(max!==null&&!finite(max,.1))e.push(`第 ${i+1} 段适用最大长度必须大于等于0.1 mm，或留空表示不限`);if(finite(min,.1)&&finite(max,.1)&&max<min)e.push(`第 ${i+1} 段适用最大长度不能小于最小长度`);});
  if(!Array.isArray(t.layers)||!t.layers.length)e.push('请至少设置一层一道');
  else {
    if(new Set(t.layers.map(l=>l.id)).size!==t.layers.length)e.push('层编号不能重复');
    for(const l of t.layers){if(!l.name?.trim()||!finite(l.height)||!Array.isArray(l.passes)||!l.passes.length){e.push('每层需要名称、高度和至少一道');continue;}
      if(new Set(l.passes.map(p=>p.id)).size!==l.passes.length)e.push('焊道编号不能重复');
      for(const p of l.passes){if(!p.name?.trim()||!validPassOffsets(p.offset))e.push(`${l.name}：焊道名称或偏移无效`);e.push(...validatePoints(p.points,n,false,t.type).map(error=>`${l.name}/${p.name}：${error}`));}
    }
  }
  return [...e, ...validatePoints(t.points, n,false,t.type)];
}
export function fixedLayout(t) {
  const ids=new Map(t.points.map(p=>[p.id,uid()]));
  return { id: uid(), name: t.name.trim(), segmentCount: t.segments.length, points: t.points.map(({id, kind, name, segment, percent, location,referenceId,anchorRole,autoRole }) => ({ id: ids.get(id), kind, name, segment, percent,...(anchorRole?{anchorRole}:{}),...(autoRole?{autoRole}:{}), ...(referenceId!==undefined?{referenceId:ids.get(referenceId)||''}:{}), ...(location ? { location: structuredClone(location) } : {}) })) };
}
export function validateFixed(f) {
  if(!f||typeof f.id!=='string'||!f.name?.trim()||f.name.length>80||!Number.isInteger(f.segmentCount)||!finite(f.segmentCount,1,3))return ['固定模板结构无效'];
  const issues=validatePoints(f.points,f.segmentCount,true,'local');
  if(f.definition){if(f.definition.type!=='local'||f.definition.id!==f.id||f.definition.name!==f.name||f.definition.segments?.length!==f.segmentCount)issues.push('固定模板编辑内容与点位骨架不一致');issues.push(...validateTemplate(f.definition));}
  if(f.layers!==undefined){if(!Array.isArray(f.layers)||!f.layers.length)issues.push('固定模板至少需要一层一道');else for(const l of f.layers){if(!l.name?.trim()||!finite(l.height)||!Array.isArray(l.passes)||!l.passes.length){issues.push('固定模板层道位置无效');continue;}for(const p of l.passes){if(!validPassOffsets(p.offset))issues.push('固定模板焊道偏移无效');issues.push(...validatePoints(p.points,f.segmentCount,true,'local'));}}}
  return [...new Set(issues)];
}
export function reuseLayout(t, f) {
  let resized = resizeSegments(t, f.segmentCount);
  if(f.definition){
    const source=f.definition;
    const segments=resized.segments.map((s,i)=>{const original=source.segments[i],next={...s,geometry:original.geometry,length:original.length};for(const key of ['shape','pathPoints','edgeId','part']){if(original[key]!==undefined)next[key]=structuredClone(original[key]);else delete next[key];}return next;});
    resized={...resized,closure:source.closure,segments,cornerCount:source.cornerCount,corners:structuredClone(source.corners)};
  }
  resized.reusedFromFixed={id:f.id,name:f.name};
  function positions(points){const ids=new Map(points.map(p=>[p.id,uid()]));return points.map(p=>({...point(p.kind,p.segment,p.percent,p.name),id:ids.get(p.id),...(p.anchorRole?{anchorRole:p.anchorRole}:{}),...(p.autoRole?{autoRole:p.autoRole}:{}),...(p.referenceId!==undefined?{referenceId:ids.get(p.referenceId)||''}:{}),offset:{x:p.location?.along||0,y:p.location?.normal||0,z:p.location?.height||0}}));}
  if(f.layers){const layers=f.layers.map(l=>({id:uid(),name:l.name,height:l.height,passes:l.passes.map(p=>({id:uid(),name:p.name,offset:structuredClone(p.offset),points:positions(p.points)}))}));return ensureLayers(syncControlPoints({...resized,layers,points:layers[0].passes[0].points}));}
  return ensureLayers(syncControlPoints({...resized,points:positions(f.points)}));
}
export function targetFromWeld(w) {
  if (!w) return null;
  w=directedWeld(w);
  return { ...w, closure:w.closure||(w.closed===true?'closed':'open'), segments: w.segments || [segment(w)], cornerAngles: w.cornerAngles || [], completeStart: w.completeStart === true, completeEnd: w.completeEnd === true, atConnection: w.atConnection === true, groove: w.groove || { type: '无坡口', angle: 0, depth: 0 }, startHole: w.startHole ?? false, endHole: w.endHole ?? false };
}
export function matchTemplate(t, target, options={}) {
  if(t.enabled===false)return {ok:false,reasons:['模板已停用，不参与匹配']};
  if (!target) return { ok: false, reasons: ['请先加载模型并选择焊道'] };
  target=directedWeld(target);
  const invalid=[...validateTemplate(t),...geometryRuleErrors(t)];if(invalid.length)return {ok:false,reasons:invalid.map(v=>'模板参数无效：'+v)};
  const shortOnly=options.planningRevision===3||!!t.requirementsMatch||t.shortSegmentMatch===true;
  const hasShortRanges=!!t.requirementsMatch||t.shortSegmentMatch===true;
  t=templateForMatching(t);
  const reasons = t.requirementsMatch?geometryRuleMismatches(t.requirementsMatch,target):[], n = t.segments?.length, value=v=>v===undefined||v===null||v===''?'未提供':String(v);
  const compare=(label,expected,actual,unit='')=>reasons.push(`${label}不一致（模板 ${value(expected)}${unit} / 焊道 ${value(actual)}${unit}）`);
  if((target.closure||'open')!==t.closure)compare('开放／闭合属性',t.closure==='closed'?'闭合':'开放',target.closure==='closed'?'闭合':'开放');
  if (t.type === 'whole' && (!target.completeStart || !target.completeEnd)) reasons.push(`焊缝模板要求完整的起点、终点（缺少${[!target.completeStart?'完整起点':'',!target.completeEnd?'完整终点':''].filter(Boolean).join('、')}）`);
  if (target.leg !== t.leg) compare('焊脚',t.leg,target.leg,' mm');
  if (target.segments?.length !== n) compare('焊缝段数量',n,target.segments?.length,' 段');
  if (!Array.isArray(target.cornerAngles) || target.cornerAngles.length !== t.cornerCount) compare('转角数量',t.cornerCount,target.cornerAngles?.length,' 个');
  else target.cornerAngles.forEach((a, i) => {
    const c=t.corners[i],side=cornerSide(c),actual=target.cornerDirections?.[i],measured=cornerMeasuredAngle(a);
    if(actual?.reason){reasons.push(`转角 ${i+1} 无法判定内角/外角：${actual.reason}`);return;}
    if(actual?.angleSide&&actual.angleSide!=='straight'&&actual.angleSide!==side)reasons.push(`转角 ${i+1} 转向类型不一致（模板 ${CORNER_SIDES[side]} / 焊道 ${CORNER_SIDES[actual.angleSide]}，沿焊接方向${actual.angleSide==='inner'?'左转':'右转'}）`);
    if (!finite(a,0,360)||Math.abs(measured-c.standard)>c.tolerance+1e-9)reasons.push(`转角 ${i+1} 超出 ${c.standard}° ±${c.tolerance}°（${CORNER_SIDES[side]}；焊道 ${value(Number.isFinite(measured)?Math.round(measured*10000)/10000:a)}°）`);
  });
  t.segments.forEach((s, i) => {
    const other = target.segments?.[i];if (!other) return;
    for (const [key, label] of [['position', '焊接位置'], ['joint', '接头类型'], ['geometry', '几何类型']]) if (s[key] !== other[key]) compare(`第 ${i + 1} 段${label}`,s[key],other[key]);
    if(t.type==='local'&&!finite(other.length,.1))reasons.push(`第 ${i+1} 段焊接长度必须为大于等于0.1 mm的有效数值`);
    if(shortOnly&&s.length>=SHORT_SEGMENT_MM)return;
    const range=shortOnly?shortSegmentRange(s):null;
    const min=shortOnly?(hasShortRanges?s.minLength??range.minLength:range.minLength):t.type==='local'?.1:segmentMinLength(t,s),max=shortOnly?(hasShortRanges?s.maxLength??range.maxLength:range.maxLength):t.type==='local'?null:segmentMaxLength(t,s);
    if(!finite(other.length,min-1e-9))reasons.push(`第 ${i+1} 段小于最小长度（模板至少 ${min} mm / 焊道 ${value(other.length)} mm）`);
    if(max!==null&&finite(other.length)&&other.length>max+1e-9)reasons.push(`第 ${i+1} 段大于最大长度（模板至多 ${max} mm / 焊道 ${value(other.length)} mm）`);
    if (!shortOnly && t.type === 'whole' && t.mode === 'exact' && (!finite(other.length) || Math.abs(s.length - other.length) > segmentLengthTolerance(t,s)+1e-9)) reasons.push(`第 ${i + 1} 段长度超出 ±${segmentLengthTolerance(t,s)} mm（模板 ${s.length} mm / 焊道 ${value(other.length)} mm）`);
  });
  if (!target.groove || grooveType(target.groove.type) !== grooveType(t.groove.type))compare('坡口类型',t.groove.type,target.groove?.type);
  else if(t.groove.type!=='无坡口'){
    if(grooveType(t.groove.type)!=='I 形'&&target.groove.angle!==t.groove.angle)compare('坡口角度',t.groove.angle,target.groove.angle,'°');
    if(target.groove.depth!==t.groove.depth)compare('坡口深度',t.groove.depth,target.groove.depth,' mm');
    for(const [key,label] of [['rootGap','根部间隙'],['rootRadius','根部半径'],['rootFace','钝边长度']])if(grooveValue(target.groove,key)!==grooveValue(t.groove,key))compare(label,grooveValue(t.groove,key),grooveValue(target.groove,key),' mm');
  }
  if (t.type === 'whole')for(const [key,label] of [['startHole','起点过焊孔'],['endHole','终点过焊孔']])if(target[key]!==t[key])compare(label,t[key]?'有':'无',typeof target[key]==='boolean'?target[key]?'有':'无':'未提供');
  return { ok: reasons.length === 0, reasons };
}
export function applyTemplateToWeld(w, t, options={}) {
  const target = targetFromWeld(w), match = matchTemplate(t, target, options);
  if (!match.ok) throw new Error(match.reasons.join('；'));
  const previewTarget={...target,segments:target.segments.map((s,i)=>({...s,shape:s.shape||t.segments[i].shape})),corners:t.corners};
  const path=previewPath(previewTarget.segments,'xy',t.corners,t.closure);
  const layers=t.layers.map(layer=>({...structuredClone(layer),passes:layer.passes.map(pass=>({...structuredClone(pass),controlPoints:pass.points.map(p=>{
    const resolved=resolvePassPoint(previewTarget,p,pass.points,pass.offset,layer.height,path);
    return {...structuredClone(p),angles:resolved.angles,distance:resolved.distance,actualSegment:resolved.actualSegment,originalSegment:(target.sourceSegmentIndices?.[resolved.actualSegment-1]??resolved.actualSegment-1)+1,position:{x:resolved.position[0],y:resolved.position[1],z:resolved.position[2]}};
  }).sort((a,b)=>a.distance-b.distance)}))}));
  const controlPoints=layers[0].passes[0].controlPoints;
  return { ...w, template: t.name, templateId: t.id, controlPoints,layers, planned: false };
}
