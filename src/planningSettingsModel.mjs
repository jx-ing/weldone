import {DEFAULT_INTERFERENCE_ANGLE,DEFAULT_INTERFERENCE_DISTANCE,DEFAULT_MERGE_ANGLE_RANGE,DEFAULT_MERGE_GAP} from './planningConfiguration.mjs';

export const SETTINGS_TABS=[['action','全局焊脚设置'],['topology','拓扑调整'],['path','路径设置'],['tracking','跟踪设置'],['measurement','测量参数设置']];
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
 const {measureTemplateNeighborhood,...configuration}=withoutRetiredFillSettings(raw);
 const {intermittentParameters,visionParameters,samplingAvoidance,...settings}=structuredClone(configuration);
 const {enabled,length,...split}=settings.splitParameters||{};
 const {verticalDown,poseStep,...motion}=settings.actionParameters||{};
 const wrap=settings.wrapParameters||{},merge=settings.mergeParameters||{},precision=settings.precisionParameters||{},tracking=settings.trackingParameters||{};
 const {startPose,endPose,...ends}=settings.interferenceEndParameters||{};
 const next={...settings,actionParameters:{...motion,legMode:motion.legMode??'thickness',legHeight:motion.legHeight??null,lineStep:motion.lineStep??5,arcStep:motion.arcStep??2,edgeSearchDistance:motion.edgeSearchDistance??15,safeTransitionOffset:offset(motion.safeTransitionOffset,[0,50,motion.liftHeight??100]),safeApproachOffset:offset(motion.safeApproachOffset,[0,20,40]),overlapDistance:motion.overlapDistance??5,staggerDistance:motion.staggerDistance??20,flatPose:pose(motion.flatPose),verticalPose:pose(motion.verticalPose),liftHeight:motion.liftHeight??100,externalAxisLength:motion.externalAxisLength??1500},
  wrapParameters:{...wrap,flatEnabled:wrap.flatEnabled??wrap.enabled??true,verticalEnabled:wrap.verticalEnabled??wrap.enabled??true,lDistanceRatio:wrap.lDistanceRatio||'2/3',uPose:pose(wrap.uPose),flatLPose:pose(wrap.flatLPose),verticalLPose:pose(wrap.verticalLPose),independentLength:defaultNumber(wrap.independentLength,30),passHoleThreshold:defaultNumber(wrap.passHoleThreshold,35),gapThreshold:defaultNumber(wrap.gapThreshold,350)},
  mergeParameters:{...merge,gapThreshold:defaultNumber(merge.gapThreshold,DEFAULT_MERGE_GAP),enabled:merge.enabled??true,countEnabled:merge.countEnabled??Number.isInteger(merge.count),count:merge.count??2,lengthEnabled:merge.lengthEnabled??!empty(merge.maxLength),maxLength:defaultNumber(merge.maxLength,1500),passHoleSize:defaultNumber(merge.passHoleSize,15),angleMin:merge.angleMin??DEFAULT_MERGE_ANGLE_RANGE.angleMin,angleMax:merge.angleMax??DEFAULT_MERGE_ANGLE_RANGE.angleMax},
  splitParameters:{...split,gapThreshold:split.gapThreshold??null,edgeThreshold:split.edgeThreshold??null,autoDeleteUnavoidable:split.autoDeleteUnavoidable??true},
  interferenceEndParameters:{...ends,verticalStartDistance:ends.verticalStartDistance??20,startDistance:defaultNumber(ends.startDistance,DEFAULT_INTERFERENCE_DISTANCE),endDistance:defaultNumber(ends.endDistance,DEFAULT_INTERFERENCE_DISTANCE),startAngle:defaultNumber(startPose?.advance??ends.startAngle,DEFAULT_INTERFERENCE_ANGLE),endAngle:defaultNumber(endPose?.advance??ends.endAngle,DEFAULT_INTERFERENCE_ANGLE),startLineOffset:ends.startLineOffset??0,endLineOffset:ends.endLineOffset??0},
  precisionParameters:{...precision,laserPose:{...offset(precision.laserPose,[0,0,0]),...pose(precision.laserPose)},structuredLightPose:{...offset(precision.structuredLightPose,[0,0,0]),...pose(precision.structuredLightPose)},lineSweepSpeed:precision.lineSweepSpeed??150,arcSweepSpeed:precision.arcSweepSpeed??70,mixedScan:{...precision.mixedScan},structuredLightMixedScan:{...precision.structuredLightMixedScan}},
  trackingParameters:{...tracking,laserEnabled:capabilities.laserTracking===false?false:tracking.laserEnabled??true,arcEnabled:capabilities.arcTracking===false?false:tracking.arcEnabled??true,minLineLength:tracking.minLineLength??160,minArcDiameter:tracking.minArcDiameter??160,minEdgeWidth:tracking.minEdgeWidth??10}};
 if(settings.topologyVersion===1){
  const legacyLeg={enabled:motion.legMode==='global',height:motion.legHeight??null};
  next.actionParameters.defaultLegs=Object.fromEntries(['flat','vertical'].map(kind=>[kind,{...legacyLeg,...motion.defaultLegs?.[kind]}]));
  Object.assign(next.mergeParameters,{angleEnabled:merge.angleEnabled??true,grooveEnabled:merge.grooveEnabled??true,flatContactGap:merge.flatContactGap??0,verticalContactGap:merge.verticalContactGap??0});
  Object.assign(next.wrapParameters,{outerClearance:wrap.outerClearance??0,verticalDistance:wrap.verticalDistance??null});
  if(settings.weldPreprocessing){
   const p=settings.weldPreprocessing;
   next.weldPreprocessing={maxHolePlateThickness:p.maxHolePlateThickness??null,minCornerHoleSize:p.minCornerHoleSize??0,outerClearance:p.outerClearance??wrap.outerClearance??0,maxWrapPlateThickness:p.maxWrapPlateThickness??null};
   for(const [kind,coefficient] of [['flat',.8],['vertical',.7]]){
    const leg=next.actionParameters.defaultLegs[kind];
    Object.assign(leg,{mode:leg.mode??(leg.enabled?'fixed':'coefficient'),coefficient:leg.coefficient??coefficient});
   }
  }
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
 for(const [key,fallback] of [['lineStep',5],['arcStep',2],['edgeSearchDistance',15],['liftHeight',100],['externalAxisLength',1500]])action[key]=defaultNumber(action[key],fallback);
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
 if(next.weldPreprocessing)for(const key of Object.keys(next.weldPreprocessing))next.weldPreprocessing[key]=n(next.weldPreprocessing[key]);
 if('localMatchDistance' in next)next.localMatchDistance=n(next.localMatchDistance);
 if(next.topologyVersion===1){
  for(const leg of Object.values(action.defaultLegs)){
   leg.height=n(leg.height);
   if(leg.mode){leg.coefficient=n(leg.coefficient);leg.enabled=leg.mode==='fixed';}
  }
  for(const key of ['flatContactGap','verticalContactGap'])m[key]=defaultNumber(m[key],0);
  w.outerClearance=defaultNumber(w.outerClearance,0);
  w.verticalDistance=n(w.verticalDistance);
  const corner=next.cornerPathParameters;
  corner.before=defaultNumber(corner.before,30);
  corner.after=defaultNumber(corner.after,30);
  corner.offset=defaultNumber(corner.offset,0);
 }
 for(const key of ['minLineLength','minArcDiameter','minEdgeWidth'])next.trackingParameters[key]=n(next.trackingParameters[key]);
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
export function useCaseSettingsIssues(settings,capabilities={}){
 const issues=[],add=(field,message)=>issues.push({field,message});
 const decimal=value=>Number.isFinite(value)&&Math.abs(value*10-Math.round(value*10))<1e-8;
 const numeric=(field,value,label,{integer=false,positive=false,optional=false}={})=>{
  if(optional&&empty(value))return;
  if(!Number.isFinite(value)||(positive?value<=0:value<0)||(integer?!Number.isInteger(value):!decimal(value))){
   add(field,label+'须为'+(positive?'大于0':'大于等于0')+'的'+(integer?'整数':'一位小数'));
  }
 };
 const poseCheck=(field,value,label)=>{
  for(const [key,name] of POSE_AXES)if(!empty(value?.[key])&&(!Number.isFinite(value[key])||Math.abs(value[key])>360))add(field+'.'+key,label+name+'须在-360–360°范围内');
 };
 const topology=settings.topologyVersion===1;
 const a=settings.actionParameters;
 if(a){
  if(!topology&&a.legMode==='global'&&(!Number.isFinite(a.legHeight)||a.legHeight<=0||!Number.isInteger(a.legHeight*2)))add('actionParameters.legHeight','统一焊脚高度须大于0，步长0.5 mm');
  for(const [key,label] of [['lineStep','直线步长'],['arcStep','圆弧步长'],['edgeSearchDistance','焊缝边缘检测距离'],['overlapDistance','起终点搭接距离'],['staggerDistance','起点错开距离']]){
   numeric('actionParameters.'+key,a[key],label,{integer:true,positive:true,optional:true});
  }
  poseCheck('actionParameters.flatPose',a.flatPose,'平角焊标准姿态');
  poseCheck('actionParameters.verticalPose',a.verticalPose,'立角焊标准姿态');
  for(const [key,label] of [['safeTransitionOffset','安全过渡点'],['safeApproachOffset','安全接近点']])for(const axis of OFFSET_AXES){
   numeric('actionParameters.'+key+'.'+axis,a[key]?.[axis],label+axis.toUpperCase()+'偏移',{integer:true,optional:true});
  }
  numeric('actionParameters.externalAxisLength',a.externalAxisLength,'外部轴联动长度',{integer:true,positive:true});
  numeric('actionParameters.liftHeight',a.liftHeight,'收下枪高度',{integer:true,optional:true});
 }
 const w=settings.wrapParameters,m=settings.mergeParameters,preprocessing=settings.weldPreprocessing;
 if(preprocessing)for(const [key,label] of [['maxHolePlateThickness','过焊孔内允许焊接最大板厚'],['minCornerHoleSize','转角合并最小过焊孔尺寸'],['outerClearance','外角最小空间'],['maxWrapPlateThickness','包角最大板厚']]){
  const value=preprocessing[key];
  if(!empty(value)&&(!Number.isFinite(value)||value<0))add('weldPreprocessing.'+key,label+'须为非负数');
 }
 if(topology){
  for(const [key,label] of [['flat','平角焊'],['vertical','立焊']]){
   const leg=a?.defaultLegs?.[key],field='actionParameters.defaultLegs.'+key;
   if(typeof leg?.enabled!=='boolean')add(field+'.enabled',label+'默认焊脚开关无效');
   if(leg?.mode==='coefficient'&&!(Number.isFinite(leg.coefficient)&&leg.coefficient>0))add(field+'.coefficient',label+'焊脚计算系数须大于0');
   if((leg?.mode==='fixed'||!leg?.mode&&leg?.enabled)&&(!Number.isFinite(leg.height)||leg.height<.5||!Number.isInteger(leg.height*2)))add(field+'.height',label+'默认焊脚高度须大于等于0.5 mm，步长0.5 mm');
  }
  for(const key of ['enabled','angleEnabled','grooveEnabled'])if(typeof m?.[key]!=='boolean')add('mergeParameters.'+key,'相接板端合并开关无效');
  if(m?.enabled&&m.angleEnabled)for(const key of ['angleMin','angleMax'])if(!Number.isFinite(m[key]))add('mergeParameters.'+key,'请填写合并角度范围的上下限');
  if(!preprocessing)numeric('mergeParameters.flatContactGap',m?.flatContactGap,'平角焊焊缝相接最小间隙');
  if(!preprocessing)numeric('mergeParameters.verticalContactGap',m?.verticalContactGap,'立焊焊缝相接最小间隙');
  if(!preprocessing&&w?.flatEnabled)numeric('wrapParameters.outerClearance',w.outerClearance,'外角最小空间');
  if(w?.verticalEnabled)numeric('wrapParameters.verticalDistance',w.verticalDistance,'立焊上包角距离',{positive:true,optional:true});
  const corner=settings.cornerPathParameters;
  numeric('cornerPathParameters.before',corner?.before,'默认转角前距离');
  numeric('cornerPathParameters.after',corner?.after,'默认转角后距离');
  if(!Number.isFinite(corner?.offset))add('cornerPathParameters.offset','默认转角点偏移须为有效数值');
 }
 if(w?.rulesVersion>=2){
  numeric('wrapParameters.gapThreshold',w.gapThreshold,'包角间隙阈值',{integer:true,positive:true,optional:true});
  if(!topology||w.flatEnabled){
   poseCheck('wrapParameters.flatLPose',w.flatLPose,'平角焊L形包角姿态');
   numeric('wrapParameters.independentLength',w.independentLength,'独立焊缝长度',{positive:true});
  }
  numeric('wrapParameters.passHoleThreshold',w.passHoleThreshold,'过焊孔阈值',{integer:true,positive:true});
  if(!topology||w.verticalEnabled)poseCheck('wrapParameters.verticalLPose',w.verticalLPose,'立焊L形包角姿态');
 }
 if(m?.rulesVersion>=2){
  numeric('mergeParameters.passHoleSize',m.passHoleSize,'合并过焊孔尺寸',{positive:true});
  if(m.lengthEnabled)numeric('mergeParameters.maxLength',m.maxLength,'合并长度',{positive:true});
  if(m.countEnabled){
   numeric('mergeParameters.count',m.count,'合并数量',{integer:true,positive:true});
   if(m.count<2)add('mergeParameters.count','合并数量最小为2');
  }
 }
 const split=settings.splitParameters;
 if(split?.rulesVersion>=2)numeric('splitParameters.gapThreshold',split.gapThreshold,'间隙打断阈值',{integer:split.rulesVersion===2,positive:true,optional:true});
 const ends=settings.interferenceEndParameters;
 if(ends)for(const [key,label] of [['startDistance','起点'],['endDistance','终点'],['verticalStartDistance','立焊起点']]){
  numeric('interferenceEndParameters.'+key,ends[key],label+'变姿态距离',{optional:key==='verticalStartDistance'});
 }
 const precision=settings.precisionParameters;
 if(precision){
  for(const [key,label,available] of [['laserPose','线激光标准姿态',capabilities.laserPrecision],['structuredLightPose','结构光标准姿态',capabilities.structuredLightPrecision]]){
   if(available===false)continue;
   poseCheck('precisionParameters.'+key,precision[key],label);
   for(const axis of OFFSET_AXES){
    const value=precision[key]?.[axis];
    if(!empty(value)&&!Number.isFinite(value))add('precisionParameters.'+key+'.'+axis,label+axis.toUpperCase()+'须为有效数值');
   }
  }
  if(capabilities.laserPrecision!==false)for(const [key,label] of [['lineSweepSpeed','直线推扫速度'],['arcSweepSpeed','圆弧推扫速度']]){
   if(!empty(precision[key])&&(!Number.isFinite(precision[key])||precision[key]<=0))add('precisionParameters.'+key,label+'须大于0');
  }
 }
 const direction=settings.sequenceParameters?.scanDirection;
 if(direction!=null&&(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite)||direction.every(value=>value===0)))add('sequenceParameters.scanDirection','扫描方向须填写三个有限数值，且至少一轴非零');
 if(!empty(settings.localMatchDistance)&&(!Number.isFinite(settings.localMatchDistance)||settings.localMatchDistance<=0))add('localMatchDistance','局部模板匹配距离须大于0');
 for(const [group,sensor,available] of [['mixedScan','线激光',capabilities.laserPrecision],['structuredLightMixedScan','结构光',capabilities.structuredLightPrecision]]){
  if(available===false)continue;
  for(const [key,label] of MIXED_SCAN_FIELDS){
   const value=precision?.[group]?.[key];
   if(!empty(value)&&(!Number.isFinite(value)||value<0))add('precisionParameters.'+group+'.'+key,sensor+label+'须为非负数');
  }
 }
 const t=settings.trackingParameters;
 if(t?.rulesVersion===2){
  if(t.laserEnabled)for(const [key,label] of [['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径'],['minEdgeWidth','最小边缘宽度']])numeric('trackingParameters.'+key,t[key],label);
  if(capabilities.laserTracking===false&&t.laserEnabled)add('trackingParameters.laserEnabled','未配置激光跟踪相机，不能开启激光跟踪');
  if(capabilities.arcTracking===false&&t.arcEnabled)add('trackingParameters.arcEnabled','未配置电弧跟踪，不能开启电弧跟踪');
 }
 return issues;
}
export const useCaseSettingsErrors=(settings,capabilities)=>useCaseSettingsIssues(settings,capabilities).map(issue=>issue.message);
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
