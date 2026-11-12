import {PROCESS_TYPES} from './processLibraryView.mjs';
import {newCornerPointGroups,newWrapPoints,processFeaturePointChanges} from './processFeaturePoints.mjs';
import {grooveType,grooveValue,validGroove,grooveFieldsFor} from './grooveModel.mjs';
import {migrateProcessWeldForms,migrateProcessPasses,normalizeCornerOffsets,processWeldForms,roundWeldLeg,weldForm,weldPositionCode} from './planningRequirements.mjs';
import {GROOVES,POSITIONS} from './templateModel.mjs';
export const MACHINE_MODES={synergic:'一元',separate:'分别',job:'JOB'};
export const WELDING_MODES={dc:'直流',pulse:'脉冲'};
export const WEAVE_PATTERNS={sine:'正弦摆动',triangle:'三角摆动',l:'L摆动'};
export const WIRE_TYPES=['实芯焊丝','药芯焊丝'];
export const WIRE_DIAMETERS=[1,1.2,1.4,1.6];
export const SHIELD_GASES=['CO2','80%Ar+20%CO2','80%CO2+20%AR'];
export const WELD_METHODS=['MIG','MAG'];
export const MATERIALS=['低碳钢','不锈钢','铝合金','Q235碳钢','Q345不锈钢','SPHC'];
const weave=()=>({enabled:false,pattern:'sine',amplitude:null,frequency:null,dwellLeft:0,dwellRight:0});
const passKeys=['machineMode','weldingMode','start','weld','end','offset','angles','weave','cornerWeave','wrapWeave','cornerParameters','wrapParameters','legacyCornerParameters','cornerDistances','cornerOffsets','cornerSpeeds'];
const uid=()=>crypto.randomUUID();
export function newProcessPass(){return {id:uid(),name:'第 1 道',machineMode:'separate',weldingMode:'dc',start:{current:null,voltage:null,correction:0,time:0,job:null},weld:{current:null,voltage:null,correction:0,speed:null,job:null},end:{current:null,voltage:null,correction:0,time:0,job:null},offset:{y:0,z:0},angles:{pushPull:0,pitch:0},weave:weave(),cornerParameters:newCornerPointGroups(),wrapParameters:newWrapPoints(),cornerDistances:{inner:{before:null,after:null},outer:{before:null,after:null}},cornerOffsets:{inner:null,outer:null}};}
function passValues(p){return Object.fromEntries(passKeys.filter(k=>p[k]!==undefined).map(k=>[k,structuredClone(p[k])]));}
export function newProcessEntry(){return {id:uid(),name:'',leg:null,position:'',weldForms:['角焊缝'],groove:{type:'无坡口',angle:0,depth:0},applicability:{welderModel:'',wireType:WIRE_TYPES[0],wireDiameter:1.2,gas:SHIELD_GASES[0],method:'MAG',material:'低碳钢'},...passValues(newProcessPass())};}
export function ensureProcessLayers(p){
  p=migrateProcessPasses(p);
  if(p.processLayers!==undefined)return structuredClone(p);
  return {...structuredClone(p),processLayers:[{id:uid(),name:'第 1 层',passes:[{id:uid(),name:'第 1 道',...passValues(p)}]}]};
}
export function processPasses(p){return p.processLayers?p.processLayers.flatMap((layer,li)=>layer.passes.map((pass,pi)=>({layer,pass,layerIndex:li,passIndex:pi}))):[{layer:{name:'第 1 层'},pass:p,layerIndex:0,passIndex:0}];}
function withLayers(p,processLayers){return {...p,processLayers,...passValues(processLayers[0].passes[0])};}
export function updateProcessPass(p,id,values){return withLayers(p,p.processLayers.map(l=>({...l,passes:l.passes.map(pass=>pass.id===id?{...pass,...values}:pass)})));}
export function updateProcessCorner(p,id,index,values){const pass=processPasses(p).find(row=>row.pass.id===id)?.pass;if(!pass||!Number.isInteger(index)||index<0||index>19)throw Error('拐角参数位置无效');if(pass.cornerParameters&&!Array.isArray(pass.cornerParameters))return updateProcessFeaturePoint(p,id,index<3?'inner':'outer',index<3?index:index-3,values);const corners=structuredClone(pass.cornerParameters||[]);while(corners.length<=index)corners.push({enabled:false,current:null,voltage:null,correction:0,time:0,job:null});corners[index]={...corners[index],...values};return updateProcessPass(p,id,{cornerParameters:corners});}
export function updateProcessFeaturePoint(p,id,kind,index,values){const pass=processPasses(p).find(row=>row.pass.id===id)?.pass;if(!pass)throw Error('工艺道不存在');return updateProcessPass(p,id,processFeaturePointChanges(pass,kind,index,values));}
function nextName(list,unit){let n=1;while(list.some(v=>v.name===`第 ${n} ${unit}`))n++;return `第 ${n} ${unit}`;}
export function addProcessLayer(p,sourceId){const source=processPasses(p).find(v=>v.pass.id===sourceId)?.pass||p.processLayers[0].passes[0];return withLayers(p,[...p.processLayers,{id:uid(),name:nextName(p.processLayers,'层'),passes:[{...structuredClone(source),id:uid(),name:'第 1 道'}]}]);}
export function addProcessPass(p,layerId,sourceId){const source=processPasses(p).find(v=>v.pass.id===sourceId)?.pass||p.processLayers[0].passes[0];return withLayers(p,p.processLayers.map(l=>l.id===layerId?{...l,passes:[...l.passes,{...structuredClone(source),id:uid(),name:nextName(l.passes,'道')}]}:l));}
export function removeProcessLayer(p,id){return p.processLayers.length>1?withLayers(p,p.processLayers.filter(l=>l.id!==id)):p;}
export function removeProcessPass(p,layerId,id){return withLayers(p,p.processLayers.map(l=>l.id===layerId&&l.passes.length>1?{...l,passes:l.passes.filter(pass=>pass.id!==id)}:l));}
export function moveProcessPass(p,layerId,id,direction=-1){return withLayers(p,p.processLayers.map(layer=>{if(layer.id!==layerId)return layer;const passes=[...layer.passes],index=passes.findIndex(pass=>pass.id===id),next=index+direction;if(index<0||next<0||next>=passes.length)return layer;[passes[index],passes[next]]=[passes[next],passes[index]];return {...layer,passes};}));}
const finite=(v,min=-Infinity)=>Number.isFinite(v)&&v>=min;
function validatePass(p,modern=false,allowLegacyZero=false){
  const decimal=(value,digits)=>Number.isFinite(value)&&Math.abs(value*10**digits-Math.round(value*10**digits))<1e-8;
  const integerRange=(value,min,max=Infinity)=>Number.isInteger(value)&&value>=min&&value<=max;
  const minSpeed=modern&&!allowLegacyZero?1:0;
  const errors=[];
  const cornerOffsets=normalizeCornerOffsets(p.cornerOffsets);
  if(cornerOffsets!==undefined){
    if(!cornerOffsets||typeof cornerOffsets!=='object'||Array.isArray(cornerOffsets))errors.push('转角点偏移参数无效');
    else for(const [kind,label] of [['inner','内角'],['outer','外角']]){const offset=cornerOffsets[kind];if(offset!=null&&!finite(offset))errors.push(label+'转角点偏移应为有效数值');}
  }
  if(p.cornerDistances!==undefined){
    if(!p.cornerDistances||typeof p.cornerDistances!=='object'||Array.isArray(p.cornerDistances))errors.push('拐角距离参数无效');
    else for(const [kind,label] of [['inner','内角'],['outer','外角']]){
      const distances=p.cornerDistances[kind];if(distances===undefined)continue;
      if(!distances||typeof distances!=='object'||Array.isArray(distances)){errors.push(`${label}拐角距离参数无效`);continue;}
      for(const [key,name] of [['before','转角前距离'],['after','转角后距离']])if(distances[key]!==undefined&&distances[key]!==null&&!finite(distances[key],0))errors.push(`${label}${name}应为非负数`);
    }
  }
  if(!Object.hasOwn(MACHINE_MODES,p.machineMode))errors.push('请选择焊机参数类型');
  if(p.machineMode!=='job'&&!Object.hasOwn(WELDING_MODES,p.weldingMode))errors.push('请选择直流或脉冲焊接模式');
  function phase(value,label){
    if(!value){errors.push(`${label}参数缺失`);return;}
    if(modern&&p.machineMode!=='job'){
      if(!integerRange(value.current,100,500))errors.push(label+'电流须为100–500 A的整数');
      if(p.machineMode==='separate'&&!integerRange(value.voltage,10,50))errors.push(label+'电压须为10–50 V的整数');
      if(p.machineMode==='synergic'&&!finite(value.correction))errors.push(label+'须填写电压修正百分数');
      return;
    }
    if(p.machineMode==='job'){if(!Number.isInteger(value.job)||value.job<0)errors.push(`${label}JOB号必须为大于等于 0 的整数`);}
    else {if(!finite(value.current,Number.MIN_VALUE))errors.push(`${label}电流必须大于 0`);if(p.machineMode==='separate'&&!finite(value.voltage,Number.MIN_VALUE))errors.push(`${label}电压必须大于 0`);if(p.machineMode==='synergic'&&!finite(value.correction))errors.push(`${label}电压修正值必须为有效数值`);}
  }
  phase(p.start,'起弧');phase(p.weld,'焊接');phase(p.end,'收弧');
  const pointSet=(values,label,count)=>{if(!Array.isArray(values)||(count!==undefined?values.length!==count:values.length>20)){errors.push(count===undefined?'拐角参数最多20组':`${label}必须包含${count}个点`);return;}values.forEach((value,i)=>{const name=label+(i+1);if(!value||typeof value.enabled!=='boolean')errors.push(`${name}启用状态无效`);else if(value.enabled){phase(value,name);if(!finite(value.time,0))errors.push(`${name}动作时间必须大于等于0`);if(value.weave!==undefined)validateWeave(value.weave,`${name}摆弧`);}});};
  if(p.cornerParameters!==undefined){if(Array.isArray(p.cornerParameters))pointSet(p.cornerParameters,'拐角');else if(!p.cornerParameters||typeof p.cornerParameters!=='object')errors.push('拐角参数类型无效');else{pointSet(p.cornerParameters.inner,'内角点',3);pointSet(p.cornerParameters.outer,'外角点',3);}}
  if(p.wrapParameters!==undefined)pointSet(p.wrapParameters,'包角点',7);
  if(modern&&[p.start?.time,p.end?.time].some(value=>!decimal(value,2)))errors.push('起收弧动作时间最多两位小数');
  if(!finite(p.start?.time,0)||!finite(p.end?.time,0))errors.push('起弧时间、收弧时间必须大于等于 0');
  if(modern?(!Number.isFinite(p.weld?.speed)||!integerRange(p.weld.speed/10,minSpeed)):!finite(p.weld?.speed,Number.MIN_VALUE))errors.push(modern?'焊接速度须为大于0的整数 cm/min':'焊接速度必须大于 0');
  function validateWeave(value,label){if(!value||typeof value.enabled!=='boolean'){errors.push(`${label}启用状态无效`);return;}if(value.enabled&&value.pattern!==undefined&&!Object.hasOwn(WEAVE_PATTERNS,value.pattern))errors.push(`${label}请选择有效的摆动方式`);if(modern&&value.enabled){for(const [key,digits] of [['amplitude',1],['frequency',1],['dwellLeft',2],['dwellRight',2],['centerOffset',1]])if(!finite(value[key],0)||!decimal(value[key],digits))errors.push(label+'：'+({amplitude:'振幅',frequency:'频率',dwellLeft:'左停留时间',dwellRight:'右停留时间',centerOffset:'中央隆起度'})[key]+'缺失或精度不符');return;}if(value.enabled&&(!finite(value.amplitude,Number.MIN_VALUE)||!finite(value.frequency,Number.MIN_VALUE)||!finite(value.dwellLeft,0)||!finite(value.dwellRight,0)))errors.push(`${label}需填写正数幅度、频率和非负停留时间`);}
  for(const [key,label] of [['cornerWeave','拐角摆弧'],['wrapWeave','包角摆弧']])if(p[key]!==undefined)validateWeave(p[key],label);
  if(!p.offset||!finite(p.offset.y)||!finite(p.offset.z))errors.push('Y、Z 偏移必须为有效数值');
  if(!p.angles||!finite(p.angles.pushPull)||!finite(p.angles.pitch))errors.push('推拉角、俯仰角必须为有效数值');
  if(modern){
    const offsets=[p.offset?.y,p.offset?.z,...Object.values(cornerOffsets??{}).filter(value=>value!=null)];
    if(offsets.some(value=>!decimal(value,1)||value < -50||value > 50))errors.push('偏移须为-50–50 mm的一位小数');
    if([p.angles?.pushPull,p.angles?.pitch].some(value=>!integerRange(value,0)))errors.push('前进角和工作角须为非负整数');
    if(Object.values(p.cornerSpeeds??{}).some(value=>value!=null&&!integerRange(value/10,minSpeed)))errors.push('转角速度须为大于0的整数 cm/min');
  }
  validateWeave(p.weave,'摆动参数');return errors;
}
export function validateProcessEntry(p,{allowLegacyLeg=false}={}){
  if(!p||typeof p!=='object')return ['工艺参数结构无效'];
  const errors=[];
  if(typeof p.id!=='string'||!p.id||(typeof p.name!=='string'||!p.name.trim())||p.name.length>80)errors.push('请输入 1–80 字工艺名称');
  if(!(allowLegacyLeg&&p.leg===undefined)&&(!finite(p.leg,0.5)||!Number.isInteger(p.leg*2)))errors.push('焊脚必须为大于等于 0.5 mm 的数值，步长为 0.5 mm');
  if(!(allowLegacyLeg&&p.position===undefined)&&!POSITIONS.includes(p.position))errors.push('请选择焊接位置');
  if(p.recipeRevision===3){
    if(!['PB','PF','PG'].includes(weldPositionCode(p.position)))errors.push('请选择平角焊或立焊');
    if(!Array.isArray(p.weldForms)||!p.weldForms.length||p.weldForms.some(value=>!['角焊缝','搭接焊缝'].includes(value)))errors.push('请选择焊缝形式');
    if(typeof p.arcTracking!=='boolean')errors.push('请选择是否使用电弧跟踪');
    if(!p.applicability?.deviceProfileId)errors.push('请选择启用的焊接设备');
  }
  if(p.processType!==undefined&&!Object.hasOwn(PROCESS_TYPES,p.processType))errors.push('请选择有效的工艺类型');
  if(!validGroove(p.groove))errors.push('请完善坡口类型、角度、深度、根部间隙和根部半径');
  if(!(allowLegacyLeg&&p.applicability===undefined)){
    const a=p.applicability;
    if(!a||typeof a.welderModel!=='string'||!a.welderModel.trim()||a.welderModel.length>80)errors.push('请输入焊机型号（最多80字）');
    if(!a||!WIRE_TYPES.includes(a.wireType)||!WIRE_DIAMETERS.includes(a.wireDiameter)||!SHIELD_GASES.includes(a.gas)||!WELD_METHODS.includes(a.method)||!MATERIALS.includes(a.material))errors.push('请完善焊丝类型、直径、保护气体、焊接方法和母材');
  }
  if(p.processLayers!==undefined){
    const layers=p.processLayers;
    if(!Array.isArray(layers)||!layers.length||layers.length>20||layers.some(l=>!l||typeof l.id!=='string'||!l.id||typeof l.name!=='string'||!l.name.trim()||!Array.isArray(l.passes)||!l.passes.length||l.passes.length>50))return [...errors,'每套工艺需要1–20层，每层1–50道'];
    const passes=layers.flatMap(l=>l.passes);
    if(passes.length>200||new Set(layers.map(l=>l.id)).size!==layers.length||new Set(passes.map(v=>v?.id)).size!==passes.length)errors.push('工艺层道编号重复或总道数超过200');
    layers.forEach((l,li)=>l.passes.forEach((pass,pi)=>{if(!pass||typeof pass.id!=='string'||!pass.id||typeof pass.name!=='string'||!pass.name.trim())errors.push(`第${li+1}层/第${pi+1}道名称或编号无效`);if(pass)errors.push(...validatePass(pass,p.recipeRevision===3,allowLegacyLeg).map(v=>`第${li+1}层/第${pi+1}道：${v}`));}));
  }else errors.push(...validatePass(p,p.recipeRevision===3,allowLegacyLeg));
  return errors;
}
function effectivePass(p){
  const phase=v=>p.machineMode==='job'?{job:v.job}:p.machineMode==='synergic'?{current:v.current,correction:v.correction}:{current:v.current,voltage:v.voltage};
  const effectiveWeave=v=>v.enabled?structuredClone(v):{enabled:false};
  const point=v=>v.enabled?{enabled:true,...phase(v),time:v.time,...(v.weave!==undefined?{weave:effectiveWeave(v.weave)}:{})}:{enabled:false};
  return {...(p.cornerSpeeds?{cornerSpeeds:structuredClone(p.cornerSpeeds)}:{}),...(p.cornerOffsets!==undefined?{cornerOffsets:normalizeCornerOffsets(p.cornerOffsets)}:{}),...(p.cornerDistances!==undefined?{cornerDistances:structuredClone(p.cornerDistances)}:{}),machineMode:p.machineMode,...(p.machineMode!=='job'?{weldingMode:p.weldingMode}:{}),start:{...phase(p.start),time:p.start.time},weld:{...phase(p.weld),speed:p.weld.speed},end:{...phase(p.end),time:p.end.time},offset:structuredClone(p.offset),angles:structuredClone(p.angles),weave:effectiveWeave(p.weave),...(p.cornerWeave?{cornerWeave:effectiveWeave(p.cornerWeave)}:{}),...(p.wrapWeave?{wrapWeave:effectiveWeave(p.wrapWeave)}:{}),...(p.cornerParameters!==undefined?{cornerParameters:Array.isArray(p.cornerParameters)?p.cornerParameters.map(point):{inner:p.cornerParameters.inner.map(point),outer:p.cornerParameters.outer.map(point)}}:{}),...(p.wrapParameters!==undefined?{wrapParameters:p.wrapParameters.map(point)}:{})};
}
export function effectiveProcessEntry(p){
  const errors=validateProcessEntry(p,{allowLegacyLeg:true});if(errors.length)throw Error(errors.join('；'));
  const processLayers=p.processLayers?.map(l=>({id:l.id,name:l.name,passes:l.passes.map(pass=>({id:pass.id,name:pass.name,...effectivePass(pass)}))}));
  return {id:p.id,name:p.name,...(p.leg!==undefined?{leg:p.leg}:{}),...(p.position!==undefined?{position:p.position}:{}),...(p.applicability?{applicability:structuredClone(p.applicability)}:{}),weldForms:structuredClone(processWeldForms(p)),...(p.recipeRevision===3?{recipeRevision:3,arcTracking:p.arcTracking}:{}),groove:p.groove.type==='无坡口'?{type:'无坡口',angle:0,depth:0}:structuredClone(p.groove),...(processLayers?{processLayers}:{}),...effectivePass(processLayers?processLayers[0].passes[0]:p)};
}
export function matchProcessEntry(p,w){
  const reasons=[];if(!w)return {ok:false,reasons:['请先在模型中选择焊道']};
  if(p?.leg===undefined)return {ok:false,reasons:['请先编辑工艺并补充焊脚']};
  if(p.position===undefined||p.applicability===undefined)return {ok:false,reasons:['请先编辑工艺并补充适用条件和焊接位置']};
  const invalid=validateProcessEntry(p);if(invalid.length)return {ok:false,reasons:invalid.map(v=>'工艺参数无效：'+v)};
  if(roundWeldLeg(w.leg)!==p.leg)reasons.push(`焊脚不一致（工艺 ${p.leg} mm / 焊道 ${w.leg} mm）`);
  const segments=w.segments?.length?w.segments:[w];
  if(!processWeldForms(p).includes(weldForm(w)))reasons.push('焊缝形式不一致');
  if(typeof p.arcTracking==='boolean'&&p.arcTracking!==segments.some(s=>(s.tracking??w.tracking)==='电弧跟踪'))reasons.push('电弧跟踪条件不一致');
  segments.forEach((s,i)=>{if(p.recipeRevision===3?(['PF','PG'].includes(weldPositionCode(p.position))?!['PF','PG'].includes(weldPositionCode(s.position)):weldPositionCode(s.position)!==weldPositionCode(p.position)):s.position!==p.position)reasons.push(`第 ${i+1} 段焊接位置不一致（工艺 ${p.position} / 焊道 ${s.position??'未提供'}）`);});
  const groove=w.groove||{type:'无坡口',angle:0,depth:0};
  if(grooveType(groove.type)!==grooveType(p.groove.type))reasons.push(`坡口类型不一致（工艺 ${p.groove.type} / 焊道 ${groove.type??'未提供'}）`);else if(groove.type!=='无坡口'){if(grooveType(groove.type)!=='I 形'&&groove.angle!==p.groove.angle)reasons.push(`坡口角度不一致（工艺 ${p.groove.angle}° / 焊道 ${groove.angle??'未提供'}°）`);for(const [key,label] of grooveFieldsFor(groove.type).filter(([key])=>key!=='angle'&&key!=='depth'))if(grooveValue(groove,key)!==grooveValue(p.groove,key))reasons.push(label+'不一致（工艺 '+grooveValue(p.groove,key)+' mm / 焊道 '+(grooveValue(groove,key)??'未提供')+' mm）');if(groove.depth!==p.groove.depth)reasons.push(`坡口深度不一致（工艺 ${p.groove.depth} mm / 焊道 ${groove.depth??'未提供'} mm）`);}
  return {ok:!reasons.length,reasons};
}
export function applyProcessEntry(w,p){
  const match=matchProcessEntry(p,w);if(!match.ok)throw Error(match.reasons.join('；'));
  const processParameters=effectiveProcessEntry(p);
  const next={...w,processId:p.id,processName:p.name,processParameters,speed:processParameters.weld.speed,planned:false};
  if(processParameters.machineMode==='job'){delete next.current;delete next.voltage;}else{next.current=processParameters.weld.current;if(processParameters.machineMode==='separate')next.voltage=processParameters.weld.voltage;else delete next.voltage;}
  return next;
}
export function upsertProcessEntry(list,p){const errors=validateProcessEntry(p);if(errors.length)throw Error(errors.join('；'));const saved=structuredClone({...migrateProcessWeldForms(p),name:p.name.trim(),applicability:{...p.applicability,welderModel:p.applicability.welderModel.trim()}});return list.some(item=>item.id===p.id)?list.map(item=>item.id===p.id?saved:item):[...list,saved];}
export function copyProcessEntry(p){const copy={...structuredClone(migrateProcessPasses(p)),id:uid(),name:p.name.slice(0,72)+' · 副本'};if(copy.processLayers)copy.processLayers=copy.processLayers.map(l=>({...l,id:uid(),passes:l.passes.map(pass=>({...pass,id:uid()}))}));return copy;}
export function validWeldProcessParameters(w){const p=w.processParameters;if((['extracted','manual-merge'].includes(w.source)||w.source==='manual'&&(typeof w.splitFrom?.id==='string'||w.current===null&&w.voltage===null))&&!p)return ['current','voltage'].every(k=>w[k]===null||finite(w[k],Number.MIN_VALUE));if(p&&validateProcessEntry(p,{allowLegacyLeg:true}).length)return false;const first=p?processPasses(p)[0].pass:null;return (first?.machineMode==='job'||finite(w.current,Number.MIN_VALUE))&&(['job','synergic'].includes(first?.machineMode)||finite(w.voltage,Number.MIN_VALUE));}
export function effectivePointOverrides(overrides,mode){return Object.fromEntries(Object.entries(overrides||{}).filter(([key])=>!(mode==='job'&&['current','voltage','correction','weldingMode'].includes(key))&&!(mode==='synergic'&&key==='voltage')&&!(mode==='separate'&&key==='correction')));}
