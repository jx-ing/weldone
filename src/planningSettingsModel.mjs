import {DEFAULT_INTERFERENCE_ANGLE,DEFAULT_INTERFERENCE_DISTANCE,DEFAULT_MERGE_ANGLE_RANGE,DEFAULT_MERGE_GAP} from './planningConfiguration.mjs';

export const SETTINGS_TABS=[['action','全局工艺参数'],['topology','拓扑调整'],['path','路径设置'],['tracking','跟踪设置'],['measurement','测量参数设置']];
export const OFFSET_AXES=['x','y','z'];
export const POSE_AXES=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
export const MIXED_SCAN_FIELDS=[
 ['arcPointDistance','Arc打点距离'],
 ['linePointDistance','Line打点距离'],
 ['endClearance','两端避让距离'],
 ['minWeldLength','生成扫描点的最短焊缝长度'],
 ['scanDistance','扫描距离']
];
const empty=value=>value===undefined||value===null||value==='';
export const asNumber=value=>empty(value)?null:Number(value);
export const defaultNumber=(value,fallback)=>empty(value)?fallback:Number(value);
const offset=(value,defaults)=>Object.fromEntries(OFFSET_AXES.map((key,index)=>[key,value?.[key]??defaults[index]]));
export function withoutRetiredFillSettings(settings){
 const wrap=settings?.wrapParameters;
 if(!wrap)return settings;
 const {fillEnabled,fillOffset,fillHoleSize,...wrapParameters}=wrap;
 return {...settings,wrapParameters};
}
const pose=value=>Object.fromEntries(POSE_AXES.map(([key])=>[key,value?.[key]??null]));
export function settingsDefaults(raw={},capabilities={}){
 const {intermittentParameters,...settings}=structuredClone(withoutRetiredFillSettings(raw));
 const {enabled,length,...split}=settings.splitParameters||{};
 const motion=settings.actionParameters||{},wrap=settings.wrapParameters||{},merge=settings.mergeParameters||{},vision=settings.visionParameters||{},precision=settings.precisionParameters||{},tracking=settings.trackingParameters||{},sampling=settings.samplingAvoidance||{};
 const {startPose,endPose,...ends}=settings.interferenceEndParameters||{};
 const next={...settings,actionParameters:{...motion,legMode:motion.legMode??'thickness',legHeight:motion.legHeight??null,verticalDown:motion.verticalDown??false,poseStep:motion.poseStep??10,lineStep:motion.lineStep??5,arcStep:motion.arcStep??2,edgeSearchDistance:motion.edgeSearchDistance??15,safeTransitionOffset:offset(motion.safeTransitionOffset,[0,50,motion.liftHeight??100]),safeApproachOffset:offset(motion.safeApproachOffset,[0,20,40]),overlapDistance:motion.overlapDistance??5,staggerDistance:motion.staggerDistance??20,flatPose:pose(motion.flatPose),verticalPose:pose(motion.verticalPose),liftHeight:motion.liftHeight??100,externalAxisLength:motion.externalAxisLength??1500},
  wrapParameters:{...wrap,flatEnabled:wrap.flatEnabled??wrap.enabled??true,verticalEnabled:wrap.verticalEnabled??wrap.enabled??true,lDistanceRatio:wrap.lDistanceRatio||'2/3',uPose:pose(wrap.uPose),flatLPose:pose(wrap.flatLPose),verticalLPose:pose(wrap.verticalLPose),independentLength:defaultNumber(wrap.independentLength,30),passHoleThreshold:defaultNumber(wrap.passHoleThreshold,35),gapThreshold:defaultNumber(wrap.gapThreshold,350)},
  mergeParameters:{...merge,gapThreshold:defaultNumber(merge.gapThreshold,DEFAULT_MERGE_GAP),enabled:merge.enabled??true,countEnabled:merge.countEnabled??Number.isInteger(merge.count),count:merge.count??2,lengthEnabled:merge.lengthEnabled??!empty(merge.maxLength),maxLength:defaultNumber(merge.maxLength,1500),passHoleSize:defaultNumber(merge.passHoleSize,15),angleMin:merge.angleMin??DEFAULT_MERGE_ANGLE_RANGE.angleMin,angleMax:merge.angleMax??DEFAULT_MERGE_ANGLE_RANGE.angleMax},
  splitParameters:{...split,gapThreshold:split.gapThreshold??null,edgeThreshold:split.edgeThreshold??null,autoDeleteUnavoidable:split.autoDeleteUnavoidable??sampling.autoDeleteUnavoidable??false},
  interferenceEndParameters:{...ends,verticalStartDistance:ends.verticalStartDistance??20,startDistance:defaultNumber(ends.startDistance,DEFAULT_INTERFERENCE_DISTANCE),endDistance:defaultNumber(ends.endDistance,DEFAULT_INTERFERENCE_DISTANCE),startAngle:defaultNumber(startPose?.advance??ends.startAngle,DEFAULT_INTERFERENCE_ANGLE),endAngle:defaultNumber(endPose?.advance??ends.endAngle,DEFAULT_INTERFERENCE_ANGLE),startLineOffset:ends.startLineOffset??0,endLineOffset:ends.endLineOffset??0},
  precisionParameters:{...precision,laserPose:{...offset(precision.laserPose,[0,0,0]),...pose(precision.laserPose)},structuredLightPose:{...offset(precision.structuredLightPose,[0,0,0]),...pose(precision.structuredLightPose)},lineSweepSpeed:precision.lineSweepSpeed??150,arcSweepSpeed:precision.arcSweepSpeed??70,mixedScan:{...precision.mixedScan},structuredLightMixedScan:{...precision.structuredLightMixedScan}},
  visionParameters:{...vision,sweepPose:pose(vision.sweepPose),photoPose:pose(vision.photoPose),twoFaceSpeed:vision.twoFaceSpeed??null,threeFaceSpeed:vision.threeFaceSpeed??null},
  trackingParameters:{...tracking,laserEnabled:capabilities.laserTracking===false?false:tracking.laserEnabled??true,arcEnabled:capabilities.arcTracking===false?false:tracking.arcEnabled??true,minLineLength:tracking.minLineLength??160,minArcDiameter:tracking.minArcDiameter??160,minEdgeWidth:tracking.minEdgeWidth??10},
  samplingAvoidance:{...sampling,enabled:sampling.enabled??true,step:sampling.step??null,autoDeleteUnavoidable:sampling.autoDeleteUnavoidable??false,...Object.fromEntries([['advance',-45,45],['work',-40,50],['rotation',-80,80]].map(([key,min,max])=>[key,{enabled:true,min,max,...sampling[key]}]))}};
 if(settings.topologyVersion===1){
  const legacyLeg={enabled:motion.legMode==='global',height:motion.legHeight??null};
  next.actionParameters.defaultLegs=Object.fromEntries(['flat','vertical'].map(kind=>[kind,{...legacyLeg,...motion.defaultLegs?.[kind]}]));
  Object.assign(next.mergeParameters,{angleEnabled:merge.angleEnabled??true,grooveEnabled:merge.grooveEnabled??true,flatContactGap:merge.flatContactGap??0,verticalContactGap:merge.verticalContactGap??0});
  Object.assign(next.wrapParameters,{outerClearance:wrap.outerClearance??0,verticalDistance:wrap.verticalDistance??null});
  const corner=settings.cornerPathParameters;
  next.cornerPathParameters={before:corner?.before??30,after:corner?.after??30,offset:corner?.offset??0};
 }
 return next;
}
export function serializeSettings(draft,capabilities={}){
 const next=settingsDefaults(draft,capabilities),n=asNumber;
 next.planningRevision=3;
 const action=next.actionParameters;
 action.legHeight=n(action.legHeight);
 for(const [key,fallback] of [['poseStep',10],['lineStep',5],['arcStep',2],['edgeSearchDistance',15],['liftHeight',100],['externalAxisLength',1500]])action[key]=defaultNumber(action[key],fallback);
 for(const [key,defaults] of [['safeTransitionOffset',[0,50,action.liftHeight]],['safeApproachOffset',[0,20,40]]]){
  for(const [index,axis] of OFFSET_AXES.entries())action[key][axis]=defaultNumber(action[key][axis],defaults[index]);
 }
 action.overlapDistance=defaultNumber(action.overlapDistance,5);
 action.staggerDistance=defaultNumber(action.staggerDistance,20);
 for(const key of ['flatPose','verticalPose'])next.actionParameters[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(next.actionParameters[key][axis])]));
 const w=next.wrapParameters;w.enabled=w.flatEnabled||w.verticalEnabled;w.independentLength=defaultNumber(w.independentLength,30);w.gapThreshold=defaultNumber(w.gapThreshold,350);for(const key of ['flatLPose','verticalLPose'])w[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(w[key][axis])]));w.passHoleThreshold=defaultNumber(w.passHoleThreshold,35);w.uPose=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(w.uPose[axis])]));
 const m=next.mergeParameters;m.rulesVersion=3;m.angleMin=n(m.angleMin);m.angleMax=n(m.angleMax);m.count=n(m.count);m.maxLength=defaultNumber(m.maxLength,1500);m.passHoleSize=defaultNumber(m.passHoleSize,15);m.angleDefinition='included';m.position='flat-flat';delete m.continuousOnly;m.passHoleInclusive=false;delete m.angle;
 for(const key of ['gapThreshold','edgeThreshold'])next.splitParameters[key]=n(next.splitParameters[key]);next.splitParameters.rulesVersion=3;w.rulesVersion=3;next.trackingParameters.rulesVersion=2;
 for(const side of ['start','end']){
  const ends=next.interferenceEndParameters;
  ends[side+'Angle']=n(ends[side+'Angle']);
  ends[side+'LineOffset']=defaultNumber(ends[side+'LineOffset'],0);
 }
 next.interferenceEndParameters.verticalStartDistance=defaultNumber(next.interferenceEndParameters.verticalStartDistance,20);
 for(const key of ['startDistance','endDistance'])next.interferenceEndParameters[key]=defaultNumber(next.interferenceEndParameters[key],DEFAULT_INTERFERENCE_DISTANCE);
 for(const key of ['sweepPose','photoPose'])next.visionParameters[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(next.visionParameters[key][axis])]));
 for(const key of ['twoFaceSpeed','threeFaceSpeed'])next.visionParameters[key]=n(next.visionParameters[key]);
 const precision=next.precisionParameters;
 for(const [key,fallback] of [['lineSweepSpeed',150],['arcSweepSpeed',70]])precision[key]=defaultNumber(precision[key],fallback);
 for(const key of ['laserPose','structuredLightPose']){
  for(const axis of OFFSET_AXES)precision[key][axis]=defaultNumber(precision[key][axis],0);
  for(const [axis] of POSE_AXES)precision[key][axis]=n(precision[key][axis]);
 }
 for(const group of ['mixedScan','structuredLightMixedScan']){
  for(const [key] of MIXED_SCAN_FIELDS)precision[group][key]=n(precision[group][key]);
 }
 if(Array.isArray(next.sequenceParameters?.scanDirection)){
  const direction=next.sequenceParameters.scanDirection.map(n);
  if(direction.every(value=>value===null))delete next.sequenceParameters.scanDirection;
  else next.sequenceParameters.scanDirection=direction;
 }
 if('localMatchDistance' in next)next.localMatchDistance=n(next.localMatchDistance);
 if(next.topologyVersion===1){
  for(const leg of Object.values(action.defaultLegs))leg.height=n(leg.height);
  for(const key of ['flatContactGap','verticalContactGap'])m[key]=defaultNumber(m[key],0);
  w.outerClearance=defaultNumber(w.outerClearance,0);
  w.verticalDistance=n(w.verticalDistance);
  const corner=next.cornerPathParameters;
  corner.before=defaultNumber(corner.before,30);
  corner.after=defaultNumber(corner.after,30);
  corner.offset=defaultNumber(corner.offset,0);
 }
 for(const key of ['minLineLength','minArcDiameter','minEdgeWidth'])next.trackingParameters[key]=n(next.trackingParameters[key]);
 next.samplingAvoidance.step=n(next.samplingAvoidance.step);for(const [key] of POSE_AXES)for(const bound of ['min','max'])next.samplingAvoidance[key][bound]=n(next.samplingAvoidance[key][bound]);
 return next;
}
export function updateProjectPlanning(data,values){
 const from=data.project||'本地项目',to=values.project??from,profiles=structuredClone(data.projectPlanning||{});
 profiles[from]={...profiles[from],planningSettings:structuredClone(data.planningSettings||{}),workpieceType:data.workpieceType??''};
 const previous=data.templateProjects||[],after=values.templateProjects;
 if(after){const removed=previous.filter(name=>!after.includes(name)),added=after.filter(name=>!previous.includes(name));if(removed.length===1&&added.length===1&&previous.length===after.length){profiles[added[0]]=profiles[removed[0]];delete profiles[removed[0]];}else for(const name of removed)delete profiles[name];}
 const next={...data,...values,projectPlanning:profiles};
 if(to!==from){next.planningSettings=structuredClone(profiles[to]?.planningSettings||{});next.workpieceType=profiles[to]?.workpieceType??'';next.welds=data.welds.map(w=>({...w,planned:false}));}
 profiles[to]={...profiles[to],planningSettings:structuredClone(values.planningSettings??next.planningSettings??{}),workpieceType:values.workpieceType??next.workpieceType??''};
 if(values.planningSettings)next.planningSettings=structuredClone(values.planningSettings);
 return next;
}
export function resolveEndpointPose(settings,endpoint,position){const values=settingsDefaults(settings),standard=/^P[FG]/.test(String(position))?values.actionParameters.verticalPose:values.actionParameters.flatPose,angle=values.interferenceEndParameters[endpoint+'Angle'];return {...standard,advance:angle??standard.advance};}
export function trackingChoice(segment,tracking,capabilities={}){const line=segment.geometry==='直线',diameter=segment.arcDiameter??(segment.shape?.radius!==undefined?segment.shape.radius*2:null),edge=segment.edgeWidth??segment.edgeDistance;const laser=tracking.laserEnabled&&capabilities.laserTracking!==false&&((line&&segment.length>=tracking.minLineLength)||(!line&&Number.isFinite(diameter)&&diameter>=tracking.minArcDiameter))&&(segment.laserTrackingClearance?.threshold===tracking.minEdgeWidth||Number.isFinite(edge)&&edge>tracking.minEdgeWidth);return laser?'激光跟踪':tracking.arcEnabled&&capabilities.arcTracking!==false?'电弧跟踪':'无跟踪';}
export function useCaseSettingsErrors(settings,capabilities={}){
 const errors=[],decimal=value=>Number.isFinite(value)&&Math.abs(value*10-Math.round(value*10))<1e-8;
 const numeric=(value,label,{integer=false,positive=false,optional=false}={})=>{if(optional&&empty(value))return;if(!Number.isFinite(value)||(positive?value<=0:value<0)||(integer?!Number.isInteger(value):!decimal(value)))errors.push(`${label}须为${positive?'大于0':'大于等于0'}的${integer?'整数':'一位小数'}`);};
 const poseCheck=(value,label)=>{for(const [key,name] of POSE_AXES)if(!empty(value?.[key])&&(!Number.isFinite(value[key])||Math.abs(value[key])>360))errors.push(`${label}${name}须在-360–360°范围内`);};
 if(settings.actionParameters){const a=settings.actionParameters;if(settings.topologyVersion!==1&&a.legMode==='global'&&(!Number.isFinite(a.legHeight)||a.legHeight<=0||!Number.isInteger(a.legHeight*2)))errors.push('统一焊脚高度须大于0，步长0.5 mm');for(const [key,label] of [['poseStep','焊枪姿态变化步长'],['lineStep','直线步长'],['arcStep','圆弧步长'],['edgeSearchDistance','焊缝边缘检测距离'],['overlapDistance','起终点搭接距离'],['staggerDistance','起点错开距离']])numeric(a[key],label,{integer:true,positive:true,optional:true});poseCheck(a.flatPose,'平角焊标准姿态');poseCheck(a.verticalPose,'立角焊标准姿态');for(const [key,label] of [['safeTransitionOffset','安全过渡点'],['safeApproachOffset','安全接近点']])for(const axis of ['x','y','z'])numeric(a[key]?.[axis],label+axis.toUpperCase()+'偏移',{integer:true,optional:true});numeric(a.externalAxisLength,'外部轴联动长度',{integer:true,positive:true});numeric(a.liftHeight,'收下枪高度',{integer:true,optional:true});}
 if(settings.topologyVersion===1){
  for(const [key,label] of [['flat','平角焊'],['vertical','立焊']]){
   const leg=settings.actionParameters?.defaultLegs?.[key];
   if(typeof leg?.enabled!=='boolean')errors.push(label+'默认焊脚开关无效');
   if(leg?.enabled&&(!Number.isFinite(leg.height)||leg.height<.5||!Number.isInteger(leg.height*2)))errors.push(label+'默认焊脚高度须大于等于0.5 mm，步长0.5 mm');
  }
  const wrap=settings.wrapParameters, merge=settings.mergeParameters, corner=settings.cornerPathParameters;
  if(typeof merge?.enabled!=='boolean'||typeof merge.angleEnabled!=='boolean'||typeof merge.grooveEnabled!=='boolean')errors.push('相接板端合并开关无效');
  if(merge?.enabled&&merge.angleEnabled&&(!Number.isFinite(merge.angleMin)||!Number.isFinite(merge.angleMax)))errors.push('请填写合并角度范围的上下限');
  numeric(merge?.flatContactGap,'平角焊焊缝相接最小间隙');
  numeric(merge?.verticalContactGap,'立焊焊缝相接最小间隙');
  if(wrap?.flatEnabled)numeric(wrap.outerClearance,'外角最小空间');
  if(wrap?.verticalEnabled)numeric(wrap.verticalDistance,'立焊上包角距离',{positive:true,optional:true});
  numeric(corner?.before,'默认转角前距离');
  numeric(corner?.after,'默认转角后距离');
  if(!Number.isFinite(corner?.offset))errors.push('默认转角点偏移须为有效数值');
 }
 const w=settings.wrapParameters;if(w?.rulesVersion>=2){numeric(w.gapThreshold,'包角间隙阈值',{integer:true,positive:true,optional:true});poseCheck(w.flatLPose,'平角焊L形包角姿态');poseCheck(w.verticalLPose,'立焊L形包角姿态');numeric(w.independentLength,'独立焊缝长度',{positive:true});numeric(w.passHoleThreshold,'过焊孔包角阈值',{integer:true,positive:true});}
 const m=settings.mergeParameters;if(m?.rulesVersion>=2){numeric(m.passHoleSize,'合并过焊孔尺寸',{positive:true});if(m.lengthEnabled)numeric(m.maxLength,'合并长度',{positive:true});if(m.countEnabled){numeric(m.count,'合并数量',{integer:true,positive:true});if(m.count<2)errors.push('合并数量最小为2');}}
 const split=settings.splitParameters;if(split?.rulesVersion>=2)numeric(split.gapThreshold,'间隙打断阈值',{integer:split.rulesVersion===2,positive:true,optional:true});
 if(settings.interferenceEndParameters){const e=settings.interferenceEndParameters;numeric(e.startDistance,'起点变姿态距离');numeric(e.endDistance,'终点变姿态距离');numeric(e.verticalStartDistance,'立焊起点变姿态距离',{optional:true});}
 if(settings.visionParameters){const v=settings.visionParameters;poseCheck(v.sweepPose,'推扫标准姿态');poseCheck(v.photoPose,'定点拍照标准姿态');for(const [key,label] of [['twoFaceSpeed','两面交推扫速度'],['threeFaceSpeed','三面交推扫速度']])if(!empty(v[key])&&(!Number.isFinite(v[key])||v[key]<=0))errors.push(`${label}须大于0`);}
 const precision=settings.precisionParameters;
 if(precision){
  for(const [key,label] of [['laserPose','线激光标准姿态'],['structuredLightPose','结构光标准姿态']]){
   poseCheck(precision[key],label);
   for(const axis of OFFSET_AXES){const value=precision[key]?.[axis];if(!empty(value)&&!Number.isFinite(value))errors.push(label+axis.toUpperCase()+'须为有效数值');}
  }
  for(const [key,label] of [['lineSweepSpeed','直线推扫速度'],['arcSweepSpeed','圆弧推扫速度']])if(!empty(precision[key])&&(!Number.isFinite(precision[key])||precision[key]<=0))errors.push(label+'须大于0');
 }
 const direction=settings.sequenceParameters?.scanDirection;
 if(direction!=null&&(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite)||direction.every(value=>value===0)))errors.push('扫描方向须填写三个有限数值，且至少一轴非零');
 if(!empty(settings.localMatchDistance)&&(!Number.isFinite(settings.localMatchDistance)||settings.localMatchDistance<=0))errors.push('局部模板匹配距离须大于0');
 for(const [group,sensor] of [['mixedScan','线激光'],['structuredLightMixedScan','结构光']]){
  for(const [key,label] of MIXED_SCAN_FIELDS){
   const value=precision?.[group]?.[key];
   if(!empty(value)&&(!Number.isFinite(value)||value<0))errors.push(sensor+label+'须为非负数');
  }
 }
 const t=settings.trackingParameters;if(t?.rulesVersion===2){if(t.laserEnabled)for(const [key,label] of [['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径'],['minEdgeWidth','最小边缘宽度']])numeric(t[key],label);if(capabilities.laserTracking===false&&t.laserEnabled)errors.push('未配置激光跟踪相机，不能开启激光跟踪');if(capabilities.arcTracking===false&&t.arcEnabled)errors.push('未配置电弧跟踪，不能开启电弧跟踪');}
 const sampling=settings.samplingAvoidance;if(sampling){if(sampling.enabled!==undefined&&typeof sampling.enabled!=='boolean')errors.push('采样避障总开关无效');if(!empty(sampling.step)&&(!Number.isFinite(sampling.step)||sampling.step<=0))errors.push('采样步长须大于0');}
 return errors;
}
export function wrapChoice(facts,parameters){
 const none='不包角',kind=facts.junctionType,hasHole=facts.hasHole===true,threshold=parameters.passHoleThreshold??35,gapThreshold=parameters.gapThreshold??350;
 if(['间隙打断','过焊孔打断','长度打断','对称打断','避障打断','边缘打断'].includes(facts.breakReason))return none;
 const position=String(facts.position||'').split(' · ')[0];
 if(position==='PB'&&parameters.flatEnabled===false||position==='PF'&&parameters.verticalEnabled===false)return none;
 if(kind==='三面交')return hasHole&&facts.plateThickness<(parameters.independentLength??30)&&Number.isFinite(facts.holeSize)&&facts.holeSize>=threshold?'L形包角':none;
 if(kind!=='两面交'||!Number.isFinite(facts.gap))return none;
 if(hasHole&&(!Number.isFinite(facts.holeSize)||facts.holeSize<threshold))return none;
 return facts.gap>gapThreshold?'U形包角':hasHole&&facts.gap<gapThreshold?'L形包角':none;
}
