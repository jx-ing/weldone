import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Menu, Settings, Plus, ChevronDown, Upload, Download, X, Box, Search, Trash2, Play, Pause, RotateCcw, CircleHelp, FolderOpen, Save, SlidersHorizontal, Maximize2, Minimize2, Filter, Copy, Activity, FileJson, Cable, CircleCheck } from 'lucide-react';
import Viewer from './StepViewer';
import {MAX_PLANNING_WELDS,planningContext,roundWeldLeg,belongsToDevice} from './planningRequirements.mjs';
import {validGroove} from './grooveModel.mjs';
import PlanningSettings from './PlanningSettings';
import {updateProjectPlanning} from './planningSettingsModel.mjs';
import PlanningLibraryPicker from './PlanningLibraryPicker';
import PlanningModelTools from './PlanningModelTools';
import {geometryOptionsForPlanning} from './planningConfiguration.mjs';
import {weldPointDistance,splitSelectedWeld,undoLastSplit,planeSplitStations} from './manualSplitModel.mjs';
import './planningWorkspace.css';
import WeldMergeDialog from './WeldMergeDialog';
import {mergeSelectedWelds,undoManualMerge} from './manualMergeModel.mjs';
import {excludeConfirmedNonWelds,repairConfirmedNonWeldStorage} from './confirmedNonWelds.mjs';
import {DEMO_SOURCE_SHA256,DEFAULT_GEOMETRY_OPTIONS,installGeometryResult,restoreGeometryResult,validExtractedWeld,removablePlanningWeld,removePlanningWelds} from './geometryProcessingModel.mjs';
import './geometryProcessing.css';
import {EXAMPLE_MODEL,useStepExample,validManualWeldPath} from './manualWeldModel.mjs';
import {cacheStepMesh,cacheStepNeighborhood,isDemoModel,loadStepNeighborhood,stepModelKey,switchStepWorkspace,validStepModel} from './stepModelStore.mjs';
import ViewCube from './ViewCube';
import TemplateLibrary, {TemplateEditor} from './TemplateLibrary';
import {newPlanningTemplate} from './templateCoverModel.mjs';
import {DEFAULT_TEMPLATE_CAPTURE_RANGE,validTemplateCaptureRange} from './templateCaptureRange.mjs';
import {createTemplateNeighborhoodMeasurer,loadDemoTemplateNeighborhood} from './templateNeighborhood.mjs';
import {templateGeometryKey} from './templateGeometryRules.mjs';
import WeldAttributes from './WeldAttributes';
import {copyWeldLayersToTemplate,newWeldLayer,newWeldPass,validWeldLayerLayout,weldLayerLayout,weldLayerTreeGroups,weldPointBasePosition} from './weldLayerLayout.mjs';
import WeldPointTree from './WeldPointTree';
import WeldControlPointForm from './WeldControlPointForm';
import {analyzeWeldMatch,planWorkspace,canPreviewWeld,applySelectedTemplate,restorePlanningState,planWeldFromMatch} from './weldMatching.mjs';
import ProcessParameterLibrary from './ProcessParameterLibrary';
import DeviceControl from './DeviceControl';
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
function read() { try {
    const v = JSON.parse(localStorage.getItem('weldone.replica.draft.v1'));
    if (valid(v))
        return restorePlanningState(excludeConfirmedNonWelds(useStepExample(migrateDraft(v))));
}
catch { } return structuredClone(defaults); }
function Btn({ children, icon: Icon, primary = false, ...rest }) { return <button className={'btn ' + (primary ? 'primary' : '')} {...rest}>{Icon && <Icon size={14}/>} {children}</button>; }
function Empty({ model = false, text }) { return <div className="empty"><img src={`/assets/${model ? 'empty-model' : 'empty-data'}.svg`} alt=""/><p>{text || '暂无数据'}</p></div>; }
function Dialog({ title, onClose, children }) { const ref = useRef(); useEffect(() => { const old = document.activeElement; ref.current?.querySelector('input,button')?.focus(); const handle = e => { if (e.key === 'Escape')
    onClose(); if (e.key === 'Tab') {
    const list = [...ref.current.querySelectorAll('button,input,select')].filter(x => !x.matches(':disabled') && x.getClientRects().length);
    if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1)?.focus();
    }
    else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0]?.focus();
    }
} }; document.addEventListener('keydown', handle); return () => { document.removeEventListener('keydown', handle); old?.focus(); }; }, []); return <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="dialog"><header><strong>{title}</strong><button className="icon" aria-label="关闭弹窗" onClick={onClose}><X size={18}/></button></header>{children}</section></div>; }
export function App() {
    const [data, setData] = useState(read), [page, setPage] = useState('工艺规划'), [leftTab, setLeftTab] = useState('结构树'), [search, setSearch] = useState(''), [logSearch, setLogSearch] = useState(''), [logs, setLogs] = useState([]), [dialog, setDialog] = useState(null), [toast, setToast] = useState(''), [running, setRunning] = useState(false), [progress, setProgress] = useState(0), [display, setDisplay] = useState(false), [view, setView] = useState({ grid: true, model: true, welds: true, labels: true, transparent: false }), [reset, setReset] = useState(0), [camera, setCamera] = useState('iso'), [collapsed, setCollapsed] = useState(false), [speed, setSpeed] = useState(1), [execution, setExecution] = useState('待就绪'), [saved, setSaved] = useState('本地工作区'), [draft, setDraft] = useState(''), [processRequest,setProcessRequest]=useState(0), [libraryEditing,setLibraryEditing]=useState(false), [modelInfo,setModelInfo]=useState(null), [deleteWeldIds,setDeleteWeldIds]=useState([]);
    const [templateDraft,setTemplateDraft]=useState(null);
    const [templateDuplicate,setTemplateDuplicate]=useState(null);
    const [coverBusy,setCoverBusy]=useState(false);
    const appRef=useRef(),coverCapture=useRef(),pickedSplit=useRef(null),weldEditBaseline=useRef(new Map());
    const [planningPointsVisible,setPlanningPointsVisible]=useState(false);
    const [planningSelection,setPlanningSelection]=useState(null);
    const [closedPointTree,setClosedPointTree]=useState('');
    const [newPointTarget,setNewPointTarget]=useState(null);
    useEffect(()=>{if(!['工艺参数库','焊接模板库'].includes(page))return;const root=appRef.current,size=()=>{const scale=Math.max(.64,Math.min(1,window.innerWidth/1920));root.style.setProperty('--ps',scale+'px');root.style.setProperty('--process-zoom',scale);};size();window.addEventListener('resize',size);return()=>{window.removeEventListener('resize',size);root.style.removeProperty('--ps');root.style.removeProperty('--process-zoom');};},[page]);
    const file = useRef(),taskFile=useRef(),stepFile=useRef(),stepImportWorker=useRef(), toastTimer = useRef(), geometryWorker=useRef(), dataRef=useRef(data); dataRef.current=data;
    const [stepImporting,setStepImporting]=useState(''),[stepError,setStepError]=useState(''),[modelLoadRevision,setModelLoadRevision]=useState(0);
    const demoModel=isDemoModel(data);
    const deviceControl=useMemo(()=>data.deviceControl??migrateDeviceControl(undefined,data.deviceCapabilities),[data.deviceControl,data.deviceCapabilities]);
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
    const filteredWelds=data.welds.filter(weld=>(weld.id+weld.name).toLowerCase().includes(search.toLowerCase()));
    const selectableWelds=filteredWelds.filter(weld=>removablePlanningWeld(weld)&&(modelEditMode!=="merge"||weld.enabled));
    const context=useMemo(()=>({...planningContext({...data,deviceControl}),measureTemplateNeighborhood:demoModel?neighborhood:importedMeasure}),[data.planningSettings,data.processDeviceProfiles,data.deviceCapabilities,deviceControl,demoModel,neighborhood,importedMeasure]);
    const measureLibraryTemplate=useMemo(()=>(template,range)=>{
      const source=template.sourceWeld;
      const measure=isDemoModel(source)?neighborhood:source.stepModel?.sourceSha256===importedSha?importedMeasure:null;
      return measure?.(template,range);
    },[neighborhood,importedSha,importedMeasure]);
    const activeProcesses=useMemo(()=>data.processLibrary.filter(process=>belongsToDevice(process,context.activeDevice)),[data.processLibrary,context]);
    const selectedDecision=useMemo(()=>selected?analyzeWeldMatch(selected,data.templates,activeProcesses,context):null,[selected,data.templates,activeProcesses,context]);
    const weldMatchRoutes=useMemo(()=>{
      const options={...context,includeMatchDiagnostics:false};
      return new Map(data.welds.map(weld=>[weld.id,analyzeWeldMatch(weld,data.templates,activeProcesses,options).route]));
    },[data.welds,data.templates,activeProcesses,context]);
    const pointLayout=useMemo(()=>weldLayerLayout(selected,selectedDecision,data.templates,activeProcesses,context),[selected,selectedDecision,data.templates,activeProcesses,context]);
    const pointProcess=selected?.processParameters??selectedDecision?.process??selectedDecision?.whole?.baseProcessSnapshot;
    const planningPointGroups=useMemo(()=>weldLayerTreeGroups(selected,pointLayout,pointProcess),[selected,pointLayout,pointProcess]);
    const planningPoints=useMemo(()=>planningPointGroups.flatMap(group=>group.points),[planningPointGroups]);
    const activeSelection=planningSelection?.weldId===selected?.id?planningSelection:null;
    const activePoint=activeSelection?.type==='point'?planningPoints.find(point=>point.id===activeSelection.id):undefined;
    const activePointGroup=activeSelection?.type==='pass'?planningPointGroups.find(group=>group.id===activeSelection.id):
      activeSelection?.type==='layer'?planningPointGroups.find(group=>group.layerId===activeSelection.id):undefined;
    const pointGroup=activePoint?planningPointGroups.find(group=>group.id===activePoint.groupId):activePointGroup;
    const pointBasePosition=useMemo(()=>activePoint?weldPointBasePosition(selected,pointLayout,activePoint.groupId,activePoint.raw.id):undefined,[selected,pointLayout,activePoint]);
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
    function saveWeldLayout(weld,pointLayout){
      if(!weld||!weld.enabled||weld.mergedInto||weld.splitInto)return '当前焊缝不可编辑层道或点位';
      const current=dataRef.current;
      const append=item=>({...item,pointLayout,attributeOverrides:{...item.attributeOverrides,pointLayout}});
      const next={...current,welds:current.welds.map(item=>item.id===weld.id?append(item):item)};
      const pending=weldEditBaseline.current;
      const baseline=pending.get(weld.id);
      const persisted={...next,welds:next.welds.map(item=>item.id===weld.id&&baseline?append(baseline):pending.get(item.id)??item)};
      try{localStorage.setItem('weldone.replica.draft.v1',JSON.stringify(persisted));}
      catch{return '本机保存失败，请检查浏览器存储空间后重试';}
      if(baseline)pending.set(weld.id,append(baseline));
      setData(next);
      if(!pending.size)setSaved('已保存至本机');
      return '';
    }
    function addWeldLayer(weld){
      const layout=weld.id===selected?.id?pointLayout:weldLayerLayout(weld,null,data.templates,activeProcesses,context);
      if(layout.length>=20)return notify('每条焊缝最多 20 层');
      const layer=newWeldLayer(weld,layout.length+1);
      const issue=saveWeldLayout(weld,[...layout,layer]);
      if(issue)return notify(issue);
      selectTreeWeld(weld.id);
      selectWeldPoint('layer',layer.id,weld.id);
    }
    function addWeldPass(layerId){
      const layer=pointLayout.find(item=>item.id===layerId);
      if(!layer||layer===pointLayout[0])return;
      if(layer.passes.length>=50)return notify('每层最多 50 道');
      const pass=newWeldPass(selected,layer.passes.length+1);
      const issue=saveWeldLayout(selected,pointLayout.map(item=>item.id===layerId?{...item,passes:[...item.passes,pass]}:item));
      if(issue)return notify(issue);
      selectWeldPoint('pass',pass.id);
    }
    function saveLayerOrPass(group,values,layerOnly){
      return saveWeldLayout(selected,pointLayout.map(layer=>{
        if(layer.id!==group.layerId)return layer;
        if(layerOnly)return {...layer,...values};
        return {...layer,passes:layer.passes.map(pass=>pass.id===group.id?{...pass,...values}:pass)};
      }));
    }
    function saveWeldPoint(point,editing=false){
      const group=planningPointGroups.find(item=>item.id===point.groupId);
      if(!group)return '请选择所属道';
      if(!editing&&group.points.length>=500)return '每道最多 500 个点位';
      const {groupId,...record}=point;
      const reference=group.points.find(item=>item.raw.id===record.referenceId)?.raw;
      if(reference){record.segment=reference.segment;record.percent=reference.percent;}
      const next=pointLayout.map(layer=>({...layer,passes:layer.passes.map(pass=>{
        if(pass.id!==groupId)return pass;
        const points=editing?pass.points.map(item=>item.id===record.id?record:item):[...pass.points,record];
        return {...pass,points};
      })}));
      const issue=saveWeldLayout(selected,next);
      if(issue)return issue;
      if(!editing){selectWeldPoint('point',groupId+':'+record.id);setDialog(null);}
      return '';
    }
    const canPreview=!weldEditBaseline.current.has(selected?.id)&&canPreviewWeld(selected,data.templates,data.processLibrary);
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
    function selectModelWeld(id,point){const weld=dataRef.current.welds.find(w=>w.id===id);if(!weld)return;
      if(modelEditMode==='merge'){if(!weld.enabled||weld.mergedInto||weld.splitInto)return;setMergeIds(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);}
      if(modelEditMode==='split'&&point){const at=String(Math.round(weldPointDistance(weld,point)*100)/100);if(dataRef.current.selected!==id)pickedSplit.current={id,at};setSplitAt(at);}
      setData(d=>({...d,selected:id}));
    }
    function confirmSplit(){try{const next=splitSelectedWeld(dataRef.current,dataRef.current.selected,splitByFace?faceStations:Number(splitAt),{revision:3});if(!valid(next))throw Error('打断结果未通过路径校验');persistGeometry(replanEditedGeometry(next));setSplitError('');setSplitAt('');setFaceStations([]);log('已打断焊道 '+dataRef.current.selected+'，原焊道已保留，可撤销。');}catch(e){setSplitError(e.message);}}
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
    function undoGeometryEdit(){
      const current=dataRef.current,history=current.manualEditHistory??[],last=history.at(-1);
      if(!last)return;
      try{const restored=last.kind==='merge'?undoManualMerge(current,last.id):undoLastSplit(current);persistGeometry({...restored,manualEditHistory:history.slice(0,-1)});setSplitError('');notify('已撤销上一次焊缝操作');}
      catch(error){notify(error.message);}
    }
    function undoSplit(){try{persistGeometry(undoLastSplit(dataRef.current));setSplitError('');notify('已撤销上一次手动打断');}catch(e){setSplitError(e.message);}}
    function notify(s) { setToast(s); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); }
    function log(message) { setLogs(l => [...l.slice(-149), { id: crypto.randomUUID(), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), message }]); }
    function change(fn) { setData(fn); setSaved('有未保存修改'); }
    useEffect(()=>{
      const corrected=excludeConfirmedNonWelds(data);
      if(corrected!==data)setData(corrected);
    },[data]);
    useEffect(()=>{
      try{if(repairConfirmedNonWeldStorage(localStorage))setSaved(previous=>previous==='有未保存修改'?previous:'已保存至本机');}
      catch{notify('非焊缝已从当前列表移除，本机草稿保存失败，请导出草稿备份');}
    },[]);
    useEffect(() => { setRunning(false); }, [page]);
    useEffect(() => { setRunning(false); setProgress(0); }, [data.model, data.selected]);
    useEffect(() => { if (!running)
        return; const t = setInterval(() => setProgress(p => Math.min(100, p + speed * .4)), 50); return () => clearInterval(t); }, [running, speed]);
    useEffect(() => { if (progress >= 100 && running) {
        setRunning(false);
        log('路径预览完成，当前示例未进行碰撞检测。');
    } }, [progress, running]);
    useEffect(() => () => {clearTimeout(toastTimer.current);geometryWorker.current?.terminate();stepImportWorker.current?.terminate();}, []);
    function persistGeometry(next){setData(next);try{localStorage.setItem('weldone.replica.draft.v1',JSON.stringify(next));setSaved('已保存至本机');return true;}catch{setSaved('有未保存修改');notify('处理已完成，本机存储空间不足，请导出草稿');return false;}}
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
          const pending=dataRef.current;
          if(!reference&&!measure&&(pending.templates.some(template=>template.enabled!==false&&template.requirementsMatch?.captureRange)||
            pending.welds.some(weld=>weld.enabled&&weld.templateSnapshot?.requirementsMatch?.captureRange))){
            measure=await loadDemoTemplateNeighborhood();
            setNeighborhood(()=>measure);
          }
          const current=dataRef.current;
          if(stepModelKey(current)!==modelKey||current.model!==workspace.model)throw Error('模型已切换，请重新运行一键规划');
          if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改，再重新运行一键规划');
          const settings=planningContext({...current,deviceControl:current.deviceControl??deviceControl});
          if(JSON.stringify(options)!==JSON.stringify(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,settings))){
            throw Error('提取设置已变更，请重新运行一键规划');
          }
          const extracted=installGeometryResult(current,message.result);
          if(!valid(extracted))throw Error('焊道提取结果未通过工作区校验');
          if(reference&&message.result.neighborhood){
            const geometry=message.result.neighborhood,sha=reference.sourceSha256;
            measure=createTemplateNeighborhoodMeasurer(geometry);
            setImportedNeighborhood({sha,measure});
            cacheStepNeighborhood(sha,geometry).catch(()=>{});
          }
          const count=extracted.welds.filter(weld=>weld.source==='extracted'&&removablePlanningWeld(weld)).length;
          log(`焊道提取完成：${count} 条。开始工艺规划。`);
          executePlan(extracted,settings,measure);
          setView(view=>({...view,welds:true}));
          finish();
        }catch(error){fail(error.message);}
      };
      worker.postMessage({options,model:workspace.model,reference});
    }
    function mergeSelection(){try{const next=mergeSelectedWelds(dataRef.current,mergeIds,context);if(!valid(next))throw Error('合并后的路径未通过校验');persistGeometry(replanEditedGeometry(next));setMergeIds([]);setMerging(false);log(`${mergeIds.length} 条焊道已合并为 ${next.selected}，原焊道已保留并屏蔽。`);}catch(e){setMergeError(e.message);}}
    function undoMerge(){try{const next=undoManualMerge(dataRef.current,dataRef.current.selected);persistGeometry(next);notify('已恢复合并前的焊道');}catch(e){notify(e.message);}}
    function undoGeometry(){const next=restoreGeometryResult(dataRef.current);if(persistGeometry(next))notify('已撤销本次几何处理并保存');log('已撤销本次焊道几何处理。');}
    function patch(key, value) { const current=dataRef.current.welds.find(w=>w.id===dataRef.current.selected);if(current&&!weldEditBaseline.current.has(current.id))weldEditBaseline.current.set(current.id,structuredClone(current));setRunning(false); change(d => ({ ...d, welds: d.welds.map(w => w.id === d.selected ? { ...w, [key]: value, ...(key==='segments'?{position:value.every(s=>s.position===value[0].position)?value[0].position:'混合位置（逐段设置）'}:{}), ...((w.segments?.length===1||['extracted','manual-merge'].includes(w.source)&&key==='position')&&['position','length'].includes(key)?{segments:w.segments.map(s=>({...s,[key]:value}))}:{}), planned: key==='planningPointOverrides'?w.planned:false } : w) })); }
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
    function installStepWorkspace(next){
      if(!valid(next))throw Error('模型工作区校验失败');
      localStorage.setItem('weldone.replica.draft.v1',JSON.stringify(next));
      setData(next);
      setSaved('已保存至本机');
      setModelInfo(null);
      setModelLoadRevision(value=>value+1);
      setProgress(0);
      setRunning(false);
      setModelEditMode('');
      setMergeIds([]);
      setClosedPointTree('');
      setPlanningSelection(null);
      setView(current=>({...current,model:true,welds:true}));
      closeImport();
    }
    function checkModelSwitch(){
      if(geometryWorker.current||geometryProgress)throw Error('请等待当前一键规划完成');
      if(weldEditBaseline.current.size)throw Error('请先应用或取消焊缝属性修改');
    }
    async function load(){
      try{
        checkModelSwitch();
        const current=dataRef.current;
        if(isDemoModel(current)){closeImport();return;}
        installStepWorkspace(await switchStepWorkspace(current,EXAMPLE_MODEL));
        notify('示例模型已加载');
      }catch(error){setStepError(error.message);}
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
            const next=await switchStepWorkspace(dataRef.current,model.name,reference);
            if(stepImportWorker.current!==worker)return;
            installStepWorkspace(next);
            log('已导入 '+model.name+'，共 '+model.meshes.length+' 个零件。');
            notify('STEP 模型已导入');
          }catch(error){fail(error.message);}
        };
        worker.postMessage(chosen);
      }catch(error){stopStepImport();setStepError(error.message);}
    }
    function save() { try {
        localStorage.setItem('weldone.replica.draft.v1', JSON.stringify(data));
        setSaved('已保存至本机');
        notify('规划草稿已保存至本机');
        log('已保存本地规划草稿。');
    }
    catch {
        notify('浏览器存储不可用，请导出 JSON 草稿');
    } }
    function exportDraft() { const u = URL.createObjectURL(new Blob([JSON.stringify({ format: 'weldone-ui-draft', version: 1, ...data }, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = u; a.download = `${data.model || 'Weldone'}-规划草稿.json`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); log('已导出 JSON 规划草稿，不含实机执行程序。'); }
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
        const current=dataRef.current;
        const workspace={...task,deviceControl:current.deviceControl??deviceControl,deviceCapabilities:current.deviceCapabilities};
        if(!valid(workspace))throw Error('PF 任务数据无效');
        const loaded=restorePlanningState(excludeConfirmedNonWelds(useStepExample(migrateDraft(workspace))));
        const next={...loaded,selected:loaded.welds.some(w=>w.id===loaded.selected)?loaded.selected:loaded.welds[0]?.id||''};
        installStepWorkspace(next);
        log('已导入 PF 任务 '+chosen.name);
        notify('PF 任务已导入');
      }catch(error){
        notify(error instanceof SyntaxError?'无法读取 PF 文件，请选择本平台导出的任务文件。':error.message);
      }
    }
    async function importDraft(e) { const f = e.target.files?.[0]; e.target.value = ''; if (!f)
        return; try {
        checkModelSwitch();
        if (f.size > 5 * 1024 * 1024)
            throw Error('文件超过 5MB');
        const v = JSON.parse(await f.text());
        checkModelSwitch();
        if (v.format !== 'weldone-ui-draft' || !valid(v))
            throw Error('草稿格式不正确，请选择本平台导出的 JSON');
        setRunning(false);
        const loaded=restorePlanningState(excludeConfirmedNonWelds(useStepExample(migrateDraft(v)))); change({...loaded,selected:loaded.welds.some(w=>w.id===loaded.selected)?loaded.selected:loaded.welds[0]?.id||''});
        setDialog(null);
        log('已导入规划草稿');
        notify('草稿导入成功');
    }
    catch (e) {
        notify(e.message);
    } }
    function executePlan(workspace,settings,measure){
      const options={...settings,measureTemplateNeighborhood:measure};
      const welds=planWorkspace(workspace.welds,workspace.templates,workspace.processLibrary,options);
      const ready=welds.filter(weld=>weld.enabled&&weld.planned).length;
      const blocked=welds.filter(weld=>weld.enabled&&!weld.planned).length;
      const selected=welds.some(weld=>weld.id===workspace.selected)?workspace.selected:
        (welds.find(weld=>weld.enabled&&!weld.planned)??welds.find(weld=>weld.enabled)??welds[0])?.id??'';
      log(`规划完成：${ready} 条生成路径，${blocked} 条待处理。`);
      if(!persistGeometry({...workspace,welds,selected}))return;
      notify(!welds.length?'本次未提取到可规划的焊道':`工艺规划完成：${ready} 条已生成路径，${blocked} 条待处理`);
    }
    function plan(){
      if(geometryProgress||geometryWorker.current)return;
      if(weldEditBaseline.current.size){notify('请先应用或取消焊缝属性修改');return;}
      if(stepImportWorker.current){notify('请等待 STEP 模型导入完成');return;}
      if(!demoModel&&!data.stepModel&&!data.welds.length){notify('请先导入 STEP 模型');return;}
      setRunning(false);
      setProgress(0);
      try{
        if(demoModel||data.stepModel){extractAndPlan(geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,context),data);return;}
        log('当前模型暂无自动提取数据，使用已有焊道进行工艺规划。');
        executePlan(data,context);
      }catch(error){notify(error.message);}
    }
    function cancelWeldEdit(){
      const previous=weldEditBaseline.current.get(data.selected);
      if(!previous)return;
      weldEditBaseline.current.delete(previous.id);
      change({...data,welds:data.welds.map(weld=>weld.id===previous.id?previous:weld)});
    }
    function applyWeldAttributes(){
      if(!selected||!selected.name.trim()||roundWeldLeg(selected.leg)===null||!validGroove(selected.groove)||selected.segments.some(segment=>!segment.position||segment.position==='待确认')){notify('请完善焊缝名称、焊脚、位置及坡口');return;}
      const previous=weldEditBaseline.current.get(selected.id);
      try{
        const overrides={...selected.attributeOverrides};
        for(const key of ['name','leg','position','weldType','machineCount','groove','workFace','direction','tracking','scanSettings','endpointFacts','edgeDistance','planningPointOverrides'])if(previous&&JSON.stringify(previous[key])!==JSON.stringify(selected[key]))overrides[key]=structuredClone(selected[key]);
        if(previous&&JSON.stringify(previous.segments)!==JSON.stringify(selected.segments)){
          overrides.segments=selected.segments.map(segment=>({position:segment.position,tracking:segment.tracking,startWrapMode:segment.startWrapMode,endWrapMode:segment.endWrapMode}));
        }
        const decision=analyzeWeldMatch(selected,data.templates,activeProcesses,context);
        const next=planWeldFromMatch({...selected,attributeOverrides:overrides},decision,context);
        weldEditBaseline.current.delete(selected.id);
        persistGeometry({...data,welds:data.welds.map(weld=>weld.id===selected.id?next:weld)});
        notify(decision.ready?'焊缝属性已应用并重新规划':'焊缝属性已应用，请查看当前焊缝的处理提示');
      }catch(error){notify(error.message);}
    }
    const templateSourceIssues = wholeWeldSourceIssues(data.model, selected);
    const templateCreateDisabled = coverBusy || !modelInfo || (demoModel&&!neighborhood) || templateSourceIssues.length > 0;
    const templateCreateHint = templateSourceIssues.join('；') || (!modelInfo ? '请等待三维模型加载完成' : demoModel&&!neighborhood ? neighborhoodError||'正在加载焊缝邻域数据' : '截取所选焊缝域模型并新建模板');
    async function createWholeTemplate() {
      if (templateCreateDisabled || !coverCapture.current) return;
      setCoverBusy(true);
      try {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const capture = coverCapture.current;
        if (!capture) return;
        const range=data.templateCaptureRange??DEFAULT_TEMPLATE_CAPTURE_RANGE;
        const source=targetFromWeld(selected);
        const evidence=context.measureTemplateNeighborhood?.(source,range);
        const cover=capture(source,range);
        const initial=newPlanningTemplate(data.model,data.welds,selected.id,cover,range,evidence,data.stepModel);
        const template=copyWeldLayersToTemplate(initial,pointLayout,selected,pointProcess);
        setTemplateDraft({template:{...template,project:data.project||'本地项目'},evidence,source});
      } catch (error) {
        notify(error.message);
      } finally {
        setCoverBusy(false);
      }
    }
    function commitNewTemplate(value, defaultId) {
      const key = templateGeometryKey(value);
      const templates = [...data.templates, value].map(template =>
        defaultId && template.type === 'whole' && templateGeometryKey(template) === key
          ? {...template, defaultForGeometry: template.id === defaultId}
          : template
      );
      const decision = {ready: true, route: 'whole', whole: value, locals: [], steps: ['已匹配：'+value.name, '无需匹配', '无需匹配']};
      const source=data.welds.find(weld=>weld.id===value.sourceWeld.id);
      const appliesToSource=source&&matchTemplate(value,targetFromWeld(source),context).ok;
      const welds=appliesToSource?data.welds.map(weld=>weld.id===source.id?planWeldFromMatch(weld,decision,context):weld):data.welds;
      const error = updateTemplates({templates, welds});
      if (error) return error;
      setTemplateDuplicate(null);
      setTemplateDraft(null);
      go('焊接模板库');
      notify(appliesToSource?'焊接模板已保存并回填到当前焊缝':'焊接模板已保存');
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
      const updated = applySelectedTemplate(selected, template, data.processLibrary, context);
      change(current => ({...current, welds: current.welds.map(weld => weld.id === selected.id ? updated : weld)}));
      log(selected.id+' 已应用模板 '+template.name);
      notify('模板的全部层、道和控制点已应用，请保存规划草稿');
    }
    function deleteSelectedWelds(){
      const current=dataRef.current,next=removePlanningWelds(current,deleteWeldIds);
      setDeleteWeldIds([]);
      if(next===current)return;
      for(const id of deleteWeldIds)weldEditBaseline.current.delete(id);
      setRunning(false);setProgress(0);setMergeIds([]);setPlanningSelection(null);
      if(persistGeometry(next))notify('已删除 '+(current.welds.length-next.welds.length)+' 条焊缝');
    }
    function updateTemplates(input) { const values=deviceLibraryUpdates(data,input);const removed=new Set(values.processLibrary?data.processLibrary.filter(process=>!values.processLibrary.some(next=>next.id===process.id)).map(process=>process.id):[]);const disabled=new Set((values.templates||[]).filter(t=>t.enabled===false&&data.templates.find(v=>v.id===t.id)?.enabled!==false).map(t=>t.id));const next={...updateProjectPlanning(data,values),...(disabled.size?{welds:data.welds.map(w=>disabled.has(w.templateId)||disabled.has(w.localTemplateId)||(w.localApplications||[]).some(a=>disabled.has(a.templateId))?{...w,planned:false}:w)}:{})}; if(removed.size)next.welds=next.welds.map(weld=>clearRemovedProcess(weld,removed));try { localStorage.setItem('weldone.replica.draft.v1', JSON.stringify(next)); setData(next); setSaved('已保存至本机'); return ''; } catch { return '本机保存失败，请检查浏览器存储空间后重试'; } }
    function applyProcess(p,{throwOnError=false}={}) { if(!selected)return false;try{const updated=applyProcessEntry(selected,p);change(d=>({...d,welds:d.welds.map(w=>w.id===d.selected?updated:w)}));log(`${selected.id} 已应用工艺参数 ${p.name}`);notify('工艺参数已应用，请保存规划草稿');return true;}catch(e){if(throwOnError)throw e;notify(e.message);return false;} }
    const go = p => { if(!modules.includes(p))return;if(page==='工艺规划'&&p!==page)setModelInfo(null);setPage(p); setDisplay(false); setDialog(null); };
    function navigate(pageName) {
      if (pageName === page) return;
      const eventName = page === '工艺参数库' ? 'process-library-navigate' : page === '焊接模板库' ? 'template-library-navigate' : '';
      const proceed = () => go(pageName);
      if (!eventName || window.dispatchEvent(new CustomEvent(eventName, {cancelable:true, detail:{navigate:proceed}}))) proceed();
    }
    return <div ref={appRef} className={'app'+(page==='工艺参数库'?' process-library-view'+(libraryEditing?' process-detail-mode':''):page==='焊接模板库'?' template-library-view':'')}><header className="titlebar"><img src="/assets/favicon.ico" alt=""/><span>Weldone</span><div className="title-actions"><span>原版工艺规划平台</span><button aria-label="帮助" onClick={() => setDialog('about')}><CircleHelp size={15}/></button></div></header><nav className="main-nav" aria-label="主导航"><button aria-label="收起结构树" className="nav-menu" onClick={() => setCollapsed(!collapsed)}><Menu size={17}/></button>{modules.map(m => <button key={m} className={page === m ? 'selected' : ''} onClick={() => navigate(m)}>{m === '系统管理' && <SlidersHorizontal size={14}/>} {m}</button>)}<button className="nav-help" aria-label="平台说明" onClick={() => setDialog('about')}><CircleHelp size={17}/></button></nav><main>{!libraryEditing&&page!=='焊接模板库'&&page!=='设备控制'&&page!=='生产统计'&&<section className="page-bar"><h1>{page}</h1>{page === '生产执行' && <span className="tag">模型驱动 · 示例模式</span>}<div className="bar-actions"><button className="icon" aria-label={page==='工艺参数库'?'设备信息配置':'工艺规划设置'} onClick={() => page==='工艺参数库'?window.dispatchEvent(new Event('process-device-settings')):setDialog('settings')}>{page==='工艺参数库'?<img src="/assets/process-library/settings.svg" alt=""/>:<Settings size={17}/>}</button>{['工艺规划', '路径仿真'].includes(page) ? <>{page==='工艺规划'&&<Btn primary icon={Plus} aria-label="以选中焊缝创建模板" disabled={templateCreateDisabled} title={templateCreateHint} onClick={createWholeTemplate}>{coverBusy?'正在截取封面…':'创建焊缝模板'}</Btn>}<Btn primary onClick={() => setDialog('import')}>导入模型</Btn><Btn aria-label="一键规划" aria-busy={!!geometryProgress} title={geometryProgress?.stage??'提取焊道并进行工艺规划'} disabled={!data.model||!!geometryProgress} onClick={plan}><span aria-live="polite">{geometryProgress?.phase==='extract'?'提取焊道 '+geometryProgress.percent+'%':geometryProgress?'工艺规划中…':'一键规划'}</span></Btn><Btn onClick={()=>taskFile.current?.click()}>导入 PF 文件</Btn><Btn disabled={!data.model} onClick={exportTask}>导出任务</Btn></> : page === '生产执行' ? <><Btn icon={RotateCcw} onClick={() => { setExecution('示例就绪'); log('示例工作区已就绪，未连接实机。'); }}>初始化</Btn><Btn onClick={() => { setRunning(false); setExecution('已停止'); }}>终止</Btn><Btn primary disabled={!canPreview} icon={Play} onClick={() => { if (progress === 100)
        setProgress(0); if(canPreview){setRunning(!running); setExecution('示例预览');} }}>执行预览</Btn></> : page==='工艺参数库' ? !libraryEditing&&<Btn primary onClick={()=>setProcessRequest(n=>n+1)}><img src="/assets/process-library/plus.svg" alt=""/>新建工艺参数</Btn> : <Btn icon={Save} onClick={save}>保存草稿</Btn>}</div></section>}
    {['工艺规划', '路径仿真', '生产执行'].includes(page) ? <div className={'workspace ' + (collapsed ? 'collapsed' : '')}><aside className="structure"><div className="panel-tabs">{(page === '生产执行' ? ['任务列表', '加工列表'] : ['结构树', '零件管理']).map(t => <button key={t} className={leftTab === t ? 'active' : ''} onClick={() => setLeftTab(t)}>{t}</button>)}<button className="mini-primary" onClick={() => setDialog('import')}><Plus size={14}/><span>导入模型</span></button></div>{!data.model ? <Empty model text={page === '生产执行' ? '暂无排单' : '请导入模型'}/> : <><div className="tree-search"><Search size={14}/><input aria-label="搜索焊缝" placeholder="搜索名称 / 编号" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="tree-root"><ChevronDown size={14}/><FolderOpen size={15}/><strong>{data.model}</strong><span className="sample-label">{data.geometryProcessing?'几何提取':data.welds.length?'已有焊道':'待提取'}</span></div>{leftTab === '零件管理' ? <div className="parts-list">{(modelInfo?.parts||[]).map((p, i) => <div key={i}><Box size={15}/><span>{p}</span><small>P00{i + 1}</small></div>)}</div> : <><div className="tree-section"><ChevronDown size={13}/>焊缝 <small>({data.welds.length})</small></div>{page==='工艺规划'&&<div className="weld-multi-tools"><label><input type="checkbox" aria-label="全选可见焊道" checked={selectableWelds.length>0&&selectableWelds.every(w=>mergeIds.includes(w.id))} onChange={e=>setMergeIds(e.target.checked?selectableWelds.map(w=>w.id):[])}/>多选 {mergeIds.length}</label><button type="button" disabled={!mergeIds.length||!!geometryProgress} onClick={()=>setDeleteWeldIds(mergeIds)}>删除所选</button>{mergeIds.length>0&&<button type="button" onClick={()=>setMergeIds([])}>清空</button>}</div>}<div className="weld-list">{filteredWelds.map(w => {const route=weldMatchRoutes.get(w.id),matched=route==='whole'||route==='automatic'||route==='local';const showPoints=page==='工艺规划'&&w.id===data.selected&&closedPointTree!==w.id;return <div key={w.id} className="weld-tree-branch"><div className={'weld-row ' + (w.id === data.selected ? 'selected' : '')}>{page==='工艺规划'&&<input type="checkbox" className="merge-checkbox" aria-label={`选择焊道 ${w.id}`} disabled={!removablePlanningWeld(w)||modelEditMode==='merge'&&!w.enabled} checked={mergeIds.includes(w.id)} onChange={e=>setMergeIds(ids=>e.target.checked?[...ids,w.id]:ids.filter(id=>id!==w.id))}/>}<input type="checkbox" aria-label={`启用 ${w.id}`} disabled={!!w.mergedInto||!!w.splitInto} checked={w.enabled} onChange={e => change(d => ({ ...d, welds: d.welds.map(x => x.id === w.id ? { ...x, enabled: e.target.checked } : x) }))}/><button className="weld-row-main" onClick={() => selectTreeWeld(w.id)}><Cable size={14}/><span>{w.id}<small>{w.name}</small></span><span className={'status-dot ' + (matched?'green':route==='blocked'?'wa-pending-dot':'')} title={matched?'已匹配':route==='blocked'?'未匹配':undefined}/></button>{page==='工艺规划'&&<><button type="button" className="weld-point-action" title={showPoints?'收起点位':'展开点位'} aria-label={(showPoints?'收起 ':'展开 ')+w.id+' 点位'} aria-expanded={showPoints} onClick={()=>showPoints?setClosedPointTree(w.id):selectTreeWeld(w.id)}><ChevronDown size={13}/></button><button type="button" className="weld-point-action" title="新建层" aria-label={'为 '+w.id+' 新建层'} disabled={!w.enabled||!!w.mergedInto||!!w.splitInto||!!geometryProgress||!w.segments?.every(segment=>segment.pathPoints?.length>=2)} onClick={()=>addWeldLayer(w)}><Plus size={14}/></button></>}</div>{showPoints&&<WeldPointTree weldId={w.id} groups={planningPointGroups} selection={activeSelection} onSelect={selectWeldPoint} onAddPoint={beginWeldPoint} onAddPass={addWeldPass} editable={w.enabled&&!w.mergedInto&&!w.splitInto&&!geometryProgress}/>}</div>;})}{!data.welds.some(w => (w.id + w.name).toLowerCase().includes(search.toLowerCase())) && <p className="no-match">{data.welds.length?'没有匹配的焊道':'尚未生成焊道，请点击一键规划'}</p>}</div></>}<footer className="tree-footer">已启用 {enabled.length} / {data.welds.length} 条<span>{total} mm</span></footer></>}</aside><section className="center"><div className="model-title"><strong>模型视图</strong>{data.model && <span>{data.model}<span className="sample-label">{modelInfo?.parts.length||0} 个零件</span></span>}</div><div className="viewport">{page==='工艺规划'&&<PlanningModelTools canUndo={!!data.manualEditHistory?.length} onUndo={undoGeometryEdit} splitByFace={splitByFace} faceStations={faceStations} onSplitByFace={value=>{setSplitByFace(value);setFaceStations([]);setSplitError('');}} mode={modelEditMode} onMode={editModelMode} weld={selected} ids={mergeIds} onUndoMerge={undoMerge} onMerge={()=>{setMergeError('');setMerging(true);}} splitAt={splitAt} onSplitAt={setSplitAt} onSplit={confirmSplit} onUndoSplit={undoSplit} canUndoSplit={!!data.manualSplitHistory?.length} disabled={!modelInfo||!!geometryProgress} error={splitError}/>}<Viewer key={stepModelKey(data)+':'+modelLoadRevision} stepModel={data.stepModel} mergeIds={modelEditMode==='merge'?mergeIds:[]} editMode={modelEditMode} splitPoint={modelEditMode==='split'&&selected&&splitAt!==''?{id:selected.id,distance:Number(splitAt)}:null} planningPoints={planningPointsVisible?planningPoints:[]} selectedPlanningPointId={activePoint?.id} onPlanningPointSelect={id=>selectWeldPoint('point',id)} onCoverCaptureReady={capture=>{coverCapture.current=capture;}} onModelInfo={setModelInfo} model={data.model} selected={data.selected} welds={data.welds} progress={progress} view={view} reset={reset} camera={camera} onSelect={selectModelWeld} onSelectFace={modelEditMode==='split'&&splitByFace?selectSplitFace:undefined}/><div className="display-wrap"><button className="btn" onClick={() => setDisplay(!display)} aria-expanded={display}>视图显示 <ChevronDown size={13}/></button>{display && <div className="display-pop">{[['model', '模型'], ['welds', '焊缝'], ['labels', '标注'], ['grid', '网格'], ['transparent', '透明显示']].map(([k, l]) => <label key={k}><input type="checkbox" checked={view[k]} onChange={e => setView(v => ({ ...v, [k]: e.target.checked }))}/>{l}</label>)}</div>}</div><div className="view-tools"><button aria-label="适应视图" title="适应视图" onClick={() => setReset(r => r + 1)}><Maximize2 size={20}/></button><button aria-label="切换俯视" title="切换俯视" onClick={() => setCamera(c => c === 'top' ? 'iso' : 'top')}><Minimize2 size={20}/></button><button aria-label="透明模型" title="透明模型" className={view.transparent ? 'active' : ''} onClick={() => setView(v => ({ ...v, transparent: !v.transparent }))}><Box size={20}/></button><button aria-label="恢复默认" title="恢复默认" onClick={() => { setCamera('iso'); setReset(r => r + 1); setView({ grid: true, model: true, welds: true, labels: true, transparent: false }); }}><RotateCcw size={20}/></button></div><ViewCube onView={setCamera}/><div className="view-cameras">{[['top', '上'], ['front', '前'], ['right', '右'], ['iso', '等轴']].map(([id, l]) => <button key={id} className={camera === id ? 'active' : ''} onClick={() => setCamera(id)}>{l}</button>)}</div>{data.model && <div className="canvas-note">{selected?selected.id+' · '+selected.position+' · '+selected.length.toFixed(2)+' mm':data.model+(demoModel?' · 可一键规划':'')}</div>}{page !== '工艺规划' && data.model && <div className="player"><button disabled={!canPreview} aria-label={running ? '暂停预览' : '播放预览'} onClick={() => { if (progress === 100)
        setProgress(0); if(canPreview)setRunning(!running); }}>{running ? <Pause size={21}/> : <Play size={21}/>}</button><button aria-label="重置预览" onClick={() => { setRunning(false); setProgress(0); }}><RotateCcw size={17}/></button><input type="range" disabled={!canPreview} aria-label="路径进度" min="0" max="100" step=".1" value={progress} onChange={e => { setRunning(false); setProgress(+e.target.value); }}/><span>{progress.toFixed(0)}%</span><select aria-label="播放速度" value={speed} onChange={e => setSpeed(+e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></div>}</div><section className="logs"><header><strong>日志</strong><span /><input placeholder="搜索日志" aria-label="搜索日志" value={logSearch} onChange={e => setLogSearch(e.target.value)}/><button className="icon" aria-label="倒序日志" onClick={() => setLogs(l => [...l].reverse())}><Filter size={14}/></button><button className="icon" aria-label="清空日志" onClick={() => setLogs([])}><Trash2 size={14}/></button></header><div className="log-lines">{logs.filter(l => l.message.includes(logSearch)).map(l => <div key={l.id}><time>{l.time}</time><span>{l.message}</span></div>)}</div></section></section><aside className="inspector">{!selected ? <Empty text={data.model?"请先运行一键规划或选择已有焊道":"请先导入 STEP 模型"}/> : <WeldAttributes onChooseTemplate={()=>setDialog('templatePicker')} onChooseProcess={()=>setDialog('processPicker')} planningSelection={activeSelection} planningPoint={activePoint} planningPointBasePosition={pointBasePosition} planningPointGroup={pointGroup} onSavePoint={point=>saveWeldPoint(point,true)} onSaveLayerOrPass={saveLayerOrPass} onPlanningViewChange={setPlanningPointsVisible} onUndoMerge={undoMerge} decision={selectedDecision} weld={selected} templates={data.templates} processLibrary={data.processLibrary} onPatch={patch} onCancel={weldEditBaseline.current.has(selected.id)?cancelWeldEdit:undefined} onSave={applyWeldAttributes}/>}</aside></div> : page==='焊接模板库' ? <TemplateLibrary measureNeighborhood={measureLibraryTemplate} captureRange={data.templateCaptureRange} templates={data.templates} project={data.project} projectNames={data.templateProjects} processLibrary={data.processLibrary} onUpdate={updateTemplates} onEditingChange={setLibraryEditing} onGoPlanning={()=>go('工艺规划')} notify={notify}/> : page==='工艺参数库' ? <ProcessParameterLibrary welds={data.welds} deletedDeviceProfiles={data.deletedProcessDevices} onRestoreDevice={id=>{try{return updateTemplates(restoreDeviceLibrary(data,id));}catch(error){return error.message;}}} onEditingChange={setLibraryEditing} entries={data.processLibrary} deviceProfiles={data.processDeviceProfiles} selected={selected} editorRequest={processRequest} onEditorRequestHandled={()=>setProcessRequest(0)} onUpdate={updateTemplates} onApply={p=>{if(applyProcess(p)){go('工艺规划');}}} notify={notify}/> : page === '设备控制' ? <DeviceControl value={deviceControl} onSave={deviceControl=>{
  const error=updateTemplates({deviceControl});if(!error)notify('设备配置已保存');return error;
 }}/> : page === '生产统计' ? <ProductionStatisticsWorkspace/> : <section className="settings-page"><h2>{page === '调试工具' ? '工作区诊断' : '项目与系统'}</h2><dl className="device-info"><dt>当前项目</dt><dd>{data.project || '本地项目'}</dd><dt>数据存储</dt><dd>当前浏览器 · 本机存储</dd><dt>平台版本</dt><dd>Weldone UI Replica 1.0</dd><dt>运行模式</dt><dd>离线交互原型</dd><dt>当前模型</dt><dd>{data.model || '未加载'}</dd><dt>设备服务</dt><dd>未接入</dd></dl><div className="button-row"><Btn onClick={() => { setDraft(data.project || '本地项目'); setDialog('project'); }}>编辑项目</Btn><Btn icon={Save} onClick={save}>保存草稿</Btn><Btn icon={Download} onClick={exportDraft}>导出备份</Btn><Btn icon={FileJson} onClick={() => file.current?.click()}>导入备份</Btn>{page === '调试工具' && <Btn icon={Activity} onClick={() => notify('本地工作区可用，设备服务未接入')}>检查工作区</Btn>}</div></section>}
    </main><footer className="statusbar"><span>项目：{data.project || '本地项目'}</span><span className="status-dot"/><span>设备未连接</span><span className="status-spacer"/><span>{execution === '待就绪' ? '本地示例模式' : execution}</span><span>{saved}</span></footer><input hidden type="file" accept=".pf" aria-label="PF 文件" ref={taskFile} onChange={importTask}/><input hidden type="file" accept=".step,.stp" aria-label="STEP 文件" ref={stepFile} onChange={importStep}/><input hidden type="file" accept=".json,application/json" ref={file} onChange={importDraft}/>{toast && <div className="toast" role="status"><CircleCheck size={18}/>{toast}</div>}
    {merging&&<WeldMergeDialog settings={context} welds={data.welds} ids={mergeIds} onClose={()=>setMerging(false)} onMerge={mergeSelection} error={mergeError}/>}
    {deleteWeldIds.length>0&&<Dialog title="删除所选焊缝" onClose={()=>setDeleteWeldIds([])}><div className="dialog-body"><p>确定删除所选的 {deleteWeldIds.length} 条焊缝？</p><p className="delete-weld-list">{deleteWeldIds.join('、')}</p></div><footer><Btn onClick={()=>setDeleteWeldIds([])}>取消</Btn><Btn primary onClick={deleteSelectedWelds}>确认删除</Btn></footer></Dialog>}
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
    {selected&&dialog==='templatePicker'&&<Dialog title="焊接模板库" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="template" weld={selected} templates={data.templates} project={data.project} projectNames={data.templateProjects} onCancel={()=>setDialog(null)} onConfirm={template=>{applyTemplate(template);setDialog(null);}}/></Dialog>}
    {selected&&dialog==='processPicker'&&<Dialog title="工艺参数库" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="process" weld={selected} processLibrary={activeProcesses} onCancel={()=>setDialog(null)} onConfirm={value=>{if(applyProcess(value,{throwOnError:true}))setDialog(null);}}/></Dialog>}
    {dialog === 'settings' && <Dialog title="工艺规划设置" onClose={() => setDialog(null)}><PlanningSettings key={data.project} capabilities={context.deviceCapabilities} settings={data.planningSettings} onCancel={()=>setDialog(null)} onSave={settings=>{const error=updateTemplates({planningSettings:settings});if(!error)setDialog(null);return error;}}/></Dialog>}
    {dialog === 'about' && <Dialog title="关于原版工艺规划平台" onClose={() => setDialog(null)}><div className="dialog-body"><h2>原版工艺规划平台</h2><p>参照本机安装版 Weldone 1.0.4 的导航、三栏工作区、橙色主题与日志布局实现。</p><p>示例使用 111.step 的实际几何，支持焊道提取、模板应用与本地草稿保存。支持几何提取、打断和合并规则；设备通信尚未接入。</p></div><footer><Btn primary onClick={() => setDialog(null)}>知道了</Btn></footer></Dialog>}
    {dialog === 'project' && <Dialog title="编辑项目" onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); if (!draft.trim()) return; change(d => ({ ...d, project:draft.trim() })); setDialog(null); notify('已更新，请保存草稿保留'); }}><div className="dialog-body"><label className="form-label">项目名称<input autoFocus required maxLength="80" value={draft} onChange={e => setDraft(e.target.value)}/></label></div><footer><Btn type="button" onClick={() => setDialog(null)}>取消</Btn><Btn primary type="submit">保存</Btn></footer></form></Dialog>}
    {templateDraft&&<TemplateEditor initial={templateDraft.template} neighborhoodEvidence={templateDraft.evidence} neighborhoodSource={templateDraft.source} measureNeighborhood={context.measureTemplateNeighborhood} isNew processLibrary={data.processLibrary} onClose={()=>setTemplateDraft(null)} onSave={saveNewTemplate}/>}
    {templateDuplicate&&<Dialog title="重复焊接模板" onClose={()=>setTemplateDuplicate(null)}>
      <div className="tpl-confirm-body"><p>已存在焊缝几何条件相同的模板。继续创建时，请选择默认匹配的模板。</p><select aria-label="同几何默认模板" value={templateDuplicate.defaultId} onChange={event=>setTemplateDuplicate({...templateDuplicate,defaultId:event.target.value})}>{[...templateDuplicate.duplicates,templateDuplicate.value].map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></div>
      <footer><Btn onClick={()=>setTemplateDuplicate(null)}>取消</Btn><Btn primary onClick={()=>{try{const issue=commitNewTemplate(templateDuplicate.value,templateDuplicate.defaultId);if(issue)notify(issue);}catch(error){notify(error.message);}}}>继续创建</Btn></footer>
    </Dialog>}
    </div>;
}
