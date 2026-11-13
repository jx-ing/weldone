export const DEFAULT_MERGE_GAP=10;
export const DEFAULT_MERGE_ANGLE_RANGE={angleMin:60,angleMax:120};
export const DEFAULT_INTERFERENCE_ANGLE=38;
export const DEFAULT_INTERFERENCE_DISTANCE=35;
export const WORKPIECE_TYPES=['小组立','中组立','护板'];
export const L_WRAP_DISTANCES=[['1/2','1/2板厚'],['2/3','2/3板厚']];
export const INTERFERENCE_END_FIELDS=[['Angle','姿态','°'],['Distance','距离','mm'],['LineOffset','线偏移','mm']];
const positiveTenth=value=>Number.isFinite(value)&&value>0&&Math.abs(value*10-Math.round(value*10))<1e-8;
const filled=value=>value!==null&&value!==undefined&&value!=='';
const hasRange=value=>'angleMin' in value||'angleMax' in value;
function wrapParameterIssues(value={},topology=false){
 const issues=[],add=(key,message)=>issues.push({field:'wrapParameters.'+key,message});
 for(const [key,label] of [['flatEnabled','平角焊包角'],['verticalEnabled','立角焊包角']])if(value[key]!==undefined&&typeof value[key]!=='boolean')add(key,`${label}启用状态无效`);
 if((!topology||value.flatEnabled!==false)&&filled(value.independentLength)&&(!Number.isFinite(value.independentLength)||value.independentLength<=0))add('independentLength','独立焊缝长度应大于0 mm');
 if((!topology||value.flatEnabled!==false)&&filled(value.lDistanceRatio)&&!L_WRAP_DISTANCES.some(([ratio])=>ratio===value.lDistanceRatio))add('lDistanceRatio','L形包角距离请选择1/2板厚或2/3板厚');
 for(const [key,label] of [['advance','前进角'],['work','工作角'],['rotation','旋转角']]){
  const angle=value.uPose?.[key];
  if((!topology||value.flatEnabled!==false)&&filled(angle)&&(!Number.isFinite(angle)||angle < -360||angle>360))add('uPose.'+key,`U形控制姿态${label}应为-360–360°`);
 }
 return issues;
}
export const wrapParameterErrors=value=>wrapParameterIssues(value).map(issue=>issue.message);
export function mergeAngleRange(value={}){
 if(hasRange(value))return {angleMin:value.angleMin??'',angleMax:value.angleMax??''};
 return Number.isFinite(value.angle)?{angleMin:0,angleMax:value.angle}:{angleMin:'',angleMax:''};
}
function mergeParameterIssues(value={},topology=false){
 const issues=[],add=(key,message)=>issues.push({field:'mergeParameters.'+key,message});
 const enabled=!topology||value.enabled!==false;
 if(value.lengthEnabled!==false&&filled(value.maxLength)&&(!Number.isFinite(value.maxLength)||value.maxLength<=0))add('maxLength','合并长度应为大于0的有效数值');
 if(enabled&&value.grooveEnabled!==false&&filled(value.gapThreshold)&&(!Number.isFinite(value.gapThreshold)||value.gapThreshold<0))add('gapThreshold',value.grooveEnabled===true?'最大合并槽隙应为非负数':'合并间隙阈值应为非负数');
 if(filled(value.passHoleSize)&&(!Number.isFinite(value.passHoleSize)||value.passHoleSize<0))add('passHoleSize','合并过焊孔尺寸应为非负数');
 if(enabled&&hasRange(value)&&value.angleEnabled!==false){
  const min=filled(value.angleMin),max=filled(value.angleMax);
  if(min!==max)add(min?'angleMax':'angleMin','请同时填写最小合并角度和最大合并角度');
  for(const key of ['angleMin','angleMax'])if(filled(value[key])&&(!Number.isFinite(value[key])||value[key]<0||value[key]>(value.rulesVersion>=2?360:180)))add(key,value.rulesVersion>=2?'合并角度应为0–360°':'合并角度应为0–180°');
  if(min&&max&&Number.isFinite(value.angleMin)&&Number.isFinite(value.angleMax)&&(value.rulesVersion>=3?value.angleMin>=value.angleMax:value.angleMin>value.angleMax))add('angleMin','最小合并角度须小于最大合并角度');
 }else if(enabled&&filled(value.angle)&&(!Number.isFinite(value.angle)||value.angle<0||value.angle>180))add('angle','合并角度应为0–180°');
 if(value.countEnabled!==false&&value.count!==null&&value.count!==undefined&&value.count!==''&&(!Number.isInteger(value.count)||value.count<2||!(value.rulesVersion>=2)&&value.count>30))add('count',value.rulesVersion>=2?'合并数量应为不小于2的整数':'合并个数应为2–30的整数');
 if(value.countEnabled===true&&!filled(value.count))add('count','请输入合并数量');
 return issues;
}
export const mergeParameterErrors=value=>[...new Set(mergeParameterIssues(value).map(issue=>issue.message))];
export function geometryOptionsForPlanning(defaults,settings={}){
 const options=structuredClone(defaults),merge=settings.mergeParameters||{};
 const errors=planningSettingsErrors(settings);if(errors.length)throw Error(errors.join('；'));
 const range=mergeAngleRange(merge);
 if(Number.isFinite(range.angleMin)&&Number.isFinite(range.angleMax)){const lower=merge.angleDefinition==='included'?range.angleMin:180-range.angleMax,upper=merge.angleDefinition==='included'?range.angleMax:180-range.angleMin;options.mergeParams.夹角阈值下限=Math.min(180,Math.max(0,lower));options.mergeParams.夹角阈值上限=Math.min(180,Math.max(0,upper));if(lower>180||upper<0)options.automaticMerge=false;}
 if(merge.countEnabled!==false&&Number.isInteger(merge.count))options.maxMergeCount=merge.count;
 if(merge.lengthEnabled!==false&&Number.isFinite(merge.maxLength))options.maxMergeLength=merge.maxLength;
 if(merge.enabled!==undefined&&options.automaticMerge!==false)options.automaticMerge=merge.enabled;
 if(Number.isFinite(merge.gapThreshold)||settings.planningRevision===3){
  options.maxMergeGap=Number.isFinite(merge.gapThreshold)?merge.gapThreshold:DEFAULT_MERGE_GAP;
  options.mergeParams.最大合并距离=options.maxMergeGap;
  options.mergeGapCheck=true;
 }else if(merge.continuousOnly)options.continuousOnly=true;
 if(merge.position)options.mergePosition=merge.position;
 if(Number.isFinite(merge.passHoleSize)){options.mergePassHoleSize=merge.passHoleSize;if(merge.passHoleInclusive===false)options.mergePassHoleInclusive=false;options.mergeParams.最长通过距离=merge.passHoleSize;options.mergeParams.最小通过高度=merge.passHoleSize;}
 if(settings.topologyVersion===1){
  if(typeof merge.angleEnabled!=='boolean'||typeof merge.grooveEnabled!=='boolean')throw Error('相接板端合并限制开关无效');
  const range=mergeIncludedAngleRange(merge);
  const maxGroove=merge.grooveEnabled?merge.gapThreshold??DEFAULT_MERGE_GAP:null;
  options.cornerMerge={flatContactGap:merge.flatContactGap??0,verticalContactGap:merge.verticalContactGap??0,
    angleRange:merge.angleEnabled&&Number.isFinite(range.angleMin)&&Number.isFinite(range.angleMax)?range:null,maxGroove};
  options.automaticMerge=merge.enabled!==false;
  options.mergeGapCheck=maxGroove!==null;
  options.mergeParams.夹角阈值下限=0;
  options.mergeParams.夹角阈值上限=180;
  options.mergeParams.最大合并距离=maxGroove===null?DEFAULT_MERGE_GAP:Math.max(.001,2*maxGroove);
  delete options.maxMergeGap;
  delete options.mergePosition;
 }
 if(settings.weldPreprocessing){
  options.automaticMerge=false;
  options.mergeGapCheck=true;
  options.mergeParams.最大合并距离=0;
  options.offsetThreshold=null;
  options.extendThreshold=Math.max(options.extendThreshold??0,settings.weldPreprocessing.outerClearance??0);
  options.weldPreprocessing=true;
 }
 if(settings.wrapParameters){options.wrapParameters=structuredClone(settings.wrapParameters);options.wrapDistanceRatio=settings.wrapParameters.lDistanceRatio==='1/2'?.5:2/3;}
 if(settings.planningRevision===3)options.planningRevision=3;
 if(settings.splitParameters||settings.planningRevision===3){
  const {enabled,length,...thresholds}=structuredClone(settings.splitParameters??{});
  options.splitParameters={...(settings.planningRevision===3?{edgeThreshold:null}:{}),...thresholds};
 }
 if(!settings.weldPreprocessing&&Number.isFinite(settings.splitParameters?.gapThreshold)){options.offsetThreshold=settings.splitParameters.gapThreshold;options.offset=Math.max(options.offset,settings.splitParameters.gapThreshold);}
 if(settings.interferenceEndParameters)options.interferenceEndParameters=structuredClone(settings.interferenceEndParameters);
 if(settings.trackingParameters)options.trackingParameters=structuredClone(settings.trackingParameters);if(settings.actionParameters)options.actionParameters=structuredClone(settings.actionParameters);
 return options;
}
export function mergeIncludedAngleRange(value={}){
 const range=mergeAngleRange(value);
 if(value.angleDefinition==='included'||range.angleMin===''||range.angleMax==='')return range;
 return {angleMin:180-range.angleMax,angleMax:180-range.angleMin};
}
export function planningSettingsIssues(settings={}){
 const topology=settings.topologyVersion===1;
 const issues=[...mergeParameterIssues(settings.mergeParameters,topology),...wrapParameterIssues(settings.wrapParameters,topology)];
 const add=(field,message)=>issues.push({field,message});
 if(settings.trackingParameters){const tracking=settings.trackingParameters;for(const [key,label] of [['laserEnabled','激光跟踪'],['arcEnabled','电弧跟踪']])if(typeof tracking[key]!=='boolean')add('trackingParameters.'+key,label+'启用状态无效');if(tracking.laserEnabled)for(const [key,label] of [['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径']])if(!Number.isFinite(tracking[key])||tracking[key]<0)add('trackingParameters.'+key,label+'应为大于等于0的有效数值');}
 for(const [end,side] of [['start','起点'],['end','终点']])for(const [field,label] of INTERFERENCE_END_FIELDS){
  const value=settings.interferenceEndParameters?.[end+field],key='interferenceEndParameters.'+end+field;
  if(!filled(value))continue;
  if(!Number.isFinite(value)){add(key,side+label+'请输入有效数值');continue;}
  if(field==='Distance'&&value<0)add(key,side+label+'应为非负数');
  if(field==='Angle'&&Math.abs(value)>360)add(key,side+label+'应为-360–360°');
 }
 const split=settings.splitParameters||{};
 if(split.autoDeleteUnavoidable!==undefined&&typeof split.autoDeleteUnavoidable!=='boolean')add('splitParameters.autoDeleteUnavoidable','自动删除无法避障焊缝开关无效');
 if(filled(split.edgeThreshold)&&(!positiveTenth(split.edgeThreshold)))add('splitParameters.edgeThreshold','边缘打断阈值须为大于0的一位小数');
 if(filled(split.gapThreshold)&&(split.rulesVersion>=3?!positiveTenth(split.gapThreshold):!Number.isFinite(split.gapThreshold)||split.gapThreshold<0))add('splitParameters.gapThreshold','间隙打断阈值须为大于0的一位小数');
 return issues;
}
export const planningSettingsErrors=settings=>[...new Set(planningSettingsIssues(settings).map(issue=>issue.message))];
