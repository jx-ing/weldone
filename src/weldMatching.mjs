import {preferLocalWindows,localMatchDistance} from './localTemplateSearch.mjs';
import {roundWeldLeg} from './planningRequirements.mjs';
import {prepareStrategyGeometry,assignWeldingOrder} from './strategyGeometry.mjs';
import {defaultWeldPosePreview,generateBaseStrategyPlan,generateStrategyPlan,plannedTracking,WELD_POSE_REVISION} from './strategyPlanning.mjs';
import {automaticWeldPoses} from './automaticWeldPoses.mjs';
import {normalizeVerticalWeld,verticalTraversal} from './weldDirectionGeometry.mjs';
import {applyTemplateToWeld,independentWeldTemplate} from './templateModel.mjs';
import {applyProcessEntry,effectiveProcessEntry} from './processParameterModel.mjs';
import {materializeEndpointWraps} from './weldWrapJunctions.mjs';
import {weldLayerLayout,weldLayoutTrackingIssue} from './weldLayerLayout.mjs';
import {laserTrackingSignature} from './laserTrackingDirection.mjs';
import {analyzeWeldMatch,clearMissingWeldTemplates,localTemplateDiagnostics,localTemplateWindows,resolveTemplateBase,templateAvailable,weldTemplateIds} from './weldMatchAnalysis.mjs';
export {MATCH_ROUTES,analyzeWeldMatch,clearMissingWeldTemplates,localTemplateDiagnostics,localTemplateWindows,resolveTemplateBase,weldTemplateIds} from './weldMatchAnalysis.mjs';

function clearApplications(w){const next={...w,template:'',controlPoints:[],layers:[],localApplications:[],automaticPoses:[]};for(const key of ['templateId','templateSnapshot','processId','processName','processParameters','localTemplateId','matchPlan','strategyPlan'])delete next[key];return next;}
function applyLocal(window,fallbackProcess,options){
  const applied=applyTemplateToWeld(window.target,window.template,options);
  const mapPoint=p=>({...p,segment:window.segmentIndices[p.segment-1]+1,
    actualSegment:p.actualSegment===undefined?undefined:window.segmentIndices[p.actualSegment-1]+1});
  const baseProcess=window.baseProcess||fallbackProcess;
  const prefix=`local:${window.template.id}:${window.startSegment}:${window.endSegment}`;
  return {...(baseProcess?{baseProcessParameters:effectiveProcessEntry(baseProcess)}:{}),templateId:window.template.id,name:window.template.name,templateSnapshot:{...structuredClone(window.template),...(window.baseProcess?{baseProcessSnapshot:effectiveProcessEntry(window.baseProcess)}:{})},startSegment:window.startSegment,endSegment:window.endSegment,segmentIndices:window.segmentIndices,controlPoints:applied.controlPoints.map(mapPoint),layers:applied.layers.map(l=>({...l,id:`${prefix}:${l.id}`,passes:l.passes.map(p=>({...p,id:`${prefix}:${p.id}`,controlPoints:p.controlPoints.map(mapPoint)}))}))};
}
export function applySelectedTemplate(w,t,processLibrary=[],options={}){
  if(t.type==='whole'){const template=independentWeldTemplate(t),next={...applyTemplateToWeld(w,template,options),templateSnapshot:structuredClone(template),localApplications:[]};for(const key of ['processId','processName','processParameters','localTemplateId'])delete next[key];for(const key of ['current','voltage','speed'])if(Number.isFinite(t[key])&&t[key]>0)next[key]=t[key];return next;}
  const windows=preferLocalWindows(localTemplateWindows(t,w,options));if(!windows.length)throw Error(localTemplateDiagnostics(t,w,options).reasons.join('；'));
  return {...w,localTemplateId:t.id,localApplications:windows.map(window=>{const base=resolveTemplateBase(t,window.target,processLibrary);if(!base.ok)throw Error(base.reasons.join('；'));return applyLocal({...window,baseProcess:base.process},w.processParameters,options);}),planned:false};
}
function prepareBaseWeld(w,options){
  w=normalizeVerticalWeld(w);
  if(options.planningRevision!==3)return w;
  w={...w,leg:roundWeldLeg(w.leg),strategyPlan:undefined};
  if(options.deviceCapabilities?.laserPrecision===true||w.laserTrackingDirection||w.laserTrackingIssue)w=plannedTracking(w,options);
  if(w.enabled&&!w.mergedInto&&!w.splitInto&&!w.gapJoinError){
    w.strategyPlan=generateBaseStrategyPlan(w,options)??undefined;
  }
  return w;
}

function applyTrajectoryOverlays(w,decision,options){
  const strategy=options.planningRevision===3;
  const basePlan=strategy?w.strategyPlan:undefined;
  if(!decision.ready){
    const base=strategy&&decision.route==='blocked'?clearApplications(w):w;
    const clearedValues=base!==w&&(w.processParameters||w.templateSnapshot)?{current:null,voltage:null,speed:null}:{};
    return {...base,...clearedValues,...(decision.plannedSegments?{segments:decision.plannedSegments}:{}),
      ...(basePlan?{strategyPlan:basePlan}:{}),planned:false,
      matchPlan:{ready:false,route:decision.route,reason:decision.reason||'已屏蔽'}};
  }
  let next;
  if(decision.route==='whole'){
    next=applySelectedTemplate(clearApplications(w),independentWeldTemplate(decision.whole),[],options);
    if(basePlan)next.strategyPlan={...basePlan,templateAngles:true};
  }else{
    next=applyProcessEntry(clearApplications(decision.plannedSegments?{...w,segments:decision.plannedSegments}:w),decision.process);
    if(basePlan)next.strategyPlan=generateStrategyPlan(next,next.processParameters,options)??basePlan;
    if(decision.locals.length){next.localApplications=decision.locals.map(window=>applyLocal(window,decision.process,options));next.localTemplateId=decision.locals[0].template.id;}
  }
  const layerPoses=next.laserTrackingDirection&&(options.laserTrackingByRobot||decision.route==='whole'||next.pointLayout?.length);
  const laserTrackingIssue=layerPoses?weldLayoutTrackingIssue(next,weldLayerLayout(next,decision,[],[],options),options):next.strategyPlan?.laserTrackingIssue;
  if(layerPoses&&next.strategyPlan)next.strategyPlan={...next.strategyPlan,laserTrackingIssue};
  if(laserTrackingIssue)return {...next,planned:false,matchPlan:{ready:false,route:'blocked',reason:laserTrackingIssue}};
  return {...next,automaticPoses:strategy||decision.route==='whole'?[]:automaticWeldPoses(w,decision.locals),planned:!strategy||!!next.strategyPlan,matchPlan:{ready:true,...(strategy?{planningRevision:3}:{}),route:decision.route,localMatchDistance:decision.localMatchDistance,wholeId:decision.whole?.id,processId:decision.route==='whole'?undefined:decision.process?.id,localIds:next.localApplications.map(v=>v.templateId),steps:decision.steps}};
}

export function planWeldFromMatch(w,decision,options={}){
  return applyTrajectoryOverlays(prepareBaseWeld(w,options),decision,options);
}

export function planWeld(w,templates,processLibrary,options={}){
  const base=prepareBaseWeld(w,options);
  return applyTrajectoryOverlays(base,analyzeWeldMatch(base,templates,processLibrary,options),options);
}

export function planWorkspace(welds,templates,processLibrary,options={}){
  const materialized=welds.map(weld=>materializeEndpointWraps(weld,options.wrapParameters));
  if(options.planningRevision!==3)return materialized.map(weld=>planWeld(weld,templates,processLibrary,options));
  const topology=prepareStrategyGeometry(materialized,options);
  const allocated=options.laserTrackingByRobot?assignWeldingOrder(topology,options):topology;
  return assignWeldingOrder(allocated.map(weld=>planWeld(weld,templates,processLibrary,options)),options);
}
export function canPreviewWeld(w,templates=[],processLibrary=[],options={}){
  if(!w?.enabled||w.mergedInto||w.splitInto||w.gapJoinError||verticalTraversal(w.segments,w.position)==='conflict')return false;
  if(w.strategyPlan?.settingsOnly&&!w.matchPlan?.ready)return true;
  if(!w.planned||!w.matchPlan?.ready)return false;
  if(w.templateSnapshot?.enabled===false||w.localApplications?.some(application=>application.templateSnapshot?.enabled===false)||
    weldTemplateIds(w).some(id=>!templateAvailable({id},templates,options)))return false;
  if(w.matchPlan.planningRevision===3)return true;
  if(w.matchPlan.route!=='whole'&&w.matchPlan.localMatchDistance!==undefined&&w.matchPlan.localMatchDistance!==localMatchDistance(options))return false;
  return analyzeWeldMatch(w,templates,processLibrary,options).ready;
}
export function weldPreviewStrategy(weld,whole,process,options){
  if(!weld?.enabled||weld.mergedInto||weld.splitInto||weld.gapJoinError)return null;
  const strategy=weld.strategyPlan;
  const saved=strategy?.poseRevision===WELD_POSE_REVISION&&
    strategy.laserTrackingSignature===laserTrackingSignature(weld,options)?strategy:undefined;
  if(whole){
    if(saved?.templateAngles&&weld.matchPlan?.wholeId===whole.id&&weld.templateId===whole.id)return saved;
    const base=generateBaseStrategyPlan(weld,options);
    return base?{...base,templateAngles:true}:null;
  }
  if(!process)return saved?.settingsOnly&&!saved.templateAngles?saved:defaultWeldPosePreview(weld,options);
  if(saved&&!saved.settingsOnly&&weld.matchPlan?.processId===process.id&&weld.processParameters?.id===process.id&&
     (weld.planned||weld.collisionState))return saved;
  return generateStrategyPlan(plannedTracking(weld,options),process,options);
}
export function restorePlanningState(workspace){
  return {...workspace,welds:workspace.welds.map(weld=>{
    const next=workspace.templates?clearMissingWeldTemplates(weld,workspace.templates):weld;
    return {...next,planned:!!next.planned&&next.matchPlan?.ready===true};
  })};
}
