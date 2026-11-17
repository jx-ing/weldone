import {TextInput} from './FormInput.jsx';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {EmptyState as Empty, Feedback, IconTooltips, PageHeader, formatLength, useModalScrollLock} from './WorkspaceUI';
import { PanelLeftClose, PanelLeftOpen, PanelRightOpen, PanelRightClose, MoreHorizontal, Settings, Plus, ChevronDown, Upload, X, Box, Search, Trash2, RotateCcw, CircleHelp, FolderOpen, Maximize2, Minimize2, Filter, Copy, Cable, Crosshair, Layers } from 'lucide-react';
import Viewer from './StepViewer';
import {MAX_PLANNING_WELDS,planningContext,roundWeldLeg,belongsToDevice,weldPositionCode} from './planningRequirements.mjs';
import {validGroove} from './grooveModel.mjs';
import PlanningSettings from './PlanningSettings';
import {settingsDefaults,updateProjectPlanning} from './planningSettingsModel.mjs';
import {prepareExtractedPlanningWorkspace} from './geometryPlanningResult.mjs';
import PlanningLibraryPicker from './PlanningLibraryPicker';
import PlanningModelTools from './PlanningModelTools';
import PlanningViewDisplay,{DEFAULT_PLANNING_VIEW,WorkpiecePlacementTools} from './PlanningViewDisplay';
import {geometryOptionsForPlanning} from './planningConfiguration.mjs';
import {canSeparateWeldSegments,separateWeldSegments,weldPointDistance,splitSelectedWeld,undoLastSplit,planeSplitStations,installWrapSplit} from './manualSplitModel.mjs';
import {segmentName,weldMeasurementCapabilities,weldPrecisionMethod} from './weldAttributeModel.mjs';
import {weldMeasurementPlan} from './weldMeasurementPlan.mjs';
import './planningWorkspace.css';
import WeldMergeDialog from './WeldMergeDialog';
import {mergeSelectedWelds,undoManualMerge} from './manualMergeModel.mjs';
import {excludeConfirmedNonWelds} from './confirmedNonWelds.mjs';
import {DEMO_SOURCE_SHA256,DEFAULT_GEOMETRY_OPTIONS,deletedGeometryForModel,excludeDeletedGeometry,restoreGeometryResult,validExtractedWeld,removablePlanningWeld,removePlanningWelds} from './geometryProcessingModel.mjs';
import './geometryProcessing.css';
import {createManualWeld,distance,EXAMPLE_MODEL,pathLength,useStepExample,validManualWeldPath} from './manualWeldModel.mjs';
import {manualPointCount,manualWeldIntersections,manualWeldSegments,manualWeldThroughPoints} from './manualWeldIntersection.mjs';
import {cacheStepMesh,cacheStepNeighborhood,isBundledStartupStep,isDemoModel,isPointCloudWorkspace,loadStepMesh,loadStepNeighborhood,STARTUP_STEP_MODEL,STARTUP_STEP_REFERENCE,stepModelKey,switchStepWorkspace,validStepModel,validWorkpiecePose,workpiecePoseFor} from './stepModelStore.mjs';
import {POINT_CLOUD_EXTENSIONS} from './pointCloudModel.mjs';
import {reversePointCloud} from './reversePointCloud.mjs';
import {applyWeldWrapEdits,endpointWrapAt,endpointWrapCandidates,endpointWrapEdge,endpointWrapEdgePortion,endpointWrapNeighbor,materializeEndpointWraps,overlappingEndpointWrap,wrapPlateThickness,wrapSegmentDistance} from './weldWrapJunctions.mjs';
import {directedWeld,measureDirectedConnection} from './weldDirectionGeometry.mjs';
import {assignWeldingOrder,disableShortPlanningWelds} from './strategyGeometry.mjs';
import {createPlanningCollisionPool} from './planningCollisionPool.mjs';
import {loadProductionTask,loadWorkspaceDraft,saveProductionTask,saveWorkspaceDraft,loadWorkstationSceneFile,saveWorkstationSceneFile} from './workspaceDraftStore.mjs';
import {listWorkpieceTemplates,loadWorkpieceTemplate,removeWorkpieceTemplate,saveWorkpieceTemplate} from './workspaceDraftStore.mjs';
import {canSaveWorkpieceTemplate,createWorkpieceTemplate,workpieceWorkspace} from './workpieceTemplateModel.mjs';
import {captureWorkpieceCover} from './captureWorkpieceCover.mjs';
import WorkpieceLibrary from './WorkpieceLibrary';
import {createTemplateProject,templateProjectGroups} from './templateProjects.mjs';
import ViewCube from './ViewCube';
import TemplateLibrary, {TemplateEditor} from './TemplateLibrary';
import {newPlanningTemplate,templateMeasurementWeld} from './templateCoverModel.mjs';
import {DEFAULT_TEMPLATE_CAPTURE_RANGE,validTemplateCaptureRange} from './templateCaptureRange.mjs';
import {createTemplateNeighborhoodMeasurer,loadDemoTemplateNeighborhood} from './templateNeighborhood.mjs';
import {templateGeometryKey} from './templateGeometryRules.mjs';
import WeldAttributes from './WeldAttributes';
import {copyWeldLayersToTemplate,nextWeldLayer,nextWeldPass,removeWeldLayoutItem,updateWeldLayoutPoint,validWeldLayerLayout,weldLayerLayout,weldLayerPassPaths,weldLayerTreeGroups,weldLayoutTrackingIssue,weldPathTrackingIssue,weldPointPlacement,weldPointPosition} from './weldLayerLayout.mjs';
import WeldPointTree from './WeldPointTree';
import WeldControlPointForm from './WeldControlPointForm';
import {analyzeWeldMatch,planWorkspace,applySelectedTemplate,restorePlanningState,planWeld,planWeldFromMatch,clearMissingWeldTemplates,weldPreviewStrategy,weldTemplateIds} from './weldMatching.mjs';
import ProcessParameterLibrary from './ProcessParameterLibrary';
import DeviceControl,{WorkstationDeviceControl} from './DeviceControl';
import {configureWorkstation,configuredTrackingPlanes,importWorkstationScene,loadStructuredLightAttachment,loadWorkstationScene} from './workstationScene.mjs';
import {workstationPlanningControl,workstationPrecisionByRobot} from './workstationDevices.mjs';
import {plannedTracking} from './strategyPlanning.mjs';
import {deviceControlCapabilities,deviceControlError,enabledPlanningRobots,migrateDeviceControl} from './deviceControlModel.mjs';
import {DEFAULT_LASER_MOUNT_SIDE} from './laserCameraMount.mjs';
import ProductionStatisticsWorkspace from './ProductionStatisticsWorkspace';
import ProductionExecutionWorkspace from './ProductionExecutionWorkspace';
import {planningTaskDocument,productionTaskSnapshot,readPlanningTask} from './planningTask.mjs';
import {deviceLibraryUpdates,normalizeActiveDevices,restoreDeviceLibrary,clearRemovedProcess} from './processDeviceLibraries.mjs';
import {matchesWorkstationWelder,validDeviceProfileStore,workstationWelders} from './processDeviceModel.mjs';
import {validateProcessEntry,applyProcessEntry,validWeldProcessParameters} from './processParameterModel.mjs';
import { migrateDraft, validateTemplate, validateFixed, wholeWeldSourceIssues,matchTemplate,targetFromWeld } from './templateModel.mjs';
const modules = ['工艺规划', '生产执行', '工件库', '焊接模板库', '工艺参数库', '设备控制', '生产统计'];
const previewModels=[STARTUP_STEP_MODEL,EXAMPLE_MODEL];
const defaults = migrateDraft({ model: '', welds: [], selected: '', project: '本地项目', templates: [] });
function valid(v) { try { const d = migrateDraft(v); return typeof d.model === 'string' && (d.workpiecePose===undefined||validWorkpiecePose(d.workpiecePose)) && (!d.stepModel||validStepModel(d.stepModel)) && typeof d.project === 'string' && (d.templateCaptureRange===undefined||validTemplateCaptureRange(d.templateCaptureRange)) && (d.templateProjects===undefined||Array.isArray(d.templateProjects)&&d.templateProjects.length<1000&&new Set(d.templateProjects).size===d.templateProjects.length&&d.templateProjects.every(p=>typeof p==='string'&&p.trim()===p&&p.length>0&&p.length<=80)) && typeof d.selected === 'string' && Array.isArray(d.welds) && d.welds.length <= MAX_PLANNING_WELDS && new Set(d.welds.map(w => w.id)).size === d.welds.length && d.welds.every(w => /^W[0-9]{3,6}$/.test(w.id) && typeof w.name === 'string' && typeof w.position === 'string' && typeof w.template === 'string' && typeof w.enabled === 'boolean' && validWeldLayerLayout(w.pointLayout) && validManualWeldPath(w,d.model) && validExtractedWeld(w,d) && (d.model!==EXAMPLE_MODEL||['manual','extracted','manual-merge'].includes(w.source)) && Number.isFinite(w.length)&&w.length>0 && ['leg','speed'].every(k=>(['extracted','manual-merge'].includes(w.source)||w.splitFrom||w.source==='manual'&&w.current===null&&w.voltage===null)&&w[k]===null||Number.isFinite(w[k])&&(k==='speed'&&w.processParameters?.recipeRevision===3?w[k]>=0:w[k]>0)) && validWeldProcessParameters(w)) && d.templates.length < 1000 && new Set(d.templates.map(t => t.id)).size === d.templates.length && d.templates.every(t => !validateTemplate(t).filter(e=>!e.includes('请选择有效基准点')).length) && Array.isArray(d.fixedTemplates) && d.fixedTemplates.length < 1000 && new Set(d.fixedTemplates.map(t => t.id)).size === d.fixedTemplates.length && d.fixedTemplates.every(t => !validateFixed(t).filter(e=>!e.includes('请选择有效基准点')).length) && (d.deviceControl===undefined||!deviceControlError(d.deviceControl)) && validDeviceProfileStore(d.processDeviceProfiles) && Array.isArray(d.processLibrary) && d.processLibrary.length < 1000 && new Set(d.processLibrary.map(p=>p.id)).size===d.processLibrary.length && d.processLibrary.every(p=>!validateProcessEntry(p,{allowLegacyLeg:true}).length); } catch { return false; } }
async function readWorkspace(){
  const saved=await loadWorkspaceDraft();
  const shared=saved&&valid(saved)?migrateDraft(saved):structuredClone(defaults);
  if(isBundledStartupStep(shared.model,shared.stepModel))return shared;
  return switchStepWorkspace(shared,STARTUP_STEP_MODEL,STARTUP_STEP_REFERENCE);
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
  const [attempt,setAttempt]=useState(0),[loaded,setLoaded]=useState(null),[error,setError]=useState(false);
  useEffect(()=>{
    let active=true;
    Promise.all([readWorkspace(),loadProductionTask()]).then(([workspace,task])=>{
      if(active)setLoaded({workspace,task});
    },()=>{if(active)setError(true);});
    return ()=>{active=false;};
  },[attempt]);
  if(loaded)return <Workspace initialData={loaded.workspace} initialProductionTask={loaded.task}/>;
  return <main><Empty text={error?'无法读取本机工作区':'正在读取本机工作区'} actions={error&&
    <Btn onClick={()=>{setError(false);setAttempt(value=>value+1);}}>重试</Btn>}/></main>;
}
function Workspace({initialData,initialProductionTask}) {
    const [data, setData] = useState(initialData), [page, setPage] = useState('工艺规划'), [leftTab, setLeftTab] = useState('结构树'), [search, setSearch] = useState(''), [logSearch, setLogSearch] = useState(''), [logs, setLogs] = useState([]), [dialog, setDialog] = useState(null), [toast, setToast] = useState(null), [view, setView] = useState(DEFAULT_PLANNING_VIEW), [reset, setReset] = useState(0), [camera, setCamera] = useState('iso'), [collapsed, setCollapsed] = useState(false), [saved, updateSaved] = useState(''), [processRequest,setProcessRequest]=useState(null), [libraryEditing,setLibraryEditing]=useState(false), [modelInfo,setModelInfo]=useState(null), [deleteWeldIds,setDeleteWeldIds]=useState([]);
    const [savedAt,setSavedAt]=useState(''),[savingWorkspace,setSavingWorkspace]=useState(false);
    const [productionTask,setProductionTask]=useState(initialProductionTask),[writingProductionTask,setWritingProductionTask]=useState(false);
    const [workpieceDialog,setWorkpieceDialog]=useState(null),[workpieceBusy,setWorkpieceBusy]=useState(false);
    const [editingWorkpiece,setEditingWorkpiece]=useState(null);
    const [workpieceDialogError,setWorkpieceDialogError]=useState('');
    const [workpieces,setWorkpieces]=useState([]),[workpiecesLoading,setWorkpiecesLoading]=useState(false),[workpiecesError,setWorkpiecesError]=useState('');
    useEffect(()=>{
      if(page!=='工件库')return;
      let active=true;
      setWorkpiecesLoading(true);setWorkpiecesError('');
      listWorkpieceTemplates().then(items=>{if(active)setWorkpieces(items);},
        ()=>{if(active)setWorkpiecesError('无法读取本机工件库');})
        .finally(()=>{if(active)setWorkpiecesLoading(false);});
      return ()=>{active=false;};
    },[page]);
    const workpieceProjects=[...new Set([...templateProjectGroups(data.templates,data.project,data.templateProjects).map(group=>group.name),
      ...workpieces.map(item=>item.project),data.project||'本地项目'])];
    const productionTaskLock=useRef(false),productionTaskFile=useRef(null);
    const [partsSearch,setPartsSearch]=useState(''),[collapsedWeldGroup,setCollapsedWeldGroup]=useState(null);
    const workspaceSave=useRef(false);
    const treeToggle=useRef(null),modelTreeToggle=useRef(null);
    const [inspectorOpen,setInspectorOpen]=useState(()=>window.innerWidth>=1440);
    const [logsOpen,setLogsOpen]=useState(false),[logHeight,setLogHeight]=useState(200);
    const logResizeStart=useRef(null);
    const [batchSelect,setBatchSelect]=useState(false);
    const [templateDraft,setTemplateDraft]=useState(null);
    const [precisionCoverOpen,setPrecisionCoverOpen]=useState(false);
    const planningCollisionEnabled=data.planningSettings?.splitParameters?.toolHeadCollisionEnabled===true;
    const collisionPool=useMemo(createPlanningCollisionPool,[]);
    const [cameraFieldOfView,setCameraFieldOfView]=useState(false);
    const [segmentSeparation,setSegmentSeparation]=useState(null);
    const [templateDuplicate,setTemplateDuplicate]=useState(null);
    const [coverBusy,setCoverBusy]=useState(false);
    const coverCapture=useRef(),pickedSplit=useRef(null),weldEditBaseline=useRef(new Map());
    const [planningPointsVisible,setPlanningPointsVisible]=useState(false);
    const [measurementView,setMeasurementView]=useState(false),[measurementPickKey,setMeasurementPickKey]=useState(null);
    useEffect(()=>{if(!measurementView)setMeasurementPickKey(null);},[measurementView]);
    const [measurementSelection,setMeasurementSelection]=useState(null);
    const [measurementFocus,setMeasurementFocus]=useState(0);
    const [passFocus,setPassFocus]=useState(0),[removeLayoutTarget,setRemoveLayoutTarget]=useState(null);
    const [planningSelection,setPlanningSelection]=useState(null);
    const [pointOffsetPreview,setPointOffsetPreview]=useState(null);
    const [hiddenGeometry,setHiddenGeometry]=useState(new Set());
    const modelViewKey=stepModelKey(data);
    const [workpieceTool,setWorkpieceTool]=useState(null);
    useEffect(()=>setWorkpieceTool(null),[modelViewKey,page]);
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
    const taskFile=useRef(),stepFile=useRef(),stepImportWorker=useRef(), toastTimer = useRef(), geometryWorker=useRef(), dataRef=useRef(data); dataRef.current=data;
    const startupGeometryWorker=useRef(null);
    const [stepImporting,setStepImporting]=useState(''),[stepError,setStepError]=useState(''),[modelLoadRevision,setModelLoadRevision]=useState(0);
    const [reverseResult,setReverseResult]=useState(null),reverseRequest=useRef(null);
    const demoModel=isDemoModel(data);
    const pointCloudWorkspace=isPointCloudWorkspace(data),pointCloudFile=useRef();
    const [workstationSource,setWorkstationSource]=useState(null),[structuredModel,setStructuredModel]=useState(null);
    const [workstationStatus,setWorkstationStatus]=useState('正在加载工作站场景…');
    const [workstationLoading,setWorkstationLoading]=useState(true);
    const sceneFileInput=useRef(null),sceneImport=useRef(false);
    useEffect(()=>{
      let active=true;
      async function restoreScene(){
        let warning='';
        try{
          const local=await loadWorkstationSceneFile().then(file=>file?importWorkstationScene(file):null)
            .catch(()=>{warning='本机场景无法加载，已使用默认场景。';return null;});
          const scene=local??await loadWorkstationScene();
          if(active){setWorkstationSource(scene);setWorkstationStatus(warning);}
        }catch(error){
          if(active)setWorkstationStatus('工作站场景加载失败：'+error.message);
        }finally{
          if(active)setWorkstationLoading(false);
        }
      }
      void restoreScene();
      return ()=>{active=false;};
    },[]);
    const sceneKey=workstationSource?.sceneKey;
    const settingsForScene=useCallback(workspace=>sceneKey?
      workspace.workstationSettings?.byScene?.[sceneKey]:workspace.workstationSettings,[sceneKey]);
    const workstationSettings=settingsForScene(data);
    const needsStructuredModel=workstationSettings?.additionalDevices?.some(device=>device.kind==='precision'&&device.brand==='weijing');
    useEffect(()=>{
      if(!workstationSource||!needsStructuredModel||structuredModel)return;
      let active=true;
      loadStructuredLightAttachment().then(model=>{if(active)setStructuredModel(model);})
        .catch(error=>{if(active)setWorkstationStatus(error.message);});
      return ()=>{active=false;};
    },[workstationSource,needsStructuredModel,structuredModel]);
    const workstation=useMemo(()=>configureWorkstation(workstationSource,workstationSettings,structuredModel),
      [workstationSource,workstationSettings,structuredModel]);
    const controlForWorkspace=useCallback(workspace=>workstationSource
      ?workstationPlanningControl(workstationSource.devices,settingsForScene(workspace))
      :workspace.deviceControl??migrateDeviceControl(undefined,workspace.deviceCapabilities),[workstationSource,settingsForScene]);
    const deviceControl=useMemo(()=>controlForWorkspace(data),[controlForWorkspace,data.deviceControl,data.deviceCapabilities,data.workstationSettings]);
    const sceneWelders=useMemo(()=>workstationWelders(workstation?.devices),[workstation]);
    const eligibleProcessProfiles=useCallback(profiles=>profiles.filter(profile=>matchesWorkstationWelder(profile,sceneWelders)),[sceneWelders]);
    const availableProcessProfiles=useMemo(()=>eligibleProcessProfiles(data.processDeviceProfiles),[eligibleProcessProfiles,data.processDeviceProfiles]);
    const getPlanningContext=useCallback(workspace=>({...planningContext({...workspace,deviceControl:controlForWorkspace(workspace),
      processDeviceProfiles:sceneWelders.length?normalizeActiveDevices(eligibleProcessProfiles(workspace.processDeviceProfiles)):workspace.processDeviceProfiles,
    }),laserTrackingByRobot:workstationSource?configuredTrackingPlanes(workstationSource,settingsForScene(workspace)):undefined,
    precisionByRobot:workstationSource?workstationPrecisionByRobot(workstationSource.devices,settingsForScene(workspace)):undefined}),
    [controlForWorkspace,sceneWelders,eligibleProcessProfiles,workstationSource,settingsForScene]);
    const {laserPrecision,structuredLightPrecision:structuredLightInstalled}=deviceControlCapabilities(deviceControl);
    const planningRobots=enabledPlanningRobots(deviceControl);
    const currentRobot=planningRobots[0]?.configuration??deviceControl.robot;
    const laserMountSide=laserPrecision?currentRobot.laserMountSide??DEFAULT_LASER_MOUNT_SIDE:undefined;
    const invertModelZ=currentRobot.mounting==='inverted';
    useEffect(()=>{
      if(!planningCollisionEnabled){collisionPool.dispose();return;}
      if(!data.model||pointCloudWorkspace||(!data.stepModel&&!isDemoModel(data))){collisionPool.dispose();return;}
      const timer=setTimeout(()=>collisionPool.prepare(data,false,laserMountSide,structuredLightInstalled),0);
      return ()=>clearTimeout(timer);
    },[data.model,data.stepModel,pointCloudWorkspace,planningCollisionEnabled,laserMountSide,structuredLightInstalled,collisionPool]);
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
    const canPlaceWorkpiece=!!modelInfo&&!modelEditMode&&!geometryProgress&&!savingWorkspace;
    const placementMode=view.model?workpieceTool:null;
    const [manualCreate,setManualCreate]=useState(null),[creatingWelds,setCreatingWelds]=useState(false);
    const manualCreateLock=useRef(false);
    const [wrapFocus,setWrapFocus]=useState(null);
    const storedWeld = data.welds.find(w => w.id === data.selected), enabled = data.welds.filter(w => w.enabled), total = Math.round(enabled.reduce((s, w) => s + w.length, 0)*100)/100;
    const context=useMemo(()=>({...getPlanningContext(data),measureTemplateNeighborhood:demoModel?neighborhood:importedMeasure}),[data.planningSettings,data.processDeviceProfiles,data.deviceCapabilities,data.deviceControl,data.workstationSettings,getPlanningContext,demoModel,neighborhood,importedMeasure]);
    const selected=useMemo(()=>plannedTracking(storedWeld,context),[storedWeld,context]);
    const measureLibraryTemplate=useMemo(()=>(template,range)=>{
      const source=template.sourceWeld;
      const measure=isDemoModel(source)?neighborhood:source.stepModel?.sourceSha256===importedSha?importedMeasure:null;
      if(!measure)return null;
      const current=dataRef.current;
      const original=source.model===current.model&&source.stepModel?.sourceSha256===current.stepModel?.sourceSha256?
        current.welds.find(weld=>weld.id===source.id):null;
      return measure(templateMeasurementWeld(template,original),range);
    },[neighborhood,importedSha,importedMeasure,data.model,data.welds]);
    const activeProcesses=useMemo(()=>data.processLibrary.filter(process=>belongsToDevice(process,context.activeDevice)),[data.processLibrary,context]);
    const allocationLabel=weld=>planningRobots.find(robot=>robot.id===weld.assignedRobot)?.label;
    const selectedDecision=useMemo(()=>selected?analyzeWeldMatch(selected,data.templates,activeProcesses,context):null,[selected,data.templates,activeProcesses,context]);
    const weldMatchResults=useMemo(()=>{
      const options={...context,includeMatchDiagnostics:false};
      return new Map(data.welds.map(weld=>{
        const match=analyzeWeldMatch(weld,data.templates,activeProcesses,options);
        return [weld.id,{route:match.route,templateId:match.whole?.id,processId:match.process?.id}];
      }));
    },[data.welds,data.templates,activeProcesses,context]);
    const weldSearch=search.trim().toLowerCase();
    const filteredWelds=data.welds.filter(weld=>(weld.id+weld.name).toLowerCase().includes(weldSearch));
    const weldGroupOpen=collapsedWeldGroup!==modelViewKey;
    const visibleParts=(modelInfo?.parts??[]).map((name,index)=>({name,id:'P'+String(index+1).padStart(3,'0')}))
      .filter(({id,name})=>(id+name).toLowerCase().includes(partsSearch.trim().toLowerCase()));
    const selectableWelds=filteredWelds.filter(weld=>removablePlanningWeld(weld)&&(modelEditMode!=='merge'||weld.enabled));
    function templateImpact(ids){
      const removed=new Set(ids);
      return data.welds.filter(weld=>weldTemplateIds(weld).some(id=>removed.has(id))).length;
    }
    const pointLayout=useMemo(()=>weldLayerLayout(selected,selectedDecision,data.templates,activeProcesses,context),[selected,selectedDecision,data.templates,activeProcesses,context]);
    const pointProcess=selectedDecision?.process??selectedDecision?.whole?.baseProcessSnapshot??null;
    const pointStrategy=useMemo(()=>weldPreviewStrategy(selected,selectedDecision?.whole,pointProcess,context),
      [selected,selectedDecision?.whole,pointProcess,context]);
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
    const trackingIssue=useMemo(()=>selected?.laserTrackingIssue??(selected?weldPathTrackingIssue(selected,layoutPaths,context):undefined),
      [selected,layoutPaths,context]);
    const scanningCapabilities=weldMeasurementCapabilities(selected,context);
    const photoView=page==='工艺规划'&&measurementView&&selected?.enabled&&
      weldPrecisionMethod(selected.scanSettings,scanningCapabilities)==='fixedPhoto';
    const [photoScene,setPhotoScene]=useState(null);
    useEffect(()=>{
      if(!photoView||!data.model)return;
      let cancelled=false,scene;
      import('./weldCollision.mjs').then(({loadWeldCollisionScene})=>loadWeldCollisionScene(
        {model:data.model,stepModel:data.stepModel},{coverOpen:true,includeWireTip:true,laserMountSide,structuredLightInstalled})).then(loaded=>{
        if(cancelled){loaded.dispose();return;}
        scene=loaded;
        setPhotoScene({key:modelViewKey,scene});
      }).catch(error=>{if(!cancelled)setPhotoScene({key:modelViewKey,error:'无法加载拍照检查模型 · '+error.message});});
      return()=>{cancelled=true;scene?.dispose();setPhotoScene(null);};
    },[photoView,data.model,data.stepModel,modelViewKey,laserMountSide,structuredLightInstalled]);
    const measurementPass=layoutPaths.find(pass=>pass.id===pointGroup?.id)??layoutPaths[0];
    const measurementPlan=useMemo(()=>{
      if(page!=='工艺规划'||!measurementView)return null;
      const verification=photoScene?.key===modelViewKey?photoScene:null;
      return weldMeasurementPlan(selected,context,referenceNormalAt,{
        ...(photoView?verification:null),weldingPoseAt:distance=>measurementPass?.posesAtGeometryStation(distance).at(-1)
      });
    },[page,measurementView,selected,context,referenceNormalAt,photoView,photoScene,modelViewKey,measurementPass]);
    const measurementKey=measurementPlan?JSON.stringify([selected.id,measurementPlan.method,selected.scanSettings?.direction,selected.scanSettings?.measurementScope]):null;
    const measurementIndex=measurementSelection?.key===measurementKey&&measurementPlan?
      Math.max(0,measurementPlan.points.findIndex(point=>point.id===measurementSelection.id||point.sourceId===measurementSelection.id)):0;
    const measurementPoint=measurementPlan?.points[measurementIndex];
    const pickingMeasurement=!!measurementPlan&&measurementPickKey===measurementKey;
    function insertMeasurementPoint(station){
      if(!measurementPlan||!selected||!Number.isFinite(station)||station<0||station>measurementPlan.length||workspaceSave.current||geometryProgress)return false;
      const method=measurementPlan.method,scan=selected.scanSettings??{};
      const points=scan.customPoints?.[method]??[];
      if(points.some(point=>Math.abs(point.station-station)<1e-6)){notify('该里程已有自定义测量点');return false;}
      const id=crypto.randomUUID();
      patch('scanSettings',{...scan,customPoints:{...scan.customPoints,[method]:[...points,{id,station}]}});
      setMeasurementSelection({key:measurementKey,id});
      setMeasurementPickKey(null);
      return true;
    }
    const measurementHead=measurementPoint?.photoCheck&&measurementPoint.photoCheck.state!=='ready'&&!measurementPoint.manualPose?undefined:measurementPoint;
    const measurementPreview=measurementPoint?{plan:measurementPlan,index:measurementIndex,fieldOfView:cameraFieldOfView,
      onPoint:index=>setMeasurementSelection({key:measurementKey,id:measurementPlan.points[index]?.id}),
      onInsert:insertMeasurementPoint,pickingMeasurement,onPick:()=>setMeasurementPickKey(pickingMeasurement?null:measurementKey),onFieldOfView:setCameraFieldOfView}:undefined;
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
    const passCollision=selectedPass&&!pointStrategy?.previewOnly&&pointStrategy===selected.strategyPlan?
      selected.collisionPasses?.find(pass=>pass.id===selectedPass.id):undefined;
    const collisionPoint=passCollision?.contact??passCollision?.closest;
    const collisionMarker=planningPointsVisible&&collisionPoint&&Math.abs(station-collisionPoint.station)<.05?collisionPoint.point:null;
    const updatePreviewStation=useCallback(station=>setPassPreview({key:previewPassKey,station}),[previewPassKey]);
    const sampleStation=selectedPass?.sampleStations.find(sample=>Math.abs(sample-station)<1e-7);
    const sampleMarker=planningPointsVisible&&stationPose&&sampleStation!==undefined?stationPose.position:null;
    const pointPose=previewPoint&&passPaths.find(pass=>pass.id===pointGroup?.id)?.posesAt(previewPoint.distance)
      .find(pose=>pose.pointId===previewPoint.raw.id);
    const headPass=activeSelection?.type==='layer'?passPaths.find(pass=>pass.layerId===activeSelection.id):
      !activeSelection?passPaths[0]:undefined;
    const headPose=stationPose??headPass?.posesAt(headPass.startStation).at(-1);
    const headPoint=previewPoint&&passIsVisible(pointGroup?.layerId,pointGroup?.id)?
      {...previewPoint,toolPose:pointPose??previewPoint.toolPose}:
      headPose?{position:headPose.position,toolPose:headPose}:null;
    const editablePointGroups=planningPointGroups.filter(group=>group.layerId===newPointTarget?.layerId);
    function selectWeldPoint(type,id,weldId=selected?.id){
      if(weldId)setPlanningSelection({weldId,type,id});
    }
    function selectTreeWeld(id){
      setWrapFocus(null);
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
      if(weld.laserTrackingDirection||weld.laserTrackingIssue){
        const issue=weldLayoutTrackingIssue(weld.id===selected?.id?{...weld,strategyPlan:pointStrategy}:weld,pointLayout,context);
        if(issue)return issue;
      }
      if(workspaceSave.current||geometryProgress)return '请等待当前操作完成';
      const current=dataRef.current;
      const append=item=>({...item,pointLayout,collisionState:planningCollisionEnabled?'未检测':undefined,collisionVerified:false,collisionPasses:undefined,weldingOrder:null,
        attributeOverrides:{...item.attributeOverrides,pointLayout}});
      const next={...current,welds:current.welds.map(item=>item.id===weld.id?append(item):item)};
      const pending=weldEditBaseline.current;
      const baseline=pending.get(weld.id);
      const persisted={...next,welds:next.welds.map(item=>item.id===weld.id&&baseline?append(baseline):pending.get(item.id)??item)};
      try{
        const verified=await recheckEditedWelds(persisted,new Set([weld.id]));
        const checked=new Map(verified.welds.map(item=>[item.id,item]));
        await commitWorkspace(verified,()=>{
          if(baseline)pending.set(weld.id,checked.get(weld.id));
          const welds=next.welds.map(item=>pending.has(item.id)?item:checked.get(item.id)??item);
          applyWorkspace({...next,welds,selected:dataRef.current.selected});
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
    function editModelMode(mode){
      setWrapFocus(null);setModelEditMode(mode);setSplitByFace(false);setFaceStations([]);setSplitError('');
      setManualCreate(mode==='create'?{method:'face',kind:'line',picks:[],paths:[],error:''}:null);
      setView(v=>({...v,welds:true,...(mode==='create'?{model:true}:{})}));
    }
    function setManualCreateMethod(fields){
      setManualCreate(draft=>({...draft,...fields,picks:[],paths:[],error:''}));
    }
    function selectManualWeldPoint(pick,mesh){
      if(!manualCreate||manualCreateLock.current)return;
      const {method,kind,picks}=manualCreate,required=method==='point'?manualPointCount(kind):2;
      if(!pick){
        setManualCreate({...manualCreate,error:'请点击模型上的'+(method==='face'?'面':method==='solid'?'实体':'点')});
        return;
      }
      const previous=picks.length===required?[]:picks;
      if(previous.some(item=>method==='point'?distance(item.point,pick.point)<.1:item.part===pick.part&&item.face===pick.face)){
        setManualCreate({...manualCreate,error:'请选择另一个'+(method==='face'?'面':method==='solid'?'实体':'点')});
        return;
      }
      const next=[...previous,pick];
      try{
        const paths=next.length<required?[]:method==='point'?[manualWeldThroughPoints(kind,next.map(item=>item.point))]:manualWeldIntersections(mesh,...next);
        setManualCreate({...manualCreate,picks:next,paths,error:''});
      }catch(error){setManualCreate({...manualCreate,picks:next,paths:[],error:error.message});}
    }
    async function confirmManualWeld(){
      if(!manualCreate?.paths.length||manualCreateLock.current||workspaceSave.current||geometryProgress)return;
      const current=dataRef.current;
      manualCreateLock.current=true;
      setCreatingWelds(true);
      try{
        const welds=[...current.welds],ids=[];
        const defaults=settingsDefaults(context).actionParameters.defaultLegs;
        for(const path of manualCreate.paths){
          const segments=manualWeldSegments(path),position=segments[0].position;
          const leg=defaults[weldPositionCode(position)==='PF'?'vertical':'flat'];
          const weld=createManualWeld([...welds,...(current.collisionOriginals??[])],segments,{
            name:'手动焊缝',model:current.model,position,leg:leg?.enabled?Number(leg.height):null,withoutProcess:true,
            closed:manualCreate.method==='point'?manualCreate.kind==='circle':undefined
          });
          welds.push(weld);ids.push(weld.id);
        }
        const next={...current,welds,selected:ids[0],manualEditHistory:[...(current.manualEditHistory??[]),{
          kind:'create',id:ids[0],ids,previousSelected:current.selected
        }]};
        if(!valid(next))throw Error('创建结果未通过焊缝路径校验');
        const planned=await replanEditedGeometry(next);
        if(dataRef.current!==current)throw Error('工艺规划已更新，请重新确认创建');
        const saved=await persistGeometry(planned);
        if(dataRef.current!==planned)return;
        editModelMode('');
        setSearch('');
        setLeftTab('结构树');
        setPlanningSelection(null);
        weldTreeLocation.current=next.selected;
        if(saved)notify('已创建 '+ids.length+' 条焊缝');
        log('手动创建焊缝 '+ids.join('、'));
      }catch(error){setManualCreate(draft=>draft&&({...draft,error:error.message}));}
      finally{manualCreateLock.current=false;setCreatingWelds(false);}
    }
    function locateModelWeld(id){
      if(page!=='工艺规划')return;
      if(leftTab!=='结构树')setLeftTab('结构树');
      if(collapsed)setCollapsed(false);
      if(!filteredWelds.some(weld=>weld.id===id))setSearch('');
      setCollapsedWeldGroup(null);
      weldTreeLocation.current=id;
    }
    function selectModelWeld(id,point){const weld=dataRef.current.welds.find(w=>w.id===id);if(!weld)return;
      if(pickingMeasurement&&!modelEditMode){
        if(point&&id===selected?.id)insertMeasurementPoint(weldPointDistance(directedWeld(weld),point));
        else notify('请在当前选中的焊缝上选择测量点');
        return;
      }
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
    async function confirmSplit(){try{const next=splitSelectedWeld(dataRef.current,dataRef.current.selected,splitByFace?faceStations:Number(splitAt),{revision:3});if(!valid(next))throw Error('打断结果未通过路径校验');if(!await persistGeometry(await replanEditedGeometry(next)))return;setSplitError('');setSplitAt('');setFaceStations([]);log('已打断焊道 '+dataRef.current.selected+'，原焊道已保留，可撤销。');}catch(e){setSplitError(e.message);}}
    function chooseSegments(indices){
      setSegmentSeparation(current=>({...current,indices,error:''}));
    }
    async function confirmSegmentSeparation(){
      const {id,indices}=segmentSeparation;
      try{
        if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改');
        const next=separateWeldSegments(dataRef.current,id,indices);
        if(!valid(next))throw Error('拆分结果未通过路径校验');
        if(await persistGeometry(await replanEditedGeometry(next)))notify('已拆分 '+indices.length+' 个焊缝段');
        if(leftTab!=='结构树')setLeftTab('结构树');
        if(search)setSearch('');
        weldTreeLocation.current=next.selected;
        setPlanningSelection(null);
        setSegmentSeparation(null);
        log('已拆分焊缝 '+id+' 的 '+indices.length+' 个焊缝段');
      }catch(error){setSegmentSeparation(current=>({...current,error:error.message}));}
    }
    async function recheckEditedWelds(workspace,ids){
      const changed=workspace.welds.filter(weld=>ids.has(weld.id));
      if(!changed.length)return workspace;
      const options={...context,requireCollisionVerification:planningCollisionEnabled};
      let checked=changed.map(weld=>({...weld,collisionState:planningCollisionEnabled?'未检测':undefined,
        collisionVerified:false,collisionPasses:undefined,collisionResult:undefined,
        ...(weld.strategyPlan?{strategyPlan:{...weld.strategyPlan,collisionStatus:'未验证'}}:{})}));
      if(planningCollisionEnabled&&(workspace.stepModel||isDemoModel(workspace))&&changed.some(weld=>weld.enabled&&weld.planned)){
        setGeometryProgress({phase:'collision',percent:0,stage:'正在复检修改后的焊缝'});
        try{
          const result=await collisionPool.run({...workspace,welds:changed},options,false,undefined,undefined,{checkOnly:true});
          checked=result.welds;
          for(const weld of checked)if(!weld.collisionVerified)log(weld.id+' · '+weld.collisionState);
        }catch(error){log('碰撞复检未完成：'+error.message);}
        finally{setGeometryProgress(null);}
      }
      const byId=new Map(checked.map(weld=>[weld.id,weld]));
      return {...workspace,welds:assignWeldingOrder(workspace.welds.map(weld=>byId.get(weld.id)??weld),options)};
    }
    function replanEditedGeometry(workspace){
      const added=workspace.manualEditHistory?.at(-1);
      const ids=new Set(added?.kind==='split'?workspace.manualSplitHistory.at(-1).childIds:added?.kind==='create'?added.ids:[workspace.selected]);
      const welds=workspace.welds.map(weld=>{
        if(!ids.has(weld.id))return weld;
        const geometry=materializeEndpointWraps(weld,settingsDefaults(context).wrapParameters);
        return planWeld(geometry,workspace.templates,activeProcesses,context);
      });
      return recheckEditedWelds({...workspace,welds},ids);
    }
    function selectSplitFace(origin,normal){
      if(!selected)return;
      const stations=planeSplitStations(selected,origin,normal);
      setFaceStations(stations);setSplitError(stations.length?'':'所选平面未穿过焊缝内部');
    }
    async function undoGeometryEdit(){
      const current=dataRef.current,history=current.manualEditHistory??[],last=history.at(-1);
      if(!last)return;
      try{
        let restored;
        if(last.kind==='create'){
          restored=removePlanningWelds(current,last.ids);
          if(restored.welds.some(weld=>weld.id===last.previousSelected))restored={...restored,selected:last.previousSelected};
          restored={...restored,welds:assignWeldingOrder(restored.welds,context)};
        }else restored=last.kind==='merge'?undoManualMerge(current,last.id):undoLastSplit(current);
        if(!await persistGeometry({...restored,manualEditHistory:history.slice(0,-1)}))return;
        setSplitError('');notify('已撤销上一次焊缝操作');
      }
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
    useEffect(() => () => {clearTimeout(toastTimer.current);geometryWorker.current?.terminate();geometryWorker.current=null;stepImportWorker.current?.terminate();reverseRequest.current?.abort();collisionPool?.dispose();}, [collisionPool]);
    useEffect(()=>{
      if(workstationLoading||page!=='工艺规划')return;
      const timer=setTimeout(()=>{
        if(dataRef.current===initialData&&!geometryWorker.current)void startPlanning(initialData,{saveResult:false});
      },0);
      return ()=>clearTimeout(timer);
    },[initialData,workstationLoading,page]);
    async function commitWorkspace(persisted,apply,projectChange){
      if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');
      workspaceSave.current=true;
      setSavingWorkspace(true);
      try{
        try{await saveWorkspaceDraft(persisted,projectChange);}
        catch(error){
          if(error?.name==='WorkpieceProjectInUseError')throw error;
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
    async function saveWorkpiecePose(pose){
      const current=dataRef.current;
      if(stepModelKey(current)!==modelViewKey||pose&&!validWorkpiecePose(pose))return;
      await persistGeometry({...current,workpiecePose:pose??undefined});
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
    function extractAndPlan(options,workspace,{saveResult,restoreDeleted}){
      const modelKey=stepModelKey(workspace),reference=workspace.stepModel;
      const worker=new Worker(new URL('./geometryProcessing.worker.js',import.meta.url),{type:'module'});
      geometryWorker.current=worker;
      if(!saveResult)startupGeometryWorker.current=worker;
      const stillActive=()=>geometryWorker.current===worker;
      const finish=()=>{
        if(!stillActive())return;
        worker.terminate();
        geometryWorker.current=null;
        if(startupGeometryWorker.current===worker)startupGeometryWorker.current=null;
        setGeometryProgress(null);
      };
      const fail=message=>{
        if(!stillActive())return;
        log('一键规划未完成：'+message);
        notify(message);
        finish();
      };
      setGeometryProgress({phase:'extract',stage:'准备提取焊道',percent:0});
      log('一键规划开始：提取焊道。');
      worker.onerror=()=>fail('焊道提取失败，请重试');
      worker.onmessageerror=()=>fail('无法读取焊道提取结果，请重试');
      worker.onmessage=async({data:message})=>{
        if(!stillActive())return;
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
          flushSync(()=>setGeometryProgress({phase:'plan',stage:'生成基础轨迹并应用匹配的模板或工艺参数'}));
          await new Promise(resolve=>setTimeout(resolve,0));
          if(!stillActive())return;
          let measure=reference?undefined:neighborhoodRef.current;
          if(!reference&&!measure&&isDemoModel(workspace)){
            measure=await loadDemoTemplateNeighborhood();
            if(!stillActive())return;
            setNeighborhood(()=>measure);
          }
          const current=dataRef.current;
          if(stepModelKey(current)!==modelKey||current.model!==workspace.model)throw Error('模型已切换，请重新运行一键规划');
          if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');
           if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改，再重新运行一键规划');
          const settings=getPlanningContext(current);
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
          const extracted=prepareExtractedPlanningWorkspace(current,message.result,settings,measure,{restoreDeleted});
          log('已完成焊缝预处理：自动删除、自动合并、自动打断。');
          if(!valid(extracted))throw Error('焊道提取结果未通过工作区校验');
          const count=extracted.welds.filter(weld=>weld.source==='extracted'&&removablePlanningWeld(weld)).length;
          log(`焊道提取完成：${count} 条。开始工艺规划。`);
          await executePlan(extracted,settings,measure,geometry,{saveResult,replanning:workspace.welds.length>0,isCurrent:stillActive});
          if(!stillActive())return;
          setView(view=>({...view,welds:true}));
          finish();
        }catch(error){fail(error.message);}
      };
      try{worker.postMessage({options,model:workspace.model,reference});}
      catch(error){fail(error.message);}
    }
    async function mergeSelection(){try{const next=mergeSelectedWelds(dataRef.current,mergeIds,context);if(!valid(next))throw Error('合并后的路径未通过校验');if(!await persistGeometry(await replanEditedGeometry(next)))return;setMergeIds([]);setMerging(false);log(`${mergeIds.length} 条焊道已合并为 ${next.selected}，原焊道已保留并屏蔽。`);}catch(e){setMergeError(e.message);}}
    async function undoMerge(){try{const next=undoManualMerge(dataRef.current,dataRef.current.selected);if(!await persistGeometry(next))return;notify('已恢复合并前的焊道');}catch(e){notify(e.message);}}
    async function undoGeometry(){const next=restoreGeometryResult(dataRef.current);if(!await persistGeometry(next))return;notify('已撤销本次几何处理并保存');log('已撤销本次焊道几何处理。');}
    function patch(key,value){
      if(workspaceSave.current||geometryProgress)return;
      const current=dataRef.current.welds.find(weld=>weld.id===dataRef.current.selected);
      if(!current)return;
      if(key==='direction'&&(selected?.laserTrackingDirection||selected?.laserTrackingIssue))return;
      if(!weldEditBaseline.current.has(current.id))weldEditBaseline.current.set(current.id,structuredClone(current));
      const next={...current,[key]:value};
      if(key!=='scanSettings'){
        if(key!=='planningPointOverrides')next.planned=false;
        next.collisionVerified=false;
      }
      if(key==='segments'){
        const segments=value.filter(segment=>!segment.generatedEndpointWrap);
        next.position=segments.every(segment=>segment.position===segments[0].position)?segments[0].position:
          current.topology==='vertical'?current.position:'混合位置（逐段设置）';
      }
      if(key==='leg')next.segments=current.segments.map(segment=>({...segment,weldLeg:roundWeldLeg(value)}));
      if((current.segments?.length===1||['extracted','manual-merge'].includes(current.source)&&key==='position')&&['position','length'].includes(key)){
        next.segments=current.segments.map(segment=>({...segment,[key]:value}));
      }
      change(workspace=>({...workspace,welds:workspace.welds.map(weld=>weld.id===current.id?next:weld)}));
    }
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
      setEditingWorkpiece(null);
      setModelInfo(null);
      setModelLoadRevision(value=>value+1);
      setModelEditMode('');
      setManualCreate(null);
      setMergeIds([]);
      setClosedPointTree('');
      setPlanningSelection(null);
      setView(current=>({...current,model:true,welds:true}));
      closeImport();
    }
    function checkModelSwitch(cancelStartup=false){
      if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');
      if(manualCreateLock.current)throw Error('请等待焊缝创建完成');
      const worker=geometryWorker.current;
      if(cancelStartup&&worker&&worker===startupGeometryWorker.current){
        worker.terminate();
        geometryWorker.current=null;
        startupGeometryWorker.current=null;
        setGeometryProgress(null);
      }else if(worker||geometryProgress)throw Error('请等待当前一键规划完成');
    }
    async function selectWorkstationScene(event){
      const file=event.target.files?.[0];
      event.target.value='';
      if(!file||sceneImport.current)return;
      try{checkModelSwitch(true);}catch(error){notify(error.message,'warning');return;}
      sceneImport.current=true;
      setWorkstationLoading(true);
      try{
        const scene=await importWorkstationScene(file);
        try{await saveWorkstationSceneFile(file);}
        catch{throw Error('无法将场景保存到本机浏览器，请检查可用存储空间');}
        setWorkstationSource(scene);
        setWorkstationStatus('');
        notify('场景已导入：'+file.name,'success');
      }catch(error){
        notify('场景导入失败：'+error.message,'error');
      }finally{
        sceneImport.current=false;
        setWorkstationLoading(false);
      }
    }
    async function saveSceneDeviceSettings(settings){
      const stored=dataRef.current.workstationSettings;
      const workstationSettings=sceneKey?{...stored,byScene:{...stored?.byScene,[sceneKey]:settings}}:settings;
      const error=await updateTemplates({workstationSettings});
      if(!error)notify('设备配置已保存');
      return error;
    }
    function openWorkpieceDialog(type,record){
      setWorkpieceDialogError('');
      setWorkpieceDialog(type==='save'?{type,name:data.model.replace(/\.(step|stp)$/i,''),project:record??data.project??'本地项目'}:
        type==='update'?{type,record,name:record.name,project:record.project}:type==='project'?{type,name:''}:{type,record});
    }
    function closeWorkpieceDialog(){
      if(!workpieceBusy)setWorkpieceDialog(null);
    }
    async function loadWorkpieceIntoPlanning(record,edit=false){
      checkModelSwitch(true);
      if(stepImportWorker.current)throw Error('请等待模型导入完成');
      if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改');
      const snapshot=await loadWorkpieceTemplate(record.id);
      const next=workpieceWorkspace(dataRef.current,record,snapshot);
      if(!valid(next))throw Error('工件模板未通过工作区校验');
      if(next.stepModel)await cacheStepMesh(snapshot.mesh);
      if(next.stepModel&&snapshot.neighborhood)await cacheStepNeighborhood(record.fingerprint,snapshot.neighborhood);
      if(geometryWorker.current||workspaceSave.current||manualCreateLock.current)throw Error('当前工艺规划正在处理，请稍后重试');
      await installStepWorkspace(next);
      if(edit)setEditingWorkpiece(record);
      setSearch('');setLeftTab('结构树');setHiddenGeometry(new Set());
      go('工艺规划');
      log((edit?'已打开工件模板 ':'已复用工件模板 ')+record.name+'，'+next.welds.length+' 条焊缝。');
      notify((edit?'正在编辑工件模板 ':'已复用工件模板 ')+record.name,'success');
    }
    async function editWorkpiece(record){
      if(workpieceBusy)return;
      setWorkpieceBusy(true);
      try{await loadWorkpieceIntoPlanning(record,true);}
      catch(error){notify(error.message,'error');}
      finally{setWorkpieceBusy(false);}
    }
    async function confirmWorkpieceDialog(event){
      event.preventDefault();
      if(workpieceBusy)return;
      setWorkpieceBusy(true);
      setWorkpieceDialogError('');
      try{
        const current=dataRef.current,{type,record,name,project}=workpieceDialog;
        if(type==='save'||type==='update'){
          checkModelSwitch();
          if(stepImportWorker.current)throw Error('请等待模型导入完成');
          if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改');
        }
        if(type==='save'||type==='update'){
          const template=await createWorkpieceTemplate(current,{name,project,id:type==='update'?record.id:undefined});
          template.summary.cover=captureWorkpieceCover(template.snapshot.mesh,workpiecePoseFor(current));
          await saveWorkpieceTemplate(template);
          setWorkpieces(items=>[template.summary,...items.filter(item=>item.id!==template.summary.id)]);
          if(type==='update')setEditingWorkpiece(template.summary);
          notify((type==='update'?'已更新工件模板 ':'已保存工件模板 ')+template.summary.name,'success');
        }else if(type==='reuse'){
          await loadWorkpieceIntoPlanning(record);
        }else if(type==='project'){
          const values=createTemplateProject(current.templates,current.project,workpieceProjects,name);
          const error=await updateTemplates(values);
          if(error)throw Error(error);
        }else{
          await removeWorkpieceTemplate(record.id);
          setWorkpieces(items=>items.filter(item=>item.id!==record.id));
          notify('工件模板已删除','success');
        }
        setWorkpieceDialog(null);
      }catch(error){
        setWorkpieceDialogError(error?.name==='QuotaExceededError'?'本机存储空间不足，工件模板未保存':error.message);
      }finally{
        setWorkpieceBusy(false);
      }
    }
    async function openModelWorkspace(model,reference,{autoPlan=false}={}){
      const discarded=weldEditBaseline.current.size>0;
      await installStepWorkspace(switchStepWorkspace(dataRef.current,model,reference));
      setSearch('');setBatchSelect(false);
      setLeftTab('结构树');
      setHiddenGeometry(new Set());
      setPointOffsetPreview(null);
      log('已加载 '+model+'。');
      if(reference?.kind==='pointCloud'){notify('点云已加载');return;}
      else if(discarded)notify('模型已加载，未应用的焊缝属性修改已舍弃');
      if(autoPlan)await startPlanning(dataRef.current);
      else if(!discarded)notify('模型已加载，可点击一键规划');
    }
    async function loadPreviewModel(model){
      if(stepImportWorker.current)return;
      try{
        checkModelSwitch();
        setStepError('');
        setStepImporting(model);
        const reference=model===STARTUP_STEP_MODEL?STARTUP_STEP_REFERENCE:undefined;
        await openModelWorkspace(model,reference,{autoPlan:true});
      }catch(error){
        stopStepImport();
        setStepError(error.message);
      }
    }
    function importModel(event,kind){
      const chosen=event.target.files?.[0];
      event.target.value='';
      if(chosen)importModelFile(chosen,kind);
    }
    function importModelFile(chosen,kind){
      if(stepImportWorker.current)return;
      setStepError('');
      try{
        checkModelSwitch();
        const cloud=kind==='pointCloud';
        if(cloud?!/\.(txt|xyz|ply|pcd)$/i.test(chosen.name):!/\.(step|stp)$/i.test(chosen.name))throw Error(
          cloud?'请选择 TXT、XYZ、PLY 或 PCD 点云文件':'请选择 .step 或 .stp 文件');
        const worker=cloud?new Worker(new URL('./pointCloudImport.worker.js',import.meta.url),{type:'module'}):
          new Worker(new URL('./stepImport.worker.js',import.meta.url),{type:'module'});
        stepImportWorker.current=worker;
        setStepImporting(chosen.name);
        const fail=message=>{
          if(stepImportWorker.current!==worker)return;
          stopStepImport();
          setStepError(message);
        };
        worker.onerror=()=>fail((cloud?'点云':'STEP')+'解析失败，请检查文件或尝试重新导出');
        worker.onmessage=async({data:result})=>{
          if(stepImportWorker.current!==worker)return;
          if(result.error){fail(result.error);return;}
          try{
            const model=result.model;
            const reference=cloud?{kind:'pointCloud',sourceSha256:model.sourceSha256}:
              model.name===EXAMPLE_MODEL&&model.sourceSha256===DEMO_SOURCE_SHA256?undefined:{sourceSha256:model.sourceSha256};
            if(reference)await cacheStepMesh(cloud?model:{...model,sourceFile:chosen});
            if(stepImportWorker.current!==worker)return;
            checkModelSwitch();
            await openModelWorkspace(model.name,reference);
          }catch(error){fail(error.message);}
        };
        worker.postMessage(chosen);
      }catch(error){stopStepImport();setStepError(error.message);}
    }
    function closeReverseModel(){
      reverseRequest.current?.abort();
      reverseRequest.current=null;
      setReverseResult(null);
      closeImport();
    }
    async function runReverseModel(){
      if(reverseRequest.current||stepImportWorker.current)return;
      const workspace=dataRef.current;
      if(!isPointCloudWorkspace(workspace)){
        setDialog('import-point-cloud');
        return;
      }
      try{checkModelSwitch();}catch(error){notify(error.message);return;}
      const request=new AbortController();
      reverseRequest.current=request;
      setReverseResult({running:true});
      setStepError('');
      setDialog('reverse-model');
      try{
        const cloud=await loadStepMesh(workspace.model,workspace.stepModel);
        const result=await reversePointCloud(cloud,workspace.workpieceType,request.signal);
        if(reverseRequest.current!==request)return;
        setReverseResult(result);
        log(`逆向建模完成：${result.parts} 个实体。`);
      }catch(error){
        if(reverseRequest.current===request)setReverseResult({error:error.message});
      }finally{
        if(reverseRequest.current===request)reverseRequest.current=null;
      }
    }
    function downloadReconstructedStep(file){
      const url=URL.createObjectURL(file);
      const download=document.createElement('a');
      download.href=url;
      download.download=file.name;
      download.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    function downloadTask(){
      const url=URL.createObjectURL(new Blob([JSON.stringify(planningTaskDocument(data),null,2)],{type:'application/json'}));
      const download=document.createElement('a');
      download.href=url;
      download.download=(data.model||'Weldone').replace(/\.(step|stp|txt|xyz|pcd|ply)$/i,'')+'-规划任务.pf';
      download.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      log('已导出规划任务');
    }
    async function publishProductionTask(workspace,options,source){
      if(productionTaskLock.current)throw Error('正在更新生产执行任务，请稍后重试');
      productionTaskLock.current=true;
      setWritingProductionTask(true);
      try{
        const task=productionTaskSnapshot(workspace,options,source);
        await saveProductionTask(task);
        setProductionTask(task);
      }finally{
        productionTaskLock.current=false;
        setWritingProductionTask(false);
      }
    }
    async function exportTaskToProduction(){
      try{
        checkModelSwitch();
        await publishProductionTask(dataRef.current,context,'已从工艺规划更新任务');
        log('已导出任务到生产执行');
        notify('生产执行任务已更新','success',{label:'查看生产执行',onClick:()=>go('生产执行')});
      }catch(error){notify(error.message,'error');}
    }
    async function importTask(event,toProduction=false){
      const chosen=event.target.files?.[0];
      event.target.value='';
      if(!chosen)return;
      try{
        if(!toProduction)checkModelSwitch();
        if(!/\.pf$/i.test(chosen.name))throw Error('请选择 .pf 任务文件');
        const task=readPlanningTask(await chosen.text());
        if(!toProduction)checkModelSwitch();
        const current=dataRef.current;
        const workspace={...task,deviceControl:current.deviceControl,deviceCapabilities:current.deviceCapabilities,workstationSettings:current.workstationSettings};
        if(!workspace.model||!valid(workspace))throw Error('PF 任务数据无效');
        const loaded=restorePlanningState(excludeConfirmedNonWelds(useStepExample(migrateDraft(workspace))));
        const next={...loaded,selected:loaded.welds.some(w=>w.id===loaded.selected)?loaded.selected:loaded.welds[0]?.id||''};
        if(toProduction){
          await publishProductionTask(next,getPlanningContext(next),'已导入任务 '+chosen.name);
          notify('生产执行任务已导入','success');
          return;
        }
        await installStepWorkspace(next);
        log('已导入 PF 任务 '+chosen.name);
        notify('PF 任务已导入');
      }catch(error){
        notify(error instanceof SyntaxError?'无法读取 PF 文件，请选择本平台导出的任务文件。':error.message);
      }
    }
    async function executePlan(workspace,settings,measure,geometry,{saveResult=true,replanning=false,isCurrent=()=>true}={}){
      const checkCollisions=settings.splitParameters?.toolHeadCollisionEnabled===true;
      const options={...settings,measureTemplateNeighborhood:measure,requireCollisionVerification:checkCollisions};
      const rejected=deletedGeometryForModel(workspace,workspace.stepModel?.sourceSha256??(isDemoModel(workspace)?DEMO_SOURCE_SHA256:workspace.geometryProcessing?.sourceSha256));
      const source=excludeDeletedGeometry([...workspace.welds.filter(weld=>!weld.collisionFragment),...(workspace.collisionOriginals??[])],rejected,{exactOnly:true});
      const planned=planWorkspace(source.map(({disabledByMinWeldLength,...weld})=>({...weld,enabled:disabledByMinWeldLength||weld.enabled,wrapPoseOverrides:undefined,collisionPasses:undefined,collisionVerified:false,collisionState:undefined,collisionResult:undefined})),workspace.templates,workspace.processLibrary,options);
      let welds=planned,collisionOriginals=[],collisionComplete=true;
      if(checkCollisions&&(workspace.stepModel||isDemoModel(workspace))){
        setGeometryProgress({phase:'collision',percent:0,stage:'正在准备机头与工件网格'});
        try{
          const result=await collisionPool.run({...workspace,welds:planned},options,false,(index,total)=>{
            if(!isCurrent())return;
            setGeometryProgress(current=>{
              const percent=total?Math.floor(index/total*100):100;
              return current?.phase==='collision'&&current.percent===percent?current:
                {phase:'collision',percent,stage:'正在检查机头与工件碰撞 '+index+'/'+total};
            });
          },geometry);
          if(!isCurrent())return;
          ({welds,collisionOriginals}=result);
          const {checked,unchecked,trimmed,removed}=result.counts;
          for(const original of collisionOriginals){
            const collision=original.collisionPasses?.find(pass=>pass.contact)?.contact;
            if(collision)log(original.id+' · '+collision.part+' · '+collision.station.toFixed(1)+' mm 发生碰撞，已调整焊缝。');
          }
          log('碰撞检测完成：检测与复检 '+(result.detectionMs/1000).toFixed(2)+' s，含裁剪总耗时 '+(result.elapsedMs/1000).toFixed(2)+' s，'+checked+' 条已检测，'+unchecked+' 条未进入碰撞校验，'+trimmed+' 次碰撞裁剪，'+removed+' 条整道移除。');
        }catch(error){
          if(!isCurrent())return;
          log('碰撞检测未完成：'+error.message);
          notify('碰撞检测未完成，保留本次焊道。');
          collisionComplete=false;
          welds=planned.map(weld=>({...weld,collisionState:'未检测',collisionVerified:false}));
        }
      }
      if(collisionComplete){
        const checked=disableShortPlanningWelds(welds,settings.splitParameters?.minWeldLength);
        const disabled=checked.filter(weld=>weld.disabledByMinWeldLength).length;
        if(disabled){
          log('按最小焊缝长度屏蔽 '+disabled+' 条焊缝。');
          welds=assignWeldingOrder(checked,options);
        }
      }
      welds=assignWeldingOrder(excludeDeletedGeometry(welds,rejected,{exactOnly:true}),options);
      if(!valid({...workspace,welds,collisionOriginals}))throw Error('规划结果未通过工作区校验');
      const enabled=welds.filter(weld=>weld.enabled);
      const ready=enabled.filter(weld=>weld.planned&&(!checkCollisions||weld.collisionVerified)&&
        (options.planningRobots.length<2||weld.assignedRobot)).length;
      if(options.planningRobots.length>1)log('多机焊道分配：'+enabled.filter(weld=>weld.assignedRobot).length+' 条已分配。');
      const blocked=enabled.length-ready;
      const withTrajectory=welds.filter(weld=>weld.enabled&&weld.strategyPlan?.passes?.length).length;
      const selected=welds.some(weld=>weld.id===workspace.selected)?workspace.selected:
        (welds.find(weld=>weld.enabled&&!weld.planned)??welds.find(weld=>weld.enabled)??welds[0])?.id??'';
      const readyLabel=checkCollisions?'已匹配工艺并完成碰撞校验':'已匹配工艺';
      log(`规划完成：${withTrajectory} 条已生成轨迹，${ready} 条${readyLabel}，${blocked} 条待处理。`);
      const next={...workspace,welds,selected,collisionOriginals};
      if(saveResult){
        if(!await persistGeometry(next))return;
      }else{
        applyWorkspace(next);
        if(welds.length)return;
      }
      const label=replanning?'重新规划完成':'一键规划完成';
      notify(welds.length?`${label}，${withTrajectory} 条焊缝已生成轨迹。`:'本次未提取到可规划的焊道',welds.length?'success':'warning');
    }
    async function startPlanning(workspace,{saveResult=true,restoreDeleted=false}={}){
      if(isPointCloudWorkspace(workspace))return;
      const settings=getPlanningContext(workspace);
      try{
        if(isDemoModel(workspace)||workspace.stepModel){
          const options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,settings);
          if(settings.splitParameters?.toolHeadCollisionEnabled===true)collisionPool.prepare(workspace,false,settings.laserMountSide,settings.deviceCapabilities?.structuredLightPrecision!==false);
          extractAndPlan(options,workspace,{saveResult,restoreDeleted});
          return;
        }
        log('当前模型暂无自动提取数据，使用已有焊道进行工艺规划。');
        setGeometryProgress({phase:'plan',stage:'生成已有焊道的工艺轨迹'});
        try{await executePlan(workspace,settings,undefined,undefined,{saveResult,replanning:workspace.welds.length>0});}
        finally{setGeometryProgress(null);}
      }catch(error){notify(error.message);}
    }
    async function plan(){
      if(geometryProgress||geometryWorker.current)return;
      if(workspaceSave.current){notify('正在保存本机工作区，请稍后重新规划。','warning');return;}
      if(manualCreateLock.current){notify('请等待焊缝创建完成。','warning');return;}
      if(workstationLoading){notify('请等待工作站加载完成。','warning');return;}
      if(weldEditBaseline.current.size){notify('请先应用或取消焊缝属性修改');return;}
      if(stepImportWorker.current){notify('请等待文件导入完成');return;}
      const workspace=dataRef.current;
      if(isPointCloudWorkspace(workspace)){notify('请先导入 STEP 模型进行一键规划');return;}
      if(!isDemoModel(workspace)&&!workspace.stepModel&&!workspace.welds.length){notify('请先导入 STEP 模型');return;}
      await startPlanning(workspace,{restoreDeleted:true});
    }
    function focusWrapEndpoint(index,side){
      if(!selected?.segments[index])return;
      setWrapFocus(current=>current?.weldId===selected.id&&current.index===index&&current.side===side?current:
       {weldId:selected.id,index,side});
    }
    function setEndpointWrap(index,side,kind,edges){
      const {physical}=endpointWrapAt(selected,index,side);
      patch('segments',selected.segments.map((segment,at)=>at===index?
       {...segment,[physical+'WrapEdit']:{kind,...(edges?.length?{edges}:{}),...(kind==='vertical'?{position:'PB · 横角焊'}:{})}}:segment));
      setWrapFocus({weldId:selected.id,index,side,message:kind==='none'?'':undefined});
    }
    function patchWeldWrap(index,side,kind){
      if(workspaceSave.current||geometryProgress||!selected)return;
      const {physical,blocked,value,junction,pending}=endpointWrapAt(selected,index,side);
      if(blocked)return;
      const downgrade=junction?.canUseU&&selected.segments[junction.segment]?.strategyWrapKind==='U'&&kind==='L';
      const splitEdit=kind==='none'&&junction||downgrade;
      if(splitEdit||pending&&kind===junction?.kind){
        const replaced=downgrade||pending?.type==='L'?junction.joints:[junction.id];
        const other=(selected.pendingWrapEdits??[]).filter(edit=>!replaced.includes(edit.id));
        patch('pendingWrapEdits',splitEdit?[...other,{id:junction.id,type:kind}]:other);
        const message=downgrade?(selected.closure==='closed'?
          '应用后仅在所选 U 形包角处打开闭环，断口两侧各保留一个 L 形包角':
          '应用后将生成两条独立的 L 形焊缝'):undefined;
        setWrapFocus({weldId:selected.id,index,side,message});
        return;
      }
      const current=selected.segments[index];
      const baseSegments=selected.segments.filter(segment=>!segment.generatedEndpointWrap);
      const source={...selected,segments:baseSegments},at=baseSegments.indexOf(current);
      const neighbor=endpointWrapNeighbor(source,at,physical);
      if(kind==='none'||kind===value){
        if(kind==='none')setEndpointWrap(index,side,kind);
        else setWrapFocus({weldId:selected.id,index,side});
        return;
      }
      const adjacent=endpointWrapCandidates(source,at,physical);
      if(neighbor){
        const [before,after]=physical==='start'?[neighbor,current]:[current,neighbor];
        const corner=measureDirectedConnection(source,before,after,context.measureTemplateNeighborhood?.measureCorner);
        const thickness=neighbor.subplateThickness??neighbor.plateThickness?.副板厚度??neighbor.plateThickness;
        const short=neighbor.strategyRole==='wrap'||Number.isFinite(thickness)&&pathLength(neighbor.pathPoints)<=thickness+1e-7;
        const existingU=neighbor.strategyWrapKind==='U'||current.strategyWrapKind==='U';
        if(adjacent.length&&short&&corner?.angleSide==='outer'&&(kind!=='U'||existingU)){
          setEndpointWrap(index,side,kind);
          return;
        }
        setWrapFocus({weldId:selected.id,index,side,message:'相邻段没有符合该类型的外角路径。可先拆出该段，再为端点选择模型板边。'});
        return;
      }
      if(kind==='vertical'&&weldPositionCode(current.position)!=='PF')return;
      const message=kind==='U'?'在模型中依次选择包角短边和绕过第二个角后的板边。':'在模型中选择与当前端点相接的板边。';
      setWrapFocus({weldId:selected.id,index,side,kind,picking:true,edges:[],message});
      setModelEditMode('');
      setView(value=>({...value,model:true}));
    }
    function selectWrapEdge(candidates){
      if(!wrapFocus?.picking||wrapFocus.weldId!==selected?.id)return;
      const {index,side,kind,edges}=wrapFocus;
      const {physical}=endpointWrapAt(selected,index,side),segment=selected.segments[index];
      const settings=settingsDefaults(context).wrapParameters;
      const maxDistance=wrapSegmentDistance(segment,settings,kind);
      let path;
      for(const candidate of candidates){
        if(candidate.partId&&[segment.mainPartId,segment.subPartId].every(id=>id&&id!==candidate.partId))continue;
        path=endpointWrapEdge(segment,physical,candidate.points,edges);
        if(path&&kind==='U'&&!edges.length){
          const thickness=wrapPlateThickness(segment);
          if(thickness&&pathLength(path)>thickness+.001)path=null;
        }else if(path&&(kind==='U'||!maxDistance)){
          path=endpointWrapEdgePortion(path,candidate.station);
        }
        if(path)break;
      }
      if(!path){
        setWrapFocus({...wrapFocus,message:'没有找到与上一端点连接且方向符合包角的板边。请重新选择。'});
        return;
      }
      const picked=[...edges,path];
      if(kind==='U'&&picked.length===1){
        setWrapFocus({...wrapFocus,edges:picked,message:'请选择与短边另一端相接的返回板边。'});
        return;
      }
      setEndpointWrap(index,side,kind,picked);
    }
    function cancelWeldEdit(){
      if(workspaceSave.current)return;
      setWrapFocus(null);
      const previous=weldEditBaseline.current.get(data.selected);
      if(!previous)return;
      weldEditBaseline.current.delete(previous.id);
      change({...data,welds:data.welds.map(weld=>weld.id===previous.id?previous:weld)});
    }
    async function applyWeldAttributes(){
      if(!selected||workspaceSave.current||geometryProgress||wrapFocus?.picking&&wrapFocus.weldId===selected.id)return;
      const pending=weldEditBaseline.current;
      const previous=pending.get(selected.id);
      try{
        if(previous){
          const {scanSettings,...fields}=selected;
          const {scanSettings:oldScan,...oldFields}=previous;
          if(JSON.stringify(scanSettings)!==JSON.stringify(oldScan)&&JSON.stringify(fields)===JSON.stringify(oldFields)){
            const weld={...selected,attributeOverrides:{...selected.attributeOverrides,scanSettings:structuredClone(scanSettings)}};
            const next={...data,welds:data.welds.map(item=>item.id===weld.id?weld:item)};
            const persisted={...next,welds:next.welds.map(item=>item.id===weld.id?item:pending.get(item.id)??item)};
            await commitWorkspace(persisted,()=>{
              pending.delete(weld.id);
              applyWorkspace({...next,selected:dataRef.current.selected});
            });
            notify('测量配置已应用');
            return;
          }
        }
        if(selected.pendingWrapEdits?.length){
          const original=previous??selected;
          const fragments=applyWeldWrapEdits(selected,selected.pendingWrapEdits,settingsDefaults(context).wrapParameters);
          if(!fragments.length)throw Error('所选连接点无法拆分，请检查包角距离');
          const split=installWrapSplit({...data,welds:data.welds.map(weld=>weld.id===original.id?original:weld)},original,fragments);
          if(!valid(split))throw Error('包角拆分结果未通过路径校验');
          const children=new Set(split.manualSplitHistory.at(-1).childIds);
          const options={...context,measureTemplateNeighborhood:context.measureTemplateNeighborhood};
          const welds=split.welds.map(weld=>children.has(weld.id)?planWeld(weld,split.templates,activeProcesses,options):weld);
          weldEditBaseline.current.delete(selected.id);
          if(!await persistGeometry(await recheckEditedWelds({...split,welds},children))){if(previous)weldEditBaseline.current.set(selected.id,previous);return;}
          setPlanningSelection(null);
          weldTreeLocation.current=split.selected;
          const openedAtWrap=selected.closure==='closed'&&children.size===1&&
            selected.pendingWrapEdits.some(edit=>edit.type==='L');
          notify(openedAtWrap?'已在所选包角处打开焊缝，保留两端 L 形包角':'已拆分为 '+children.size+' 条焊缝');
          return;
        }
        if(!selected.name.trim()||roundWeldLeg(selected.leg)===null||!validGroove(selected.groove)||selected.segments.some(segment=>!segment.position||segment.position==='待确认')){notify('请完善焊缝名称、焊脚、位置及坡口');return;}
        const overrides={...selected.attributeOverrides};
        for(const key of ['name','leg','position','weldType','machineCount','groove','workFace','direction','tracking','scanSettings','endpointFacts','edgeDistance','planningPointOverrides'])if(previous&&JSON.stringify(previous[key])!==JSON.stringify(selected[key]))overrides[key]=structuredClone(selected[key]);
        if(previous&&JSON.stringify(previous.segments)!==JSON.stringify(selected.segments)){
          overrides.segments=selected.segments.filter(segment=>!segment.generatedEndpointWrap).map(segment=>({position:segment.position,
            tracking:segment.tracking,arcTracking:segment.arcTracking,laserTracking:segment.laserTracking,
            startWrapMode:segment.startWrapMode,endWrapMode:segment.endWrapMode,startWrapEdit:segment.startWrapEdit,endWrapEdit:segment.endWrapEdit}));
        }
        const {pendingWrapEdits,...edited}=selected;
        if(overrides.leg!==undefined)overrides.leg=roundWeldLeg(overrides.leg);
        const geometry=materializeEndpointWraps({...edited,leg:roundWeldLeg(edited.leg),attributeOverrides:overrides},settingsDefaults(context).wrapParameters);
        const overlap=overlappingEndpointWrap(geometry,data.welds);
        if(overlap){notify('包角轨迹与 '+overlap.id+' 重叠，请重新选择板边');return;}
        const decision=analyzeWeldMatch(geometry,data.templates,activeProcesses,context);
        const next=planWeldFromMatch({...geometry,collisionState:undefined,collisionPasses:undefined},decision,context);
        if(!valid({...data,welds:data.welds.map(weld=>weld.id===selected.id?next:weld)}))throw Error('修改后的包角轨迹未通过焊缝校验');
        weldEditBaseline.current.delete(selected.id);
        if(!await persistGeometry(await recheckEditedWelds({...data,welds:data.welds.map(weld=>weld.id===selected.id?next:weld)},new Set([selected.id]))))return;
        setWrapFocus(null);
        notify(decision.ready?'焊缝属性已应用并重新规划':'焊缝属性已应用，请查看当前焊缝的处理提示');
      }catch(error){notify(error.message);}
    }
    const focusedWrapSegment=selected?.id===wrapFocus?.weldId?selected?.segments[wrapFocus?.index]:null;
    const wrapPreview=useMemo(()=>{
      if(!focusedWrapSegment)return null;
      const {physical,edit}=endpointWrapAt(selected,wrapFocus.index,wrapFocus.side);
      const anchor=focusedWrapSegment.pathPoints[physical==='start'?0:focusedWrapSegment.pathPoints.length-1];
      const edges=wrapFocus.edges??edit?.edges??[];
      const geometry=edges.length&&!wrapFocus.picking?materializeEndpointWraps(selected,settingsDefaults(context).wrapParameters):selected;
      const overlap=overlappingEndpointWrap(geometry,data.welds);
      const relevant=geometry.segments.filter(segment=>segment.generatedEndpointWrap&&segment.generatedForSide===physical);
      const paths=relevant.length?relevant.map(segment=>segment.pathPoints):edges;
      return {anchor,paths,overlap:overlap?.id};
    },[context,data.welds,focusedWrapSegment,selected,wrapFocus]);
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
    async function updateTemplates(input,projectChange) {
      if(workspaceSave.current)return '正在保存本机工作区，请稍后重试';
      const data=dataRef.current;
      const compatible=profile=>matchesWorkstationWelder(profile,sceneWelders);
      if(input.processDeviceProfiles&&sceneWelders.length){
        const existing=new Map(data.processDeviceProfiles.map(profile=>[profile.id,profile]));
        const mismatch=input.processDeviceProfiles.find(profile=>!compatible(profile)&&
          JSON.stringify(existing.get(profile.id)?.applicability)!==JSON.stringify(profile.applicability));
        if(mismatch)return `“${mismatch.name}”的焊机必须与工作站场景一致`;
      }
      const values=deviceLibraryUpdates(data,input,compatible);
      const removedProcesses=new Set(values.processLibrary?data.processLibrary
        .filter(process=>!values.processLibrary.some(next=>next.id===process.id)).map(process=>process.id):[]);
      const disabledTemplates=new Set((values.templates??[]).filter(template=>
        template.enabled===false&&data.templates.find(previous=>previous.id===template.id)?.enabled!==false
      ).map(template=>template.id));
      const deleting=values.templates&&data.templates.some(template=>!values.templates.some(entry=>entry.id===template.id));
      const next=updateProjectPlanning(data,values);
      try {
        if(input.deviceControl||input.workstationSettings){
          const options={...getPlanningContext(next),measureTemplateNeighborhood:context.measureTemplateNeighborhood};
          const robotSelectionChanged=planningRobots.map(robot=>robot.id).join()!==options.planningRobots.map(robot=>robot.id).join();
          const trackingChanged=robotSelectionChanged||context.robotMounting!==options.robotMounting||laserMountSide!==options.laserMountSide||
            context.deviceCapabilities.laserTracking!==options.deviceCapabilities.laserTracking||
            context.deviceCapabilities.arcTracking!==options.deviceCapabilities.arcTracking||
            JSON.stringify(context.laserTrackingByRobot)!==JSON.stringify(options.laserTrackingByRobot);
          if(trackingChanged||structuredLightInstalled!==options.deviceCapabilities.structuredLightPrecision){
            const processes=next.processLibrary.filter(process=>belongsToDevice(process,options.activeDevice));
            const welds=assignWeldingOrder(next.welds,options).map(weld=>{
              if(!weld.enabled||weld.mergedInto||weld.splitInto)return weld;
              const reset={...weld,collisionVerified:false,collisionPasses:undefined,collisionResult:undefined,collisionState:undefined,
                ...(weld.strategyPlan?{strategyPlan:{...weld.strategyPlan,collisionStatus:'未验证'}}:{})};
              return trackingChanged?planWeld(reset,next.templates,processes,options):reset;
            });
            next.welds=assignWeldingOrder(welds,{...options,requireCollisionVerification:planningCollisionEnabled});
          }else if(robotSelectionChanged)next.welds=assignWeldingOrder(next.welds,{...options,requireCollisionVerification:planningCollisionEnabled});
        }
        if(input.planningSettings&&planningRobots.length>1){
          const options=getPlanningContext(next);
          next.welds=assignWeldingOrder(next.welds,{...options,requireCollisionVerification:planningCollisionEnabled});
        }
        if(deleting||disabledTemplates.size||removedProcesses.size){
          const options={...getPlanningContext(next),measureTemplateNeighborhood:context.measureTemplateNeighborhood};
          next.welds=next.welds.map(weld=>{
            const current=removedProcesses.size?clearRemovedProcess(weld,removedProcesses):weld;
            const cleaned=deleting?clearMissingWeldTemplates(current,next.templates):current;
            if(cleaned.enabled&&(cleaned!==weld||weldTemplateIds(cleaned).some(id=>disabledTemplates.has(id)))){
              return planWeld({...cleaned,collisionVerified:false,collisionState:undefined,collisionPasses:undefined,
                weldingOrder:null},next.templates,next.processLibrary,options);
            }
            return cleaned;
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
        },projectChange);
        return '';
      }catch(error){return error.message;}
    }
    async function savePlanningSettings(settings,changed,allocationChanged){
      const current=dataRef.current;
      const sourceSha=current.stepModel?.sourceSha256??(isDemoModel(current)?DEMO_SOURCE_SHA256:null);
      const hasCompletedPlan=!!(current.model&&sourceSha&&current.geometryProcessing?.sourceSha256===sourceSha);
      const error=await updateTemplates({planningSettings:settings});
      if(error)return error;
      if(changed&&hasCompletedPlan){setDialog('replan-settings');return '';}
      setDialog(null);
      notify(allocationChanged?'多机焊道分配已保存':current.welds.length?'设置已保存，下次一键规划时使用。现有焊缝和已生成路径已保留。':'设置已保存，点击一键规划后按新设置提取焊缝并生成路径。');
      return '';
    }
    function dismissSettingsReplan(){
      setDialog(null);
      notify('设置已保存，现有规划结果已保留。');
    }
    function applyProcess(p,{throwOnError=false}={}) { if(!selected)return false;try{if(workspaceSave.current)throw Error('正在保存本机工作区，请稍后重试');const updated=applyProcessEntry(plannedTracking(selected,context),p);change(d=>({...d,welds:d.welds.map(w=>w.id===d.selected?updated:w)}));log(`${selected.id} 已应用工艺参数 ${p.name}`);notify('工艺参数已应用，请保存规划草稿');return true;}catch(e){if(throwOnError)throw e;notify(e.message);return false;} }
    const go = p => { if(!modules.includes(p))return;if(page==='工艺规划'&&p!==page)setModelInfo(null);setPage(p); setDialog(null);setToast(null); };
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
      <main id="main-content" tabIndex={-1}>
       {!libraryEditing&&page==='工艺规划'&&<PageHeader title={page} actions={<>
        <Btn onClick={()=>setDialog('import')}>导入模型</Btn>
        <Btn onClick={()=>setDialog('import-point-cloud')}>导入点云</Btn>
        <Btn disabled={!!stepImporting||!!geometryProgress} onClick={runReverseModel}>逆向建模</Btn>
        <div className="planning-action-group" role="group" aria-label="一键规划与设置">
         <Btn primary aria-label="一键规划" aria-busy={!!geometryProgress||savingWorkspace}
          title={savingWorkspace?'正在保存本机工作区':geometryProgress?.stage??(workstationLoading?'正在加载工作站':
           stepImporting?'正在导入文件':pointCloudWorkspace?'请先导入 STEP 模型':data.model?'提取焊道并进行工艺规划':'请先导入模型')}
          data-tooltip={!data.model?'请先导入模型':undefined}
          disabled={!data.model||pointCloudWorkspace||!!geometryProgress||creatingWelds||savingWorkspace||workstationLoading||!!stepImporting} onClick={plan}>
          <span aria-live="polite">{savingWorkspace?'保存中…':geometryProgress?.phase==='extract'?'提取焊道 '+geometryProgress.percent+'%':
           geometryProgress?.phase==='collision'?'碰撞检测 '+geometryProgress.percent+'%':geometryProgress?'工艺规划中…':
           workstationLoading?'加载工作站…':'一键规划'}</span>
         </Btn>
         <Btn icon={Settings} aria-label="工艺规划设置" onClick={()=>setDialog('settings')}/>
        </div>
        <Btn onClick={()=>taskFile.current?.click()}>导入 PF 文件</Btn>
        <Btn disabled={!canSaveWorkpieceTemplate(data)||!!geometryProgress} onClick={()=>openWorkpieceDialog('save')}>保存为工件模板</Btn>
        {editingWorkpiece&&<Btn primary disabled={!!geometryProgress} onClick={()=>openWorkpieceDialog('update',editingWorkpiece)}>保存工件模板修改</Btn>}
        <div className="planning-action-group planning-task-export" role="group" aria-label="导出任务">
         <Btn disabled={!data.model||writingProductionTask||!!geometryProgress||creatingWelds}
          title="导出到生产执行" onClick={exportTaskToProduction}>导出任务</Btn>
         <details name="planning-action-menu" onKeyDown={event=>{if(event.key==='Escape')event.currentTarget.open=false;}}>
          <summary className="btn" aria-label="任务导出选项" title="任务导出选项"><ChevronDown size={14}/></summary>
          <div className="display-pop"><button type="button" disabled={!data.model} onClick={event=>{
           event.currentTarget.closest('details').open=false;downloadTask();
          }}>下载 PF 文件</button></div>
         </details>
        </div>
       </>}/>}
       {!libraryEditing&&page==='工艺参数库'&&<PageHeader title={page} actions={<>
        <Btn icon={Settings} aria-label="设备信息配置" onClick={()=>window.dispatchEvent(new Event('process-device-settings'))}>设备配置</Btn>
        <Btn primary disabled={!availableProcessProfiles.length} title={!availableProcessProfiles.length?'请先添加设备信息配置':undefined}
         onClick={()=>setProcessRequest({fromWeld:false})}><img src="/assets/process-library/plus.svg" alt=""/>新建工艺参数</Btn>
       </>}/>}
    {page==='工艺规划' ? <div className={'workspace planning-workspace'+(collapsed?' collapsed':'')+(inspectorOpen?' inspector-open':'')}><aside className="structure" aria-label="模型结构">
      <div className="panel-tabs">
        <button className="icon rail-button" aria-label="收起结构树" title="收起结构树" ref={treeToggle}
          onClick={()=>{flushSync(()=>setCollapsed(true));modelTreeToggle.current?.focus();}}><PanelLeftClose size={17}/></button>
        {(pointCloudWorkspace?['结构树']:['结构树','零件管理']).map(tab=><button type="button" key={tab}
          className={leftTab===tab?'active':''} aria-pressed={leftTab===tab} onClick={()=>setLeftTab(tab)}>{tab}</button>)}
      </div>
      {!data.model?<Empty model text="请导入模型"/>:<>
        <div className="tree-root"><FolderOpen size={15}/><strong title={data.model}>{data.model}</strong></div>
        {!pointCloudWorkspace&&<div className="tree-search">
          <Search size={14} aria-hidden="true"/>
          {leftTab==='零件管理'?<TextInput aria-label="搜索零件" placeholder="搜索零件名称 / 编号" value={partsSearch} onChange={event=>setPartsSearch(event.target.value)}/>:
            <TextInput aria-label="搜索焊缝" placeholder="搜索焊缝名称 / 编号" value={search} onChange={event=>setSearch(event.target.value)}/>}
          {(leftTab==='零件管理'?partsSearch:search)&&<button type="button" className="icon" aria-label="清空搜索"
            onClick={()=>leftTab==='零件管理'?setPartsSearch(''):setSearch('')}><X size={13}/></button>}
        </div>}
        {pointCloudWorkspace?<p className="point-cloud-count">{modelInfo?.pointCount!==undefined?modelInfo.pointCount.toLocaleString('zh-CN')+' 个点':''}</p>:
        leftTab==='零件管理'?<>
          <div className="tree-section"><span>零件</span><small>{visibleParts.length}</small></div>
          <div className="parts-list">{visibleParts.map(({name,id})=><div key={id}><Box size={15}/><span title={name}>{name}</span><small>{id}</small></div>)}
          {!visibleParts.length&&partsSearch&&<p className="no-match">没有匹配的零件</p>}</div>
        </>:<>
          <div className="tree-section">
            <button type="button" className="tree-group-toggle" aria-expanded={weldGroupOpen} aria-controls="planning-weld-tree"
              onClick={()=>setCollapsedWeldGroup(weldGroupOpen?modelViewKey:null)}>
              <ChevronDown size={14}/><span>焊缝</span><small>{weldSearch?filteredWelds.length+' / '+data.welds.length:data.welds.length}</small>
            </button>
            <button type="button" className="btn tree-batch-toggle" aria-pressed={batchSelect} disabled={!data.welds.length} onClick={()=>{
              if(!batchSelect)setCollapsedWeldGroup(null);
              setBatchSelect(!batchSelect);
              if(batchSelect&&modelEditMode!=='merge')setMergeIds([]);
            }}><Trash2 size={13}/>{batchSelect?'退出选择':'批量删除'}</button>
          </div>
          {weldGroupOpen&&(batchSelect||modelEditMode==='merge')&&<div className="weld-multi-tools">
            <label><input type="checkbox" aria-label="全选可见焊道" checked={selectableWelds.length>0&&selectableWelds.every(weld=>mergeIds.includes(weld.id))}
              onChange={event=>setMergeIds(event.target.checked?[...new Set([...mergeIds,...selectableWelds.map(weld=>weld.id)])]:
                mergeIds.filter(id=>!selectableWelds.some(weld=>weld.id===id)))}/>已选 {mergeIds.length} 条</label>
            <button type="button" className="btn danger-outline" disabled={!mergeIds.length||!!geometryProgress}
              onClick={()=>setDeleteWeldIds(mergeIds)}>删除所选</button>
            {mergeIds.length>0&&<button type="button" className="btn" onClick={()=>setMergeIds([])}>清空</button>}
          </div>}
          <div className="weld-list" id="planning-weld-tree" hidden={!weldGroupOpen} ref={weldList}>{filteredWelds.map(w => {const route=weldMatchResults.get(w.id)?.route,matched=route==='whole'||route==='automatic'||route==='local';const showPoints=page==='工艺规划'&&w.id===data.selected&&closedPointTree!==w.id;return <div key={w.id} className={'weld-tree-branch'+(showPoints?' expanded':'')}><div data-weld-id={w.id} className={'weld-row ' + (w.id === data.selected ? 'selected' : '')} onClick={event=>{if(!event.target.closest('button,input,summary,label,.weld-row-menu'))selectTreeWeld(w.id);}}>{page==='工艺规划'&&(batchSelect||modelEditMode==='merge')&&<input type="checkbox" className="merge-checkbox" aria-label={`选择焊道 ${w.id}`} disabled={!removablePlanningWeld(w)||modelEditMode==='merge'&&!w.enabled} checked={mergeIds.includes(w.id)} onChange={e=>setMergeIds(ids=>e.target.checked?[...ids,w.id]:ids.filter(id=>id!==w.id))}/>}<input type="checkbox" aria-label={`启用 ${w.id}`} disabled={!!w.mergedInto||!!w.splitInto} checked={w.enabled} onChange={e => change(d => ({ ...d, welds: d.welds.map(x => x.id === w.id ? { ...x, enabled: e.target.checked, disabledByMinWeldLength: undefined } : x) }))}/><button className="weld-row-main" onClick={() => selectTreeWeld(w.id)}><Cable size={14}/><span className="weld-row-label"><strong>{w.id}{allocationLabel(w)&&<span className="tree-weld-arm">{allocationLabel(w)}</span>}</strong><small title={w.name} className={'weld-row-origin origin-'+(w.source==='manual'?'manual':w.topology||w.source==='manual-merge'?'merged':'extracted')}>{w.name}</small></span></button><span className={'status-dot ' + (matched?'green':route==='blocked'?'wa-pending-dot':'')} title={matched?'已匹配':route==='blocked'?'未匹配':undefined}/>{page==='工艺规划'&&<><button type="button" className="weld-point-action" title={showPoints?'收起点位':'展开点位'} aria-label={(showPoints?'收起 ':'展开 ')+w.id+' 点位'} aria-expanded={showPoints} onClick={()=>showPoints?setClosedPointTree(w.id):selectTreeWeld(w.id)}><ChevronDown size={13}/></button><details className="weld-row-actions"><summary title="更多焊缝操作" aria-label={'更多操作 '+w.id}><MoreHorizontal size={16}/></summary><div className="weld-row-menu">
 <button type="button" onClick={event=>{toggleGeometry(weldViewKey(w.id));event.currentTarget.closest('details').open=false;}}>{hiddenWelds.has(w.id)?'显示焊缝':'隐藏焊缝'}</button>
 <button type="button" disabled={!w.enabled||!!w.mergedInto||!!w.splitInto||!!geometryProgress||!w.segments?.every(segment=>segment.pathPoints?.length>=2)} onClick={event=>{event.currentTarget.closest('details').open=false;addWeldLayer(w);}}>新建层</button>
 <button type="button" className="danger-text" disabled={!removablePlanningWeld(w)||!!geometryProgress} onClick={event=>{event.currentTarget.closest('details').open=false;setDeleteWeldIds([w.id]);}}>删除焊缝</button>
 </div></details></>}</div>{showPoints&&<WeldPointTree weldId={w.id} groups={planningPointGroups} selection={activeSelection} onSelect={selectWeldPoint} onAddPoint={beginWeldPoint} onAddPass={addWeldPass} onRemove={setRemoveLayoutTarget} isVisible={node=>!hiddenGeometry.has(layoutViewKey(w.id,node))} onToggleVisibility={node=>toggleGeometry(layoutViewKey(w.id,node))} editable={w.enabled&&!w.mergedInto&&!w.splitInto&&!geometryProgress}/>}</div>;})}{!filteredWelds.length && <p className="no-match">{data.welds.length?'没有匹配的焊道':'可以手动创建焊缝，或点击一键规划'}</p>}</div></>}</>}</aside><section className="center"><div className="model-title">{collapsed&&<button className="icon rail-button" aria-label="展开结构树" title="展开结构树" ref={modelTreeToggle} onClick={()=>{flushSync(()=>setCollapsed(false));treeToggle.current?.focus();}}><PanelLeftOpen size={17}/></button>}<strong>模型视图</strong></div><div className="viewport">{page==='工艺规划'&&data.model&&!pointCloudWorkspace&&<PlanningModelTools manualCreate={manualCreate} onCreateMethod={setManualCreateMethod} onCreateUndo={()=>setManualCreate(draft=>({...draft,picks:draft.picks.slice(0,-1),paths:[],error:''}))} onCreateConfirm={confirmManualWeld} creating={creatingWelds} canUndo={!!data.manualEditHistory?.length} onUndo={undoGeometryEdit} splitByFace={splitByFace} faceStations={faceStations} onSplitByFace={value=>{setSplitByFace(value);setFaceStations([]);setSplitError('');}} mode={modelEditMode} onMode={editModelMode} weld={selected} ids={mergeIds} onUndoMerge={undoMerge} onMerge={()=>{setMergeError('');setMerging(true);}} splitAt={splitAt} onSplitAt={setSplitAt} onSplit={confirmSplit} onUndoSplit={undoSplit} canUndoSplit={!!data.manualSplitHistory?.length} disabled={!modelInfo||!!geometryProgress} error={splitError}/>}<Viewer workstation={workstation} workstationStatus={workstationStatus} toolPreviewRobotId={selected?.assignedRobot??planningRobots[0]?.id} toolPreviewScan={selected?.scanSettings} workpiecePose={workpiecePoseFor(data)} onWorkpiecePoseChange={saveWorkpiecePose} workpieceEditMode={canPlaceWorkpiece?placementMode:null} structuredLightInstalled={structuredLightInstalled} laserMountSide={laserMountSide} invertModelZ={invertModelZ} manualCreate={modelEditMode==='create'?manualCreate:null} onManualCreatePick={modelEditMode==='create'&&manualCreate?selectManualWeldPoint:undefined} wrapPreview={wrapPreview} onSelectWrapEdge={wrapFocus?.picking&&wrapFocus.weldId===selected?.id?selectWrapEdge:undefined} key={stepModelKey(data)+':'+modelLoadRevision} stepModel={data.stepModel} mergeIds={modelEditMode==='merge'?mergeIds:undefined} editMode={modelEditMode} splitPoint={modelEditMode==='split'&&selected&&splitAt!==''?{id:selected.id,distance:Number(splitAt)}:null} planningPoints={visiblePlanningPoints} sampleMarker={sampleMarker} collisionMarker={collisionMarker} headPoint={measurementView?measurementHead:headPoint} headCoverOpen={!!measurementPoint&&measurementPlan.camera==='structuredLight'} headFieldOfView={!!measurementPoint&&cameraFieldOfView} measurementPlan={measurementPlan} measurementIndex={measurementIndex} onMeasurementPointSelect={pickingMeasurement?undefined:measurementPreview?.onPoint} measurementFocus={measurementFocus} passPaths={measurementPoint?undefined:passPaths} hiddenWelds={hiddenWelds} passFocus={passFocus} onSelectPass={id=>selectModelPlanningItem('pass',id)} selectedPlanningPointId={activePoint?.id} onPlanningPointSelect={id=>selectModelPlanningItem('point',id)} onCoverCaptureReady={capture=>{coverCapture.current=capture;}} onModelInfo={setModelInfo} model={data.model} selected={data.selected} welds={data.welds} view={view} reset={reset} camera={camera} onSelect={selectModelWeld} onSelectFace={modelEditMode==='split'&&splitByFace?selectSplitFace:undefined}/><PlanningViewDisplay view={view} onChange={setView}/><div className="view-tools" role="group" aria-label="模型视图操作">{measurementPoint&&!modelEditMode&&<button type="button" aria-label="近看测量点" title="近看测量点" onClick={()=>setMeasurementFocus(value=>value+1)}><Crosshair size={18}/></button>}{!measurementPoint&&passPaths.length>0&&<button type="button" aria-label="近看层道偏移" title="近看层道偏移" onClick={()=>{setView(current=>({...current,passes:true}));setPassFocus(value=>value+1);}}><Layers size={18}/></button>}{data.model&&<WorkpiecePlacementTools mode={placementMode} disabled={!canPlaceWorkpiece}
   onChange={mode=>{setWorkpieceTool(current=>current===mode&&view.model?null:mode);setView(current=>({...current,model:true}));}}
   onRestore={data.workpiecePose?()=>{void saveWorkpiecePose(null);setReset(value=>value+1);}:undefined}/>}<button aria-label="适应视图" title="适应视图" onClick={() => setReset(r => r + 1)}><Maximize2 size={20}/></button><button aria-label="切换俯视" title="切换俯视" onClick={() => setCamera(c => c === 'top' ? 'iso' : 'top')}><Minimize2 size={20}/></button><button aria-label="透明模型" title="透明模型" className={view.transparent ? 'active' : ''} onClick={() => setView(v => ({ ...v, transparent: !v.transparent }))}><Box size={20}/></button><button aria-label="恢复默认" title="恢复默认" onClick={() => { setCamera('iso'); setReset(r => r + 1); setHiddenGeometry(new Set()); setView(DEFAULT_PLANNING_VIEW); }}><RotateCcw size={20}/></button><PlanningViewDisplay geometry view={view} onChange={setView}/></div><div className="view-orientation" role="group" aria-label="模型视角"><ViewCube onView={setCamera} invertModelZ={invertModelZ}/><div className="view-cameras">{[['top', '上'], ['front', '前'], ['right', '右'], ['iso', '等轴']].map(([id, l]) => <button key={id} className={camera === id ? 'active' : ''} aria-label={l==='等轴'?'等轴视图':l+'视图'} title={id==='top'?'上视图（从 '+(invertModelZ?'Z-':'Z+')+' 方向）':undefined} aria-pressed={camera===id} onClick={() => setCamera(id)}>{l}</button>)}</div></div>{data.model && <div className="canvas-note">{selected?selected.id+' · '+selected.position+' · '+formatLength(selected.length)+' mm':demoModel?'可一键规划':''}</div>}</div><section className={'logs'+(logsOpen?' logs-open':'')} style={{'--logs-height':logHeight+'px'}}>
  {logsOpen&&<div className="log-resize-handle" title="拖动调整日志面板高度" aria-hidden="true"
   onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);logResizeStart.current={y:event.clientY,height:logHeight};}}
   onPointerMove={event=>{const start=logResizeStart.current;if(start)setLogHeight(Math.max(100,Math.min(320,start.height+start.y-event.clientY)));}}
   onLostPointerCapture={()=>{logResizeStart.current=null;}}/>}
  <header><button type="button" className="log-toggle" aria-expanded={logsOpen} onClick={()=>setLogsOpen(open=>!open)}><ChevronDown size={15}/><strong>日志 · {logs.length} 条</strong></button>{!logsOpen&&logs.length>0&&<span className="log-latest" title={logs.at(-1).message}>最新：{logs.at(-1).message}</span>}{logsOpen&&<><span/><TextInput placeholder="搜索日志" aria-label="搜索日志" value={logSearch} onChange={e=>setLogSearch(e.target.value)}/><button className="icon" aria-label="倒序日志" title="倒序日志" onClick={()=>setLogs(l=>[...l].reverse())}><Filter size={14}/></button><button className="icon" aria-label="清空日志" title="清空日志" onClick={()=>setLogs([])}><Trash2 size={14}/></button></>}</header>
  {logsOpen&&<div className="log-lines">{logs.filter(l=>l.message.includes(logSearch)).map(l=><div key={l.id}><time>{l.time}</time><span>{l.message}</span></div>)}</div>}
 </section></section><aside className="inspector" aria-label="焊缝属性侧栏">
 <button type="button" className="icon inspector-toggle" aria-label={inspectorOpen?'收起焊缝属性':'展开焊缝属性'} title={inspectorOpen?'收起焊缝属性':'展开焊缝属性'} aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(open=>!open)}>{inspectorOpen?<PanelRightClose size={18}/>:<PanelRightOpen size={18}/>}</button>
 <div className="inspector-content" inert={!inspectorOpen}>{!selected ? <Empty text={data.model?null:"请先导入 STEP 模型"}/> : <WeldAttributes onCreateTemplate={page==='工艺规划'?createWholeTemplate:undefined} createTemplateUnavailable={templateCreateDisabled?templateCreateHint:''} onCreateProcess={page==='工艺规划'&&availableProcessProfiles.length?()=>{setProcessRequest({fromWeld:true});go('工艺参数库');}:undefined} onChooseTemplate={()=>setDialog('templatePicker')} onChooseProcess={()=>setDialog('processPicker')} planningSelection={activeSelection} planningPoint={activePoint} planningPointPose={previewPoint?.pose} planningPassPreview={stationPose?{pose:stationPose,from:firstStation,to:lastStation,sampleStations:selectedPass.sampleStations,sampleStation,
   speedAt:selectedPass.speedAt, collision:passCollision,
   onStation:updatePreviewStation}:undefined} defaultPosePreview={pointStrategy?.settingsOnly&&!pointStrategy.templateAngles} planningPointBasePosition={pointBasePosition} planningPointGroup={pointGroup} onSavePoint={point=>saveWeldPoint(point,true)} onSaveLayerOrPass={saveLayerOrPass} onOffsetPreview={setPointOffsetPreview} onOffsetPreviewEnd={clearPointOffsetPreview} onPlanningViewChange={setPlanningPointsVisible} onScanningViewChange={setMeasurementView} measurementPreview={measurementPreview} robotAssignment={allocationLabel(selected)} onUndoMerge={undoMerge} onSeparateSegments={page==='工艺规划'&&!geometryProgress&&canSeparateWeldSegments(selected)?()=>setSegmentSeparation({id:selected.id,indices:[],error:''}):undefined} decision={selectedDecision} trackingSegments={selected?.segments} trackingWeld={selected} trackingIssue={trackingIssue} weld={selected} templates={data.templates} processLibrary={data.processLibrary} onPatch={patch} onWrapChange={patchWeldWrap} onWrapFocus={focusWrapEndpoint} onClearWrapFocus={()=>setWrapFocus(null)} wrapFocus={wrapPreview?.overlap?{...wrapFocus,message:'包角轨迹与 '+wrapPreview.overlap+' 重叠'}:wrapFocus} busy={!!geometryProgress} deviceCapabilities={scanningCapabilities} onCancel={weldEditBaseline.current.has(selected.id)?cancelWeldEdit:undefined} onSave={applyWeldAttributes}/>}</div></aside></div> : page==='焊接模板库' ? <TemplateLibrary templateImpact={templateImpact} measureNeighborhood={measureLibraryTemplate} captureRange={data.templateCaptureRange} templates={data.templates} project={data.project} projectNames={data.templateProjects} processLibrary={data.processLibrary} onUpdate={updateTemplates} onEditingChange={setLibraryEditing} onGoPlanning={()=>go('工艺规划')} notify={notify}/> : page==='工艺参数库' ? <ProcessParameterLibrary sceneWelders={sceneWelders} welds={data.welds} deletedDeviceProfiles={data.deletedProcessDevices} onRestoreDevice={async id=>{try{return await updateTemplates(restoreDeviceLibrary(dataRef.current,id));}catch(error){return error.message;}}} onEditingChange={setLibraryEditing} entries={data.processLibrary} deviceProfiles={data.processDeviceProfiles} selected={selected?plannedTracking(selected,context):null} editorRequest={processRequest} onEditorRequestHandled={()=>setProcessRequest(null)} onUpdate={updateTemplates} onApply={p=>{if(applyProcess(p)){go('工艺规划');}}} notify={notify}/> : page === '设备控制' ? workstation?<WorkstationDeviceControl key={sceneKey??'builtin'} workstation={workstationSource} value={workstationSettings} sceneStatus={workstationStatus} loading={workstationLoading} onImport={()=>sceneFileInput.current?.click()} coverOpen={precisionCoverOpen} onCoverChange={setPrecisionCoverOpen} fieldOfView={cameraFieldOfView} onFieldOfViewChange={setCameraFieldOfView} onSave={saveSceneDeviceSettings}/>:<DeviceControl sceneStatus={workstationStatus} loading={workstationLoading} onImport={()=>sceneFileInput.current?.click()} value={deviceControl} coverOpen={precisionCoverOpen} onCoverChange={setPrecisionCoverOpen} fieldOfView={cameraFieldOfView} onFieldOfViewChange={setCameraFieldOfView} onSave={async deviceControl=>{
  const error=await updateTemplates({deviceControl});if(!error)notify('设备配置已保存');return error;
 }}/> : page==='工件库'?<WorkpieceLibrary projects={workpieceProjects} project={data.project} records={workpieces}
  loading={workpiecesLoading} error={workpiecesError} canSave={canSaveWorkpieceTemplate(data)}
  onSave={project=>openWorkpieceDialog('save',project)} onApply={record=>openWorkpieceDialog('reuse',record)}
  onEdit={editWorkpiece}
  onRemove={record=>openWorkpieceDialog('remove',record)} onNewProject={()=>openWorkpieceDialog('project')}/>
  : page==='生产执行'?<ProductionExecutionWorkspace key={(sceneKey??'builtin')+':'+(productionTask?.updatedAt??'empty')} task={productionTask} Dialog={Dialog}
  workstation={workstation} workstationStatus={workstationStatus} livePlanning={context}
  importing={writingProductionTask} onImportTask={()=>productionTaskFile.current?.click()}
  invertModelZ={invertModelZ}/>:
  <ProductionStatisticsWorkspace/>}
    </main><footer className="statusbar"><span>项目：{(page==='生产执行'?productionTask?.workspace.project:data.project)||'本地项目'}</span><span className="status-dot"/><span>设备未连接</span>{page==='工艺规划'&&data.welds.length>0&&<span className="status-welds">已启用 {enabled.length.toLocaleString('zh-CN')} / {data.welds.length.toLocaleString('zh-CN')} 条 · {formatLength(total)} mm</span>}{(savingWorkspace||saved)&&<><span className="status-spacer"/><span role="status" className={'save-indicator'+(!savingWorkspace&&saved==='已保存至本机'?' saved':'')}>{savingWorkspace?'正在保存至本机':saved}{!savingWorkspace&&saved==='已保存至本机'&&savedAt&&' · '+savedAt}</span></>}</footer><input hidden type="file" accept=".pf" aria-label="PF 文件" ref={taskFile} onChange={event=>importTask(event)}/><input hidden type="file" accept=".pf" aria-label="生产执行 PF 文件" ref={productionTaskFile} onChange={event=>importTask(event,true)}/><input hidden type="file" accept=".step,.stp" aria-label="STEP 文件" ref={stepFile} onChange={event=>importModel(event)}/><input hidden type="file" accept={POINT_CLOUD_EXTENSIONS} aria-label="点云文件" ref={pointCloudFile} onChange={event=>importModel(event,'pointCloud')}/><input hidden type="file" accept=".glb,model/gltf-binary" aria-label="场景文件" ref={sceneFileInput} onChange={selectWorkstationScene}/>{toast && <Feedback {...toast} onDismiss={()=>setToast(null)}/>}
    {workpieceDialog&&<Dialog title={{save:'保存为工件模板',update:'保存工件模板修改',reuse:'复用工件模板',remove:'删除工件模板',project:'新建项目'}[workpieceDialog.type]}
     onClose={closeWorkpieceDialog}>
     <form onSubmit={confirmWorkpieceDialog}>
      <div className="dialog-body workpiece-form">
       {['save','update','project'].includes(workpieceDialog.type)&&
        <label>{workpieceDialog.type==='project'?'项目名称':'工件模板名称'}
         <TextInput value={workpieceDialog.name} maxLength={80} required
          onChange={event=>setWorkpieceDialog({...workpieceDialog,name:event.target.value})}/></label>}
       {['save','update'].includes(workpieceDialog.type)&&<label>项目<select value={workpieceDialog.project}
        onChange={event=>setWorkpieceDialog({...workpieceDialog,project:event.target.value})}>
        {workpieceProjects.map(project=><option key={project}>{project}</option>)}</select></label>}
       {workpieceDialog.type==='reuse'&&<p>将「{workpieceDialog.record.name}」的模型和 {workpieceDialog.record.weldCount} 条焊缝载入工艺规划。</p>}
       {workpieceDialog.type==='remove'&&<p>确定从工件库删除「{workpieceDialog.record.name}」？</p>}
       {workpieceDialogError&&<p role="alert" className="workpiece-error">{workpieceDialogError}</p>}
      </div>
      <footer><Btn type="button" onClick={closeWorkpieceDialog} disabled={workpieceBusy}>取消</Btn>
       <Btn type="submit" primary danger={workpieceDialog.type==='remove'} disabled={workpieceBusy}>
        {workpieceBusy?'处理中…':{save:'保存',update:'保存',reuse:'载入工艺规划',remove:'确认删除',project:'新建'}[workpieceDialog.type]}</Btn></footer>
     </form>
    </Dialog>}
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
        <div className="step-import-actions">{previewModels.map(model=><Btn key={model} disabled={!!stepImporting} onClick={()=>loadPreviewModel(model)}>
          导入预览模型 {model===EXAMPLE_MODEL?model:'a1a'}
        </Btn>)}
        </div>
      </div>
      <footer><Btn onClick={closeImport}>{stepImporting?'取消导入':'取消'}</Btn></footer>
    </Dialog>}
    {dialog==='import-point-cloud'&&<Dialog title="导入点云" onClose={closeImport}>
      <div className="dialog-body">
        <div className="import-zone"><Box size={38}/><h3>导入本地点云</h3><p>支持 TXT、XYZ、PLY 和 PCD。TXT 每行三列，依次为 X、Y、Z。</p>
          <Btn primary disabled={!!stepImporting} onClick={()=>pointCloudFile.current?.click()}>选择点云文件</Btn>
        </div>
        {stepImporting&&<p role="status">正在解析 {stepImporting}…</p>}
        {stepError&&<p role="alert" className="tpl-errors">{stepError}</p>}
      </div>
      <footer><Btn onClick={closeImport}>{stepImporting?'取消导入':'取消'}</Btn></footer>
    </Dialog>}
    {dialog==='reverse-model'&&<Dialog title="逆向建模" onClose={closeReverseModel}>
      <div className="dialog-body">
        {reverseResult?.running&&<p role="status">正在重建 {data.model}…</p>}
        {reverseResult?.error&&<p role="alert" className="tpl-errors">{reverseResult.error}</p>}
        {reverseResult?.file&&<p role="status">{reverseResult.type==='subassembly'?'小组立':'重磅板'} STEP 已生成，共 {reverseResult.parts} 个实体。</p>}
        {stepImporting&&<p role="status">正在载入 STEP…</p>}
        {stepError&&<p role="alert" className="tpl-errors">{stepError}</p>}
      </div>
      <footer>
        <Btn onClick={closeReverseModel}>{reverseResult?.running||stepImporting?'取消':'关闭'}</Btn>
        {reverseResult?.file&&<>
          <Btn onClick={()=>downloadReconstructedStep(reverseResult.file)}>下载 STEP</Btn>
          <Btn primary disabled={!!stepImporting} onClick={()=>importModelFile(reverseResult.file)}>载入模型</Btn>
        </>}
      </footer>
    </Dialog>}
    {dialog==='weldPoint'&&selected?.id===newPointTarget?.weldId&&<Dialog title={'添加点位 · '+selected.id} onClose={()=>setDialog(null)}><WeldControlPointForm key={selected.id} groups={editablePointGroups} initialGroup={newPointTarget.passId} existing={planningPoints} onSave={saveWeldPoint} onCancel={()=>setDialog(null)}/></Dialog>}
    {selected&&dialog==='templatePicker'&&<Dialog title="选择焊接模板" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="template" weld={selected} templates={data.templates} project={data.project} projectNames={data.templateProjects} onCancel={()=>setDialog(null)} onConfirm={template=>{if(applyTemplate(template))setDialog(null);}}/></Dialog>}
    {selected&&dialog==='processPicker'&&<Dialog title="工艺参数库" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="process" weld={selected} processLibrary={activeProcesses} onCancel={()=>setDialog(null)} onConfirm={value=>{if(applyProcess(value,{throwOnError:true}))setDialog(null);}}/></Dialog>}
    {dialog === 'settings' && <Dialog title="工艺规划设置" onClose={() => setDialog(null)}><PlanningSettings key={data.project} capabilities={context.deviceCapabilities} robots={context.planningRobots} welds={data.welds} settings={data.planningSettings} hasWelds={data.welds.length>0} saving={savingWorkspace} onCancel={()=>setDialog(null)} onSave={savePlanningSettings}/></Dialog>}
    {dialog === 'replan-settings' && <Dialog title="重新规划" onClose={dismissSettingsReplan}>
      <div className="dialog-body"><p>当前工艺规划设置有修改，是否重新规划</p></div>
      <footer><Btn onClick={dismissSettingsReplan}>取消</Btn><Btn primary onClick={()=>{setDialog(null);void plan();}}>重新一键规划</Btn></footer>
    </Dialog>}
    {dialog === 'about' && <Dialog title="关于原版工艺规划平台" onClose={() => setDialog(null)}><div className="dialog-body"><h2>原版工艺规划平台</h2><p>参照本机安装版 Weldone 1.0.4 的导航、三栏工作区、橙色主题与日志布局实现。</p><p>选择 a1a.step 或 111.step 预览模型后，平台使用实际模型几何自动运行一键规划。支持几何提取、打断和合并、模板应用与本地草稿保存。设备通信尚未接入。</p></div><footer><Btn primary onClick={() => setDialog(null)}>知道了</Btn></footer></Dialog>}
    {dialog==='help'&&<Dialog title="使用帮助" onClose={()=>setDialog(null)}><div className="dialog-body"><p>在工艺规划导入 STEP 模型，再点击「一键规划」提取焊缝、生成基础轨迹，再应用匹配的模板或工艺参数。</p><p>选中焊缝后，可在焊缝属性中查看匹配结果或基于此焊道新建模板。</p></div></Dialog>}
    {dialog==='shortcuts'&&<Dialog title="快捷键" onClose={()=>setDialog(null)}><div className="dialog-body"><p>Tab / Shift + Tab 在控件之间移动。</p><p>Esc 关闭当前弹窗。</p><p>Ctrl / ⌘ + S 保存正在编辑的模板。</p></div></Dialog>}
    {templateDraft&&<TemplateEditor initial={templateDraft.template} neighborhoodEvidence={templateDraft.evidence} neighborhoodSource={templateDraft.source} measureNeighborhood={context.measureTemplateNeighborhood} isNew processLibrary={data.processLibrary} onClose={()=>setTemplateDraft(null)} onSave={saveNewTemplate}/>}
    {templateDuplicate&&<Dialog title="重复焊接模板" onClose={()=>setTemplateDuplicate(null)}>
      <div className="tpl-confirm-body"><p>已存在焊缝几何条件相同的模板。继续创建时，请选择默认匹配的模板。</p><select aria-label="同几何默认模板" value={templateDuplicate.defaultId} onChange={event=>setTemplateDuplicate({...templateDuplicate,defaultId:event.target.value})}>{[...templateDuplicate.duplicates,templateDuplicate.value].map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
      <footer><Btn onClick={()=>setTemplateDuplicate(null)}>取消</Btn><Btn primary onClick={async ()=>{try{const issue=await commitNewTemplate(templateDuplicate.value,templateDuplicate.defaultId);if(issue)notify(issue);}catch(error){notify(error.message);}}}>继续创建</Btn></footer>
    </Dialog>}
    </div>;
}
