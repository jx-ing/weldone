export const DEBUG_PASSWORD='000000';
export const OPERATION_GROUPS=['wrapParameters','mergeParameters','splitParameters'];
export const SETTINGS_TABS=[['action','全局焊接设置','actionParameters'],['wrap','包角设置','wrapParameters'],['interference','端点变姿态设置','interferenceEndParameters'],['vision','视觉设置','visionParameters'],['sampling','采样避障设置','samplingAvoidance'],['merge','焊缝合并设置','mergeParameters'],['split','焊缝打断设置','splitParameters']];
export const POSE_AXES=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
const empty=value=>value===undefined||value===null||value==='';
export const asNumber=value=>empty(value)?null:Number(value);
export const defaultNumber=(value,fallback)=>empty(value)?fallback:Number(value);
const pose=value=>Object.fromEntries(POSE_AXES.map(([key])=>[key,value?.[key]??null]));
export function visibleSettingsTabs(mode){return mode==='debug'?SETTINGS_TABS:SETTINGS_TABS.filter(([, ,key])=>OPERATION_GROUPS.includes(key));}
export function settingsDefaults(raw={},capabilities={}){
 const {intermittentParameters,...settings}=structuredClone(raw);
 const {enabled,length,...split}=settings.splitParameters||{};
 const motion=settings.actionParameters||{},wrap=settings.wrapParameters||{},merge=settings.mergeParameters||{},vision=settings.visionParameters||{},tracking=settings.trackingParameters||{},sampling=settings.samplingAvoidance||{},ends=settings.interferenceEndParameters||{};
 return {...settings,actionParameters:{...motion,legMode:motion.legMode??'thickness',legHeight:motion.legHeight??null,verticalDown:motion.verticalDown??false,poseStep:motion.poseStep??10,overlapDistance:motion.overlapDistance??5,staggerDistance:motion.staggerDistance??20,flatPose:pose(motion.flatPose),verticalPose:pose(motion.verticalPose),liftHeight:motion.liftHeight??100,externalAxisLength:motion.externalAxisLength??1500},
  wrapParameters:{...wrap,flatEnabled:wrap.flatEnabled??wrap.enabled??true,verticalEnabled:wrap.verticalEnabled??wrap.enabled??true,lDistanceRatio:wrap.lDistanceRatio||'2/3',uPose:pose(wrap.uPose),flatLPose:pose(wrap.flatLPose),verticalLPose:pose(wrap.verticalLPose),fillEnabled:wrap.fillEnabled??false,fillOffset:wrap.fillOffset??0,fillHoleSize:wrap.fillHoleSize??10,independentLength:defaultNumber(wrap.independentLength,30),passHoleThreshold:defaultNumber(wrap.passHoleThreshold,35),gapThreshold:wrap.gapThreshold??null},
  mergeParameters:{...merge,enabled:merge.enabled??true,countEnabled:merge.countEnabled??Number.isInteger(merge.count),count:merge.count??2,lengthEnabled:merge.lengthEnabled??!empty(merge.maxLength),maxLength:defaultNumber(merge.maxLength,1500),passHoleSize:defaultNumber(merge.passHoleSize,15),angleMin:merge.angleMin??null,angleMax:merge.angleMax??null},
  splitParameters:{...split,gapThreshold:split.gapThreshold??null,edgeThreshold:split.edgeThreshold??null},
  interferenceEndParameters:{...ends,verticalStartDistance:ends.verticalStartDistance??20,startDistance:defaultNumber(ends.startDistance,0),endDistance:defaultNumber(ends.endDistance,0),startPose:pose(ends.startPose),endPose:pose(ends.endPose)},
  visionParameters:{...vision,sweepPose:pose(vision.sweepPose),photoPose:pose(vision.photoPose),twoFaceSpeed:vision.twoFaceSpeed??null,threeFaceSpeed:vision.threeFaceSpeed??null},
  trackingParameters:{...tracking,laserEnabled:capabilities.laserTracking===false?false:tracking.laserEnabled??true,arcEnabled:capabilities.arcTracking===false?false:tracking.arcEnabled??true,minLineLength:tracking.minLineLength??160,minArcDiameter:tracking.minArcDiameter??160,minEdgeWidth:tracking.minEdgeWidth??10},
  samplingAvoidance:{...sampling,enabled:sampling.enabled??true,step:sampling.step??null,autoDeleteUnavoidable:sampling.autoDeleteUnavoidable??false,...Object.fromEntries([['advance',-45,45],['work',-40,50],['rotation',-80,80]].map(([key,min,max])=>[key,{enabled:true,min,max,...sampling[key]}]))}};
}
export function serializeSettings(draft,baseline={},mode='debug',capabilities={}){
 const next=settingsDefaults(draft,capabilities),n=asNumber;
 next.planningRevision=3;
 const action=next.actionParameters;
 action.legHeight=n(action.legHeight);
 action.poseStep=defaultNumber(action.poseStep,10);
 action.overlapDistance=defaultNumber(action.overlapDistance,5);
 action.staggerDistance=defaultNumber(action.staggerDistance,20);
 for(const key of ['flatPose','verticalPose'])next.actionParameters[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(next.actionParameters[key][axis])]));
 next.actionParameters.liftHeight=defaultNumber(next.actionParameters.liftHeight,100);next.actionParameters.externalAxisLength=defaultNumber(next.actionParameters.externalAxisLength,1500);
 const w=next.wrapParameters;w.enabled=w.flatEnabled||w.verticalEnabled;w.independentLength=defaultNumber(w.independentLength,30);w.gapThreshold=n(w.gapThreshold);w.fillOffset=defaultNumber(w.fillOffset,0);w.fillHoleSize=defaultNumber(w.fillHoleSize,10);for(const key of ['flatLPose','verticalLPose'])w[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(w[key][axis])]));w.passHoleThreshold=defaultNumber(w.passHoleThreshold,35);w.uPose=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(w.uPose[axis])]));
 const m=next.mergeParameters;m.rulesVersion=2;m.angleMin=n(m.angleMin);m.angleMax=n(m.angleMax);m.count=n(m.count);m.maxLength=defaultNumber(m.maxLength,1500);m.passHoleSize=defaultNumber(m.passHoleSize,15);m.angleDefinition='included';m.position='flat-flat';m.continuousOnly=true;m.passHoleInclusive=false;delete m.angle;
 for(const key of ['gapThreshold','edgeThreshold'])next.splitParameters[key]=n(next.splitParameters[key]);next.splitParameters.rulesVersion=2;w.rulesVersion=3;next.trackingParameters.rulesVersion=2;
 for(const key of ['startPose','endPose'])next.interferenceEndParameters[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(next.interferenceEndParameters[key][axis])]));
 next.interferenceEndParameters.verticalStartDistance=defaultNumber(next.interferenceEndParameters.verticalStartDistance,20);
 for(const key of ['startDistance','endDistance'])next.interferenceEndParameters[key]=defaultNumber(next.interferenceEndParameters[key],0);
 for(const key of ['sweepPose','photoPose'])next.visionParameters[key]=Object.fromEntries(POSE_AXES.map(([axis])=>[axis,n(next.visionParameters[key][axis])]));
 for(const key of ['twoFaceSpeed','threeFaceSpeed'])next.visionParameters[key]=n(next.visionParameters[key]);
 for(const key of ['minLineLength','minArcDiameter','minEdgeWidth'])next.trackingParameters[key]=n(next.trackingParameters[key]);
 next.samplingAvoidance.step=n(next.samplingAvoidance.step);for(const [key] of POSE_AXES)for(const bound of ['min','max'])next.samplingAvoidance[key][bound]=n(next.samplingAvoidance[key][bound]);
 if(mode==='debug')return next;
 const saved=structuredClone(baseline);
 delete saved.intermittentParameters;
 return {...saved,planningRevision:3,...Object.fromEntries(OPERATION_GROUPS.map(key=>[key,next[key]]))};
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
export function resolveEndpointPose(settings,endpoint,position){const values=settingsDefaults(settings),standard=/^P[FG]/.test(String(position))?values.actionParameters.verticalPose:values.actionParameters.flatPose,overrides=values.interferenceEndParameters[endpoint==='start'?'startPose':'endPose'];return Object.fromEntries(POSE_AXES.map(([key])=>[key,overrides[key]??standard[key]]));}
export function trackingChoice(segment,tracking,capabilities={}){const line=segment.geometry==='直线',diameter=segment.arcDiameter??(segment.shape?.radius!==undefined?segment.shape.radius*2:null),edge=segment.edgeWidth;const laser=tracking.laserEnabled&&capabilities.laserTracking!==false&&((line&&segment.length>=tracking.minLineLength)||(!line&&Number.isFinite(diameter)&&diameter>=tracking.minArcDiameter))&&Number.isFinite(edge)&&edge>=tracking.minEdgeWidth;return laser?'激光跟踪':tracking.arcEnabled&&capabilities.arcTracking!==false?'电弧跟踪':'无跟踪';}
export function useCaseSettingsErrors(settings,capabilities={}){
 const errors=[],decimal=value=>Number.isFinite(value)&&Math.abs(value*10-Math.round(value*10))<1e-8;
 const numeric=(value,label,{integer=false,positive=false,optional=false}={})=>{if(optional&&empty(value))return;if(!Number.isFinite(value)||(positive?value<=0:value<0)||(integer?!Number.isInteger(value):!decimal(value)))errors.push(`${label}须为${positive?'大于0':'大于等于0'}的${integer?'整数':'一位小数'}`);};
 const poseCheck=(value,label)=>{for(const [key,name] of POSE_AXES)if(!empty(value?.[key])&&(!Number.isFinite(value[key])||Math.abs(value[key])>360))errors.push(`${label}${name}须在-360–360°范围内`);};
 if(settings.actionParameters){const a=settings.actionParameters;if(a.legMode==='global'&&(!Number.isFinite(a.legHeight)||a.legHeight<=0||!Number.isInteger(a.legHeight*2)))errors.push('统一焊脚高度须大于0，步长0.5 mm');for(const [key,label] of [['poseStep','焊枪姿态变化步长'],['overlapDistance','起终点搭接距离'],['staggerDistance','起点错开距离']])numeric(a[key],label,{integer:true,positive:true,optional:true});poseCheck(a.flatPose,'平角焊标准姿态');poseCheck(a.verticalPose,'立角焊标准姿态');numeric(a.liftHeight,'收下枪距离焊缝高度',{integer:true,positive:true});numeric(a.externalAxisLength,'外部轴联动长度',{integer:true,positive:true});}
 const w=settings.wrapParameters;if(w?.rulesVersion>=2){numeric(w.gapThreshold,'包角间隙阈值',{integer:true,positive:true,optional:true});numeric(w.fillOffset,'立焊过焊孔填充偏移',{integer:true,optional:true});numeric(w.fillHoleSize,'立焊填充过焊孔尺寸',{integer:true,positive:true,optional:true});poseCheck(w.flatLPose,'平角焊L形包角姿态');poseCheck(w.verticalLPose,'立焊L形包角姿态');numeric(w.independentLength,'独立焊缝长度',{positive:true});numeric(w.passHoleThreshold,'过焊孔包角阈值',{integer:true,positive:true});}
 const m=settings.mergeParameters;if(m?.rulesVersion===2){numeric(m.passHoleSize,'合并过焊孔尺寸',{positive:true});if(m.lengthEnabled)numeric(m.maxLength,'合并长度',{positive:true});if(m.countEnabled){numeric(m.count,'合并数量',{integer:true,positive:true});if(m.count<2)errors.push('合并数量最小为2');}}
 const split=settings.splitParameters;if(split?.rulesVersion===2)numeric(split.gapThreshold,'间隙打断阈值',{integer:true,positive:true,optional:true});
 if(settings.interferenceEndParameters){const e=settings.interferenceEndParameters;numeric(e.startDistance,'起点变姿态距离');numeric(e.endDistance,'终点变姿态距离');numeric(e.verticalStartDistance,'立焊起点变姿态距离',{optional:true});}
 if(settings.visionParameters){const v=settings.visionParameters;poseCheck(v.sweepPose,'推扫标准姿态');poseCheck(v.photoPose,'定点拍照标准姿态');for(const [key,label] of [['twoFaceSpeed','两面交推扫速度'],['threeFaceSpeed','三面交推扫速度']])if(!empty(v[key])&&(!Number.isFinite(v[key])||v[key]<=0))errors.push(`${label}须大于0`);}
 const t=settings.trackingParameters;if(t?.rulesVersion===2){if(t.laserEnabled)for(const [key,label] of [['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径'],['minEdgeWidth','最小边缘宽度']])numeric(t[key],label);if(capabilities.laserTracking===false&&t.laserEnabled)errors.push('未配置激光跟踪相机，不能开启激光跟踪');if(capabilities.arcTracking===false&&t.arcEnabled)errors.push('未配置电弧跟踪，不能开启电弧跟踪');}
 const sampling=settings.samplingAvoidance;if(sampling){if(sampling.enabled!==undefined&&typeof sampling.enabled!=='boolean')errors.push('采样避障总开关无效');if(!empty(sampling.step)&&(!Number.isFinite(sampling.step)||sampling.step<=0))errors.push('采样步长须大于0');}
 return errors;
}
export function wrapChoice(facts,parameters){
 const none='不包角',kind=facts.junctionType,hasHole=facts.hasHole===true,threshold=parameters.passHoleThreshold??35;
 if(['间隙打断','过焊孔打断','长度打断','对称打断'].includes(facts.breakReason))return none;
 const position=String(facts.position||'').split(' · ')[0];
 if(position==='PB'&&parameters.flatEnabled===false||position==='PF'&&parameters.verticalEnabled===false)return none;
 if(kind==='三面交')return hasHole&&facts.plateThickness<=35&&Number.isFinite(facts.holeSize)&&facts.holeSize>=threshold?'L形包角':none;
 if(kind!=='两面交'||!Number.isFinite(facts.gap))return none;
 if(hasHole&&(!Number.isFinite(facts.holeSize)||facts.holeSize<threshold))return none;
 return facts.gap>50?'U形包角':hasHole&&facts.gap<50?'L形包角':none;
}
