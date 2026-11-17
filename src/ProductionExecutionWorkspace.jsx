import React,{useEffect,useMemo,useRef,useState} from 'react';
import {
 ArrowDownWideNarrow,Box,Cable,CalendarDays,ChevronDown,Filter,FolderOpen,Grid2X2,
 Maximize2,PanelLeftClose,PanelLeftOpen,RotateCcw,Settings,Square,Trash2
} from 'lucide-react';
import {EmptyState,PageHeader,formatLength} from './WorkspaceUI';
import StepViewer from './StepViewer';
import NumericInput from './NumericInput.jsx';
import ViewCube from './ViewCube';
import {DEFAULT_PLANNING_VIEW} from './PlanningViewDisplay';
import {belongsToDevice} from './planningRequirements.mjs';
import {isDemoModel,isPointCloudWorkspace,loadStepNeighborhood,stepModelKey,workpiecePoseFor} from './stepModelStore.mjs';
import {createTemplateNeighborhoodMeasurer,loadDemoTemplateNeighborhood} from './templateNeighborhood.mjs';
import {weldLayerLayout,weldLayerPassPaths,weldPathTrackingIssue} from './weldLayerLayout.mjs';
import {analyzeWeldMatch,canPreviewWeld,weldPreviewStrategy} from './weldMatching.mjs';
import {weldMeasurementPlan} from './weldMeasurementPlan.mjs';
import {weldPrecisionMethod,weldPrecisionOptions} from './weldAttributeModel.mjs';
import {saveSimulationRecord} from './productionStatisticsModel.mjs';
import {planWorkstationCycle,workstationPassFrame,workstationRobot} from './workstationSimulation.mjs';
import {plannedTracking} from './strategyPlanning.mjs';
import {configuredTracking} from './weldTracking.mjs';
import {weldTravelReversed} from './weldDirectionGeometry.mjs';
import {LASER_DIRECTION_ISSUE} from './laserTrackingDirection.mjs';
import {planVirtualCoarseScan,virtualFineCaptureFrames} from './virtualWorkstationCamera.mjs';
import {CAPTURE_SPACING_MM,COARSE_CAPTURE_SPACING_MM,pointCloudPly} from './virtualCameraSampling.mjs';
import {centeredPointCloud} from './pointCloudModel.mjs';
import {listVirtualCaptures,loadVirtualCapture,saveVirtualCapture} from './workspaceDraftStore.mjs';
import './productionExecution.css';

const emptyWorkspace={model:'',welds:[],templates:[],processLibrary:[]};
const taskTabs=[['tasks','任务列表'],['processing','加工列表'],['batches','批次管理']];
const viewTabs=[['model','模型视图'],['coarse','粗定位视图'],['fine','精定位视图']];
const viewOptions=[['model','模型'],['welds','焊缝'],['passes','层道'],['grid','网格'],['cameraFieldOfView','相机视野']];
const initialPlayback={progress:0,state:'idle'};
const playbackLabels={idle:'待仿真',ready:'仿真就绪',preparing:'正在计算机械臂轨迹',paused:'已暂停',stopped:'已停止',completed:'仿真完成',failed:'轨迹求解失败'};
const phaseLabels={positioning:'移动至寻位位置',seeking:'寻位中',approaching:'接近焊缝',welding:'焊接中',retracting:'收枪中'};
const formatDegrees=value=>(value*180/Math.PI).toFixed(2)+'°';

function timestamp(value){
 return new Date(value).toLocaleString('zh-CN',{hour12:false});
}

function ExecutionMenu({label,children,icon:Icon,compact=false,className=''}){
 const ref=useRef(null);
 useEffect(()=>{
  const element=ref.current;
  function dismiss(event){
   if(!element.open)return;
   if(event.type==='pointerdown'&&!element.contains(event.target))element.open=false;
   if(event.key==='Escape'){
    element.open=false;
    element.firstElementChild.focus();
   }
  }
  document.addEventListener('pointerdown',dismiss);
  element.addEventListener('keydown',dismiss);
  return ()=>{
   document.removeEventListener('pointerdown',dismiss);
   element.removeEventListener('keydown',dismiss);
  };
 },[]);
 return <details ref={ref} name="execution-menu" className={'execution-menu '+className}>
  <summary className="btn" aria-label={label} title={label}>
   {Icon?<Icon size={14}/>:!compact&&label}<ChevronDown size={13}/>
  </summary>
  <div className="execution-menu-content">{children}</div>
 </details>;
}

export default function ProductionExecutionWorkspace({task,workstation,workstationStatus,importing,onImportTask,invertModelZ,livePlanning,Dialog}){
 const workspace=task?.workspace??emptyWorkspace;
 const {model,stepModel,welds,templates,processLibrary}=workspace;
 const readyWelds=useMemo(()=>welds.filter(weld=>weld.enabled&&!weld.mergedInto&&!weld.splitInto),[welds]);
 const [selectedId,setSelectedId]=useState(()=>readyWelds.find(weld=>weld.id===workspace.selected)?.id??readyWelds[0]?.id);
 const [tab,setTab]=useState('tasks'),[filterOpen,setFilterOpen]=useState(false),[query,setQuery]=useState('');
 const [collapsed,setCollapsed]=useState(false);
 const [viewTab,setViewTab]=useState('model');
 const [view,setView]=useState({...DEFAULT_PLANNING_VIEW,cameraFieldOfView:true});
 const [playback,setPlayback]=useState(initialPlayback),[rate,setRate]=useState(1);
 const [cycle,setCycle]=useState(null),[heldMotion,setHeldMotion]=useState(null),[simulationIssue,setSimulationIssue]=useState('');
 const [modelInfo,setModelInfo]=useState(null),request=useRef(null);
 const runRecord=useRef(null);
 const preparingCamera=useRef(null);
 const captureRun=useRef(null);
 const [captures,setCaptures]=useState([]),[captureId,setCaptureId]=useState(''),[captureCloud,setCaptureCloud]=useState(null);
 const [captureBusy,setCaptureBusy]=useState(0);
 const [coarseRange,setCoarseRange]=useState(null);
 const [coarseDraft,setCoarseDraft]=useState(null);
 const validCoarseDraft=coarseDraft&&[coarseDraft.start,coarseDraft.end].every(value=>value!==''&&Number.isFinite(Number(value)))&&
  Number(coarseDraft.start)!==Number(coarseDraft.end);
 const [passId,setPassId]=useState(''),[camera,setCamera]=useState('iso'),[reset,setReset]=useState(0);
 const [measure,setMeasure]=useState(null);
 const [logs,setLogs]=useState(()=>task?[{id:task.updatedAt,time:task.updatedAt,text:task.source}]:[]);
 const [logQuery,setLogQuery]=useState(''),[newestFirst,setNewestFirst]=useState(true);
 const hasCloud=isPointCloudWorkspace(workspace),hasModel=!!model&&!hasCloud;
 const selected=readyWelds.find(weld=>weld.id===selectedId);
 const viewingModel=viewTab==='model',viewingCloud=viewTab==='coarse'&&hasCloud;
 const visibleCaptures=captures.filter(item=>item.kind===viewTab&&(viewTab==='coarse'||item.weldId===selectedId));
 const selectedCapture=visibleCaptures.find(item=>item.id===captureId)??visibleCaptures[0];
 const virtualCloud=captureCloud?.id===selectedCapture?.id?captureCloud?.data:undefined;
 const visibleModel=virtualCloud?selectedCapture.label:(viewingModel&&hasModel)||viewingCloud?model:'';
 const orderedWelds=useMemo(()=>readyWelds.filter(weld=>weld.planned)
  .sort((a,b)=>(a.weldingOrder??Infinity)-(b.weldingOrder??Infinity)),[readyWelds]);
 const visibleWelds=useMemo(()=>(tab==='processing'?orderedWelds:readyWelds).filter(weld=>
  (weld.id+' '+weld.name).toLowerCase().includes(query.trim().toLowerCase())),[tab,orderedWelds,readyWelds,query]);
 const visibleLogs=useMemo(()=>(newestFirst?logs.slice().reverse():logs).filter(entry=>
  (entry.text+' '+timestamp(entry.time)).toLowerCase().includes(logQuery.trim().toLowerCase())),[logs,newestFirst,logQuery]);

 useEffect(()=>{
  if(!task)return;
  let active=true;
  listVirtualCaptures(task.updatedAt).then(items=>{if(active)setCaptures(items);})
   .catch(()=>{if(active)addLog('无法读取已保存的虚拟相机点云');});
  return ()=>{active=false;};
 },[task]);
 useEffect(()=>{
  if(!selectedCapture)return;
  let active=true;
  loadVirtualCapture(selectedCapture.id).then(points=>{
   if(active&&points?.length)setCaptureCloud({id:selectedCapture.id,points,
    data:{...centeredPointCloud(points),kind:'pointCloud'}});
  }).catch(()=>{if(active)addLog('无法读取虚拟相机点云');});
  return ()=>{active=false;};
 },[selectedCapture]);

 useEffect(()=>{
  if(!hasModel)return;
  const abort=new AbortController();
  const sha=stepModel?.sourceSha256;
  const loader=isDemoModel(workspace)?loadDemoTemplateNeighborhood(abort.signal):
   sha&&workspace.geometryProcessing?.sourceSha256===sha?loadStepNeighborhood(sha)
    .then(geometry=>geometry?createTemplateNeighborhoodMeasurer(geometry):null):null;
  loader?.then(result=>{if(!abort.signal.aborted)setMeasure(()=>result);}).catch(()=>{});
  return ()=>abort.abort();
 },[hasModel,stepModel,workspace]);

 const options=useMemo(()=>({...task?.planningOptions,measureTemplateNeighborhood:measure,
  deviceCapabilities:livePlanning?.deviceCapabilities??task?.planningOptions?.deviceCapabilities,
  planningRobots:livePlanning?.planningRobots??task?.planningOptions?.planningRobots,
  laserTrackingByRobot:workstation?.laserTrackingByRobot??task?.planningOptions?.laserTrackingByRobot,
  robotMounting:invertModelZ?'inverted':'upright'}),[task,measure,workstation,invertModelZ,livePlanning]);
 const placement=useMemo(()=>workpiecePoseFor(workspace),[workspace]);
 const paths=useMemo(()=>{
  if(!hasModel||!selected||!task)return [];
  const processes=processLibrary.filter(process=>belongsToDevice(process,options.activeDevice));
  if(!canPreviewWeld(selected,templates,processes,options))return [];
  const decision=analyzeWeldMatch(selected,templates,processes,options);
  const process=decision.process??decision.whole?.baseProcessSnapshot??null;
  const layout=weldLayerLayout(selected,decision,templates,processes,options);
  const plan=weldPreviewStrategy(selected,decision.whole,process,options);
  return weldLayerPassPaths(selected,layout,plan,measure?.referenceNormalAt,process);
 },[hasModel,selected,task,options,measure,processLibrary,templates]);
 const pass=paths.find(item=>item.id===passId)??paths[0];
 const trackingIssue=useMemo(()=>{
  if(!selected)return undefined;
  const laser=selected.laserTrackingDirection||selected.segments?.some(segment=>
   segment.effectiveLaserTracking||configuredTracking(segment,selected,'laser')===true);
  if(laser){
   const checked=plannedTracking(selected,options);
   if(checked.laserTrackingIssue||!checked.laserTrackingDirection||weldTravelReversed(checked)!==weldTravelReversed(selected))
    return LASER_DIRECTION_ISSUE;
  }
  return weldPathTrackingIssue(selected,pass?[pass]:[],options);
 },[selected,pass,options]);
 const viewerPaths=useMemo(()=>pass?[{...pass,active:true}]:undefined,[pass]);
 const robot=useMemo(()=>workstationRobot(workstation,selected?.assignedRobot,options.planningRobots),
  [workstation,selected?.assignedRobot,options.planningRobots]);
 const coarsePlan=useMemo(()=>planVirtualCoarseScan(workstation,modelInfo,placement,invertModelZ),
  [workstation,modelInfo,placement,invertModelZ]);
 const [coarseStart,coarseEnd]=coarseRange??coarsePlan?.recommended.map(String)??['',''];
 const coarseFrames=useMemo(()=>coarseStart===''||coarseEnd===''?[]:
  coarsePlan?.scanning(Number(coarseStart),Number(coarseEnd))??[],[coarsePlan,coarseStart,coarseEnd]);
 const canStart=!!modelInfo&&!!robot&&!!pass&&pass.endStation>pass.startStation&&!trackingIssue;
 const running=playback.state==='running';
 const preparing=playback.state==='preparing';
 const frame=useMemo(()=>workstationPassFrame(cycle,playback.progress),[cycle,playback.progress]);
 const displayedMotion=useMemo(()=>{
  if(!frame)return heldMotion;
  const active=running||playback.state==='paused';
  const measuring=active&&['positioning','seeking'].includes(frame.phase);
  const tracking=active&&frame.phase==='welding'&&pass?.trackingAt?.(frame.station)==='激光跟踪';
  return {values:frame.values,robotId:cycle.robotId,cameraId:measuring?cycle.cameraId:tracking?cycle.laserId:undefined,
   cameraCoverOpen:measuring&&cycle.camera==='structuredLight'};
 },[frame,cycle,heldMotion,running,playback.state,pass]);
 const activePhase=running?frame?.phase:null;

 useEffect(()=>{
  if(!running||!cycle)return;
  let last=performance.now();
  const clock=setInterval(()=>{
   const now=performance.now(),increment=(now-last)*rate/cycle.duration/1000*100;
   last=now;
   setPlayback(previous=>{
    if(previous.state!=='running')return previous;
    const progress=Math.min(100,previous.progress+increment);
    return {progress,state:progress===100?'completed':'running'};
   });
  },50);
  return ()=>clearInterval(clock);
 },[running,cycle,rate]);
 useEffect(()=>()=>{request.current?.abort();finishRecord('stopped',false);},[]);
 useEffect(()=>{
  const activeTool=cycle??preparingCamera.current;
  const availableCamera=activeTool?.camera==='structuredLight'?robot?.structuredLight:robot?.laser;
  const deviceIssue=!robot||activeTool?.robotId&&activeTool.robotId!==robot.id?
   '当前焊道的机械臂已停用或缺少场景绑定，请重新分配并发布任务。':
   activeTool?.cameraId!==undefined&&activeTool.cameraId!==availableCamera?.id?'当前寻位相机已移除，请重新配置后执行。':null;
  const issue=trackingIssue??deviceIssue;
  if(!issue||!['preparing','running','paused'].includes(playback.state))return;
  holdPosition();
  setPlayback({progress:0,state:'stopped'});
  addLog(selectedId+' · '+issue);
 },[robot,cycle,trackingIssue,playback.state]);
 useEffect(()=>{if(activePhase)addLog(phaseLabels[activePhase]);},[activePhase]);
 useEffect(()=>{
  if(runRecord.current)runRecord.current.frame=frame;
  const capture=captureRun.current;
  if(capture&&!capture.fineStarted&&frame?.time>=capture.endTime&&['running','completed'].includes(playback.state)){
   capture.fineStarted=true;
   void generateCapture(capture,'fine',capture.fineFrames);
  }
  if(playback.state==='completed'){
   finishRecord('completed');
   addLog(selectedId+' 已完成寻位、焊接和收枪');
  }
 },[playback.state,frame,selectedId]);

 function addLog(text){
  setLogs(previous=>[...previous.slice(-149),{id:crypto.randomUUID(),time:new Date().toISOString(),text}]);
 }
 async function generateCapture(run,kind,frames){
  if(!frames.length)return;
  const label=kind==='coarse'?'虚拟粗定位':'虚拟精定位';
  const spacing=kind==='coarse'?COARSE_CAPTURE_SPACING_MM:CAPTURE_SPACING_MM;
  setCaptureBusy(value=>value+1);
  let worker;
  try{
   worker=new Worker(new URL('./virtualCamera.worker.js',import.meta.url),{type:'module'});
   const points=await new Promise((resolve,reject)=>{
    worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.captures[0].points);
    worker.onerror=()=>reject(Error('点云采样进程失败'));
    worker.onmessageerror=()=>reject(Error('无法读取点云采样结果'));
    worker.postMessage({model,stepModel,captures:[{kind,frames}]});
   });
   if(!points.length){addLog(label+'未拍到可见工件表面');return;}
   const id=crypto.randomUUID(),count=points.length/3;
   const summary={id,kind,count,spacing,weldId:run.weldId,passId:run.passId,
    label:label+' · '+(kind==='coarse'?model:run.weldId),createdAt:new Date().toISOString()};
   await saveVirtualCapture(task.updatedAt,summary,points);
   setCaptures(previous=>[summary,...previous]);
   if(kind==='coarse')setCaptureId(id);
   addLog(label+'已保存 '+count.toLocaleString('zh-CN')+' 个点 · '+spacing+' mm');
  }catch(error){addLog(label+'点云保存失败 · '+error.message);}
  finally{worker?.terminate();setCaptureBusy(value=>value-1);}
 }
 function downloadCapture(){
  if(!selectedCapture||captureCloud?.id!==selectedCapture.id)return;
  const url=URL.createObjectURL(pointCloudPly(captureCloud.points,selectedCapture.spacing));
  const link=document.createElement('a');
  link.href=url;link.download=selectedCapture.label+'.ply';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function captureCoarse(){
  if(!coarseFrames.length||!hasModel)return;
  setViewTab('coarse');
  void generateCapture({weldId:selected?.id??model,passId:pass?.id},'coarse',coarseFrames);
 }
 function finishRecord(status,notify=true){
  const active=runRecord.current;
  if(!active)return;
  runRecord.current=null;
  try{saveSimulationRecord(active,active.frame,status);}
  catch(error){if(notify)addLog('仿真记录保存失败 · '+error.message);}
 }
 function holdPosition(){
  request.current?.abort();
  request.current=null;
  preparingCamera.current=null;
  captureRun.current=null;
  finishRecord('stopped');
  if(displayedMotion)setHeldMotion({values:displayedMotion.values,robotId:displayedMotion.robotId});
  setCycle(null);
  setSimulationIssue('');
 }
 function selectWeld(id){
  if(id===selectedId||!readyWelds.some(weld=>weld.id===id))return;
  holdPosition();
  setSelectedId(id);
  setPassId('');
  setPlayback(initialPlayback);
 }
 function selectPass(id){
  if(id===pass?.id)return;
  holdPosition();
  setPassId(id);
  setPlayback(initialPlayback);
 }
 function initialize(){
  holdPosition();
  setPlayback({progress:0,state:'ready'});
  addLog('仿真已就绪，保留当前机械臂位置');
 }
 async function togglePlayback(){
  if(running){
   setPlayback(previous=>({...previous,state:'paused'}));
   addLog('已暂停机械臂仿真');
   return;
  }
  if(!canStart||preparing)return;
  setViewTab('model');
  if(playback.state==='paused'&&cycle&&playback.progress<100){
   setPlayback(previous=>({...previous,state:'running'}));
   return;
  }
  const current=displayedMotion?.values??{};
  holdPosition();
  const abort=new AbortController();
  request.current=abort;
  setPlayback({progress:0,state:'preparing'});
  let photoScene;
  try{
   const deviceCapabilities={...options.deviceCapabilities,laserPrecision:!!robot.laser,structuredLightPrecision:!!robot.structuredLight};
   const precisionMethod=selected.scanSettings?.precisionMethod;
   if(precisionMethod&&!weldPrecisionOptions(deviceCapabilities).some(([method])=>method===precisionMethod))
    throw Error('当前机械臂缺少已选寻位方式对应的精定位相机');
   const method=weldPrecisionMethod(selected.scanSettings,deviceCapabilities);
   const camera=method==='fixedPhoto'?'structuredLight':'laser';
   preparingCamera.current={robotId:robot.id,camera,cameraId:robot[camera]?.id};
   if(method==='fixedPhoto'){
    const {loadWeldCollisionScene}=await import('./weldCollision.mjs');
    photoScene=await loadWeldCollisionScene(workspace,{coverOpen:true,includeWireTip:true,structuredLightInstalled:true,
     laserMountSide:robot.laser?options.laserMountSide:undefined});
    abort.signal.throwIfAborted();
   }
   const measurement=weldMeasurementPlan(selected,{...options,precisionByRobot:undefined,deviceCapabilities},measure?.referenceNormalAt,{
    scene:photoScene,weldingPoseAt:station=>pass.posesAtGeometryStation(station).at(-1)
   });
   const result=await planWorkstationCycle({robot,pass,measurement,origin:modelInfo.origin??[0,0,0],placement,
    invertZ:invertModelZ,options,scan:selected.scanSettings,current,signal:abort.signal});
   if(abort.signal.aborted)return;
   if(!result.frames){
    const details=result.reason??`${result.point??phaseLabels[result.phase]} · ${formatLength(result.station)} mm 附近无法求解，TCP 位置偏差 ${formatLength(result.positionError*1000)} mm，角度偏差 ${formatDegrees(result.angleError)}`;
    setSimulationIssue(details);
    setPlayback({progress:0,state:'failed'});
    addLog(selectedId+' · '+details);
    return;
   }
   setCycle({...result,robotId:robot.id,laserId:robot.laser?.id});
   const modelOrigin=modelInfo.origin??[0,0,0];
   const capture={weldId:selected.id,passId:pass.id,endTime:result.frames.findLast(frame=>frame.capture)?.time??Infinity,
    fineFrames:virtualFineCaptureFrames(result,robot,modelOrigin,placement,invertModelZ)};
   captureRun.current=capture;
   void generateCapture(capture,'coarse',coarseFrames);
   runRecord.current={id:crypto.randomUUID(),modelName:model,modelId:stepModelKey(workspace),startedAt:new Date().toISOString(),
    weldId:selected.id,weldLabel:selected.name,position:selected.position,passId:pass.id,passIndex:pass.passIndex,duration:result.duration};
   setPlayback({progress:0,state:'running'});
   addLog('开始仿真 '+selectedId+' · '+robot.label);
  }catch(error){
   if(!abort.signal.aborted){
    setSimulationIssue(error.message);
    setPlayback({progress:0,state:'failed'});
    addLog('机械臂轨迹计算失败 · '+error.message);
   }
  }finally{
   photoScene?.dispose();
   if(request.current===abort){request.current=null;preparingCamera.current=null;}
  }
 }
 function stop(){
  holdPosition();
  setPlayback({progress:0,state:'stopped'});
  addLog('已终止仿真，保留当前机械臂位置');
 }
 function toggleView(key){
  setView(previous=>({...previous,[key]:!previous[key]}));
 }

 return <section className="production-execution" aria-label="生产执行">
  <PageHeader title="生产执行" actions={<>
   <ExecutionMenu label="执行设置" icon={Settings} className="execution-settings">
    <label>仿真倍率<select aria-label="仿真倍率" value={rate} onChange={event=>setRate(Number(event.target.value))}>
     {[.5,1,2,4].map(value=><option key={value} value={value}>{value}×</option>)}
    </select></label>
   </ExecutionMenu>
   <button type="button" className="btn" disabled={!canStart||preparing} onClick={initialize}><RotateCcw size={14}/>初始化</button>
   <div className="execution-coarse-actions">
    <button type="button" className="btn" disabled={!hasModel||!coarseFrames.length||captureBusy>0} onClick={captureCoarse}>粗定位</button>
    <button type="button" className="btn" aria-label="粗定位设置" title="粗定位设置" aria-haspopup="dialog"
     onClick={()=>setCoarseDraft({start:coarseStart,end:coarseEnd})}><Settings size={14}/></button>
   </div>
   <button type="button" className="btn" disabled={!['preparing','running','paused'].includes(playback.state)} onClick={stop}><Square size={13}/>终止</button>
   <div className="execution-split" role="group" aria-label="机械臂仿真控制">
    <button type="button" className="btn primary" title={trackingIssue??'仿真当前道次的寻位、焊接和收枪'} disabled={!canStart||preparing} onClick={togglePlayback}>
     {running?'暂停仿真':preparing?'正在计算…':'一键执行'}
    </button>
    <ExecutionMenu label="执行选项" compact className="execution-split-menu">
     <button className="btn" type="button" disabled={!canStart||preparing} onClick={event=>{
      event.currentTarget.closest('details').open=false;initialize();
     }}>重置仿真进度</button>
    </ExecutionMenu>
   </div>
  </>}>
   <button type="button" className="execution-plan-link" onClick={()=>{setCollapsed(false);setTab('batches');}}><CalendarDays size={14}/>生产计划</button>
  </PageHeader>
  <div className={'execution-workspace'+(collapsed?' execution-collapsed':'')}>
   {!collapsed&&<aside className="execution-tasks" aria-label="生产任务">
    <div className="execution-tabs execution-task-tabs" role="group" aria-label="任务分类">
     <button type="button" className="icon" aria-label="收起任务区" onClick={()=>setCollapsed(true)}><PanelLeftClose size={15}/></button>
     {taskTabs.map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}
     <button type="button" className="btn primary execution-import" disabled={importing} onClick={onImportTask}>导入任务</button>
    </div>
    {tab==='batches'?(task?<div className="execution-batch">
     <div className="execution-model"><FolderOpen size={16}/><strong>{workspace.project}</strong></div>
     <dl><dt>任务模型</dt><dd>{model}</dd><dt>焊缝</dt><dd>{readyWelds.length} 条</dd>
      <dt>已规划</dt><dd>{orderedWelds.length} 条</dd><dt>更新时间</dt><dd>{timestamp(task.updatedAt)}</dd></dl>
    </div>:<EmptyState model text="暂无生产批次"/>):<>
     <div className="execution-task-tools">
      <button type="button" className="icon" aria-label="筛选焊缝" title="筛选焊缝" aria-expanded={filterOpen}
       disabled={!readyWelds.length} onClick={()=>{if(filterOpen)setQuery('');setFilterOpen(!filterOpen);}}><Filter size={14}/></button>
      {!!task&&<span title={model}><FolderOpen size={14}/>{model}</span>}
     </div>
     {filterOpen&&<input className="execution-search" aria-label="搜索执行焊缝" placeholder="请输入" value={query}
      onChange={event=>setQuery(event.target.value)}/>}
     {visibleWelds.length?<div className="execution-welds">{visibleWelds.map(weld=><button type="button" className="execution-weld"
      key={weld.id} aria-pressed={weld.id===selectedId} onClick={()=>selectWeld(weld.id)}>
      <Cable size={15}/><span><strong>{weld.id}</strong><small title={weld.name}>{weld.name}</small></span>
      <small>{weld.planned?'已规划':weld.strategyPlan?.passes?.length?'基础轨迹':'待规划'}</small>
     </button>)}</div>:<EmptyState model text={query?'没有匹配的焊缝':!task?'无任务，请点击「导入任务」':tab==='processing'?'暂无已规划焊缝':'此任务没有焊缝'}/>}
    </>}
   </aside>}
   <section className="execution-model-view" aria-label="执行视图">
    <div className="execution-tabs execution-view-tabs" role="group" aria-label="执行视图切换">
     {collapsed&&<button type="button" className="icon" aria-label="展开任务区" onClick={()=>setCollapsed(false)}><PanelLeftOpen size={15}/></button>}
     {viewTabs.map(([id,label])=><button key={id} type="button" aria-pressed={viewTab===id} onClick={()=>setViewTab(id)}>{label}</button>)}
    </div>
    <div className="viewport execution-viewport">
     <StepViewer key={viewTab+':'+stepModelKey(workspace)+':'+(virtualCloud?selectedCapture.id:'')} showEmptyGrid showWorkstation={!virtualCloud}
       workstation={virtualCloud?null:workstation} workstationStatus={workstationStatus} workpiecePose={virtualCloud?undefined:placement}
       model={visibleModel} stepModel={visibleModel&&!virtualCloud?stepModel:undefined} pointCloudData={virtualCloud}
       welds={viewingModel?welds:emptyWorkspace.welds} selected={selectedId} onSelect={selectWeld}
       view={virtualCloud?{...view,model:true}:view} camera={camera} reset={reset} invertModelZ={!virtualCloud&&invertModelZ}
       workstationMotion={displayedMotion} showSimulationCamera={view.cameraFieldOfView} showCoarseCamera={viewingModel||viewTab==='coarse'}
       passPaths={viewingModel?viewerPaths:undefined} onModelInfo={viewingModel?setModelInfo:undefined} onSelectPass={selectPass}/>
      <ExecutionMenu label="视图显示" className="execution-display">
        {viewOptions.filter(([id])=>id==='cameraFieldOfView'?!virtualCloud&&!!(robot?.laser||robot?.structuredLight||
         workstation?.devices.some(device=>device.kind==='coarse'&&!device.configured)):
         id==='grid'||id==='model'&&!!visibleModel||viewingModel&&hasModel).map(([id,label])=><label key={id}>
        <input type="checkbox" checked={view[id]} onChange={()=>toggleView(id)}/>{label}
       </label>)}
      </ExecutionMenu>
      <div className="view-tools execution-view-tools" role="group" aria-label="执行视图操作">
       <button type="button" aria-label="适应视图" title="适应视图" onClick={()=>setReset(value=>value+1)}><Maximize2 size={18}/></button>
       <button type="button" aria-label="切换俯视" title="切换俯视" aria-pressed={camera==='top'}
        onClick={()=>setCamera(value=>value==='top'?'iso':'top')}><Box size={18}/></button>
       <button type="button" aria-label="显示网格" title="显示网格" aria-pressed={view.grid} onClick={()=>toggleView('grid')}><Grid2X2 size={18}/></button>
       <button type="button" aria-label="恢复等轴视图" title="恢复等轴视图" onClick={()=>{setCamera('iso');setReset(value=>value+1);}}><RotateCcw size={18}/></button>
      </div>
      <div className="view-orientation"><ViewCube onView={next=>{setCamera(next);setReset(value=>value+1);}} invertModelZ={invertModelZ}/></div>
     {!viewingModel&&visibleCaptures.length>0&&<div className="execution-capture-tools">
      <select aria-label="已保存点云" value={selectedCapture.id} onChange={event=>setCaptureId(event.target.value)}>
        {visibleCaptures.map(item=><option value={item.id} key={item.id}>{timestamp(item.createdAt)} · {item.count} 点 · {item.spacing??CAPTURE_SPACING_MM} mm</option>)}
      </select><button type="button" className="btn" disabled={!virtualCloud} onClick={downloadCapture}>下载 PLY</button>
     </div>}
     {!viewingModel&&!viewingCloud&&!virtualCloud&&<div className="canvas-note">{captureBusy?'正在生成点云…':viewTab==='coarse'?'暂无粗定位数据':'暂无精定位数据'}</div>}
    </div>
    {viewingModel&&pass&&<div className="execution-player" role="group" aria-label="机械臂仿真进度">
     <input type="range" aria-label="仿真进度" min="0" max="100" step=".1" value={playback.progress} disabled={!cycle}
      onChange={event=>setPlayback({progress:Number(event.target.value),state:'paused'})}/>
     <output>{Math.round(playback.progress)}%</output>
    </div>}
    <section className="execution-logs" aria-label="执行日志">
     <header><h2>日志</h2>
      <input type="search" aria-label="搜索日志" title="搜索日志" placeholder="请输入" value={logQuery}
       onChange={event=>setLogQuery(event.target.value)}/>
      <button type="button" className="icon" aria-label="切换日志顺序" title={newestFirst?'最早消息优先':'最新消息优先'}
       aria-pressed={!newestFirst} onClick={()=>setNewestFirst(value=>!value)}><ArrowDownWideNarrow size={14}/></button>
      <button type="button" className="icon" aria-label="清空日志" title="清空日志" disabled={!logs.length}
       onClick={()=>setLogs([])}><Trash2 size={14}/></button>
     </header>
     <div className="execution-log-list" role="log">
      {visibleLogs.length?visibleLogs.map(entry=><p key={entry.id}>{entry.text}<time dateTime={entry.time}>{timestamp(entry.time)}</time></p>):
       <p className="execution-log-empty">{logQuery?'没有匹配的日志':'暂无日志'}</p>}
     </div>
    </section>
   </section>
   <aside className="execution-detail" aria-label="执行状态">
    {selected?<><h2>{selected.id}</h2><dl>
     <dt>运行模式</dt><dd>机械臂仿真</dd>
     <dt>仿真状态</dt><dd role="status">{running?phaseLabels[activePhase]:playbackLabels[playback.state]}</dd>
     {robot&&<><dt>机械臂</dt><dd>{robot.label}</dd></>}
     <dt>焊缝名称</dt><dd>{selected.name}</dd>
     <dt>焊缝长度</dt><dd>{formatLength(selected.length)} mm</dd>
     {pass&&<><dt>仿真道次</dt><dd><select aria-label="仿真道次" value={pass.id} onChange={event=>selectPass(event.target.value)}>
      {paths.map(item=><option key={item.id} value={item.id}>第 {item.layerIndex+1} 层 · 第 {item.passIndex+1} 道</option>)}</select></dd></>}
     {frame&&<><dt>焊缝里程</dt><dd>{formatLength(frame.station)} mm</dd></>}
     {displayedMotion?.robotId===robot?.id&&robot?.arm.map((joint,index)=><React.Fragment key={joint.name}>
      <dt>J{index+1}</dt><dd>{formatDegrees(displayedMotion.values[joint.name])}</dd>
     </React.Fragment>)}
    </dl>{(trackingIssue||simulationIssue)&&<p className="execution-simulation-issue" role="alert">
     {trackingIssue?`${trackingIssue}。请重新规划并导出任务。`:simulationIssue}
    </p>}
    {workstation&&selected&&!robot&&<p className="execution-simulation-issue">当前焊道的机械臂已停用或缺少场景绑定，请重新分配并发布任务。</p>}
    </>:<EmptyState text="暂无数据"/>}
   </aside>
  </div>
  {coarseDraft&&<Dialog title="粗定位设置" onClose={()=>setCoarseDraft(null)}>
   <form onSubmit={event=>{
    event.preventDefault();
    if(!validCoarseDraft)return;
     setCoarseRange([coarseDraft.start,coarseDraft.end]);setCoarseDraft(null);
   }}>
    <div className="dialog-body execution-coarse-fields">
     <p>沿扫描方向相对于场景相机的位置（mm）</p>
     <label>扫描起点<NumericInput aria-label="扫描起点" step="any" required value={coarseDraft.start}
      onChange={event=>setCoarseDraft({...coarseDraft,start:event.target.value})}/></label>
     <label>扫描终点<NumericInput aria-label="扫描终点" step="any" required value={coarseDraft.end}
      onChange={event=>setCoarseDraft({...coarseDraft,end:event.target.value})}/></label>
     {!validCoarseDraft&&<p role="status">请输入两个不同的扫描位置</p>}
      {coarsePlan&&<p>当前工件推荐范围 {coarsePlan.recommended[0]} 至 {coarsePlan.recommended[1]} mm</p>}
      {coarsePlan&&!coarsePlan.depthCovered&&<p>工件有部分超出相机工作深度</p>}
    </div>
    <footer>{coarsePlan&&<button type="button" className="btn" onClick={()=>setCoarseDraft({
      start:String(coarsePlan.recommended[0]),end:String(coarsePlan.recommended[1])})}>使用推荐范围</button>}
     <button type="button" className="btn" onClick={()=>setCoarseDraft(null)}>取消</button>
     <button type="submit" className="btn primary" disabled={!validCoarseDraft}>确定</button></footer>
   </form>
  </Dialog>}
 </section>;
}
