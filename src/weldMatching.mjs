import {withinLocalSearch,preferLocalWindows,localMatchDistance} from './localTemplateSearch.mjs';
import {belongsToDevice,strategyScopeIssue,roundWeldLeg} from './planningRequirements.mjs';
import {strategyGeometryRows,assignWeldingOrder} from './strategyGeometry.mjs';
import {generateStrategyPlan,plannedTracking} from './strategyPlanning.mjs';
import {automaticWeldPoses} from './automaticWeldPoses.mjs';
import {directedWeld,directedClosingCorner} from './weldDirectionGeometry.mjs';
import {matchTemplate,targetFromWeld,applyTemplateToWeld,independentWeldTemplate} from './templateModel.mjs';
import {matchProcessEntry,applyProcessEntry,effectiveProcessEntry} from './processParameterModel.mjs';
export const MATCH_ROUTES={whole:'模板规划',local:'工艺参数 + 局部模板',automatic:'策略规划',blocked:'缺少匹配工艺',disabled:'已屏蔽'};
function unique(items){return [...new Set(items.filter(v=>v?.id))];}
const templateAvailable=(t,library)=>t.enabled!==false&&!library.some(v=>v.id===t.id&&v.enabled===false);
function preferred(items,id){return [...items].sort((a,b)=>Number(b.id===id)-Number(a.id===id));}
function templateMatches(t,w,options){try{return matchTemplate(t,targetFromWeld(w),options).ok;}catch{return false;}}
function localCandidates(t,w){
  if(t?.type!=='local'||!w?.segments?.length)return [];
  w=targetFromWeld(w);
  const n=t.segments?.length,count=w.segments.length;if(!n||n>3||n>count)return [];
  const closed=w.closure==='closed';
  if(t.closure==='closed')return [{template:t,target:{...w},segmentIndices:w.sourceSegmentIndices||w.segments.map((_,i)=>i),startSegment:1,endSegment:count}];
  return Array.from({length:closed?count:count-n+1},(_,start)=>{
    const indices=Array.from({length:n},(_,i)=>(start+i)%count),directions=indices.slice(0,-1).map(i=>i===count-1?directedClosingCorner(w):w.cornerDirections?.[i]),angles=directions.map(c=>c?.angle);
    return {template:t,target:{...w,closure:'open',segments:indices.map(i=>w.segments[i]),sourceSegmentIndices:indices.map(i=>w.sourceSegmentIndices[i]),cornerDirections:directions,cornerAngles:angles,length:indices.reduce((sum,i)=>sum+w.segments[i].length,0)},segmentIndices:indices.map(i=>w.sourceSegmentIndices[i]),startSegment:w.sourceSegmentIndices[indices[0]]+1,endSegment:w.sourceSegmentIndices[indices.at(-1)]+1};
  });
}
export function localTemplateWindows(t,w,options={}){return localCandidates(t,w).filter(c=>templateMatches(t,c.target,options)&&withinLocalSearch(c,options));}
export function localTemplateDiagnostics(t,w,options={}){
  if(!w?.segments?.length)return {ok:false,reasons:['请先选择具有焊缝段数据的焊道']};
  if(t.segments?.length>w.segments.length)return {ok:false,reasons:[`焊缝段数量不足（局部模板 ${t.segments.length} 段 / 焊道 ${w.segments.length} 段）`]};
  const candidates=localCandidates(t,w).map(c=>({...c,match:matchTemplate(t,targetFromWeld(c.target),options)}));
  const good=candidates.filter(c=>c.match.ok&&withinLocalSearch(c,options));if(good.length)return {ok:true,reasons:[],matches:good};
  for(const c of candidates)if(c.match.ok&&!withinLocalSearch(c,options))c.match={ok:false,reasons:['连接点或控制点超出前后 '+localMatchDistance(options)+' mm 匹配距离']};
  const closest=candidates.sort((a,b)=>a.match.reasons.length-b.match.reasons.length)[0];
  if(!closest)return {ok:false,reasons:['局部模板的段数或结构无效，请编辑模板补充']};
  const range=closest.segmentIndices.map(i=>i+1).join(' → ');
  return {ok:false,reasons:[`最接近的焊缝段组合：第 ${range} 段（共检查 ${candidates.length} 处）`,...closest.match.reasons.map(reason=>reason.replace(/第 (\d+) 段/g,(_,n)=>`第 ${closest.segmentIndices[Number(n)-1]+1} 段`))],segmentIndices:closest.segmentIndices};
}
function failedTemplate(t,w,options={}){const match=t.type==='local'?localTemplateDiagnostics(t,w,options):matchTemplate(t,targetFromWeld(w),options);return {...match,id:t.id,name:t.name,type:t.type};}
export function resolveTemplateBase(t,w,processLibrary=[]){
  if(t.type==='whole'||!t.baseProcessId)return {ok:true,process:null,reasons:[]};
  const candidates=unique([t.baseProcessSnapshot?.id===t.baseProcessId?t.baseProcessSnapshot:null,...processLibrary.filter(p=>p.id===t.baseProcessId)]);
  const process=candidates.find(p=>{try{return matchProcessEntry(p,w).ok;}catch{return false;}});
  return process?{ok:true,process,reasons:[]}:{ok:false,process:null,reasons:candidates.length?['基础工艺与焊道的匹配条件不一致',...candidates.map(p=>matchProcessEntry(p,w)).sort((a,b)=>a.reasons.length-b.reasons.length)[0].reasons]:['挂载的基础工艺不存在，请重新选择']};
}
export function analyzeWeldMatch(w,templates=[],processLibrary=[],options={}){
  if(w.gapJoinError)return {ready:false,route:'blocked',reason:w.gapJoinError,steps:['路径连接无效','不检查','不检查']};
  if(!w.enabled)return {ready:false,route:'disabled',steps:['已屏蔽','不检查','不检查']};
  const strategy=options.planningRevision===3;
  if(strategy)w={...w,leg:roundWeldLeg(w.leg)};
  const wholeCandidates=unique([w.templateSnapshot?.type==='whole'?w.templateSnapshot:null,...preferred(templates.filter(t=>t.type==='whole'),w.templateId)]).filter(t=>templateAvailable(t,templates));
  if(strategy)wholeCandidates.sort((a,b)=>Number(!!b.defaultForGeometry)-Number(!!a.defaultForGeometry));
  const whole=wholeCandidates.find(t=>templateMatches(t,w,options));
  if(whole)return {ready:true,route:'whole',whole,steps:[`已匹配：${whole.name}`,'无需匹配','无需匹配']};
  const wholeFailures=wholeCandidates.map(t=>failedTemplate(t,w,options));
  if(strategy){
    const reason=strategyScopeIssue(w,options);
    if(reason)return {ready:false,route:'blocked',creation:'template',reason,templateFailures:wholeFailures,steps:['未匹配','仅支持模板规划','不检查']};
    w=plannedTracking(w,options);
  }
  const processCandidates=unique([w.processParameters,...preferred(processLibrary,w.processId)]).filter(p=>!strategy||belongsToDevice(p,options.activeDevice));
  if(strategy)processCandidates.sort((a,b)=>Number((a.processLayers?.flatMap(l=>l.passes).length??1)>1)-Number((b.processLayers?.flatMap(l=>l.passes).length??1)>1));
  const process=processCandidates.find(p=>{try{return matchProcessEntry(p,w).ok;}catch{return false;}});
  if(!process)return {ready:false,route:'blocked',creation:'template-or-process',...(strategy?{plannedSegments:w.segments}:{}),reason:'无匹配的工艺参数，无法进行焊接',templateFailures:wholeFailures,processFailures:processLibrary.map(p=>({id:p.id,name:p.name,reasons:matchProcessEntry(p,w).reasons})),steps:['未匹配','未匹配','不检查']};
  if(strategy)return {ready:true,route:'automatic',process,locals:[],plannedSegments:w.segments,templateFailures:wholeFailures,steps:['未匹配',`已匹配：${process.name}`,'策略规划']};
  const localCandidates=unique([...(w.localApplications||[]).map(a=>a.templateSnapshot),...(w.templateSnapshot?.type==='local'?[w.templateSnapshot]:[]),...preferred(templates.filter(t=>t.type==='local'),w.localTemplateId)]).filter(t=>templateAvailable(t,templates));
  const candidates=[];
  for(const t of localCandidates){for(const window of localTemplateWindows(t,w,options)){const base=resolveTemplateBase(t,window.target,processLibrary);if(base.ok)candidates.push({...window,baseProcess:base.process});}}
  const locals=preferLocalWindows(candidates);
  return {ready:true,route:locals.length?'local':'automatic',process,locals,localMatchDistance:localMatchDistance(options),templateFailures:[...wholeFailures,...localCandidates.filter(t=>!locals.some(a=>a.template.id===t.id)).map(t=>{const fail=failedTemplate(t,w,options);if(fail.ok){const window=localTemplateWindows(t,w,options)[0];if(!window)return {...fail,ok:false,reasons:localTemplateDiagnostics(t,w,options).reasons};const base=resolveTemplateBase(t,window.target,processLibrary);return {...fail,ok:false,reasons:base.ok?['匹配条件已满足，相同焊缝段组合已采用更优先的局部模板']:base.reasons};}return fail;})],steps:['未匹配',`已匹配：${process.name}`,locals.length?`已匹配 ${locals.length} 处焊缝段组合`:'未匹配，使用自动规划']};
}
function clearApplications(w){const next={...w,template:'',controlPoints:[],layers:[],localApplications:[],automaticPoses:[]};for(const key of ['templateId','templateSnapshot','processId','processName','processParameters','localTemplateId','matchPlan','strategyPlan'])delete next[key];return next;}
function applyLocal(window,fallbackProcess,options){
  const applied=applyTemplateToWeld(window.target,window.template,options);
  const mapPoint=p=>({...p,segment:window.segmentIndices[p.segment-1]+1,actualSegment:p.actualSegment!==undefined?window.segmentIndices[p.actualSegment-1]+1:p.actualSegment});
  const baseProcess=window.baseProcess||fallbackProcess;
  const prefix=`local:${window.template.id}:${window.startSegment}:${window.endSegment}`;
  return {...(baseProcess?{baseProcessParameters:effectiveProcessEntry(baseProcess)}:{}),templateId:window.template.id,name:window.template.name,templateSnapshot:{...structuredClone(window.template),...(window.baseProcess?{baseProcessSnapshot:effectiveProcessEntry(window.baseProcess)}:{})},startSegment:window.startSegment,endSegment:window.endSegment,segmentIndices:window.segmentIndices,controlPoints:applied.controlPoints.map(mapPoint),layers:applied.layers.map(l=>({...l,id:`${prefix}:${l.id}`,passes:l.passes.map(p=>({...p,id:`${prefix}:${p.id}`,controlPoints:p.controlPoints.map(mapPoint)}))}))};
}
export function applySelectedTemplate(w,t,processLibrary=[],options={}){
  if(t.type==='whole'){const template=independentWeldTemplate(t),next={...applyTemplateToWeld(w,template,options),templateSnapshot:structuredClone(template),localApplications:[]};for(const key of ['processId','processName','processParameters','localTemplateId'])delete next[key];for(const key of ['current','voltage','speed'])if(Number.isFinite(t[key])&&t[key]>0)next[key]=t[key];return next;}
  const windows=preferLocalWindows(localTemplateWindows(t,w,options));if(!windows.length)throw Error(localTemplateDiagnostics(t,w,options).reasons.join('；'));
  return {...w,localTemplateId:t.id,localApplications:windows.map(window=>{const base=resolveTemplateBase(t,window.target,processLibrary);if(!base.ok)throw Error(base.reasons.join('；'));return applyLocal({...window,baseProcess:base.process},w.processParameters,options);}),planned:false};
}
export function planWeldFromMatch(w,decision,options={}){
  const strategy=options.planningRevision===3;
  if(strategy)w={...w,leg:roundWeldLeg(w.leg)};
  if(!decision.ready)return {...(strategy&&decision.route==='blocked'?clearApplications(w):w),...(decision.plannedSegments?{segments:decision.plannedSegments}:{}),planned:false,matchPlan:{ready:false,route:decision.route,reason:decision.reason||'已屏蔽'}};
  let next;
  if(decision.route==='whole'){
    next=applySelectedTemplate(clearApplications(w),independentWeldTemplate(decision.whole),[],options);
  }else{
    next=applyProcessEntry(clearApplications(decision.plannedSegments?{...w,segments:decision.plannedSegments}:w),decision.process);
    if(strategy)next.strategyPlan=generateStrategyPlan(next,next.processParameters,options);
    if(decision.locals.length){next.localApplications=decision.locals.map(window=>applyLocal(window,decision.process));next.localTemplateId=decision.locals[0].template.id;}
  }
  return {...next,automaticPoses:strategy||decision.route==='whole'?[]:automaticWeldPoses(w,decision.locals),planned:true,matchPlan:{ready:true,...(strategy?{planningRevision:3}:{}),route:decision.route,localMatchDistance:decision.localMatchDistance,wholeId:decision.whole?.id,processId:decision.route==='whole'?undefined:decision.process?.id,localIds:next.localApplications.map(v=>v.templateId),steps:decision.steps}};
}
export function planWorkspace(welds,templates,processLibrary,options={}){
  const rows=welds.map(weld=>{
    const decision=analyzeWeldMatch(weld,templates,processLibrary,options);
    return {weld:decision.plannedSegments?{...weld,segments:decision.plannedSegments}:weld,decision};
  });
  if(options.planningRevision!==3)return rows.map(({weld,decision})=>planWeldFromMatch(weld,decision,options));
  return assignWeldingOrder(strategyGeometryRows(rows,options).map(({weld,decision})=>planWeldFromMatch(weld,decision,options)),options);
}
export function canPreviewWeld(w,templates=[],processLibrary=[],options={}){if(!w?.enabled||!w.planned||!w.matchPlan?.ready)return false;const used=[w.templateSnapshot,...(w.localApplications||[]).map(a=>a.templateSnapshot)].filter(Boolean);if(used.some(t=>!templateAvailable(t,templates)))return false;if(w.matchPlan.planningRevision===3)return true;if(w.matchPlan.route!=='whole'&&w.matchPlan.localMatchDistance!==undefined&&w.matchPlan.localMatchDistance!==localMatchDistance(options))return false;return analyzeWeldMatch(w,templates,processLibrary,options).ready;}
export function restorePlanningState(d){return {...d,welds:d.welds.map(w=>({...w,planned:!!w.planned&&w.matchPlan?.ready===true}))};}
