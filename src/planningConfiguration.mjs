export const WORKPIECE_TYPES=['小组立','中组立','护板'];
export const L_WRAP_DISTANCES=[['1/2','1/2板厚'],['2/3','2/3板厚']];
export const INTERFERENCE_END_FIELDS=[['startDistance','起点变姿态距离','mm'],['endDistance','终点变姿态距离','mm']];
export const INTERFERENCE_POSE_AXES=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
export function interferenceEndValues(value={}){return {...value,...Object.fromEntries(INTERFERENCE_END_FIELDS.map(([key])=>[key,value[key]??''])),...Object.fromEntries(['startPose','endPose'].map(key=>[key,Object.fromEntries(INTERFERENCE_POSE_AXES.map(([axis])=>[axis,value[key]?.[axis]??'']))]))};}
export const SAMPLING_AXES=[['advance','前进角',20,-45,45],['work','工作角',45,-40,50],['rotation','旋转角',0,-80,80]];
export function samplingAvoidanceValues(value={}){return {...value,autoDeleteUnavoidable:value.autoDeleteUnavoidable??false,...Object.fromEntries(SAMPLING_AXES.map(([key,,,min,max])=>[key,{enabled:true,min,max,...value[key]}]))};}
export function trackingParameterValues(value={}){return {laserEnabled:true,arcEnabled:true,minLineLength:160,minArcDiameter:160,...value};}
const filled=value=>value!==null&&value!==undefined&&value!=='';
const hasRange=value=>'angleMin' in value||'angleMax' in value;
export function wrapParameterErrors(value={}){
 const errors=[];
 for(const [key,label] of [['flatEnabled','平角焊包角'],['verticalEnabled','立角焊包角']])if(value[key]!==undefined&&typeof value[key]!=='boolean')errors.push(`${label}启用状态无效`);
 if(filled(value.independentLength)&&(!Number.isFinite(value.independentLength)||value.independentLength<=0))errors.push('独立焊缝长度应大于0 mm');
 if(filled(value.lDistanceRatio)&&!L_WRAP_DISTANCES.some(([ratio])=>ratio===value.lDistanceRatio))errors.push('L形包角距离请选择1/2板厚或2/3板厚');
 for(const [key,label] of [['advance','前进角'],['work','工作角'],['rotation','旋转角']]){
  const angle=value.uPose?.[key];
  if(filled(angle)&&(!Number.isFinite(angle)||angle < -360||angle>360))errors.push(`U形控制姿态${label}应为-360–360°`);
 }
 return errors;
}
export function mergeAngleRange(value={}){
 if(hasRange(value))return {angleMin:value.angleMin??'',angleMax:value.angleMax??''};
 return Number.isFinite(value.angle)?{angleMin:0,angleMax:value.angle}:{angleMin:'',angleMax:''};
}
export function mergeParameterErrors(value={}){
 const errors=[];
 if(value.lengthEnabled!==false&&filled(value.maxLength)&&(!Number.isFinite(value.maxLength)||value.maxLength<=0))errors.push('合并长度应为大于0的有效数值');
 if(filled(value.passHoleSize)&&(!Number.isFinite(value.passHoleSize)||value.passHoleSize<0))errors.push('合并过焊孔尺寸应为非负数');
 if(hasRange(value)){
  const min=filled(value.angleMin),max=filled(value.angleMax);
  if(min!==max)errors.push('请同时填写最小合并角度和最大合并角度');
  if([value.angleMin,value.angleMax].some(v=>filled(v)&&(!Number.isFinite(v)||v<0||v>(value.rulesVersion===2?360:180))))errors.push(value.rulesVersion===2?'合并角度应为0–360°':'合并角度应为0–180°');
  if(min&&max&&Number.isFinite(value.angleMin)&&Number.isFinite(value.angleMax)&&value.angleMin>value.angleMax)errors.push('最小合并角度不能大于最大合并角度');
 }else if(filled(value.angle)&&(!Number.isFinite(value.angle)||value.angle<0||value.angle>180))errors.push('合并角度应为0–180°');
 if(value.countEnabled!==false&&value.count!==null&&value.count!==undefined&&value.count!==''&&(!Number.isInteger(value.count)||value.count<2||value.rulesVersion!==2&&value.count>30))errors.push(value.rulesVersion===2?'合并数量应为不小于2的整数':'合并个数应为2–30的整数');
 if(value.countEnabled===true&&!filled(value.count))errors.push('请输入合并数量');
 return errors;
}
export function geometryOptionsForPlanning(defaults,settings={}){
 const options=structuredClone(defaults),merge=settings.mergeParameters||{};
 const errors=planningSettingsErrors(settings);if(errors.length)throw Error(errors.join('；'));
 const range=mergeAngleRange(merge);
 if(Number.isFinite(range.angleMin)&&Number.isFinite(range.angleMax)){const lower=merge.angleDefinition==='included'?range.angleMin:180-range.angleMax,upper=merge.angleDefinition==='included'?range.angleMax:180-range.angleMin;options.mergeParams.夹角阈值下限=Math.min(180,Math.max(0,lower));options.mergeParams.夹角阈值上限=Math.min(180,Math.max(0,upper));if(lower>180||upper<0)options.automaticMerge=false;}
 if(merge.countEnabled!==false&&Number.isInteger(merge.count))options.maxMergeCount=merge.count;
 if(merge.lengthEnabled!==false&&Number.isFinite(merge.maxLength))options.maxMergeLength=merge.maxLength;
 if(merge.enabled!==undefined&&options.automaticMerge!==false)options.automaticMerge=merge.enabled;
 if(merge.continuousOnly)options.continuousOnly=true;
 if(merge.position)options.mergePosition=merge.position;
 if(Number.isFinite(merge.passHoleSize)){options.mergePassHoleSize=merge.passHoleSize;if(merge.passHoleInclusive===false)options.mergePassHoleInclusive=false;options.mergeParams.最长通过距离=merge.passHoleSize;options.mergeParams.最小通过高度=merge.passHoleSize;}
 if(settings.wrapParameters){options.wrapParameters=structuredClone(settings.wrapParameters);options.wrapDistanceRatio=settings.wrapParameters.lDistanceRatio==='1/2'?.5:2/3;}
 if(settings.planningRevision===3)options.planningRevision=3;
 if(settings.splitParameters)options.splitParameters=structuredClone(settings.splitParameters);
 if(Number.isFinite(settings.splitParameters?.gapThreshold)){options.offsetThreshold=settings.splitParameters.gapThreshold;options.offset=Math.max(options.offset,settings.splitParameters.gapThreshold);}
 if(settings.intermittentParameters)options.intermittentParameters={...structuredClone(settings.intermittentParameters),position:'PB'};
 if(settings.interferenceEndParameters)options.interferenceEndParameters=structuredClone(settings.interferenceEndParameters);
 if(settings.samplingAvoidance)options.samplingAvoidance=structuredClone(settings.samplingAvoidance);
 if(settings.trackingParameters)options.trackingParameters=structuredClone(settings.trackingParameters);if(settings.actionParameters)options.actionParameters=structuredClone(settings.actionParameters);if(settings.visionParameters)options.visionParameters=structuredClone(settings.visionParameters);
 return options;
}
export function mergeIncludedAngleRange(value={}){
 const range=mergeAngleRange(value);
 if(value.angleDefinition==='included'||range.angleMin===''||range.angleMax==='')return range;
 return {angleMin:180-range.angleMax,angleMax:180-range.angleMin};
}
export function planningSettingsErrors(settings={}){
 const errors=[...mergeParameterErrors(settings.mergeParameters),...wrapParameterErrors(settings.wrapParameters)];
 if(settings.trackingParameters){const tracking=settings.trackingParameters;for(const [key,label] of [['laserEnabled','激光跟踪'],['arcEnabled','电弧跟踪']])if(typeof tracking[key]!=='boolean')errors.push(`${label}启用状态无效`);if(tracking.laserEnabled)for(const [key,label] of [['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径']])if(!Number.isFinite(tracking[key])||tracking[key]<0)errors.push(`${label}应为大于等于0的有效数值`);}
 if(settings.samplingAvoidance?.autoDeleteUnavoidable!==undefined&&typeof settings.samplingAvoidance.autoDeleteUnavoidable!=='boolean')errors.push('是否自动删除无法避障焊道应为开启或关闭');
 if(settings.samplingAvoidance)for(const [key,label] of SAMPLING_AXES){
  const axis=settings.samplingAvoidance[key];
  if(!axis||typeof axis.enabled!=='boolean'){errors.push(`${label}采样设置无效`);continue;}
  if(settings.samplingAvoidance.enabled!==false&&axis.enabled){if(!Number.isFinite(axis.min)||!Number.isFinite(axis.max)||Math.abs(axis.min)>360||Math.abs(axis.max)>360)errors.push(`${label}采样范围应为-360–360°`);else if(axis.min>axis.max)errors.push(`${label}采样范围最小值不能大于最大值`);}
 }
 for(const [key,label,unit] of INTERFERENCE_END_FIELDS){
  const value=settings.interferenceEndParameters?.[key];
  if(!filled(value))continue;
  if(!Number.isFinite(value)){errors.push(`${label}请输入有效数值`);continue;}
  if(unit==='mm'&&value<0)errors.push(`${label}应为非负数`);
  if(unit==='°'&&(value < -360||value>360))errors.push(`${label}应为-360–360°`);
 }
 for(const [key,label] of [['startPose','起点姿态'],['endPose','终点姿态']]){
  const pose=settings.interferenceEndParameters?.[key];
  if(pose===undefined)continue;
  if(!pose||typeof pose!=='object'||Array.isArray(pose)){errors.push(`${label}设置无效`);continue;}
  for(const [axis,axisLabel] of INTERFERENCE_POSE_AXES){const value=pose[axis];if(filled(value)&&(!Number.isFinite(value)||value < -360||value>360))errors.push(`${label}${axisLabel}应为-360–360°`);}
 }
 const split=settings.splitParameters||{},intermittent=settings.intermittentParameters||{};
 if(filled(split.edgeThreshold)&&(!Number.isInteger(split.edgeThreshold)||split.edgeThreshold<=0))errors.push('边缘打断阈值须为大于0的整数');
 if(filled(split.gapThreshold)&&(!Number.isFinite(split.gapThreshold)||split.gapThreshold<0))errors.push('间隙打断阈值应为非负数');
 if(split.enabled&&(!Number.isFinite(split.length)||split.length<.1))errors.push('焊缝分段长度应至少为0.1 mm');
 if(intermittent.enabled){
  if(filled(intermittent.position)&&intermittent.position!=='PB')errors.push('间断焊焊接位置仅支持平角焊');
  if(!['chain','staggered'].includes(intermittent.layout))errors.push('请选择间断焊布置');
  if(!['uniform','endWeld'].includes(intermittent.mode))errors.push('请选择间断焊模式');
  for(const [key,label] of [['weldLength','焊接长度'],['gapLength','间断长度']])if(!Number.isFinite(intermittent[key])||intermittent[key]<(intermittent.distributionVersion>=2?0:.1))errors.push(`${label}应至少为0.1 mm`);
 }
 return errors;
}
