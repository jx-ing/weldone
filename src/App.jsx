import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Settings, Plus, ChevronDown, Upload, Download, X, Box, Search, Trash2, Play, Pause, RotateCcw, CircleHelp, FolderOpen, Save, SlidersHorizontal, Maximize2, Minimize2, Filter, Copy, Activity, Cpu, FileJson, Cable, CircleCheck, AlertCircle } from 'lucide-react';
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
import {DEFAULT_GEOMETRY_OPTIONS,installGeometryResult,restoreGeometryResult,validExtractedWeld} from './geometryProcessingModel.mjs';
import './geometryProcessing.css';
import {EXAMPLE_MODEL,useStepExample,validManualWeldPath} from './manualWeldModel.mjs';
import ViewCube from './ViewCube';
import WeldAttributes from './WeldAttributes';
import {weldPlanningPointGroups} from './weldPlanningPoints.mjs';
import {analyzeWeldMatch,planWorkspace,canPreviewWeld,restorePlanningState,planWeldFromMatch} from './weldMatching.mjs';
import ProcessParameterLibrary from './ProcessParameterLibrary';
import {deviceLibraryUpdates,restoreDeviceLibrary,clearRemovedProcess} from './processDeviceLibraries.mjs';
import {validDeviceProfileStore} from './processDeviceModel.mjs';
import {validateProcessEntry,applyProcessEntry,validWeldProcessParameters} from './processParameterModel.mjs';
import { migrateDraft, validateTemplate, validateFixed } from './templateModel.mjs';
const modules = ['工艺规划', '工艺参数库'];
const defaults = migrateDraft({ model: EXAMPLE_MODEL, welds: [], selected: '', project: '本地项目', templates: [{ id: 'TPL-001', name: '碳钢横角焊 · 6 mm', position: 'PB · 横角焊', leg: 6, current: 210, voltage: 24.5, speed: 340 }, { id: 'TPL-002', name: '薄板角焊 · 5 mm', position: 'PB · 横角焊', leg: 5, current: 180, voltage: 23, speed: 360 }, { id: 'TPL-003', name: '立向上焊 · 5 mm', position: 'PF · 立向上焊', leg: 5, current: 160, voltage: 22, speed: 220 }] });
function valid(v) { try { const d = migrateDraft(v); return typeof d.model === 'string' && typeof d.project === 'string' && (d.templateProjects===undefined||Array.isArray(d.templateProjects)&&d.templateProjects.length<1000&&new Set(d.templateProjects).size===d.templateProjects.length&&d.templateProjects.every(p=>typeof p==='string'&&p.trim()===p&&p.length>0&&p.length<=80)) && typeof d.selected === 'string' && Array.isArray(d.welds) && d.welds.length <= MAX_PLANNING_WELDS && new Set(d.welds.map(w => w.id)).size === d.welds.length && d.welds.every(w => /^W[0-9]{3,6}$/.test(w.id) && typeof w.name === 'string' && typeof w.position === 'string' && typeof w.template === 'string' && typeof w.enabled === 'boolean' && validManualWeldPath(w) && validExtractedWeld(w) && (d.model!==EXAMPLE_MODEL||['manual','extracted','manual-merge'].includes(w.source)) && Number.isFinite(w.length)&&w.length>0 && ['leg','speed'].every(k=>(['extracted','manual-merge'].includes(w.source)||w.splitFrom||w.source==='manual'&&w.current===null&&w.voltage===null)&&w[k]===null||Number.isFinite(w[k])&&(k==='speed'&&w.processParameters?.recipeRevision===3?w[k]>=0:w[k]>0)) && validWeldProcessParameters(w)) && d.templates.length < 1000 && new Set(d.templates.map(t => t.id)).size === d.templates.length && d.templates.every(t => !validateTemplate(t).filter(e=>!e.includes('请选择有效基准点')).length) && Array.isArray(d.fixedTemplates) && d.fixedTemplates.length < 1000 && new Set(d.fixedTemplates.map(t => t.id)).size === d.fixedTemplates.length && d.fixedTemplates.every(t => !validateFixed(t).filter(e=>!e.includes('请选择有效基准点')).length) && validDeviceProfileStore(d.processDeviceProfiles) && Array.isArray(d.processLibrary) && d.processLibrary.length < 1000 && new Set(d.processLibrary.map(p=>p.id)).size===d.processLibrary.length && d.processLibrary.every(p=>!validateProcessEntry(p,{allowLegacyLeg:true}).length); } catch { return false; } }
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
    const [data, setData] = useState(read), [page, setPage] = useState('工艺规划'), [leftTab, setLeftTab] = useState('结构树'), [search, setSearch] = useState(''), [logSearch, setLogSearch] = useState(''), [logs, setLogs] = useState([]), [dialog, setDialog] = useState(null), [toast, setToast] = useState(''), [running, setRunning] = useState(false), [progress, setProgress] = useState(0), [display, setDisplay] = useState(false), [view, setView] = useState({ grid: true, model: true, welds: true, labels: true, transparent: false }), [reset, setReset] = useState(0), [camera, setCamera] = useState('iso'), [collapsed, setCollapsed] = useState(false), [speed, setSpeed] = useState(1), [execution, setExecution] = useState('待就绪'), [busy, setBusy] = useState(false), [saved, setSaved] = useState('本地工作区'), [draft, setDraft] = useState(''), [device, setDevice] = useState('WeldRobot1'), [processRequest,setProcessRequest]=useState(0), [libraryEditing,setLibraryEditing]=useState(false), [modelInfo,setModelInfo]=useState(null), [deleteWeldId,setDeleteWeldId]=useState(null);
    const appRef=useRef(),pickedSplit=useRef(null),weldEditBaseline=useRef(new Map());
    const [planningPointsVisible,setPlanningPointsVisible]=useState(false),[selectedPlanningPointId,setSelectedPlanningPointId]=useState('');
    useEffect(()=>{if(page!=='工艺参数库')return;const root=appRef.current,size=()=>{const scale=Math.max(.64,Math.min(1,window.innerWidth/1920));root.style.setProperty('--ps',scale+'px');root.style.setProperty('--process-zoom',scale);};size();window.addEventListener('resize',size);return()=>{window.removeEventListener('resize',size);root.style.removeProperty('--ps');root.style.removeProperty('--process-zoom');};},[page]);
    const file = useRef(), toastTimer = useRef(), geometryWorker=useRef(), dataRef=useRef(data); dataRef.current=data;
    const [geometryProgress,setGeometryProgress]=useState(null),[mergeIds,setMergeIds]=useState([]),[merging,setMerging]=useState(false),[mergeError,setMergeError]=useState('');
    const [modelEditMode,setModelEditMode]=useState(''),[splitAt,setSplitAt]=useState(''),[splitError,setSplitError]=useState(''),[splitByFace,setSplitByFace]=useState(false),[faceStations,setFaceStations]=useState([]);
    const selected = data.welds.find(w => w.id === data.selected), enabled = data.welds.filter(w => w.enabled), total = Math.round(enabled.reduce((s, w) => s + w.length, 0)*100)/100;
    const context=useMemo(()=>planningContext(data),[data.planningSettings,data.processDeviceProfiles,data.deviceCapabilities]);
    const activeProcesses=useMemo(()=>data.processLibrary.filter(process=>belongsToDevice(process,context.activeDevice)),[data.processLibrary,context]);
    const selectedDecision=useMemo(()=>selected?analyzeWeldMatch(selected,data.templates,activeProcesses,context):null,[selected,data.templates,activeProcesses,context]);
    const weldMatchRoutes=useMemo(()=>{
      const options={...context,includeMatchDiagnostics:false};
      return new Map(data.welds.map(weld=>[weld.id,analyzeWeldMatch(weld,data.templates,activeProcesses,options).route]));
    },[data.welds,data.templates,activeProcesses,context]);
    const planningPointGroups=useMemo(()=>weldPlanningPointGroups(selected,selectedDecision,data.templates,data.processLibrary,data.planningSettings),[selected,selectedDecision,data.templates,data.processLibrary,data.planningSettings]);
    const planningPoints=useMemo(()=>planningPointGroups.flatMap(group=>group.points),[planningPointGroups]);
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
    useEffect(() => () => {clearTimeout(toastTimer.current);geometryWorker.current?.terminate();}, []);
    function persistGeometry(next){setData(next);try{localStorage.setItem('weldone.replica.draft.v1',JSON.stringify(next));setSaved('已保存至本机');return true;}catch{setSaved('有未保存修改');notify('处理已完成，本机存储空间不足，请导出草稿');return false;}}
    function processGeometry(planAfter=false){
      let options;
      try{options=geometryOptionsForPlanning(DEFAULT_GEOMETRY_OPTIONS,context);}catch(error){notify(error.message);return;}
      if(geometryWorker.current||data.model!==EXAMPLE_MODEL)return;
      setRunning(false);setProgress(0);setGeometryProgress({stage:'准备提取和处理焊道',percent:0});
      const worker=new Worker(new URL('./geometryProcessing.worker.js',import.meta.url),{type:'module'});geometryWorker.current=worker;
      const finish=()=>{worker.terminate();geometryWorker.current=null;setGeometryProgress(null);};
      worker.onmessage=({data:message})=>{if(message.type==='progress'){setGeometryProgress(message.progress);return;}if(message.type==='error'){finish();log(message.message);notify(message.message);return;}if(message.type==='result'){try{if(dataRef.current.model!==EXAMPLE_MODEL)throw Error('模型已切换，请重新运行处理');const next=installGeometryResult(dataRef.current,message.result);if(!valid(next))throw Error('几何处理结果未通过工作区校验');if(planAfter===true){executePlan(next);setView(v=>({...v,welds:true}));return;}const stored=persistGeometry(next);setView(v=>({...v,welds:true}));setReset(r=>r+1);log(`111.step：${message.result.summary.cadCandidateCount} 条几何候选，打断筛选后 ${message.result.summary.survivingUnitCount} 个保留段，${message.result.summary.mergedGroupCount} 组合并，生成 ${next.welds.filter(w=>w.source==='extracted'&&!w.mergedInto).length} 条焊道，已排除 ${next.geometryProcessing.summary.confirmedNonWeldCount||0} 条确认非焊缝结果。`);if(stored)notify(`${next.geometryProcessing.summary.processedWeldCount} 条处理焊道已生成并保存，人工焊道已保留`);}catch(e){notify(e.message);}finally{finish();}}};
      worker.onerror=()=>{finish();notify('几何处理失败，请重试；原工作区已保留');};worker.postMessage({options});
    }
    function mergeSelection(){try{const next=mergeSelectedWelds(dataRef.current,mergeIds,context);if(!valid(next))throw Error('合并后的路径未通过校验');persistGeometry(replanEditedGeometry(next));setMergeIds([]);setMerging(false);log(`${mergeIds.length} 条焊道已合并为 ${next.selected}，原焊道已保留并屏蔽。`);}catch(e){setMergeError(e.message);}}
    function undoMerge(){try{const next=undoManualMerge(dataRef.current,dataRef.current.selected);persistGeometry(next);notify('已恢复合并前的焊道');}catch(e){notify(e.message);}}
    function undoGeometry(){const next=restoreGeometryResult(dataRef.current);if(persistGeometry(next))notify('已撤销本次几何处理并保存');log('已撤销本次焊道几何处理。');}
    function patch(key, value) { const current=dataRef.current.welds.find(w=>w.id===dataRef.current.selected);if(current&&!weldEditBaseline.current.has(current.id))weldEditBaseline.current.set(current.id,structuredClone(current));setRunning(false); change(d => ({ ...d, welds: d.welds.map(w => w.id === d.selected ? { ...w, [key]: value, ...(key==='segments'?{position:value.every(s=>s.position===value[0].position)?value[0].position:'混合位置（逐段设置）'}:{}), ...((w.segments?.length===1||['extracted','manual-merge'].includes(w.source)&&key==='position')&&['position','length'].includes(key)?{segments:w.segments.map(s=>({...s,[key]:value}))}:{}), planned: key==='planningPointOverrides'?w.planned:false } : w) })); }
    function load() { change(d => d.model===EXAMPLE_MODEL?d:{...useStepExample({...d,model:'',welds:[],selected:''}),model:EXAMPLE_MODEL}); setProgress(0);setDialog(null);log('已加载 111.step，可提取并处理焊道。');notify('模型已加载，可提取焊道'); }
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
    async function importDraft(e) { const f = e.target.files?.[0]; e.target.value = ''; if (!f)
        return; try {
        if (f.size > 5 * 1024 * 1024)
            throw Error('文件超过 5MB');
        const v = JSON.parse(await f.text());
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
    function executePlan(workspace){
      if(!workspace.welds.length){notify('焊道数量为0，提取焊道失败');return;}
      const options=planningContext(workspace);
      const welds=planWorkspace(workspace.welds,workspace.templates,workspace.processLibrary,options);
      const ready=welds.filter(weld=>weld.enabled&&weld.planned).length;
      const blocked=welds.filter(weld=>weld.enabled&&!weld.planned).length;
      const selected=welds.some(weld=>weld.id===workspace.selected)?workspace.selected:
        (welds.find(weld=>weld.enabled&&!weld.planned)??welds.find(weld=>weld.enabled)??welds[0])?.id??'';
      persistGeometry({...workspace,welds,selected});
      log(`规划完成：${ready} 条生成路径，${blocked} 条待处理。`);
      notify(blocked?`${blocked} 条焊缝待处理，请选中焊缝查看属性`:`${ready} 条焊缝已生成路径`);
    }
    function plan(){
      if(weldEditBaseline.current.size){notify('请先应用或取消焊缝属性修改');return;}
      if(data.model===EXAMPLE_MODEL){processGeometry(true);return;}
      setRunning(false);setProgress(0);setBusy(true);
      try{executePlan(data);}catch(error){notify(error.message);}finally{setBusy(false);}
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
    function showTemplateUnavailable(){notify('暂不支持');}
    function disableWeld(id){setRunning(false);setProgress(0);change(d=>({...d,welds:d.welds.map(w=>w.id===id?{...w,enabled:false,planned:false}:w)}));notify(id+' 已屏蔽，不参与规划');}
    function deleteWeld(){const id=deleteWeldId;setRunning(false);setProgress(0);change(d=>{const welds=d.welds.filter(w=>w.id!==id);return {...d,welds,selected:d.selected===id?welds[0]?.id||'':d.selected};});setDeleteWeldId(null);notify(id+' 已删除，请保存草稿');}
    function updateTemplates(input) { const values=deviceLibraryUpdates(data,input);const removed=new Set(values.processLibrary?data.processLibrary.filter(process=>!values.processLibrary.some(next=>next.id===process.id)).map(process=>process.id):[]);const disabled=new Set((values.templates||[]).filter(t=>t.enabled===false&&data.templates.find(v=>v.id===t.id)?.enabled!==false).map(t=>t.id));const next={...updateProjectPlanning(data,values),...(disabled.size?{welds:data.welds.map(w=>disabled.has(w.templateId)||disabled.has(w.localTemplateId)||(w.localApplications||[]).some(a=>disabled.has(a.templateId))?{...w,planned:false}:w)}:{})}; if(removed.size)next.welds=next.welds.map(weld=>clearRemovedProcess(weld,removed));try { localStorage.setItem('weldone.replica.draft.v1', JSON.stringify(next)); setData(next); setSaved('已保存至本机'); return ''; } catch { return '本机保存失败，请检查浏览器存储空间后重试'; } }
    function applyProcess(p,{throwOnError=false}={}) { if(!selected)return false;try{const updated=applyProcessEntry(selected,p);change(d=>({...d,welds:d.welds.map(w=>w.id===d.selected?updated:w)}));log(`${selected.id} 已应用工艺参数 ${p.name}`);notify('工艺参数已应用，请保存规划草稿');return true;}catch(e){if(throwOnError)throw e;notify(e.message);return false;} }
    const go = p => { if(!modules.includes(p))return;if(page==='工艺规划'&&p!==page)setModelInfo(null);setPage(p); setDisplay(false); setDialog(null); };
    return <div ref={appRef} className={'app'+(page==='工艺参数库'?' process-library-view'+(libraryEditing?' process-detail-mode':''):'')}><header className="titlebar"><img src="/assets/favicon.ico" alt=""/><span>Weldone</span><div className="title-actions"><span>原版工艺规划平台</span><button aria-label="帮助" onClick={() => setDialog('about')}><CircleHelp size={15}/></button></div></header><nav className="main-nav" aria-label="主导航"><button aria-label="收起结构树" className="nav-menu" onClick={() => setCollapsed(!collapsed)}><Menu size={17}/></button>{modules.map(m => <button key={m} className={page === m ? 'selected' : ''} onClick={() => {if(m===page)return;if(page!=='工艺参数库'){go(m);return;}const proceed=()=>go(m),event=new CustomEvent('process-library-navigate',{cancelable:true,detail:{navigate:proceed}});if(window.dispatchEvent(event))proceed();}}>{m === '系统管理' && <SlidersHorizontal size={14}/>} {m}</button>)}<button className="nav-help" aria-label="平台说明" onClick={() => setDialog('about')}><CircleHelp size={17}/></button></nav><main>{!libraryEditing&&<section className="page-bar"><h1>{page}</h1>{page === '生产执行' && <span className="tag">模型驱动 · 示例模式</span>}<div className="bar-actions"><button className="icon" aria-label={page==='工艺参数库'?'设备信息配置':'工艺规划设置'} onClick={() => page==='工艺参数库'?window.dispatchEvent(new Event('process-device-settings')):setDialog('settings')}>{page==='工艺参数库'?<img src="/assets/process-library/settings.svg" alt=""/>:<Settings size={17}/>}</button>{['工艺规划', '路径仿真'].includes(page) ? <>{page==='工艺规划'&&<Btn primary icon={Plus} aria-label="以选中焊缝创建模板" onClick={showTemplateUnavailable}>创建焊缝模板</Btn>}<Btn primary onClick={() => setDialog('import')}>导入模型</Btn>{page==='工艺规划'&&<Btn primary disabled={data.model!==EXAMPLE_MODEL||!!geometryProgress} onClick={()=>processGeometry()}>{geometryProgress?'处理中…':'提取焊道'}</Btn>}<Btn disabled={!data.model || busy||!!geometryProgress} onClick={plan}>{busy ? '规划中…' : '一键规划'}</Btn><Btn disabled={!data.model} onClick={exportDraft}>导出草稿</Btn></> : page === '生产执行' ? <><Btn icon={RotateCcw} onClick={() => { setExecution('示例就绪'); log('示例工作区已就绪，未连接实机。'); }}>初始化</Btn><Btn onClick={() => { setRunning(false); setExecution('已停止'); }}>终止</Btn><Btn primary disabled={!canPreview} icon={Play} onClick={() => { if (progress === 100)
        setProgress(0); if(canPreview){setRunning(!running); setExecution('示例预览');} }}>执行预览</Btn></> : page==='工艺参数库' ? !libraryEditing&&<Btn primary onClick={()=>setProcessRequest(n=>n+1)}><img src="/assets/process-library/plus.svg" alt=""/>新建工艺参数</Btn> : <Btn icon={Save} onClick={save}>保存草稿</Btn>}</div></section>}
    {['工艺规划', '路径仿真', '生产执行'].includes(page) ? <div className={'workspace ' + (collapsed ? 'collapsed' : '')}><aside className="structure"><div className="panel-tabs">{(page === '生产执行' ? ['任务列表', '加工列表'] : ['结构树', '零件管理']).map(t => <button key={t} className={leftTab === t ? 'active' : ''} onClick={() => setLeftTab(t)}>{t}</button>)}<button className="mini-primary" onClick={() => setDialog('import')}><Plus size={14}/><span>导入模型</span></button></div>{!data.model ? <Empty model text={page === '生产执行' ? '暂无排单' : '请导入模型'}/> : <><div className="tree-search"><Search size={14}/><input aria-label="搜索焊缝" placeholder="搜索名称 / 编号" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="tree-root"><ChevronDown size={14}/><FolderOpen size={15}/><strong>{data.model}</strong><span className="sample-label">{data.geometryProcessing?'几何提取':data.welds.length?'已有焊道':'待提取'}</span></div>{leftTab === '零件管理' ? <div className="parts-list">{(modelInfo?.parts||[]).map((p, i) => <div key={p}><Box size={15}/><span>{p}</span><small>P00{i + 1}</small></div>)}</div> : <><div className="tree-section"><ChevronDown size={13}/>焊缝 <small>({data.welds.length})</small></div>{page==='工艺规划'&&<div className="weld-multi-tools"><label><input type="checkbox" aria-label="全选可见焊道" checked={data.welds.filter(w=>w.enabled&&!w.mergedInto&&!w.splitInto&&(w.id+w.name).toLowerCase().includes(search.toLowerCase())).length>0&&data.welds.filter(w=>w.enabled&&!w.mergedInto&&!w.splitInto&&(w.id+w.name).toLowerCase().includes(search.toLowerCase())).every(w=>mergeIds.includes(w.id))} onChange={e=>setMergeIds(e.target.checked?data.welds.filter(w=>w.enabled&&!w.mergedInto&&!w.splitInto&&(w.id+w.name).toLowerCase().includes(search.toLowerCase())).map(w=>w.id):[])}/>多选 {mergeIds.length}</label><button type="button" disabled={mergeIds.length<2||!!geometryProgress} onClick={()=>{setMergeError('');setMerging(true);}}>合并所选</button>{mergeIds.length>0&&<button type="button" onClick={()=>setMergeIds([])}>清空</button>}</div>}<div className="weld-list">{data.welds.filter(w => (w.id + w.name).toLowerCase().includes(search.toLowerCase())).map(w => {const route=weldMatchRoutes.get(w.id),matched=route==='whole'||route==='automatic'||route==='local';return <div key={w.id} className={'weld-row ' + (w.id === data.selected ? 'selected' : '')}>{page==='工艺规划'&&<input type="checkbox" className="merge-checkbox" aria-label={`选择焊道 ${w.id}`} disabled={!w.enabled||!!w.mergedInto||!!w.splitInto} checked={mergeIds.includes(w.id)} onChange={e=>setMergeIds(ids=>e.target.checked?[...ids,w.id]:ids.filter(id=>id!==w.id))}/>}<input type="checkbox" aria-label={`启用 ${w.id}`} disabled={!!w.mergedInto||!!w.splitInto} checked={w.enabled} onChange={e => change(d => ({ ...d, welds: d.welds.map(x => x.id === w.id ? { ...x, enabled: e.target.checked } : x) }))}/><button onClick={() => setData(d => ({ ...d, selected: w.id }))}><Cable size={14}/><span>{w.id}<small>{w.name}</small></span><span className={'status-dot ' + (matched?'green':route==='blocked'?'wa-pending-dot':'')} title={matched?'已匹配':route==='blocked'?'未匹配':undefined}/></button></div>;})}{!data.welds.some(w => (w.id + w.name).toLowerCase().includes(search.toLowerCase())) && <p className="no-match">{data.welds.length?'没有匹配的焊道':'尚未生成焊道，请提取焊道'}</p>}</div></>}<footer className="tree-footer">已启用 {enabled.length} / {data.welds.length} 条<span>{total} mm</span></footer></>}</aside><section className="center"><div className="model-title"><strong>模型视图</strong>{data.model && <span>{data.model}<span className="sample-label">{modelInfo?.parts.length||0} 个零件</span></span>}</div><div className="viewport">{page==='工艺规划'&&<PlanningModelTools canUndo={!!data.manualEditHistory?.length} onUndo={undoGeometryEdit} splitByFace={splitByFace} faceStations={faceStations} onSplitByFace={value=>{setSplitByFace(value);setFaceStations([]);setSplitError('');}} mode={modelEditMode} onMode={editModelMode} weld={selected} ids={mergeIds} onUndoMerge={undoMerge} onMerge={()=>{setMergeError('');setMerging(true);}} splitAt={splitAt} onSplitAt={setSplitAt} onSplit={confirmSplit} onUndoSplit={undoSplit} canUndoSplit={!!data.manualSplitHistory?.length} disabled={!modelInfo||!!geometryProgress} error={splitError}/>}<Viewer mergeIds={modelEditMode==='merge'?mergeIds:[]} editMode={modelEditMode} splitPoint={modelEditMode==='split'&&selected&&splitAt!==''?{id:selected.id,distance:Number(splitAt)}:null} planningPoints={planningPointsVisible?planningPoints:[]} selectedPlanningPointId={selectedPlanningPointId} onPlanningPointSelect={setSelectedPlanningPointId} onModelInfo={setModelInfo} model={data.model} selected={data.selected} welds={data.welds} progress={progress} view={view} reset={reset} camera={camera} onSelect={selectModelWeld} onSelectFace={modelEditMode==='split'&&splitByFace?selectSplitFace:undefined}/><div className="display-wrap"><button className="btn" onClick={() => setDisplay(!display)} aria-expanded={display}>视图显示 <ChevronDown size={13}/></button>{display && <div className="display-pop">{[['model', '模型'], ['welds', '焊缝'], ['labels', '标注'], ['grid', '网格'], ['transparent', '透明显示']].map(([k, l]) => <label key={k}><input type="checkbox" checked={view[k]} onChange={e => setView(v => ({ ...v, [k]: e.target.checked }))}/>{l}</label>)}</div>}</div><div className="view-tools"><button aria-label="适应视图" title="适应视图" onClick={() => setReset(r => r + 1)}><Maximize2 size={20}/></button><button aria-label="切换俯视" title="切换俯视" onClick={() => setCamera(c => c === 'top' ? 'iso' : 'top')}><Minimize2 size={20}/></button><button aria-label="透明模型" title="透明模型" className={view.transparent ? 'active' : ''} onClick={() => setView(v => ({ ...v, transparent: !v.transparent }))}><Box size={20}/></button><button aria-label="恢复默认" title="恢复默认" onClick={() => { setCamera('iso'); setReset(r => r + 1); setView({ grid: true, model: true, welds: true, labels: true, transparent: false }); }}><RotateCcw size={20}/></button></div><ViewCube onView={setCamera}/><div className="view-cameras">{[['top', '上'], ['front', '前'], ['right', '右'], ['iso', '等轴']].map(([id, l]) => <button key={id} className={camera === id ? 'active' : ''} onClick={() => setCamera(id)}>{l}</button>)}</div>{data.model && <div className="canvas-note">{selected?selected.id+' · '+selected.position+' · '+selected.length.toFixed(2)+' mm':'111.step · 可提取焊道'}</div>}{page !== '工艺规划' && data.model && <div className="player"><button disabled={!canPreview} aria-label={running ? '暂停预览' : '播放预览'} onClick={() => { if (progress === 100)
        setProgress(0); if(canPreview)setRunning(!running); }}>{running ? <Pause size={21}/> : <Play size={21}/>}</button><button aria-label="重置预览" onClick={() => { setRunning(false); setProgress(0); }}><RotateCcw size={17}/></button><input type="range" disabled={!canPreview} aria-label="路径进度" min="0" max="100" step=".1" value={progress} onChange={e => { setRunning(false); setProgress(+e.target.value); }}/><span>{progress.toFixed(0)}%</span><select aria-label="播放速度" value={speed} onChange={e => setSpeed(+e.target.value)}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></div>}</div><section className="logs"><header><strong>日志</strong><span /><input placeholder="搜索日志" aria-label="搜索日志" value={logSearch} onChange={e => setLogSearch(e.target.value)}/><button className="icon" aria-label="倒序日志" onClick={() => setLogs(l => [...l].reverse())}><Filter size={14}/></button><button className="icon" aria-label="清空日志" onClick={() => setLogs([])}><Trash2 size={14}/></button></header><div className="log-lines">{logs.filter(l => l.message.includes(logSearch)).map(l => <div key={l.id}><time>{l.time}</time><span>{l.message}</span></div>)}</div></section></section><aside className="inspector">{!selected ? <Empty text="请先提取焊道或选择已有焊道"/> : <WeldAttributes onChooseTemplate={showTemplateUnavailable} onChooseProcess={()=>setDialog('processPicker')} planningPointGroups={planningPointGroups} selectedPlanningPointId={selectedPlanningPointId} onPlanningPointSelect={setSelectedPlanningPointId} onPlanningViewChange={setPlanningPointsVisible} onUndoMerge={undoMerge} decision={selectedDecision} onDisable={()=>disableWeld(selected.id)} onDelete={()=>setDeleteWeldId(selected.id)} weld={selected} templates={data.templates} processLibrary={data.processLibrary} onPatch={patch} onCancel={weldEditBaseline.current.has(selected.id)?cancelWeldEdit:undefined} onSave={applyWeldAttributes}/>}</aside></div> : page==='工艺参数库' ? <ProcessParameterLibrary welds={data.welds} deletedDeviceProfiles={data.deletedProcessDevices} onRestoreDevice={id=>{try{return updateTemplates(restoreDeviceLibrary(data,id));}catch(error){return error.message;}}} onEditingChange={setLibraryEditing} entries={data.processLibrary} deviceProfiles={data.processDeviceProfiles} selected={selected} editorRequest={processRequest} onEditorRequestHandled={()=>setProcessRequest(0)} onUpdate={updateTemplates} onApply={p=>{if(applyProcess(p)){go('工艺规划');}}} notify={notify}/> : page === '设备控制' ? <section className="devices"><aside><h3>设备列表</h3>{['WeldRobot1', 'WeldRobot2', '海康粗定位', '结构光相机', '英莱线激光相机A', '英莱线激光相机B'].map((d, i) => <button key={d} className={device === d ? 'active' : ''} onClick={() => setDevice(d)}><Cpu size={19}/><span>{d}<small>{i < 2 ? '焊接机器人' : '视觉设备'}</small></span><span className="status-dot"/></button>)}</aside><section><h2>{device}</h2><span className="tag">未连接</span><h3>设备信息</h3><dl className="device-info"><dt>连接状态</dt><dd>未配置通信服务</dd><dt>设备名称</dt><dd>{device}</dd><dt>运行模式</dt><dd>本地界面演示</dd><dt>控制权限</dt><dd>仅界面浏览</dd></dl><div className="notice"><AlertCircle size={17}/>接入设备通信服务后，可在此查看运行信息。</div></section></section> : page === '产能统计' ? <section className="statistics"><div className="stats-top"><h2>工作区统计</h2><span className="tag">当前本地草稿 · 非生产报表</span></div><div className="stats-cards">{[['当前工件', data.model ? 1 : 0, '个'], ['焊缝数量', data.welds.length, '条'], ['启用焊缝长度', (total / 1000).toFixed(2), 'm'], ['已规划焊缝', data.welds.filter(w => w.planned).length, '条']].map(([n, v, u]) => <article key={n}><span>{n}</span><strong>{v}<small>{u}</small></strong></article>)}</div><div className="stats-table"><h3>焊缝规划明细</h3><table><thead><tr>{['焊缝编号', '焊缝名称', '长度 / mm', '焊脚 / mm', '状态'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.welds.map(w => <tr key={w.id}><td>{w.id}</td><td>{w.name}</td><td>{w.length}</td><td>{w.leg}</td><td><span className={w.planned ? 'tag success' : 'tag'}>{w.planned ? '已规划' : '待规划'}</span></td></tr>)}</tbody></table>{!data.welds.length && <Empty />}</div></section> : <section className="settings-page"><h2>{page === '调试工具' ? '工作区诊断' : '项目与系统'}</h2><dl className="device-info"><dt>当前项目</dt><dd>{data.project || '本地项目'}</dd><dt>数据存储</dt><dd>当前浏览器 · 本机存储</dd><dt>平台版本</dt><dd>Weldone UI Replica 1.0</dd><dt>运行模式</dt><dd>离线交互原型</dd><dt>当前模型</dt><dd>{data.model || '未加载'}</dd><dt>设备服务</dt><dd>未接入</dd></dl><div className="button-row"><Btn onClick={() => { setDraft(data.project || '本地项目'); setDialog('project'); }}>编辑项目</Btn><Btn icon={Save} onClick={save}>保存草稿</Btn><Btn icon={Download} onClick={exportDraft}>导出备份</Btn><Btn icon={FileJson} onClick={() => file.current?.click()}>导入备份</Btn>{page === '调试工具' && <Btn icon={Activity} onClick={() => notify('本地工作区可用，设备服务未接入')}>检查工作区</Btn>}</div></section>}
    </main><footer className="statusbar"><span>项目：{data.project || '本地项目'}</span><span className="status-dot"/><span>设备未连接</span><span className="status-spacer"/><span>{execution === '待就绪' ? '本地示例模式' : execution}</span><span>{saved}</span></footer><input hidden type="file" accept=".json,application/json" ref={file} onChange={importDraft}/>{toast && <div className="toast" role="status"><CircleCheck size={18}/>{toast}</div>}
    {merging&&<WeldMergeDialog settings={context} welds={data.welds} ids={mergeIds} onClose={()=>setMerging(false)} onMerge={mergeSelection} error={mergeError}/>}
    {deleteWeldId&&<Dialog title={`删除焊道 ${deleteWeldId}`} onClose={()=>setDeleteWeldId(null)}><div className="dialog-body"><p>确定删除此焊道及已应用的方案？也可以取消后选择屏蔽，保留焊道。</p></div><footer><Btn onClick={()=>setDeleteWeldId(null)}>取消</Btn><Btn primary onClick={deleteWeld}>确认删除焊道</Btn></footer></Dialog>}
    {dialog === 'import' && <Dialog title="导入模型" onClose={() => setDialog(null)}><div className="dialog-body"><div className="import-zone"><Box size={38}/><h3>111.step 示例模型</h3><p>33 个零件 · 真实几何</p><Btn primary onClick={load}>加载示例模型</Btn></div><p className="muted">加载后可按工艺规划平台规则提取焊道，并进行手动合并或打断。也可导入本平台保存的 JSON 规划草稿。</p><Btn icon={FileJson} onClick={() => file.current?.click()}>导入已有规划草稿</Btn></div><footer><Btn onClick={() => setDialog(null)}>取消</Btn></footer></Dialog>}
    {selected&&dialog==='processPicker'&&<Dialog title="工艺参数库" onClose={()=>setDialog(null)}><PlanningLibraryPicker key={selected.id} kind="process" weld={selected} processLibrary={activeProcesses} onCancel={()=>setDialog(null)} onConfirm={value=>{if(applyProcess(value,{throwOnError:true}))setDialog(null);}}/></Dialog>}
    {dialog === 'settings' && <Dialog title="工艺规划设置" onClose={() => setDialog(null)}><PlanningSettings key={data.project} capabilities={data.deviceCapabilities||{}} settings={data.planningSettings} onCancel={()=>setDialog(null)} onSave={settings=>{const error=updateTemplates({planningSettings:settings});if(!error)setDialog(null);return error;}}/></Dialog>}
    {dialog === 'about' && <Dialog title="关于原版工艺规划平台" onClose={() => setDialog(null)}><div className="dialog-body"><h2>原版工艺规划平台</h2><p>参照本机安装版 Weldone 1.0.4 的导航、三栏工作区、橙色主题与日志布局实现。</p><p>示例使用 111.step 的实际几何，支持焊道提取、模板应用与本地草稿保存。支持几何提取、打断和合并规则；设备通信尚未接入。</p></div><footer><Btn primary onClick={() => setDialog(null)}>知道了</Btn></footer></Dialog>}
    {dialog === 'project' && <Dialog title="编辑项目" onClose={() => setDialog(null)}><form onSubmit={e => { e.preventDefault(); if (!draft.trim()) return; change(d => ({ ...d, project:draft.trim() })); setDialog(null); notify('已更新，请保存草稿保留'); }}><div className="dialog-body"><label className="form-label">项目名称<input autoFocus required maxLength="80" value={draft} onChange={e => setDraft(e.target.value)}/></label></div><footer><Btn type="button" onClick={() => setDialog(null)}>取消</Btn><Btn primary type="submit">保存</Btn></footer></form></Dialog>}
    </div>;
}
