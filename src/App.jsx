import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {EmptyState as Empty, Feedback, IconTooltips, PageHeader, formatLength, useModalScrollLock} from './WorkspaceUI';
import { PanelLeftClose, PanelLeftOpen, PanelRightOpen, PanelRightClose, MoreHorizontal, Settings, Plus, ChevronDown, Upload, X, Box, Search, Trash2, RotateCcw, CircleHelp, FolderOpen, Maximize2, Minimize2, Filter, Copy, FileJson, Cable, Layers } from 'lucide-react';
import Viewer from './StepViewer';
import {MAX_PLANNING_WELDS,planningContext,roundWeldLeg,belongsToDevice} from './planningRequirements.mjs';
import {validGroove} from './grooveModel.mjs';
import PlanningSettings from './PlanningSettings';
import {settingsDefaults,updateProjectPlanning} from './planningSettingsModel.mjs';
import {mergeIncludedAngleRange,DEFAULT_MERGE_ANGLE_RANGE,DEFAULT_MERGE_GAP} from './planningConfiguration.mjs';
import {preprocessExtractedWelds} from './weldPreprocessing.mjs';
import PlanningLibraryPicker from './PlanningLibraryPicker';
import PlanningModelTools from './PlanningModelTools';
import {geometryOptionsForPlanning} from './planningConfiguration.mjs';
import {canSeparateWeldSegments,separateWeldSegments,weldPointDistance,splitSelectedWeld,undoLastSplit,planeSplitStations,installWrapSplit} from './manualSplitModel.mjs';
import {segmentName} from './weldAttributeModel.mjs';
import './planningWorkspace.css';
import WeldMergeDialog from './WeldMergeDialog';
import {mergeSelectedWelds,undoManualMerge} from './manualMergeModel.mjs';
import {excludeConfirmedNonWelds,isConfirmedNonWeldKey} from './confirmedNonWelds.mjs';
import {DEMO_SOURCE_SHA256,DEFAULT_GEOMETRY_OPTIONS,installGeometryResult,restoreGeometryResult,validExtractedWeld,removablePlanningWeld,removePlanningWelds} from './geometryProcessingModel.mjs';
import './geometryProcessing.css';
import {EXAMPLE_MODEL,useStepExample,validManualWeldPath} from './manualWeldModel.mjs';
import {cacheStepMesh,cacheStepNeighborhood,isDemoModel,loadStepNeighborhood,stepModelKey,switchStepWorkspace,validStepModel} from './stepModelStore.mjs';
import {splitWeldWrap,weldWrapJunctions} from './weldWrapJunctions.mjs';
import {createPlanningCollisionPool} from './planningCollisionPool.mjs';
import {loadWorkspaceDraft,saveWorkspaceDraft} from './workspaceDraftStore.mjs';
import ViewCube from './ViewCube';
import TemplateLibrary, {TemplateEditor} from './TemplateLibrary';
import {newPlanningTemplate} from './templateCoverModel.mjs';
import {DEFAULT_TEMPLATE_CAPTURE_RANGE,validTemplateCaptureRange} from './templateCaptureRange.mjs';
import {createTemplateNeighborhoodMeasurer,loadDemoTemplateNeighborhood} from './templateNeighborhood.mjs';
import {templateGeometryKey} from './templateGeometryRules.mjs';
import WeldAttributes from './WeldAttributes';
import {copyWeldLayersToTemplate,nextWeldLayer,nextWeldPass,removeWeldLayoutItem,updateWeldLayoutPoint,validWeldLayerLayout,weldLayerLayout,weldLayerPassPaths,weldLayerTreeGroups,weldPointPlacement,weldPointPosition} from './weldLayerLayout.mjs';
import WeldPointTree from './WeldPointTree';
import WeldControlPointForm from './WeldControlPointForm';
import {analyzeWeldMatch,planWorkspace,applySelectedTemplate,restorePlanningState,planWeldFromMatch,clearMissingWeldTemplates,weldTemplateIds} from './weldMatching.mjs';
import ProcessParameterLibrary from './ProcessParameterLibrary';
import DeviceControl from './DeviceControl';
import {generateStrategyPlan,plannedTracking} from './strategyPlanning.mjs';
import {deviceControlError,migrateDeviceControl} from './deviceControlModel.mjs';
import ProductionStatisticsWorkspace from './ProductionStatisticsWorkspace';
import {planningTaskDocument,readPlanningTask} from './planningTask.mjs';
import {deviceLibraryUpdates,restoreDeviceLibrary,clearRemovedProcess} from './processDeviceLibraries.mjs';
import {validDeviceProfileStore} from './processDeviceModel.mjs';
import {validateProcessEntry,applyProcessEntry,validWeldProcessParameters} from './processParameterModel.mjs';
import { migrateDraft, validateTemplate, validateFixed, wholeWeldSourceIssues,matchTemplate,targetFromWeld } from './templateModel.mjs';
const modules = ['工艺规划', '焊接模板库', '工艺参数库', '设备控制', '生产统计'];
const defaults = migrateDraft({ model: EXAMPLE_MODEL, welds: [], selected: '', project: '本地项目', templates: [{ id: 'TPL-001', name: '碳钢横角焊 · 6 mm', position: 'PB · 横角焊', leg: 6, current: 210, voltage: 24.5, speed: 340 }, { id: 'TPL-002', name: '薄板角焊 · 5 mm', position: 'PB · 横角焊', leg: 5, current: 180, voltage: 23, speed: 360 }, { id: 'TPL-003', name: '立向上焊 · 5 mm', position: 'PF · 立向上焊', leg: 5, current: 160, voltage: 22, speed: 220 }] });
function valid(v) { try { const d = migrateDraft(v); return typeof d.model === 'string' && (!d.stepModel||validStepModel(d.stepModel)) && typeof d.project === 'string' && (d.templateCaptureRange===undefined||validTemplateCaptureRange(d.templateCaptureRange)) && (d.templateProjects===undefined||Array.isArray(d.templateProjects)&&d.templateProjects.length<1000&&new Set(d.templateProjects).size===d.templateProjects.length&&d.templateProjects.every(p=>typeof p==='string'&&p.trim()===p&&p.length>0&&p.length<=80)) && typeof d.selected === 'string' && Array.isArray(d.welds) && d.welds.length <= MAX_PLANNING_WELDS && new Set(d.welds.map(w => w.id)).size === d.welds.length && d.welds.every(w => /^W[0-9]{3,6}$/.test(w.id) && typeof w.name === 'string' && typeof w.position === 'string' && typeof w.template === 'string' && typeof w.enabled === 'boolean' && validWeldLayerLayout(w.pointLayout) && validManualWeldPath(w,d.model) && validExtractedWeld(w,d) && (d.model!==EXAMPLE_MODEL||['manual','extracted','manual-merge'].includes(w.source)) && Number.isFinite(w.length)&&w.length>0 && ['leg','speed'].every(k=>(['extracted','manual-merge'].includes(w.source)||w.splitFrom||w.source==='manual'&&w.current===null&&w.voltage===null)&&w[k]===null||Number.isFinite(w[k])&&(k==='speed'&&w.processParameters?.recipeRevision===3?w[k]>=0:w[k]>0)) && validWeldProcessParameters(w)) && d.templates.length < 1000 && new Set(d.templates.map(t => t.id)).size === d.templates.length && d.templates.every(t => !validateTemplate(t).filter(e=>!e.includes('请选择有效基准点')).length) && Array.isArray(d.fixedTemplates) && d.fixedTemplates.length < 1000 && new Set(d.fixedTemplates.map(t => t.id)).size === d.fixedTemplates.length && d.fixedTemplates.every(t => !validateFixed(t).filter(e=>!e.includes('请选择有效基准点')).length) && (d.deviceControl===undefined||!deviceControlError(d.deviceControl)) && validDeviceProfileStore(d.processDeviceProfiles) && Array.isArray(d.processLibrary) && d.processLibrary.length < 1000 && new Set(d.processLibrary.map(p=>p.id)).size===d.processLibrary.length && d.processLibrary.every(p=>!validateProcessEntry(p,{allowLegacyLeg:true}).length); } catch { return false; } }
async function readWorkspace(){
  const saved=await loadWorkspaceDraft();
  if(saved&&valid(saved))return restorePlanningState(excludeConfirmedNonWelds(useStepExample(migrateDraft(saved))));
  return structuredClone(defaults);
}
function Btn({ children, icon: Icon, primary = false, danger = false, ...rest }) { return <button className={'btn ' + (danger?'danger':primary?'primary':'')} {...rest}>{Icon && <Icon size={14}/>} {children}</button>; }
function Dialog({ title, onClose, children }) { const ref = useRef(); useModalScrollLock(); useEffect(() => { const old = document.activeElement; ref.current?.querySelector('input,button')?.focus(); const handle = e => { if (e.key === 'Escape')
    onClose(); if (e.key === 'Tab') {
    const list = [...ref.current.querySelectorAll('button,input,select,summary')].filter(x => !x.matches(':disabled') && x.getClientRects().length);
    if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1)?.focus();
    }
    else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0]?.focus();
    }
} }; document.addEventListener('keydown', handle); return () => { document.removeEventListener('keydown', handle); old?.focus(); }; }, []); return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="dialog"><header><strong>{title}</strong><button className="icon" aria-label="关闭弹窗" title="关闭弹窗" onClick={onClose}><X size={18}/></button></header>{children}</section></div>; }
export function App(){
  const [attempt,setAttempt]=useState(0),[data,setData]=useState(null),[error,setError]=useState(false);
  useEffect(()=>{
    let active=true;
    readWorkspace().then(workspace=>{if(active)setData(workspace);},()=>{if(active)setError(true);});
    return ()=>{active=false;};
  },[attempt]);
  if(data)return <Workspace initialData={data}/>;
  return <main><Empty text={error?'无法读取本机工作区':'正在读取本机工作区'} actions={error&&
    <Btn onClick={()=>{setError(false);setAttempt(value=>value+1);}}>重试</Btn>}/></main>;
}
function Workspace({initialData}) {
    const [data, setData] = useState(initialData), [page, setPage] = useState('工艺规划'), [leftTab, setLeftTab] = useState('结构树'), [search, setSearch] = useState(''), [logSearch, setLogSearch] = useState(''), [logs, setLogs] = useState([]), [dialog, setDialog] = useState(null), [toast, setToast] = useState(null), [display, setDisplay] = useState(false), [view, setView] = useState({ grid: true, model: true, welds: true, passes: true, head: true, labels: true, transparent: false }), [reset, setReset] = useState(0), [camera, setCamera] = useState('iso'), [collapsed, setCollapsed] = useState(false), [saved, updateSaved] = useState(''), [processRequest,setProcessRequest]=useState(null), [libraryEditing,setLibraryEditing]=useState(false), [modelInfo,setModelInfo]=useState(null), [deleteWeldIds,setDeleteWeldIds]=useState([]);
    const [savedAt,setSavedAt]=useState(''),[savingWorkspace,setSavingWorkspace]=useState(false);
    const workspaceSave=useRef(false);
    const treeToggle=useRef(null),modelTreeToggle=useRef(null);
    const [inspectorOpen,setInspectorOpen]=useState(()=>window.innerWidth>=1440);
    const [logsOpen,setLogsOpen]=useState(false),[logHeight,setLogHeight]=useState(200);
    const logResizeStart=useRef(null);
    const [weldFilter,setWeldFilter]=useState('all'),[batchSelect,setBatchSelect]=useState(false);
    const [templateDraft,setTemplateDraft]=useState(null);
    const [precisionCoverOpen,setPrecisionCoverOpen]=useState(false);
    const collisionPool=useMemo(createPlanningCollisionPool,[]);
    const [cameraFieldOfView,setCameraFieldOfView]=useState(false);
    const [segmentSeparation,setSegmentSeparation]=useState(null);
    const [templateDuplicate,setTemplateDuplicate]=useState(null);
    const [coverBusy,setCoverBusy]=useState(false);
    const coverCapture=useRef(),pickedSplit=useRef(null),weldEditBaseline=useRef(new Map());
    const [planningPointsVisible,setPlanningPointsVisible]=useState(false);
    const [passFocus,setPassFocus]=useState(0),[removeLayoutTarget,setRemoveLayoutTarget]=useState(null);
    const [planningSelection,setPlanningSelection]=useState(null);
    const [pointOffsetPreview,setPointOffsetPreview]=useState(null);
    const [hiddenGeometry,setHiddenGeometry]=useState(new Set());
    const modelViewKey=stepModelKey(data);
    const weldViewKey=id=>JSON.stringify([modelViewKey,id]);
    const layoutViewKey=(id,node)=>JSON.stringify([modelViewKey,id,node]);
    function toggleGeometry(key){
      setHiddenGeometry(current=>{
        const next=new Set(current);
        if(next.has(key))next.delete(key);
        else next.add(key);
        return next;
      });
    }
    const hiddenWelds=useMemo(()=>new Set(data.welds.filter(weld=>
      hiddenGeometry.has(JSON.stringify([modelViewKey,weld.id]))).map(weld=>weld.id)),[data.welds,modelViewKey,hiddenGeometry]);
    const clearPointOffsetPreview=useCallback(pointId=>{
      setPointOffsetPreview(current=>current?.pointId===pointId?null:current);
    },[]);
    const [closedPointTree,setClosedPointTree]=useState('');
    const weldList=useRef(null);
    const weldTreeLocation=useRef(null);
    useLayoutEffect(()=>{
      const id=weldTreeLocation.current;
      if(!id)return;
      weldTreeLocation.current=null;
      const list=weldList.current;
      const row=list?.querySelector(`[data-weld-id="${CSS.escape(id)}"]`);
      if(row){
        const listTop=list.getBoundingClientRect().top+list.clientTop;
        const {top,bottom}=row.getBoundingClientRect();
        const listBottom=listTop+list.clientHeight;
        if(top<listTop)list.scrollTop+=top-listTop;
        else if(bottom>listBottom)list.scrollTop+=bottom-listBottom;
      }
    });
    const [newPointTarget,setNewPointTarget]=useState(null);
    const file = useRef(),taskFile=useRef(),stepFile=useRef(),stepImportWorker=useRef(), toastTimer = useRef(), geometryWorker=useRef(), dataRef=useRef(data); dataRef.current=data;
    const [stepImporting,setStepImporting]=useState(''),[stepError,setStepError]=useState(''),[modelLoadRevision,setModelLoadRevision]=useState(0);
    const demoModel=isDemoModel(data);
    const deviceControl=useMemo(()=>data.deviceControl??migrateDeviceControl(undefined,data.deviceCapabilities),[data.deviceControl,data.deviceCapabilities]);
    useEffect(()=>{
      if(!data.model||(!data.stepModel&&!isDemoModel(data))){collisionPool.dispose();return;}
      const timer=setTimeout(()=>collisionPool.prepare(data,precisionCoverOpen),0);
      return ()=>clearTimeout(timer);
    },[data.model,data.stepModel,precisionCoverOpen,collisionPool]);
    const [neighborhood,setNeighborhood]=useState(null),[neighborhoodError,setNeighborhoodError]=useState('');
    const [importedNeighborhood,setImportedNeighborhood]=useState(null);
    const neighborhoodRef=useRef(neighborhood);
    neighborhoodRef.current=neighborhood;
    const importedSha=data.stepModel?.sourceSha256;
    const importedMeasure=importedNeighborhood?.sha===importedSha?importedNeighborhood?.measure:undefined;
    useEffect(()=>{
      if(!importedSha||importedMeasure||data.geometryProcessing?.sourceSha256!==importedSha)return;
      let active=true;
      loadStepNeighborhood(importedSha).then(geometry=>{
        if(active&&geometry)setImportedNeighborhood({sha:importedSha,measure:createTemplateNeighborhoodMeasurer(geometry)});
      }).catch(()=>{});
      return()=>{active=false;};
    },[importedSha,importedMeasure,data.geometryProcessing?.sourceSha256]);
    useEffect(()=>{
      if(neighborhood||!(demoModel&&page==='工艺规划'||page==='焊接模板库'))return;
      const abort=new AbortController();
      setNeighborhoodError('');
      loadDemoTemplateNeighborhood(abort.signal).then(measure=>{if(!abort.signal.aborted)setNeighborhood(()=>measure);}).catch(error=>{if(!abort.signal.aborted)setNeighborhoodError(error.message);});
      return()=>abort.abort();
    },[demoModel,page,neighborhood]);
    const [geometryProgress,setGeometryProgress]=useState(null),[mergeIds,setMergeIds]=useState([]),[merging,setMerging]=useState(false),[mergeError,setMergeError]=useState('');
    const [modelEditMode,setModelEditMode]=useState(''),[splitAt,setSplitAt]=useState(''),[splitError,setSplitError]=useState(''),[splitByFace,setSplitByFace]=useState(false),[faceStations,setFaceStations]=useState([]);
    const selected = data.welds.find(w => w.id === data.selected), enabled = data.welds.filter(w => w.enabled), total = Math.round(enabled.reduce((s, w) => s + w.length, 0)*100)/100;
    const context=useMemo(()=>({...planningContext({...data,deviceControl}),measureTemplateNeighborhood:demoModel?neighborhood:importedMeasure}),[data.planningSettings,data.processDeviceProfiles,data.deviceCapabilities,deviceControl,demoModel,neighborhood,importedMeasure]);
    const measureLibraryTemplate=useMemo(()=>(template,range)=>{
      const source=template.sourceWeld;
      const measure=isDemoModel(source)?neighborhood:source.stepModel?.sourceSha256===importedSha?importedMeasure:null;
      return measure?.(template,range);
    },[neighborhood,importedSha,importedMeasure]);
    const activeProcesses=useMemo(()=>data.processLibrary.filter(process=>belongsToDevice(process,context.activeDevice)),[data.processLibrary,context]);
    const selectedDecision=useMemo(()=>selected?analyzeWeldMatch(selected,data.templates,activeProcesses,context):null,[selected,data.templates,activeProcesses,context]);
    const weldMatchResults=useMemo(()=>{
      const options={...context,includeMatchDiagnostics:false};
      return new Map(data.welds.map(weld=>{
        const match=analyzeWeldMatch(weld,data.templates,activeProcesses,options);
        return [weld.id,{route:match.route,templateId:match.whole?.id,processId:match.process?.id}];
      }));
    },[data.welds,data.templates,activeProcesses,context]);
    const filteredWelds=data.welds.filter(weld=>{
      if(!(weld.id+weld.name).toLowerCase().includes(search.trim().toLowerCase()))return false;
      const match=weldMatchResults.get(weld.id);
      return weldFilter==='template'?!match?.templateId:weldFilter==='process'?!(match?.processId||weld.processId||weld.processParameters?.id):true;
    });
    const selectableWelds=filteredWelds.filter(weld=>removablePlanningWeld(weld)&&(modelEditMode!=='merge'||weld.enabled));
    function templateImpact(ids){
      const removed=new Set(ids);
      return data.welds.filter(weld=>weldTemplateIds(weld).some(id=>removed.has(id))).length;
    }
    const pointLayout=useMemo(()=>weldLayerLayout(selected,selectedDecision,data.templates,activeProcesses,context),[selected,selectedDecision,data.templates,activeProcesses,context]);
    const pointProcess=selectedDecision?.process??selected?.processParameters??selectedDecision?.whole?.baseProcessSnapshot;
    const pointStrategy=useMemo(()=>{
      if(!selected||!pointProcess||selectedDecision?.whole)return null;
      if(selected.planned&&selected.strategyPlan&&selected.processParameters?.id===pointProcess.id)return selected.strategyPlan;
      return generateStrategyPlan(plannedTracking(selected,context),pointProcess,context);
    },[selected,selectedDecision?.whole,pointProcess,context]);
    const referenceNormalAt=context.measureTemplateNeighborhood?.referenceNormalAt;
    const planningPointGroups=useMemo(()=>weldLayerTreeGroups(selected,pointLayout,pointProcess,pointStrategy,referenceNormalAt),
      [selected,pointLayout,pointProcess,pointStrategy,referenceNormalAt]);
    const planningPoints=useMemo(()=>planningPointGroups.flatMap(group=>group.points),[planningPointGroups]);
    const activeSelection=planningSelection?.weldId===selected?.id?planningSelection:null;
    const activePoint=activeSelection?.type==='point'?planningPoints.find(point=>point.id===activeSelection.id):undefined;
    const activePointGroup=activeSelection?.type==='pass'?planningPointGroups.find(group=>group.id===activeSelection.id):
      activeSelection?.type==='layer'?planningPointGroups.find(group=>group.layerId===activeSelection.id):undefined;
    const pointGroup=activePoint?planningPointGroups.find(group=>group.id===activePoint.groupId):activePointGroup;
    const previewPatch=page==='工艺规划'&&activePoint?.id===pointOffsetPreview?.pointId?pointOffsetPreview?.patch:undefined;
    const modelPointLayout=useMemo(()=>previewPatch?updateWeldLayoutPoint(pointLayout,activePoint.groupId,
      {id:activePoint.raw.id,...previewPatch}):pointLayout,[previewPatch,pointLayout,activePoint]);
    const previewPoint=useMemo(()=>{
      if(!previewPatch)return activePoint;
      const placement=weldPointPlacement(selected,modelPointLayout,activePoint.groupId,activePoint.raw.id,false,pointStrategy,referenceNormalAt);
      return placement?{...activePoint,position:placement.position,toolPose:placement.toolPose,pose:placement.angles}:activePoint;
    },[previewPatch,activePoint,selected,modelPointLayout,pointStrategy,referenceNormalAt]);
    const layoutPaths=useMemo(()=>weldLayerPassPaths(selected,modelPointLayout,pointStrategy,referenceNormalAt,pointProcess),
      [selected,modelPointLayout,pointStrategy,referenceNormalAt,pointProcess]);
    const passIsVisible=useCallback((layerId,passId)=>![layerId,passId].some(node=>
      node&&hiddenGeometry.has(JSON.stringify([modelViewKey,selected?.id,node]))),[hiddenGeometry,modelViewKey,selected?.id]);
    const passPaths=useMemo(()=>layoutPaths.filter(pass=>passIsVisible(pass.layerId,pass.id)).map(pass=>({...pass,
      active:activeSelection?.type==='layer'?pass.layerId===activeSelection.id:pass.id===pointGroup?.id
    })),[layoutPaths,activeSelection,pointGroup?.id,passIsVisible]);
    const visiblePlanningPoints=useMemo(()=>{
      if(!planningPointsVisible)return [];
      if(previewPoint&&!passIsVisible(pointGroup?.layerId,pointGroup?.id))return [];
      if(previewPatch||layoutPaths.length)return previewPoint?[previewPoint]:[];
      return planningPointGroups.filter(group=>passIsVisible(group.layerId,group.id)).flatMap(group=>group.points);
    },[planningPointsVisible,previewPatch,previewPoint,layoutPaths.length,planningPointGroups,pointGroup,passIsVisible]);
    const pointBasePosition=useMemo(()=>activePoint?weldPointPosition(selected,pointLayout,activePoint.groupId,activePoint.raw.id,true,pointStrategy,referenceNormalAt):undefined,
      [selected,pointLayout,activePoint,pointStrategy,referenceNormalAt]);
    const selectedPass=activeSelection?.type==='pass'?passPaths.find(pass=>pass.id===pointGroup?.id):undefined;
    const [passPreview,setPassPreview]=useState(null);
    const previewPassKey=selectedPass?selected.id+':'+selectedPass.id:null;
    const firstStation=selectedPass?.startStation,lastStation=selectedPass?.endStation;
    const station=selectedPass?(passPreview?.key===previewPassKey?
      Math.max(firstStation,Math.min(lastStation,passPreview.station)):firstStation):undefined;
    const stationPose=selectedPass?.posesAt(station).at(-1);
    const passCollision=selectedPass&&selected.collisionPasses?.find(pass=>pass.id===selectedPass.id);
    const collisionPoint=passCollision?.contact??passCollision?.closest;
    const collisionMarker=planningPointsVisible&&collisionPoint&&Math.abs(station-collisionPoint.station)<.05?collisionPoint.point:null;
    const updatePreviewStation=useCallback(station=>setPassPreview({key:previewPassKey,station}),[previewPassKey]);
    const sampleStation=selectedPass?.sampleStations.find(sample=>Math.abs(sample-station)<1e-7);
    const sampleMarker=planningPointsVisible&&stationPose&&sampleStation!==undefined?stationPose.position:null;
    const pointPose=previewPoint&&passPaths.find(pass=>pass.id===pointGroup?.id)?.posesAt(previewPoint.distance)
      .find(pose=>pose.pointId===previewPoint.raw.id);
    const headPoint=planningPointsVisible&&passIsVisible(pointGroup?.layerId,pointGroup?.id)?
      previewPoint?(pointPose?{...previewPoint,toolPose:pointPose}:previewPoint):
      stationPose?{position:stationPose.position,toolPose:stationPose}:null:null;
    const editablePointGroups=planningPointGroups.filter(group=>group.layerId===newPointTarget?.layerId);
    function selectWeldPoint(type,id,weldId=selected?.id){
      if(weldId)setPlanningSelection({weldId,type,id});
    }
    function selectTreeWeld(id){
      setClosedPointTree('');
      if(id!==dataRef.current.selected)setData(current=>({...current,selected:id}));
    }
    function beginWeldPoint(layerId,passId){
      setNewPointTarget({layerId,passId,weldId:selected.id});
      setDialog('weldPoint');
    }
    async function confirmRemoveLayoutItem(){
      const target=removeLayoutTarget;
      if(!target||target.weldId!==selected?.id||geometryWorker.current)return;
      const next=removeWeldLayoutItem(pointLayout,target);
      if(next===pointLayout)return setRemoveLayoutTarget(null);
      const issue=await saveWeldLayout(selected,next);
      if(issue)return notify(issue);
      const selectionRemoved=target.type==='layer'?activeSelection?.id===target.layerId||pointGroup?.layerId===target.layerId:
        target.type==='pass'?pointGroup?.id===target.passId:
        activePoint?.groupId===target.passId&&activePoint.raw.id===target.pointId;
      if(selectionRemoved)setPlanningSelection(null);
      setRemoveLayoutTarget(null);
      notify('已删除'+target.label);
    }
    async function saveWeldLayout(weld,pointLayout){
      if(!weld||!weld.enabled||weld.mergedInto||weld.splitInto)return '当前焊缝不可编辑层道或点位';
      const current=dataRef.current;
      const append=item=>({...item,pointLayout,collisionState:undefined,collisionPasses:undefined,attributeOverrides:{...item.attributeOverrides,pointLayout}});
      const next={...current,welds:current.welds.map(item=>item.id===weld.id?append(item):item)};
      const pending=weldEditBaseline.current;
      const baseline=pending.get(weld.id);
      const persisted={...next,welds:next.welds.map(item=>item.id===weld.id&&baseline?append(baseline):pending.get(item.id)??item)};
      try{
        await commitWorkspace(persisted,()=>{
          if(baseline)pending.set(weld.id,append(baseline));
          applyWorkspace({...next,selected:dataRef.current.selected});
        });
      }catch(error){return error.message;}
      return '';
    }
    async function addWeldLayer(weld){
      const layout=weld.id===selected?.id?pointLayout:weldLayerLayout(weld,null,data.templates,activeProcesses,context);
      if(layout.length>=20)return notify('每条焊缝最多 20 层');
      const layer=nextWeldLayer(weld,layout);
      const issue=await saveWeldLayout(weld,[...layout,layer]);
      if(issue)return notify(issue);
      selectTreeWeld(weld.id);
      selectWeldPoint('layer',layer.id,weld.id);
    }
    async function addWeldPass(layerId){
      const layer=pointLayout.find(item=>item.id===layerId);
      if(!layer||layer===pointLayout[0])return;
      if(layer.passes.length>=50)return notify('每层最多 50 道');
      const pass=nextWeldPass(selected,layer);
      const issue=await saveWeldLayout(selected,pointLayout.map(item=>item.id===layerId?{...item,passes:[...item.passes,pass]}:item));
      if(issue)return notify(issue);
      selectWeldPoint('pass',pass.id);
    }
    function saveLayerOrPass(group,values,layerOnly){
      return saveWeldLayout(selected,pointLayout.map(layer=>{
        if(layer.id!==group.layerId)return layer;
        if(layerOnly)return {...layer,...values};
        const offset=Object.fromEntries(Object.entries(values.offset).map(([key,value])=>[key,value-(group.processOffsetBase?.[key]??0)]));
        return {...layer,passes:layer.passes.map(pass=>pass.id===group.id?{...pass,...values,offset}:pass)};
      }));
    }
    async function saveWeldPoint(point,editing=false){
      const group=planningPointGroups.find(item=>item.id===point.groupId);
      if(!group)return '请选择所属道';
      if(!editing&&group.points.length>=500)return '每道最多 500 个点位';
      const {groupId,...record}=point;
      const reference=group.points.find(item=>item.raw.id===record.referenceId)?.raw;
      if(reference){record.segment=reference.segment;record.percent=reference.percent;}
      const next=updateWeldLayoutPoint(pointLayout,groupId,record,!editing);
      const issue=await saveWeldLayout(selected,next);
      if(issue)return issue;
      if(!editing){selectWeldPoint('point',groupId+':'+record.id);setDialog(null);}
      return '';
    }
    useEffect(()=>{
      setSplitError('');
      setFaceStations([]);
      const picked=pickedSplit.current;
      const canSplit=selected?.enabled&&!selected.splitInto&&!selected.mergedInto;
      const defaultDistance=canSplit?String(Math.round(selected.length*50)/100):'';
      setSplitAt(picked&&picked.id===selected?.id?picked.at:defaultDistance);
      pickedSplit.current=null;
    },[data.selected,modelEditMode]);
    function editModelMode(mode){setModelEditMode(mode);setSplitByFace(false);setFaceStations([]);setSplitError('');setView(v=>({...v,welds:true}));}
    function locateModelWeld(id){
      if(page!=='工艺规划')return;
      if(leftTab!=='结构树')setLeftTab('结构树');
      if(collapsed)setCollapsed(false);
      if(!filteredWelds.some(weld=>weld.id===id)){setSearch('');setWeldFilter('all');}
      weldTreeLocation.current=id;
    }
    function selectModelWeld(id,point){const weld=dataRef.current.welds.find(w=>w.id===id);if(!weld)return;
      if(modelEditMode==='merge'){if(!weld.enabled||weld.mergedInto||weld.splitInto)return;setMergeIds(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);}
      if(modelEditMode==='split'&&point){const at=String(Math.round(weldPointDistance(weld,point)*100)/100);if(dataRef.current.selected!==id)pickedSplit.current={id,at};setSplitAt(at);}
      setData(d=>({...d,selected:id}));
      locateModelWeld(id);
    }
    function selectModelPlanningItem(type,id){
      if(!selected)return;
      selectWeldPoint(type,id);
      locateModelWeld(selected.id);
    }
    async function confirmSplit(){try{const next=splitSelectedWeld(dataRef.current,dataRef.current.selected,splitByFace?faceStations:Number(splitAt),{revision:3});if(!valid(next))throw Error('打断结果未通过路径校验');if(!await persistGeometry(replanEditedGeometry(next)))return;setSplitError('');setSplitAt('');setFaceStations([]);log('已打断焊道 '+dataRef.current.selected+'，原焊道已保留，可撤销。');}catch(e){setSplitError(e.message);}}
    function chooseSegments(indices){
      setSegmentSeparation(current=>({...current,indices,error:''}));
    }
    async function confirmSegmentSeparation(){
      const {id,indices}=segmentSeparation;
      try{
        if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改');
        const next=separateWeldSegments(dataRef.current,id,indices);
        if(!valid(next))throw Error('拆分结果未通过路径校验');
        if(await persistGeometry(replanEditedGeometry(next)))notify('已拆分 '+indices.length+' 个焊缝段');
        if(leftTab!=='结构树')setLeftTab('结构树');
        if(search)setSearch('');setWeldFilter('all');
        weldTreeLocation.current=next.selected;
        setPlanningSelection(null);
        setSegmentSeparation(null);
        log('已拆分焊缝 '+id+' 的 '+indices.length+' 个焊缝段');
      }catch(error){setSegmentSeparation(current=>({...current,error:error.message}));}
    }
    function replanEditedGeometry(workspace){
      const added=workspace.manualEditHistory?.at(-1);
      const ids=new Set(added?.kind==='split'?workspace.manualSplitHistory.at(-1).childIds:[workspace.selected]);
      return {...workspace,welds:workspace.welds.map(weld=>ids.has(weld.id)?planWeldFromMatch(weld,analyzeWeldMatch(weld,workspace.templates,activeProcesses,context),context):weld)};
    }
    function selectSplitFace(origin,normal){
      if(!selected)return;
      const stations=planeSplitStations(selected,origin,normal);
      setFaceStations(stations);setSplitError(stations.length?'':'所选平面未穿过焊缝内部');
    }
    async function undoGeometryEdit(){
      const current=dataRef.current,history=current.manualEditHistory??[],last=history.at(-1);
      if(!last)return;
      try{const restored=last.kind==='merge'?undoManualMerge(current,last.id):undoLastSplit(current);if(!await persistGeometry({...restored,manualEditHistory:history.slice(0,-1)}))return;setSplitError('');notify('已撤销上一次焊缝操作');}
      catch(error){notify(error.message);}
    }
    async function undoSplit(){try{if(!await persistGeometry(undoLastSplit(dataRef.current)))return;setSplitError('');notify('已撤销上一次手动打断');}catch(e){setSplitError(e.message);}}
    function notify(message,tone='info',action){
      clearTimeout(toastTimer.current);setToast({message,tone,action});
      if(!action)toastTimer.current=setTimeout(()=>setToast(null),3500);
    }
    function setSaved(status){updateSaved(status);if(status==='已保存至本机')setSavedAt(new Date().toLocaleTimeString('zh-CN',{hour12:false}));}
    function log(message) { setLogs(l => [...l.slice(-149), { id: crypto.randomUUID(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message }]); }
    function change(fn) {
      if(workspaceSave.current){notify('正在保存本机工作区，请稍后重试','warning');return false;}
      applyWorkspace(typeof fn==='function'?fn(dataRef.current):fn);
      setSaved('有未保存修改');
      return true;
    }
    useEffect(()=>{
      const corrected=excludeConfirmedNonWelds(data);
      if(corrected!==data)setData(corrected);
    },[data]);
    useEffect(()=>{
      if(!savingWorkspace)return;
      const waitForSave=event=>{event.preventDefault();event.returnValue='';};
      window.addEventListener('beforeunload',waitForSave);
      return ()=>window.removeEventListener('beforeunload',waitForSave);
    },[savingWorkspace]);
    useEffect(() => () => {clearTimeout(toastTimer.current);geometryWorker.current?.terminate();stepImportWorker.current?.terminate();collisionPool.dispose();}, [collisionPool]);
    async function commitWorkspace(persisted,apply){
      if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');
      workspaceSave.current=true;
      setSavingWorkspace(true);
      try{
        try{await saveWorkspaceDraft(persisted);}
        catch(error){
          if(error?.name==='QuotaExceededError')throw Error('本机存储空间不足，请导出任务备份后重试');
          throw Error('无法写入本机工作区，请重试');
        }
        apply?.();
        setSaved(weldEditBaseline.current.size?'有未保存修改':'已保存至本机');
      }finally{
        workspaceSave.current=false;
        setSavingWorkspace(false);
      }
    }
    function applyWorkspace(next){
      dataRef.current=next;
      setData(next);
    }
    async function persistGeometry(next){
      if(workspaceSave.current){notify('正在保存本机工作区，请稍后重试','warning');return false;}
      applyWorkspace(next);
      try{
        await commitWorkspace(next);
        return true;
      }catch(error){
        setSaved('有未保存修改');
        notify(error.message+'。当前规划结果仍可导出。','error');
        return false;
      }
    }
    function extractAndPlan(options,workspace){
      const modelKey=stepModelKey(workspace),reference=workspace.stepModel;
      const worker=new Worker(new URL('./geometryProcessing.worker.js',import.meta.url),{type:'module'});
      geometryWorker.current=worker;
      const finish=()=>{
        worker.terminate();
        geometryWorker.current=null;
        setGeometryProgress(null);
      };
      const fail=message=>{
        log('一键规划未完成：'+message);
        notify(message);
        finish();
      };
      setGeometryProgress({phase:'extract',stage:'准备提取焊道',percent:0});
      log('一键规划开始：提取焊道。');
      worker.onerror=()=>fail('焊道提取失败，请重试');
      worker.onmessageerror=()=>fail('无法读取焊道提取结果，请重试');
      worker.onmessage=async({data:message})=>{
        if(message.type==='progress'){
          setGeometryProgress({phase:'extract',...message.progress});
          return;
        }
        if(message.type==='error'){
          if(message.code==='STEP_SOURCE_MISSING'){
            finish();
            setStepError(message.message);
            setDialog('import');
          }else fail(message.message);
          return;
        }
        if(message.type!=='result')return;
        try{
          flushSync(()=>setGeometryProgress({phase:'plan',stage:'匹配模板和工艺参数并生成路径'}));
          await new Promise(resolve=>setTimeout(resolve,0));
          let measure=reference?undefined:neighborhoodRef.current;
          if(!reference&&!measure&&isDemoModel(workspace)){
            measure=await loadDemoTemplateNeighborhood();
            setNeighborhood(()=>measure);
          }
          const current=dataRef.current;
          if(stepModelKey(current)!==modelKey||current.model!==workspace.model)throw Error('模型已切换，请重新运行一键规划');
          if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');
           if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改，再重新运行一键规划');
          const settings=planningContext({...current,deviceControl:current.deviceControl??deviceControl});
          if(JSON.stringify(options)!==JSON.stringify(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,settings))){
            throw Error('提取设置已变更，请重新运行一键规划');
          }
          const geometry=message.result.neighborhood;
          if(reference&&geometry){
            const sha=reference.sourceSha256;
            measure=createTemplateNeighborhoodMeasurer(geometry);
            setImportedNeighborhood({sha,measure});
            cacheStepNeighborhood(sha,geometry).catch(()=>{});
          }
          const effective=settingsDefaults(settings);
          const range=mergeIncludedAngleRange(settings.mergeParameters);
          const merge={...(Number.isFinite(range.angleMin)&&Number.isFinite(range.angleMax)?range:DEFAULT_MERGE_ANGLE_RANGE),maxGroove:settings.mergeParameters?.gapThreshold??DEFAULT_MERGE_GAP};
          const manuallyDeleted=new Set((current.rejectedGeometryWelds??[]).filter(weld=>weld.rejectionReason==='用户删除'&&weld.sourceSha256===message.result.sourceSha256).map(weld=>weld.processingKey));
          const reserved=new Set(current.welds.filter(weld=>weld.source==='extracted'&&(weld.mergedInto||weld.splitInto)).map(weld=>weld.processingKey));
          const source=[],confirmedNonWelds=[];
          for(const weld of message.result.welds){
            if(manuallyDeleted.has(weld.processingKey)||reserved.has(weld.processingKey))continue;
            if(!current.stepModel&&isConfirmedNonWeldKey(weld.sourceSha256,weld.processingKey))confirmedNonWelds.push(weld);
            else source.push(weld);
          }
          const welds=preprocessExtractedWelds(source,effective.weldPreprocessing,merge,measure);
          log('已完成焊缝预处理：自动删除、自动合并、自动打断。');
          const summary={...message.result.summary,processedWeldCount:welds.length,mergedGroupCount:welds.filter(weld=>weld.segments.length>1).length,cornerCount:welds.reduce((count,weld)=>count+weld.cornerAngles.length,0)};
          const extracted=installGeometryResult(current,{...message.result,welds:[...welds,...confirmedNonWelds],summary});
          if(!valid(extracted))throw Error('焊道提取结果未通过工作区校验');
          const count=extracted.welds.filter(weld=>weld.source==='extracted'&&removablePlanningWeld(weld)).length;
          log(`焊道提取完成：${count} 条。开始工艺规划。`);
          await executePlan(extracted,settings,measure,geometry);
          setView(view=>({...view,welds:true}));
          finish();
        }catch(error){fail(error.message);}
      };
      worker.postMessage({options,model:workspace.model,reference});
    }
    async function mergeSelection(){try{const next=mergeSelectedWelds(dataRef.current,mergeIds,context);if(!valid(next))throw Error('合并后的路径未通过校验');if(!await persistGeometry(replanEditedGeometry(next)))return;setMergeIds([]);setMerging(false);log(`${mergeIds.length} 条焊道已合并为 ${next.selected}，原焊道已保留并屏蔽。`);}catch(e){setMergeError(e.message);}}
    async function undoMerge(){try{const next=undoManualMerge(dataRef.current,dataRef.current.selected);if(!await persistGeometry(next))return;notify('已恢复合并前的焊道');}catch(e){notify(e.message);}}
    async function undoGeometry(){const next=restoreGeometryResult(dataRef.current);if(!await persistGeometry(next))return;notify('已撤销本次几何处理并保存');log('已撤销本次焊道几何处理。');}
    function patch(key, value) { if(workspaceSave.current)return;const current=dataRef.current.welds.find(w=>w.id===dataRef.current.selected);if(current&&!weldEditBaseline.current.has(current.id))weldEditBaseline.current.set(current.id,structuredClone(current));change(d => ({ ...d, welds: d.welds.map(w => w.id === d.selected ? { ...w, [key]: value, ...(key==='segments'?{position:value.every(s=>s.position===value[0].position)?value[0].position:'混合位置（逐段设置）'}:{}), ...((w.segments?.length===1||['extracted','manual-merge'].includes(w.source)&&key==='position')&&['position','length'].includes(key)?{segments:w.segments.map(s=>({...s,[key]:value}))}:{}), planned: key==='planningPointOverrides'?w.planned:false } : w) })); }
    function stopStepImport(){
      stepImportWorker.current?.terminate();
      stepImportWorker.current=null;
      setStepImporting('');
    }
    function closeImport(){
      stopStepImport();
      setStepError('');
      setDialog(null);
    }
    async function installStepWorkspace(next){
      next=restorePlanningState(next);
      if(!valid(next))throw Error('模型工作区校验失败');
      await commitWorkspace(next,()=>{
        weldEditBaseline.current.clear();
        applyWorkspace(next);
      });
      setModelInfo(null);
      setModelLoadRevision(value=>value+1);
      setModelEditMode('');
      setMergeIds([]);
      setClosedPointTree('');
      setPlanningSelection(null);
      setView(current=>({...current,model:true,welds:true}));
      closeImport();
    }
    function checkModelSwitch(){
      if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');
      if(geometryWorker.current||geometryProgress)throw Error('请等待当前一键规划完成');
    }
    async function openStepModel(model,reference){
      const discarded=weldEditBaseline.current.size>0;
      await installStepWorkspace(switchStepWorkspace(dataRef.current,model,reference));
      setSearch('');setWeldFilter('all');setBatchSelect(false);
      setLeftTab('结构树');
      setHiddenGeometry(new Set());
      setPointOffsetPreview(null);
      log('已加载 '+model+'。');
      notify(discarded?'模型已加载，未应用的焊缝属性修改已舍弃':'模型已加载，可点击一键规划');
    }
    async function load(){
      try{
        checkModelSwitch();
        await openStepModel(EXAMPLE_MODEL);
      }catch(error){setStepError(error.message);notify(error.message);}
    }
    function importStep(event){
      const chosen=event.target.files?.[0];
      event.target.value='';
      if(!chosen||stepImportWorker.current)return;
      setStepError('');
      try{
        checkModelSwitch();
        if(!/\.(step|stp)$/i.test(chosen.name))throw Error('请选择 .step 或 .stp 文件');
        const worker=new Worker(new URL('./stepImport.worker.js',import.meta.url),{type:'module'});
        stepImportWorker.current=worker;
        setStepImporting(chosen.name);
        const fail=message=>{
          if(stepImportWorker.current!==worker)return;
          stopStepImport();
          setStepError(message);
        };
        worker.onerror=()=>fail('STEP 解析失败，请检查文件或尝试重新导出');
        worker.onmessage=async({data:result})=>{
          if(stepImportWorker.current!==worker)return;
          if(result.error){fail(result.error);return;}
          try{
            const model=result.model;
            const reference=model.name===EXAMPLE_MODEL&&model.sourceSha256===DEMO_SOURCE_SHA256?undefined:{sourceSha256:model.sourceSha256};
            if(reference)await cacheStepMesh({...model,sourceFile:chosen});
            if(stepImportWorker.current!==worker)return;
            checkModelSwitch();
            await openStepModel(model.name,reference);
          }catch(error){fail(error.message);}
        };
        worker.postMessage(chosen);
      }catch(error){stopStepImport();setStepError(error.message);}
    }
    function exportTask(){
      const url=URL.createObjectURL(new Blob([JSON.stringify(planningTaskDocument(data),null,2)],{type:'application/json'}));
      const download=document.createElement('a');
      download.href=url;
      download.download=(data.model||'Weldone').replace(/\.(step|stp)$/i,'')+'-规划任务.pf';
      download.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      log('已导出规划任务');
    }
    async function importTask(event){
      const chosen=event.target.files?.[0];
      event.target.value='';
      if(!chosen)return;
      try{
        checkModelSwitch();
        if(!/\.pf$/i.test(chosen.name))throw Error('请选择 .pf 任务文件');
        const task=readPlanningTask(await chosen.text());
        checkModelSwitch();
        const current=dataRef.current;
        const workspace={...task,deviceControl:current.deviceControl??deviceControl,deviceCapabilities:current.deviceCapabilities};
        if(!valid(workspace))throw Error('PF 任务数据无效');
        const loaded=restorePlanningState(excludeConfirmedNonWelds(useStepExample(migrateDraft(workspace))));
        const next={...loaded,selected:loaded.welds.some(w=>w.id===loaded.selected)?loaded.selected:loaded.welds[0]?.id||''};
        await installStepWorkspace(next);
        log('已导入 PF 任务 '+chosen.name);
        notify('PF 任务已导入');
      }catch(error){
        notify(error instanceof SyntaxError?'无法读取 PF 文件，请选择本平台导出的任务文件。':error.message);
      }
    }
    async function importDraft(e) { const f = e.target.files?.[0]; e.target.value = ''; if (!f)
        return; try {
        checkModelSwitch();
        const v = JSON.parse(await f.text());
        checkModelSwitch();
        if (v.format !== 'weldone-ui-draft' || !valid(v))
            throw Error('草稿格式不正确，请选择本平台导出的 JSON');
        const loaded=excludeConfirmedNonWelds(useStepExample(migrateDraft(v)));
        await installStepWorkspace({...loaded,selected:loaded.welds.some(w=>w.id===loaded.selected)?loaded.selected:loaded.welds[0]?.id||''});
        log('已导入规划草稿');
        notify('草稿导入成功');
    }
    catch (e) {
        notify(e.message);
    } }
    async function executePlan(workspace,settings,measure,geometry){
      const options={...settings,measureTemplateNeighborhood:measure};
      const source=[...workspace.welds.filter(weld=>!weld.collisionFragment),...(workspace.collisionOriginals??[])];
      const planned=planWorkspace(source.map(weld=>({...weld,collisionPasses:undefined,collisionState:undefined,collisionResult:undefined})),workspace.templates,workspace.processLibrary,options);
      let welds=planned,collisionOriginals=[];
      if(workspace.stepModel||isDemoModel(workspace)){
        setGeometryProgress({phase:'collision',percent:0,stage:'正在准备机头与工件网格'});
        try{
          const result=await collisionPool.run({...workspace,welds:planned},options,precisionCoverOpen,(index,total)=>
            setGeometryProgress(current=>{
              const percent=total?Math.floor(index/total*100):100;
              return current?.phase==='collision'&&current.percent===percent?current:
                {phase:'collision',percent,stage:'正在检查机头与工件碰撞 '+index+'/'+total};
            }),geometry);
          ({welds,collisionOriginals}=result);
          const {checked,unchecked,downgraded,trimmed,removed}=result.counts;
          for(const original of collisionOriginals){
            const collision=original.collisionPasses?.find(pass=>pass.contact)?.contact;
            if(collision)log(original.id+' · '+collision.part+' · '+collision.station.toFixed(1)+' mm 发生碰撞，已调整焊缝。');
          }
          log('碰撞检测完成：检测与复检 '+(result.detectionMs/1000).toFixed(2)+' s，含裁剪总耗时 '+(result.elapsedMs/1000).toFixed(2)+' s，'+checked+' 条已检测，'+unchecked+' 条无可检测路径，'+downgraded+' 条包角降级，'+trimmed+' 次碰撞裁剪，'+removed+' 条整道移除。');
        }catch(error){
          log('碰撞检测未完成：'+error.message);
          notify('碰撞检测未完成，保留本次焊道。');
          welds=planned.map(weld=>({...weld,collisionState:'未检测'}));
        }
      }
      if(!valid({...workspace,welds,collisionOriginals}))throw Error('规划结果未通过工作区校验');
      const ready=welds.filter(weld=>weld.enabled&&weld.planned).length;
      const blocked=welds.filter(weld=>weld.enabled&&!weld.planned).length;
      const selected=welds.some(weld=>weld.id===workspace.selected)?workspace.selected:
        (welds.find(weld=>weld.enabled&&!weld.planned)??welds.find(weld=>weld.enabled)??welds[0])?.id??'';
      log(`规划完成：${ready} 条生成路径，${blocked} 条待处理。`);
      if(!await persistGeometry({...workspace,welds,selected,collisionOriginals}))return;
      notify(welds.length?'焊缝提取成功':'本次未提取到可规划的焊道',welds.length?'success':'warning');
    }
    async function plan(){
      if(geometryProgress||geometryWorker.current||workspaceSave.current)return;
      if(weldEditBaseline.current.size){notify('请先应用或取消焊缝属性修改');return;}
      if(stepImportWorker.current){notify('请等待 STEP 模型导入完成');return;}
      if(!demoModel&&!data.stepModel&&!data.welds.length){notify('请先导入 STEP 模型');return;}
      try{
        if(demoModel||data.stepModel){
          collisionPool.prepare(data,precisionCoverOpen);
          extractAndPlan(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,context),data);return;
        }
        log('当前模型暂无自动提取数据，使用已有焊道进行工艺规划。');
        await executePlan(data,context);
      }catch(error){notify(error.message);}
    }
    function patchWeldWrap(id,type){
      if(workspaceSave.current||geometryProgress)return;
      const current=dataRef.current.welds.find(weld=>weld.id===dataRef.current.selected);
      if(!current)return;
      const joint=weldWrapJunctions(current).find(item=>item.id===id);
      if(!joint||type==='U'&&!joint.canUseU)return;
      const pendingWrapEdit=type===current.segments[id].endWrapKind?undefined:{id,type};
      if(!weldEditBaseline.current.has(current.id))weldEditBaseline.current.set(current.id,structuredClone(current));
      change(data=>({...data,welds:data.welds.map(weld=>weld.id===current.id?{...weld,pendingWrapEdit}:weld)}));
    }
    function cancelWeldEdit(){
      if(workspaceSave.current)return;
      const previous=weldEditBaseline.current.get(data.selected);
      if(!previous)return;
      weldEditBaseline.current.delete(previous.id);
      change({...data,welds:data.welds.map(weld=>weld.id===previous.id?previous:weld)});
    }
    async function applyWeldAttributes(){
      if(workspaceSave.current)return;
      if(!selected||!selected.name.trim()||roundWeldLeg(selected.leg)===null||!validGroove(selected.groove)||selected.segments.some(segment=>!segment.position||segment.position==='待确认')){notify('请完善焊缝名称、焊脚、位置及坡口');return;}
      const previous=weldEditBaseline.current.get(selected.id);
      try{
        if(selected.pendingWrapEdit){
          const {id,type}=selected.pendingWrapEdit;
          const original=previous??selected;
          const fragments=splitWeldWrap(selected,id,type);
          if(!fragments.length)throw Error('所选连接点无法拆分');
          const split=installWrapSplit({...data,welds:data.welds.map(weld=>weld.id===original.id?original:weld)},original,fragments);
          if(!valid(split))throw Error('包角拆分结果未通过路径校验');
          const children=new Set(split.manualSplitHistory.at(-1).childIds);
          const options={...context,measureTemplateNeighborhood:context.measureTemplateNeighborhood};
          const welds=split.welds.map(weld=>children.has(weld.id)?planWeldFromMatch(weld,analyzeWeldMatch(weld,split.templates,activeProcesses,options),options):weld);
          weldEditBaseline.current.delete(selected.id);
          if(!await persistGeometry({...split,welds})){if(previous)weldEditBaseline.current.set(selected.id,previous);return;}
          setPlanningSelection(null);
          weldTreeLocation.current=split.selected;
          notify('已拆分为 '+children.size+' 条焊缝');
          return;
        }
        const overrides={...selected.attributeOverrides};
        for(const key of ['name','leg','position','weldType','machineCount','groove','workFace','direction','tracking','scanSettings','endpointFacts','edgeDistance','planningPointOverrides'])if(previous&&JSON.stringify(previous[key])!==JSON.stringify(selected[key]))overrides[key]=structuredClone(selected[key]);
        if(previous&&JSON.stringify(previous.segments)!==JSON.stringify(selected.segments)){
          overrides.segments=selected.segments.map(segment=>({position:segment.position,tracking:segment.tracking,arcTracking:segment.arcTracking,laserTracking:segment.laserTracking,startWrapMode:segment.startWrapMode,endWrapMode:segment.endWrapMode}));
        }
        const decision=analyzeWeldMatch(selected,data.templates,activeProcesses,context);
        const next=planWeldFromMatch({...selected,attributeOverrides:overrides,collisionState:undefined,collisionPasses:undefined},decision,context);
        weldEditBaseline.current.delete(selected.id);
        if(!await persistGeometry({...data,welds:data.welds.map(weld=>weld.id===selected.id?next:weld)}))return;
        notify(decision.ready?'焊缝属性已应用并重新规划':'焊缝属性已应用，请查看当前焊缝的处理提示');
      }catch(error){notify(error.message);}
    }
    const templateSourceIssues = wholeWeldSourceIssues(data.model, selected);
    const templateCreateDisabled = coverBusy || !modelInfo || (demoModel&&!neighborhood) || templateSourceIssues.length > 0;
    const templateCreateHint = coverBusy ? '正在截取封面…' : templateSourceIssues.join('；') || (!modelInfo ? '请等待三维模型加载完成' : demoModel&&!neighborhood ? neighborhoodError||'正在加载焊缝邻域数据' : '');
    async function createWholeTemplate() {
      if (templateCreateDisabled || !coverCapture.current) return;
      setCoverBusy(true);
      try {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const capture = coverCapture.current;
        if (!capture) return;
        const range=data.templateCaptureRange??DEFAULT_TEMPLATE_CAPTURE_RANGE;
        const source=targetFromWeld(selected,context);
        const evidence=context.measureTemplateNeighborhood?.(source,range);
        const cover=capture(source,range);
        const initial=newPlanningTemplate(data.model,data.welds,selected.id,cover,range,evidence,data.stepModel,context);
        const template=copyWeldLayersToTemplate(initial,pointLayout,selected,pointProcess,pointStrategy,referenceNormalAt);
        setTemplateDraft({template:{...template,project:data.project||'本地项目'},evidence,source});
      } catch (error) {
        notify(error.message);
      } finally {
        setCoverBusy(false);
      }
    }
    async function commitNewTemplate(value, defaultId) {
      const key = templateGeometryKey(value);
      const templates = [...data.templates, value].map(template =>
        defaultId && template.type === 'whole' && templateGeometryKey(template) === key
          ? {...template, defaultForGeometry: template.id === defaultId}
          : template
      );
      const decision = {ready: true, route: 'whole', whole: value, locals: [], steps: ['已匹配：'+value.name, '无需匹配', '无需匹配']};
      const source=data.welds.find(weld=>weld.id===value.sourceWeld.id);
      const appliesToSource=source&&matchTemplate(value,targetFromWeld(source,context),context).ok;
      const welds=appliesToSource?data.welds.map(weld=>weld.id===source.id?planWeldFromMatch(weld,decision,context):weld):data.welds;
      const error = await updateTemplates({templates, welds});
      if (error) return error;
      setTemplateDuplicate(null);
      setTemplateDraft(null);
      go('焊接模板库');
      return '';
    }
    function saveNewTemplate(value) {
      try {
        const name = value.name.trim().toLowerCase();
        if (data.templates.some(template => (template.project || data.project) === value.project && template.name.trim().toLowerCase() === name)) {
          return '焊接模板名称已存在，请修改名称';
        }
        const key = templateGeometryKey(value);
        const duplicates = data.templates.filter(template => template.type === 'whole' && templateGeometryKey(template) === key);
        if (!duplicates.length) return commitNewTemplate(value);
        setTemplateDuplicate({value, duplicates, defaultId: duplicates.find(template => template.defaultForGeometry)?.id ?? duplicates[0].id});
        return '';
      } catch (error) {
        return error.message;
      }
    }
    function applyTemplate(template) {
      if(workspaceSave.current){notify('正在保存本机工作区，请稍后重试','warning');return false;}
      const updated = applySelectedTemplate(selected, template, data.processLibrary, context);
      change(current => ({...current, welds: current.welds.map(weld => weld.id === selected.id ? updated : weld)}));
      log(selected.id+' 已应用模板 '+template.name);
      notify('模板的全部层、道和控制点已应用，请保存规划草稿');
      return true;
    }
    async function deleteSelectedWelds(){
      if(workspaceSave.current)return;
      const current=dataRef.current,next=removePlanningWelds(current,deleteWeldIds);
      setDeleteWeldIds([]);
      if(next===current)return;
      for(const id of deleteWeldIds)weldEditBaseline.current.delete(id);
      setMergeIds([]);setPlanningSelection(null);
      if(await persistGeometry(next))notify('已删除 '+(current.welds.length-next.welds.length)+' 条焊缝');
    }
    async function updateTemplates(input) {
      if(workspaceSave.current)return '正在保存本机工作区，请稍后重试';
      const data=dataRef.current;
      const values=deviceLibraryUpdates(data,input);
      const removedProcesses=new Set(values.processLibrary?data.processLibrary
        .filter(process=>!values.processLibrary.some(next=>next.id===process.id)).map(process=>process.id):[]);
      const disabledTemplates=new Set((values.templates??[]).filter(template=>
        template.enabled===false&&data.templates.find(previous=>previous.id===template.id)?.enabled!==false
      ).map(template=>template.id));
      const deleting=values.templates&&data.templates.some(template=>!values.templates.some(entry=>entry.id===template.id));
      const next=updateProjectPlanning(data,values);
      try {
        if(deleting||disabledTemplates.size||removedProcesses.size){
          const options={...planningContext({...next,deviceControl}),measureTemplateNeighborhood:context.measureTemplateNeighborhood};
          next.welds=next.welds.map(weld=>{
            const current=removedProcesses.size?clearRemovedProcess(weld,removedProcesses):weld;
            const cleaned=deleting?clearMissingWeldTemplates(current,next.templates):current;
            if(cleaned!==current&&cleaned.enabled){
              const decision=analyzeWeldMatch(cleaned,next.templates,next.processLibrary,options);
              return planWeldFromMatch(cleaned,decision,options);
            }
            return disabledTemplates.size&&weldTemplateIds(cleaned).some(id=>disabledTemplates.has(id))?
              {...cleaned,planned:false}:cleaned;
          });
        }
      } catch(error){
        return '重新匹配焊缝失败：'+error.message;
      }
      try{
        const pending=new Map(weldEditBaseline.current);
        for(const [id,weld] of pending){
          let baseline=removedProcesses.size?clearRemovedProcess(weld,removedProcesses):weld;
          if(deleting)baseline=clearMissingWeldTemplates(baseline,next.templates);
          if(weldTemplateIds(baseline).some(id=>disabledTemplates.has(id)))baseline={...baseline,planned:false};
          pending.set(id,baseline);
        }
        await commitWorkspace(next,()=>{
          weldEditBaseline.current=pending;

          applyWorkspace({...next,selected:dataRef.current.selected});
        });
        return '';
      }catch(error){return error.message;}
    }
    function applyProcess(p,{throwOnError=false}={}) { if(!selected)return false;try{if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');const updated=applyProcessEntry(plannedTracking(selected,context),p);change(d=>({...d,welds:d.welds.map(w=>w.id===d.selected?updated:w)}));log(`${selected.id} 已应用工艺参数 ${p.name}`);notify('工艺参数已应用，请保存规划草稿');return true;}catch(e){if(throwOnError)throw e;notify(e.message);return false;} }
    const go = p => { if(!modules.includes(p))return;if(page==='工艺规划'&&p!==page)setModelInfo(null);setPage(p); setDisplay(false); setDialog(null);setToast(null); };
    function navigate(pageName) {
      if (pageName === page) return;
      const eventName = page === '工艺参数库' ? 'process-library-navigate' : page === '焊接模板库' ? 'template-library-navigate' : '';
      const proceed = () => go(pageName);
      if (!eventName || window.dispatchEvent(new CustomEvent(eventName, {cancelable:true, detail:{navigate:proceed}}))) proceed();
    }
    return <div className={'app'+(page==='工艺参数库'?' process-library-view'+(libraryEditing?' process-detail-mode':''):page==='焊接模板库'?' template-library-view':'')}>
      <IconTooltips/>
      <a className="skip-link" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById('main-content').focus();}}>跳到主内容</a>
      <header className="app-shell">
       <div className="app-brand"><img src="/assets/favicon.ico" alt=""/><span>Weldone</span></div>
       <nav className="app-nav" aria-label="主导航">{modules.map(name=><button type="button" key={name} aria-current={page===name?'page':undefined} onClick={()=>navigate(name)}>{name}</button>)}</nav>
       <details className="app-help"><summary aria-label="帮助菜单" title="帮助"><CircleHelp size={20}/></summary><div>{[['帮助','help'],['快捷键','shortcuts'],['关于 Weldone','about']].map(([label,target])=><button key={label} type="button" onClick={event=>{event.currentTarget.closest('details').open=false;setDialog(target);}}>{label}</button>)}</div></details>
      </header>
      <main id="main-content" tabIndex={-1}>{!libraryEditing&&page!=='焊接模板库'&&page!=='设备控制'&&page!=='生产统计'&&<PageHeader title={page} actions={<><Btn icon={Settings} aria-label={page==='工艺参数库'?'设备信息配置':'工艺规划设置'} onClick={()=>page==='工艺参数库'?window.dispatchEvent(new Event('process-device-settings')):setDialog('settings')}>{page==='工艺参数库'?'设备配置':'设置'}</Btn>{page==='工艺规划' ? <><Btn onClick={() => setDialog('import')}>导入模型</Btn><Btn primary aria-label="一键规划" aria-busy={!!geometryProgress} title={geometryProgress?.stage??(data.model?'提取焊道并进行工艺规划':'请先导入模型')} data-tooltip={!data.model?'请先导入模型':undefined} disabled={!data.model||!!geometryProgress} onClick={plan}><span aria-live="polite">{geometryProgress?.phase==='extract'?'提取焊道 '+geometryProgress.percent+'%':geometryProgress?.phase==='collision'?'碰撞检测 '+geometryProgress.percent+'%':geometryProgress?'工艺规划中…':'一键规划'}</span></Btn><Btn onClick={()=>taskFile.current?.click()}>导入 PF 文件</Btn><Btn disabled={!data.model} title={!data.model?'请先导入模型':undefined} onClick={exportTask}>导出任务</Btn></> : <Btn primary onClick={()=>setProcessRequest({fromWeld:false})}><img src="/assets/process-library/plus.svg" alt=""/>新建工艺参数</Btn>}</>}/> }
    {page==='工艺规划' ? <div className={'workspace planning-workspace'+(collapsed?' collapsed':'')+(inspectorOpen?' inspector-open':'')}><aside className="structure"><div className="panel-tabs"><button className="icon rail-button" aria-label="收起结构树" title="收起结构树" ref={treeToggle} onClick={()=>{flushSync(()=>setCollapsed(true));modelTreeToggle.current?.focus();}}><PanelLeftClose size={17}/></button>{['结构树', '零件管理'].map(t => <button key={t} className={leftTab === t ? 'active' : ''} onClick={() => setLeftTab(t)}>{t}</button>)}</div>{!data.model ? <Empty model text="请导入模型"/> : <><div className="tree-search"><Search size={14}/><input aria-label="搜索焊缝" title="焊缝来源：灰色为几何提取，蓝色为合并，橙色为手工" placeholder="搜索名称 / 编号" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="tree-root"><ChevronDown size={14}/><FolderOpen size={15}/><strong>{data.model}</strong></div>{leftTab === '零件管理' ? <div className="parts-list">{(modelInfo?.parts||[]).map((p, i) => <div key={i}><Box size={15}/><span>{p}</span><small>P00{i + 1}</small></div>)}</div> : <><div className="tree-section"><ChevronDown size={13}/>焊缝 <small>({data.welds.length})</small></div>{page==='工艺规划'&&<div className="weld-filter-tools">
 <label className="weld-filter-label">筛选<select aria-label="筛选焊缝" value={weldFilter} onChange={event=>setWeldFilter(event.target.value)}><option value="all">全部焊缝</option><option value="template">未匹配模板</option><option value="process">未匹配工艺参数</option></select></label>
 <button type="button" className="btn" aria-pressed={batchSelect} onClick={()=>{setBatchSelect(!batchSelect);if(batchSelect&&modelEditMode!=='merge')setMergeIds([]);}}>批量选择</button>
 {(batchSelect||modelEditMode==='merge')&&<div className="weld-multi-tools"><label><input type="checkbox" aria-label="全选可见焊道" checked={selectableWelds.length>0&&selectableWelds.every(w=>mergeIds.includes(w.id))} onChange={e=>setMergeIds(e.target.checked?[...new Set([...mergeIds,...selectableWelds.map(w=>w.id)])]:mergeIds.filter(id=>!selectableWelds.some(w=>w.id===id)))}/>已选 {mergeIds.length} 条</label><button type="button" className="btn danger-outline" disabled={!mergeIds.length||!!geometryProgress} onClick={()=>setDeleteWeldIds(mergeIds)}>删除所选</button>{mergeIds.length>0&&<button type="button" className="btn" onClick={()=>setMergeIds([])}>清空</button>}</div>}
 </div>}<div className="weld-list" ref={weldList}>{filteredWelds.map(w => {const route=weldMatchResults.get(w.id)?.route,matched=route==='whole'||route==='automatic'||route==='local';const showPoints=page==='工艺规划'&&w.id===data.selected&&closedPointTree!==w.id;return <div key={w.id} className={'weld-tree-branch'+(showPoints?' expanded':'')}><div data-weld-id={w.id} className={'weld-row ' + (w.id === data.selected ? 'selected' : '')} onClick={event=>{if(!event.target.closest('button,input,summary,label,.weld-row-menu'))selectTreeWeld(w.id);}}>{page==='工艺规划'&&(batchSelect||modelEditMode==='merge')&&<input type="checkbox" className="merge-checkbox" aria-label={`选择焊道 ${w.id}`} disabled={!removablePlanningWeld(w)||modelEditMode==='merge'&&!w.enabled} checked={mergeIds.includes(w.id)} onChange={e=>setMergeIds(ids=>e.target.checked?[...ids,w.id]:ids.filter(id=>id!==w.id))}/>}<input type="checkbox" aria-label={`启用 ${w.id}`} disabled={!!w.mergedInto||!!w.splitInto} checked={w.enabled} onChange={e => change(d => ({ ...d, welds: d.welds.map(x => x.id === w.id ? { ...x, enabled: e.target.checked } : x) }))}/><button className="weld-row-main" onClick={() => selectTreeWeld(w.id)}><Cable size={14}/><span>{w.id}<small className={'weld-row-origin origin-'+(w.source==='manual'?'manual':w.topology||w.source==='manual-merge'?'merged':'extracted')}>{w.name}</small></span><span className={'status-dot ' + (matched?'green':route==='blocked'?'wa-pending-dot':'')} title={matched?'已匹配':route==='blocked'?'未匹配':undefined}/></button>{page==='工艺规划'&&<><button type="button" className="weld-point-action" title={showPoints?'收起点位':'展开点位'} aria-label={(showPoints?'收起 ':'展开 ')+w.id+' 点位'} aria-expanded={showPoints} onClick={()=>showPoints?setClosedPointTree(w.id):selectTreeWeld(w.id)}><ChevronDown size={13}/></button><details className="weld-row-actions"><summary title="更多焊缝操作" aria-label={'更多操作 '+w.id}><MoreHorizontal size={16}/></summary><div className="weld-row-menu">
 <button type="button" onClick={event=>{toggleGeometry(weldViewKey(w.id));event.currentTarget.closest('details').open=false;}}>{hiddenWelds.has(w.id)?'显示焊缝':'隐藏焊缝'}</button>
 <button type="button" disabled={!w.enabled||!!w.mergedInto||!!w.splitInto||!!geometryProgress||!w.segments?.every(segment=>segment.pathPoints?.length>=2)} onClick={event=>{event.currentTarget.closest('details').open=false;addWeldLayer(w);}}>新建层</button>
 <button type="button" className="danger-text" disabled={!removablePlanningWeld(w)||!!geometryProgress} onClick={event=>{event.currentTarget.closest('details').open=false;setDeleteWeldIds([w.id]);}}>删除焊缝</button>
 </div></details></>}</div>{showPoints&&<WeldPointTree weldId={w.id} groups={planningPointGroups} selection={activeSelection} onSelect={selectWeldPoint} onAddPoint={beginWeldPoint} onAddPass={addWeldPass} onRemove={setRemoveLayoutTarget} isVisible={node=>!hiddenGeometry.has(layoutViewKey(w.id,node))} onToggleVisibility={node=>toggleGeometry(layoutViewKey(w.id,node))} editable={w.enabled&&!w.mergedInto&&!w.splitInto&&!geometryProgress}/>}</div>;})}{!filteredWelds.length && <p className="no-match">{data.welds.length?'没有匹配的焊道':'尚未生成焊道，请点击一键规划'}</p>}</div></>}</>}</aside><section className="center"><div className="model-title">{collapsed&&<button className="icon rail-button" aria-label="展开结构树" title="展开结构树" ref={modelTreeToggle} onClick={()=>{flushSync(()=>setCollapsed(false));treeToggle.current?.focus();}}><PanelLeftOpen size={17}/></button>}<strong>模型视图</strong></div><div className="viewport">{page==='工艺规划'&&<PlanningModelTools canUndo={!!data.manualEditHistory?.length} onUndo={undoGeometryEdit} splitByFace={splitByFace} faceStations={faceStations} onSplitByFace={value=>{setSplitByFace(value);setFaceStations([]);setSplitError('');}} mode={modelEditMode} onMode={editModelMode} weld={selected} ids={mergeIds} onUndoMerge={undoMerge} onMerge={()=>{setMergeError('');setMerging(true);}} splitAt={splitAt} onSplitAt={setSplitAt} onSplit={confirmSplit} onUndoSplit={undoSplit} canUndoSplit={!!data.manualSplitHistory?.length} disabled={!modelInfo||!!geometryProgress} error={splitError}/>}<Viewer key={stepModelKey(data)+':'+modelLoadRevision} stepModel={data.stepModel} mergeIds={modelEditMode==='merge'?mergeIds:undefined} editMode={modelEditMode} splitPoint={modelEditMode==='split'&&selected&&splitAt!==''?{id:selected.id,distance:Number(splitAt)}:null} planningPoints={visiblePlanningPoints} sampleMarker={sampleMarker} collisionMarker={collisionMarker} headPoint={deviceControl.precisionCamera.brand==='weijing'?headPoint:null} headCoverOpen={precisionCoverOpen} headFieldOfView={cameraFieldOfView} passPaths={passPaths} hiddenWelds={hiddenWelds} passFocus={passFocus} onSelectPass={id=>selectModelPlanningItem('pass',id)} selectedPlanningPointId={activePoint?.id} onPlanningPointSelect={id=>selectModelPlanningItem('point',id)} onCoverCaptureReady={capture=>{coverCapture.current=capture;}} onModelInfo={setModelInfo} model={data.model} selected={data.selected} welds={data.welds} view={view} reset={reset} camera={camera} onSelect={selectModelWeld} onSelectFace={modelEditMode==='split'&&splitByFace?selectSplitFace:undefined}/><div className="display-wrap"><button className="btn" onClick={() => setDisplay(!display)} aria-expanded={display}>视图显示 <ChevronDown size={13}/></button>{display && <div className="display-pop">{[['model', '模型'], ['welds', '焊缝'], ['passes', '层道'], ['head', '机头'], ['labels', '标注'], ['grid', '网格'], ['transparent', '透明显示']].map(([k, l]) => <label key={k}><input type="checkbox" checked={view[k]} onChange={e => setView(v => ({ ...v, [k]: e.target.checked }))}/>{l}</label>)}</div>}</div><div className="view-tools" role="group" aria-label="模型视图操作">{passPaths.length>0&&<button type="button" aria-label="近看层道偏移" title="近看层道偏移" onClick={()=>{setView(current=>({...current,passes:true}));setPassFocus(value=>value+1);}}><Layers size={18}/></button>}<button aria-label="适应视图" title="适应视图" onClick={() => setReset(r => r + 1)}><Maximize2 size={20}/></button><button aria-label="切换俯视" title="切换俯视" onClick={() => setCamera(c => c === 'top' ? 'iso' : 'top')}><Minimize2 size={20}/></button><button aria-label="透明模型" title="透明模型" className={view.transparent ? 'active' : ''} onClick={() => setView(v => ({ ...v, transparent: !v.transparent }))}><Box size={20}/></button><button aria-label="恢复默认" title="恢复默认" onClick={() => { setCamera('iso'); setReset(r => r + 1); setHiddenGeometry(new Set()); setView({ grid: true, model: true, welds: true, passes: true, head: true, labels: true, transparent: false }); }}><RotateCcw size={20}/></button></div><div className="view-orientation" role="group" aria-label="模型视角"><ViewCube onView={setCamera}/><div className="view-cameras">{[['top', '上'], ['front', '前'], ['right', '右'], ['iso', '等轴']].map(([id, l]) => <button key={id} className={camera === id ? 'active' : ''} aria-label={l==='等轴'?'等轴视图':l+'视图'} aria-pressed={camera===id} onClick={() => setCamera(id)}>{l}</button>)}</div></div>{data.model && <div className="canvas-note">{selected?selected.id+' · '+selected.position+' · '+formatLength(selected.length)+' mm':data.model+(demoModel?' · 可一键规划':'')}</div>}</div><section className={'logs'+(logsOpen?' logs-open':'')} style={{'--logs-height':logHeight+'px'}}>
  {logsOpen&&<div className="log-resize-handle" title="拖动调整日志面板高度" aria-hidden="true"
   onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);logResizeStart.current={y:event.clientY,height:logHeight};}}
   onPointerMove={event=>{const start=logResizeStart.current;if(start)setLogHeight(Math.max(100,Math.min(320,start.height+start.y-event.clientY)));}}
   onLostPointerCapture={()=>{logResizeStart.current=null;}}/>}
  {logsOpen&&<input className="log-height" type="range" min="100" max="320" value={logHeight} aria-label="日志面板高度" onChange={event=>setLogHeight(Number(event.target.value))}/>}
  <header><button type="button" className="log-toggle" aria-expanded={logsOpen} onClick={()=>setLogsOpen(open=>!open)}><ChevronDown size={15}/><strong>日志 · {logs.length} 条</strong></button>{!logsOpen&&logs.length>0&&<span className="log-latest" title={logs.at(-1).message}>最新：{logs.at(-1).message}</span>}{logsOpen&&<><span/><input placeholder="搜索日志" aria-label="搜索日志" value={logSearch} onChange={e=>setLogSearch(e.target.value)}/><button className="icon" aria-label="倒序日志" title="倒序日志" onClick={()=>setLogs(l=>[...l].reverse())}><Filter size={14}/></button><button className="icon" aria-label="清空日志" title="清空日志" onClick={()=>setLogs([])}><Trash2 size={14}/></button></>}</header>
  {logsOpen&&<div className="log-lines">{logs.filter(l=>l.message.includes(logSearch)).map(l=><div key={l.id}><time>{l.time}</time><span>{l.message}</span></div>)}</div>}
 </section></section><aside className="inspector" aria-label="焊缝属性侧栏">
 <button type="button" className="icon inspector-toggle" aria-label={inspectorOpen?'收起焊缝属性':'展开焊缝属性'} title={inspectorOpen?'收起焊缝属性':'展开焊缝属性'} aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(open=>!open)}>{inspectorOpen?<PanelRightClose size={18}/>:<PanelRightOpen size={18}/>}</button>
 <div className="inspector-content" inert={!inspectorOpen}>{!selected ? <Empty text={data.model?null:"请先导入 STEP 模型"}/> : <WeldAttributes onCreateTemplate={page==='工艺规划'?createWholeTemplate:undefined} createTemplateUnavailable={templateCreateDisabled?templateCreateHint:''} onCreateProcess={page==='工艺规划'?()=>{setProcessRequest({fromWeld:true});go('工艺参数库');}:undefined} onChooseTemplate={()=>setDialog('templatePicker')} onChooseProcess={()=>setDialog('processPicker')} planningSelection={activeSelection} planningPoint={activePoint} planningPointPose={previewPoint?.pose} planningPassPreview={stationPose?{pose:stationPose,from:firstStation,to:lastStation,sampleStations:selectedPass.sampleStations,sampleStation,
   speedAt:selectedPass.speedAt, collision:passCollision,
   onStation:updatePreviewStation}:undefined} planningPointBasePosition={pointBasePosition} planningPointGroup={pointGroup} onSavePoint={point=>saveWeldPoint(point,true)} onSaveLayerOrPass={saveLayerOrPass} onOffsetPreview={setPointOffsetPreview} onOffsetPreviewEnd={clearPointOffsetPreview} onPlanningViewChange={setPlanningPointsVisible} onUndoMerge={undoMerge} onSeparateSegments={page==='工艺规划'&&!geometryProgress&&canSeparateWeldSegments(selected)?()=>setSegmentSeparation({id:selected.id,indices:[],error:''}):undefined} decision={selectedDecision} trackingSegments={plannedTracking(selected,context).segments} weld={selected} templates={data.templates} processLibrary={data.processLibrary} onPatch={patch} onWrapChange={patchWeldWrap} onCancel={weldEditBaseline.current.has(selected.id)?cancelWeldEdit:undefined} onSave={applyWeldAttributes}/>}</div></aside></div> : page==='焊接模板库' ? <TemplateLibrary templateImpact={templateImpact} measureNeighborhood={measureLibraryTemplate} captureRange={data.templateCaptureRange} templates={data.templates} project={data.project} projectNames={data.templateProjects} processLibrary={data.processLibrary} onUpdate={updateTemplates} onEditingChange={setLibraryEditing} onGoPlanning={()=>go('工艺规划')} notify={notify}/> : page==='工艺参数库' ? <ProcessParameterLibrary welds={data.welds} deletedDeviceProfiles={data.deletedProcessDevices} onRestoreDevice={async id=>{try{return await updateTemplates(restoreDeviceLibrary(dataRef.current,id));}catch(error){return error.message;}}} onEditingChange={setLibraryEditing} entries={data.processLibrary} deviceProfiles={data.processDeviceProfiles} selected={selected?plannedTracking(selected,context):null} editorRequest={processRequest} onEditorRequestHandled={()=>setProcessRequest(null)} onUpdate={updateTemplates} onApply={p=>{if(applyProcess(p)){go('工艺规划');}}} notify={notify}/> : page === '设备控制' ? <DeviceControl value={deviceControl} coverOpen={precisionCoverOpen} onCoverChange={setPrecisionCoverOpen} fieldOfView={cameraFieldOfView} onFieldOfViewChange={setCameraFieldOfView} onSave={async deviceControl=>{
  const error=await updateTemplates({deviceControl});if(!error)notify('设备配置已保存');return error;
 }}/> : <ProductionStatisticsWorkspace/>}
    </main><footer className="statusbar"><span>项目：{data.project || '本地项目'}</span><span className="status-dot"/><span>设备未连接</span>{page==='工艺规划'&&data.welds.length>0&&<span className="status-welds">已启用 {enabled.length.toLocaleString('zh-CN')} / {data.welds.length.toLocaleString('zh-CN')} 条 · {formatLength(total)} mm</span>}{(savingWorkspace||saved)&&<><span className="status-spacer"/><span role="status" className={'save-indicator'+(!savingWorkspace&&saved==='已保存至本机'?' saved':'')}>{savingWorkspace?'正在保存至本机':saved}{!savingWorkspace&&saved==='已保存至本机'&&savedAt&&' · '+savedAt}</span></>}</footer><input hidden type="file" accept=".pf" aria-label="PF 文件" ref={taskFile} onChange={importTask}/><input hidden type="file" accept=".step,.stp" aria-label="STEP 文件" ref={stepFile} onChange={importStep}/><input hidden type="file" accept=".json,application/json" ref={file} onChange={importDraft}/>{toast && <Feedback {...toast} onDismiss={()=>setToast(null)}/>}
    {merging&&<WeldMergeDialog settings={context} welds={data.welds} ids={mergeIds} onClose={()=>setMerging(false)} onMerge={mergeSelection} error={mergeError}/>}
    {segmentSeparation&&selected?.id===segmentSeparation.id&&<Dialog title="拆分焊缝段" onClose={()=>setSegmentSeparation(null)}>
      <div className="dialog-body">
        <p>勾选要拆成独立焊缝的段。其余相连的段会保留为一条焊缝。</p>
        <label className="weld-segment-select-all">
          <input type="checkbox" checked={segmentSeparation.indices.length===selected.segments.length}
            ref={input=>{if(input)input.indeterminate=segmentSeparation.indices.length>0&&segmentSeparation.indices.length<selected.segments.length;}}
            onChange={event=>chooseSegments(event.target.checked?selected.segments.map((_,index)=>index):[])}/>全选
        </label>
        <div className="weld-segment-options" role="group" aria-label="焊缝段">
          {selected.segments.map((segment,index)=><label key={index}>
            <input type="checkbox" checked={segmentSeparation.indices.includes(index)} aria-label={segmentName(selected,index)}
              onChange={event=>chooseSegments(event.target.checked?[...segmentSeparation.indices,index]:segmentSeparation.indices.filter(value=>value!==index))}/>
            {segmentName(selected,index)}<small>{segment.length.toFixed(1)} mm</small>
          </label>)}
        </div>
        {segmentSeparation.error&&<p role="alert" className="tpl-errors">{segmentSeparation.error}</p>}
      </div>
      <footer><Btn onClick={()=>setSegmentSeparation(null)}>取消</Btn>
        <Btn primary disabled={!segmentSeparation.indices.length||!!geometryProgress} onClick={confirmSegmentSeparation}>拆分所选（{segmentSeparation.indices.length}）</Btn></footer>
    </Dialog>}
    {removeLayoutTarget&&<Dialog title={'删除'+({layer:'层',pass:'道',point:'点位'}[removeLayoutTarget.type])} onClose={()=>setRemoveLayoutTarget(null)}>
      <div className="dialog-body"><p>确定删除「{removeLayoutTarget.label}」？</p>
        {removeLayoutTarget.type!=='point'&&<p>其中的{removeLayoutTarget.type==='layer'?'道和点位':'点位'}也会删除。</p>}</div>
      <footer><Btn onClick={()=>setRemoveLayoutTarget(null)}>取消</Btn><Btn primary onClick={confirmRemoveLayoutItem}>确认删除</Btn></footer>
    </Dialog>}
    {deleteWeldIds.length>0&&<Dialog title="删除所选焊缝" onClose={()=>setDeleteWeldIds([])}><div className="dialog-body"><p>确定删除所选的 {deleteWeldIds.length} 条焊缝？</p><p className="delete-weld-list">{deleteWeldIds.join('、')}</p></div><footer><Btn onClick={()=>setDeleteWeldIds([])}>取消</Btn><Btn danger onClick={deleteSelectedWelds}>确认删除</Btn></footer></Dialog>}
    {dialog === 'import' && <Dialog title="导入模型" onClose={closeImport}>
      <div className="dialog-body">
        <div className="import-zone"><Box size={38}/><h3>导入本地 STEP 模型</h3><p>支持 .step 和 .stp，文件在本机浏览器中解析</p>
          <Btn primary disabled={!!stepImporting} onClick={()=>stepFile.current?.click()}>选择 STEP 文件</Btn>
        </div>
        {stepImporting&&<p role="status">正在解析 {stepImporting}…</p>}
        {stepError&&<p role="alert" className="tpl-errors">{stepError}</p>}
        <div className="step-import-actions"><Btn disabled={!!stepImporting} onClick={load}>加载 111.step 示例</Btn>
          <Btn icon={FileJson} disabled={!!stepImporting} onClick={()=>file.current?.click()}>导入已有规划草稿</Btn>
        </div>
      </div>
      <footer><Btn onClick={closeImport}>{stepImporting?'取消导入':'取消'}</Btn></footer>
    </Dialog>}
    {dialog==='weldPoint'&&selected?.id===newPointTarget?.weldId&&<Dialog title={'添加点位 · '+selected.id} onClose={()=>setDialog(null)}><WeldControlPointForm key={selected.id} groups={editablePointGroups} initialGroup={newPointTarget.passId} existing={planningPoints} onSave={saveWeldPoint} onCancel={()=>setDialog(null)}/></Dialog>}
    {selected&&dialog==='templatePicker'&&<Dialog title="选择焊接模板" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="template" weld={selected} templates={data.templates} project={data.project} projectNames={data.templateProjects} onCancel={()=>setDialog(null)} onConfirm={template=>{if(applyTemplate(template))setDialog(null);}}/></Dialog>}
    {selected&&dialog==='processPicker'&&<Dialog title="工艺参数库" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="process" weld={selected} processLibrary={activeProcesses} onCancel={()=>setDialog(null)} onConfirm={value=>{if(applyProcess(value,{throwOnError:true}))setDialog(null);}}/></Dialog>}
    {dialog === 'settings' && <Dialog title="工艺规划设置" onClose={() => setDialog(null)}><PlanningSettings key={data.project} capabilities={context.deviceCapabilities} settings={data.planningSettings} hasWelds={data.welds.length>0} onCancel={()=>setDialog(null)} onSave={async settings=>{const error=await updateTemplates({planningSettings:settings});if(!error){setDialog(null);notify(data.welds.length?'设置已保存，下次一键规划时使用。现有焊缝和已生成路径已保留。':'设置已保存，点击一键规划后按新设置提取焊缝并生成路径。');}return error;}}/></Dialog>}
    {dialog === 'about' && <Dialog title="关于原版工艺规划平台" onClose={() => setDialog(null)}><div className="dialog-body"><h2>原版工艺规划平台</h2><p>参照本机安装版 Weldone 1.0.4 的导航、三栏工作区、橙色主题与日志布局实现。</p><p>示例使用 111.step 的实际几何，支持焊道提取、模板应用与本地草稿保存。支持几何提取、打断和合并规则；设备通信尚未接入。</p></div><footer><Btn primary onClick={() => setDialog(null)}>知道了</Btn></footer></Dialog>}
    {dialog==='help'&&<Dialog title="使用帮助" onClose={()=>setDialog(null)}><div className="dialog-body"><p>在工艺规划导入 STEP 模型，再点击「一键规划」提取焊缝并匹配模板或工艺参数。</p><p>选中焊缝后，可在焊缝属性中查看匹配结果或基于此焊道新建模板。</p></div></Dialog>}
    {dialog==='shortcuts'&&<Dialog title="快捷键" onClose={()=>setDialog(null)}><div className="dialog-body"><p>Tab / Shift + Tab 在控件之间移动。</p><p>Esc 关闭当前弹窗。</p><p>Ctrl / ⌘ + S 保存正在编辑的模板。</p></div></Dialog>}
    {templateDraft&&<TemplateEditor initial={templateDraft.template} neighborhoodEvidence={templateDraft.evidence} neighborhoodSource={templateDraft.source} measureNeighborhood={context.measureTemplateNeighborhood} isNew processLibrary={data.processLibrary} onClose={()=>setTemplateDraft(null)} onSave={saveNewTemplate}/>}
    {templateDuplicate&&<Dialog title="重复焊接模板" onClose={()=>setTemplateDuplicate(null)}>
      <div className="tpl-confirm-body"><p>已存在焊缝几何条件相同的模板。继续创建时，请选择默认匹配的模板。</p><select aria-label="同几何默认模板" value={templateDuplicate.defaultId} onChange={event=>setTemplateDuplicate({...templateDuplicate,defaultId:event.target.value})}>{[...templateDuplicate.duplicates,templateDuplicate.value].map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
      <footer><Btn onClick={()=>setTemplateDuplicate(null)}>取消</Btn><Btn primary onClick={async ()=>{try{const issue=await commitNewTemplate(templateDuplicate.value,templateDuplicate.defaultId);if(issue)notify(issue);}catch(error){notify(error.message);}}}>继续创建</Btn></footer>
    </Dialog>}
    </div>;
}
