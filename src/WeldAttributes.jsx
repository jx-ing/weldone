import {TextInput} from './FormInput.jsx';
import NumericInput from './NumericInput.jsx';
import React,{useEffect,useId,useRef,useState} from 'react';
import {formatLength} from './WorkspaceUI';
import {FileOutput,Info,ChevronDown,Plus,TriangleAlert} from 'lucide-react';
import {POSITIONS} from './templateModel.mjs';
import {weldForm,weldPositionCode} from './planningRequirements.mjs';
import {grooveType,grooveValue,GROOVE_TYPES,grooveFieldsFor} from './grooveModel.mjs';
import {endpointWrapAt,endpointWrapChoices} from './weldWrapJunctions.mjs';
import {processPositionLabel} from './processLibraryView.mjs';
import {OFFSET_AXES,POSE_AXES} from './planningSettingsModel.mjs';
import {formatDecimal} from './numericPrecision.mjs';
import {WELD_TYPES,patchWeldGroup,patchWeldSegment,patchWeldGroove,segmentName,weldPrecisionMethod,weldPrecisionOptions} from './weldAttributeModel.mjs';
import WeldPlanningPointDetails from './WeldPlanningPointDetails';
import './weldAttributes.css';

const tabs=[['information','焊缝信息'],['welding','焊接规划'],['scanning','扫描规划']];
function Row({label,children}){return <div className="wa-row"><span>{label}</span>{children}</div>;}
function Options({label,value,onChange,values,placeholder='请选择',...props}){return <span className="wa-select"><select aria-label={label} value={value??''} onChange={event=>onChange(event.target.value)} {...props}>{!value&&<option value="">{placeholder}</option>}{value&&!values.some(v=>(Array.isArray(v)?v[0]:v)===value)&&<option value={value}>{value}</option>}{values.map(item=>{const [id,name]=Array.isArray(item)?item:[item,item];return <option key={id} value={id}>{name}</option>;})}</select><ChevronDown size={12}/></span>;}
function NumberField({label,value,onChange,unit,min=0,max,step='any',disabled=false}){return <span className={'wa-number'+(disabled?' disabled':'')}><NumericInput aria-label={label} min={min} max={max} step={step} disabled={disabled} required={!disabled} value={value??''} onChange={event=>{const number=event.target.value===''?'':+event.target.value;if(number===''||Number.isFinite(number)&&number>=min&&(max===undefined||number<=max))onChange(number);}}/>{unit&&<small>{unit}</small>}</span>;}

function CameraAdjustmentRow({label,actual,value,unit,onChange}){
 return <label className="wa-offset-row wa-actual-pose">
  <span>{label}</span><output className="wa-offset-value" aria-label={label+'实际值'}>{formatDecimal(actual)} {unit}</output>
  <span className="wa-offset-input"><NumericInput aria-label={label+'偏移'} step="any" value={value===null?'':value??0}
   onChange={event=>{
    const input=event.currentTarget;
    if(!input.validity.badInput)onChange(input.value===''?null:input.valueAsNumber);
   }}/><span>{unit}</span></span>
 </label>;
}

function MeasurementPreview({plan,index,onPoint,onInsert,pickingMeasurement,onPick,fieldOfView,onFieldOfView,adjustment,onAdjustment,localPoints,onEditPoints,disabled}){
 const [station,setStation]=useState('');
 const point=plan.points[index];
 const check=point.photoCheck;
 const alongPath=plan.method==='continuous';
 const activeCustom=localPoints.find(item=>item.id===point.sourceId);
 const stationValue=station===''?null:Number(station);
 const canPlace=stationValue!==null&&Number.isFinite(stationValue)&&stationValue>=0&&stationValue<=plan.length;
 const duplicate=localPoints.some(item=>Math.abs(item.station-stationValue)<1e-6);
 function addMeasurementPoint(){
  if(!canPlace||duplicate)return;
  if(onInsert(stationValue))setStation('');
 }
 const setOffset=(group,axis,value)=>onAdjustment({...adjustment,[group]:{...adjustment?.[group],[axis]:value}});
 return <section className="wa-measurement" aria-label="测量轨迹预览">
  <h3 className="wa-section-heading">测量轨迹预览</h3>
  <Row label="测量点位">{alongPath?<div className="wa-measurement-range">
   <output>{point.label} · {formatLength(point.distance)} mm</output>
   <input type="range" aria-label="测量点位" aria-valuetext={point.label} min={0} max={plan.points.length-1} value={index}
    onChange={event=>onPoint(Number(event.target.value))}/>
  </div>:<Options label="测量点位" value={String(index)} values={plan.points.map((item,i)=>[String(i),item.sourceId?item.label+' · '+formatDecimal(item.distance)+' mm':item.label])}
   onChange={value=>onPoint(Number(value))}/>}</Row>
  <div className="wa-measurement-editor">
   <label>焊缝里程 <NumericInput aria-label="新增测量点里程" min={0} max={plan.length} step="any"
    value={station} placeholder="请输入" disabled={disabled} onChange={event=>setStation(event.target.value)}/><small>mm</small></label>
   <button type="button" className="btn" disabled={disabled||!canPlace||duplicate} onClick={addMeasurementPoint}><Plus size={14}/>添加测量点</button>
   <button type="button" className="btn" aria-pressed={pickingMeasurement} disabled={disabled} onClick={onPick}>
    {pickingMeasurement?'取消选点':'从模型选点'}</button>
   {activeCustom&&<button type="button" className="btn wa-point-remove" disabled={disabled}
    onClick={()=>onEditPoints(localPoints.filter(item=>item.id!==activeCustom.id),activeCustom.id)}>删除此测量点</button>}
  </div>
  {pickingMeasurement&&<p className="wa-muted" role="status">点击当前焊缝上的位置</p>}
  {check&&<Row label="拍照检查"><output className={'wa-photo-check '+check.state}>
   {check.state==='ready'?'通过 · 与焊丝轴夹角 '+formatDecimal(check.angle)+'°':
    (check.state==='blocked'?'待调整 · ':'')+check.reasons.join('；')}
  </output></Row>}
  <Row label="相机视野"><label className="wa-measurement-fov"><input type="checkbox" checked={fieldOfView}
   onChange={event=>onFieldOfView(event.target.checked)}/>显示相机视野</label></Row>
  <Row label="镜头高度 (mm)"><output className="wa-camera-height">{formatDecimal(point.opticalPosition[2])}</output></Row>
  {plan.method==='fixedPhoto'?<>
   <Row label="拍照距离 (mm)"><output className="wa-photo-distance">{formatDecimal(point.photoDistance)}</output></Row>
   <Row label="TCP 高于被测点 (mm)"><output className="wa-tcp-clearance">{formatDecimal(point.position[2]-point.target[2])}</output></Row>
  </>:<Row label="工作距离 (mm)"><output className="wa-laser-distance">{formatDecimal(point.workingDistance)}</output></Row>}
  <fieldset className="wa-camera-adjustment" disabled={disabled}>
   <legend>相机位置与姿态（整条焊缝）</legend>
   <p className="wa-muted">TCP 偏移沿工件坐标轴生效。</p>
   <div className="wa-offset-row wa-actual-pose wa-actual-pose-header" aria-hidden="true"><span>轴</span><span>当前值</span><span>偏移量</span></div>
   {OFFSET_AXES.map((axis,i)=><CameraAdjustmentRow key={axis} label={'TCP '+axis.toUpperCase()} unit="mm" actual={point.position[i]}
    value={adjustment?.position?.[axis]} onChange={value=>setOffset('position',axis,value)}/>)}
   {POSE_AXES.map(([axis,label])=>plan.method==='fixedPhoto'?<Row key={axis} label={label}>
    <output aria-label={'拍照'+label}>{formatDecimal(point.toolPose.angles[axis])}°{axis==='rotation'?' · 跟随焊接':''}</output>
   </Row>:<CameraAdjustmentRow key={axis} label={label} unit="°" actual={point.toolPose.angles[axis]}
    value={adjustment?.angles?.[axis]} onChange={value=>setOffset('angles',axis,value)}/>)}
  </fieldset>
 </section>;
}

function MatchCard({label,value,onChoose,onCreate,createLabel,createUnavailable}){
 const tooltipId=useId();
 return <div className="wa-match-card">
  <button className="wa-choose-match" type="button" aria-label={'选择'+label} title={value?undefined:'未匹配'+label} onClick={onChoose}>
   <span>{label}{value?<FileOutput size={13}/>:<TriangleAlert className="wa-match-warning" size={15} aria-hidden="true"/>}</span><small>{value||'未选择'+label}</small>
  </button>
  {onCreate&&<>
   <button className="wa-create-match" type="button" aria-label={createLabel} aria-describedby={tooltipId} aria-disabled={!!createUnavailable} onClick={createUnavailable?undefined:onCreate}><Plus size={15} aria-hidden="true"/></button>
   <div id={tooltipId} className="wa-create-tooltip" role="tooltip">{createLabel}{createUnavailable&&<div>{createUnavailable}</div>}</div>
  </>}
 </div>;
}

export default function WeldAttributes(props){
 const {weld:w,templates,processLibrary,decision,onPatch,onSave,onCancel}=props,id=useId(),panel=useRef();
 const planningFormId=id+'-planning-form';
 const [tab,setTab]=useState(props.planningSelection?'welding':'information'),[segmentIndex,setSegmentIndex]=useState(0);
 useEffect(()=>{if(props.planningSelection)setTab('welding');},[props.planningSelection]);
 useEffect(()=>{props.onPlanningViewChange?.(tab==='welding');return()=>props.onPlanningViewChange?.(false);},[tab,props.onPlanningViewChange]);
 useEffect(()=>{props.onScanningViewChange?.(tab==='scanning');return()=>props.onScanningViewChange?.(false);},[tab,props.onScanningViewChange]);
 useEffect(()=>{setSegmentIndex(0);},[w.id]);
 useEffect(()=>{const body=panel.current?.querySelector('.wa-scroll');if(body)body.scrollTop=0;},[tab,w.id,props.planningSelection]);
 const segments=w.segments.filter(segment=>!segment.generatedEndpointWrap);
 const selectedSegment=Math.min(segmentIndex,Math.max(0,segments.length-1)),segment=segments[selectedSegment];
 const index=w.segments.indexOf(segment),groove=w.groove||{type:'无坡口',angle:0,depth:0},inactive=grooveType(groove.type)==='无坡口';
 const template=templates.find(t=>t.id===w.templateId&&t.enabled!==false),process=processLibrary.find(p=>p.id===w.processId);
 const setGroup=(key,value)=>onPatch('segments',patchWeldGroup(w,key,value)),setSegment=(key,value)=>onPatch('segments',patchWeldSegment(w,index,key,value)),setGroove=(key,value)=>onPatch('groove',patchWeldGroove(w,key,value));
 const scan=w.scanSettings||{};
 const trackingModes=[['arc','电弧跟踪'],['laser','激光跟踪']].filter(([mode])=>props.deviceCapabilities?.[mode+'Tracking']!==false);
 const tracking=props.trackingSegments?.[index];
 const trackingMode=tracking?.effectiveArcTracking?'arc':tracking?.effectiveLaserTracking?'laser':'none';
 const setTracking=mode=>onPatch('segments',w.segments.map((part,i)=>i===index?
  {...part,arcTracking:mode==='arc',laserTracking:mode==='laser'}:part));
 const wrapFocus=props.wrapFocus?.weldId===w.id&&props.wrapFocus.index===index?props.wrapFocus:null;
 const blocked=!w.enabled||!!w.mergedInto||!!w.splitInto||props.busy;
 const precisionMethods=weldPrecisionOptions(props.deviceCapabilities);
 const endpointPrecisionMethods=weldPrecisionOptions(props.deviceCapabilities,true);
 const endpointMethod=value=>endpointPrecisionMethods.some(([method])=>method===value)?value:'';
 const precisionMethod=weldPrecisionMethod(scan,props.deviceCapabilities);
 const canReverse=w.closure!=='closed'&&w.segments.length>0&&w.segments.every(
  segment=>weldPositionCode(segment.position)==='PB'&&segment.pathPoints?.length>=2
 );
 const trackingDirection=props.trackingWeld?.laserTrackingDirection;
 const trackingIssue=props.trackingIssue??props.trackingWeld?.laserTrackingIssue;
 const updateScan=values=>onPatch('scanSettings',{...scan,...values});
 const pending=w.enabled&&decision?.route==='blocked'?decision:null;
 const needsProcess=pending?.creation==='template-or-process';
 const needsTemplate=needsProcess||pending?.creation==='template';
 const appliedTemplate=!onCancel&&!needsTemplate&&template?.name;
 const appliedProcess=!onCancel&&!needsProcess&&(process?.name||w.processName||template?.baseProcess?.name);
 const templateName=appliedTemplate||decision?.whole?.name;
 const processName=decision?.process?.name||appliedProcess;
 function tabKey(event){const at=tabs.findIndex(([key])=>key===tab),next=event.key==='ArrowRight'?(at+1)%tabs.length:event.key==='ArrowLeft'?(at+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;if(next<0)return;event.preventDefault();setTab(tabs[next][0]);event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus();}
 return <section ref={panel} className="weld-attributes-panel" aria-label="焊缝属性">
  <header className="wa-header">焊缝属性</header>
  {props.robotAssignment&&<Row label="执行机械臂"><output>{props.robotAssignment}</output></Row>}
  <div className="wa-summary">
   <div className="wa-group">
    <TextInput aria-label="焊缝名称" required maxLength={80} value={w.name} title={w.name} onChange={event=>onPatch('name',event.target.value)}/>
    {props.onSeparateSegments&&<button type="button" className="btn wa-separate-button" onClick={props.onSeparateSegments}>拆分</button>}
    <div className="wa-segments" role="group" aria-label="选择焊缝段">{segments.map((s,i)=><button type="button" key={i} title={segmentName({...w,segments},i)} aria-pressed={i===selectedSegment} className={i===selectedSegment?'active':''} onClick={()=>{setSegmentIndex(i);props.onClearWrapFocus?.();}}>{segmentName({...w,segments},i)}</button>)}</div>
   </div>
   <div className="wa-template-cards" key={w.id}>
    <MatchCard label="焊接模板" value={templateName} onChoose={props.onChooseTemplate} onCreate={props.onCreateTemplate} createLabel="基于此焊道创建模板" createUnavailable={props.createTemplateUnavailable}/>
    <MatchCard label="工艺参数" value={processName} onChoose={props.onChooseProcess} onCreate={props.onCreateProcess} createLabel="基于此焊道创建工艺参数"/>
   </div>
   <div className="wa-tabs" role="tablist" aria-label="焊缝属性标签页">{tabs.map(([key,label])=><button type="button" key={key} role="tab" id={id+'-'+key} aria-selected={tab===key} aria-controls={id+'-panel'} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={tabKey}>{label}</button>)}</div>
  </div>
  <div className="wa-scroll" role="tabpanel" id={id+'-panel'} aria-labelledby={id+'-'+tab}>
   {tab==='information'?<div className="wa-information">
    <details className="wa-section"><summary>焊缝组 · {w.segments.length} 段</summary>
    <Row label="焊缝形式"><Options label="焊缝形式" value={weldForm(w)} onChange={value=>onPatch('weldType',value)} values={WELD_TYPES}/></Row>
    <Row label="焊接方式"><Options label="焊接方式" value={String(w.machineCount??1)} onChange={value=>onPatch('machineCount',Number(value))} values={[[ '1','单机焊接'],['2','双机焊接']]}/></Row>
    <Row label="焊接位置"><Options label="焊接位置" value={w.position} onChange={value=>setGroup('position',value)} values={POSITIONS.map(value=>[value,value.startsWith('PF')?'立向上焊':processPositionLabel(value)])}/></Row>
    {canReverse&&<Row label="焊接方向"><Options label="焊接方向" value={trackingDirection??(w.direction==='反向'?'反向':'正向')}
     disabled={!!trackingDirection||!!trackingIssue||!w.enabled||!!w.mergedInto||!!w.splitInto}
     onChange={value=>onPatch('direction',value)} values={['正向','反向']}/></Row>}
    {trackingDirection&&!trackingIssue&&<Row label="激光跟踪方向"><span>已锁定 · 激光在前，焊枪在后</span></Row>}
    <Row label="焊脚高度"><NumberField label="焊脚尺寸" min={.5} value={w.leg} unit="mm" onChange={value=>onPatch('leg',value)}/></Row>
    </details><details className="wa-section" open><summary>包角</summary>
    {[['start','起点包角'],['end','终点包角']].map(([side,label])=>{
     const end=endpointWrapAt(w,index,side),active=wrapFocus?.side===side;
     const vertical=weldPositionCode(segment?.position)==='PF'||end.value==='vertical';
     const choices=endpointWrapChoices.filter(([kind])=>kind==='none'||(vertical?kind==='vertical':kind!=='vertical'));
     return <Row key={side} label={label}><Options label={label} value={active?wrapFocus.kind??end.value:end.value}
      disabled={blocked||end.blocked} onFocus={()=>props.onWrapFocus?.(index,side)}
      onChange={next=>props.onWrapChange(index,side,next)} values={end.blocked?choices.slice(0,1):choices}/></Row>;
    })}
    {wrapFocus?.message&&<p className="wa-muted" role="status">{wrapFocus.message}</p>}
    {wrapFocus?.picking&&<button type="button" className="btn" onClick={props.onClearWrapFocus}>取消选边</button>}
    </details>{trackingIssue&&<p role="status" className="wa-muted">{trackingIssue}</p>}{w.disabledByMinWeldLength&&<Row label="焊缝状态"><span className="wa-readonly">短于最小焊缝长度，已屏蔽</span></Row>}{w.collisionState&&<Row label="机头碰撞检测"><span className="wa-readonly">{w.collisionState}</span></Row>}<Row label="焊缝长度"><span className="wa-readonly wa-length"><span>{Number.isFinite(w.length)?formatLength(w.length):'—'}</span><small>mm</small></span></Row>
    {trackingModes.length>0&&<Row label="焊缝跟踪"><div className="wa-tracking" role="group" aria-label="焊缝跟踪">
     {(trackingModes.length===2?[...trackingModes,['none','不跟踪']]:trackingModes).map(([mode,label])=><label key={mode}>
      <input type={trackingModes.length===2?'radio':'checkbox'} name={id+'-tracking'}
       checked={trackingMode===mode} onChange={event=>setTracking(event.target.checked?mode:'none')}/>{label}
     </label>)}
    </div></Row>}
    <details className="wa-section"><summary>坡口 · {grooveType(groove.type)}</summary><Row label="坡口类型"><Options label="焊道坡口类型" required placeholder={GROOVE_TYPES.includes(grooveType(groove.type))?'请选择':'请选择支持的坡口类型'} value={GROOVE_TYPES.includes(grooveType(groove.type))?grooveType(groove.type):''} onChange={value=>setGroove('type',value)} values={GROOVE_TYPES.map(value=>[value,value.replace(' ','')])}/></Row>
    <h4 className="wa-groove-heading">坡口尺寸<Info size={11}/></h4>
    <div className="wa-groove-grid">{grooveFieldsFor(groove.type).map(([key,label,unit,max])=><label key={key}><span>{label}</span><NumberField label={'焊道'+label} min={0} max={max} disabled={inactive} value={key==='rootFace'?(groove.rootFace??0):grooveValue(groove,key)} onChange={value=>setGroove(key,value)}/></label>)}</div>
   </details></div>:tab==='welding'?<>{props.defaultPosePreview&&<p className="wa-point-details wa-muted">按工艺规划设置显示基础轨迹，工艺待匹配。</p>}<WeldPlanningPointDetails point={props.planningPoint} actualPose={props.planningPointPose} passPreview={props.planningPassPreview} basePosition={props.planningPointBasePosition} formId={planningFormId} group={props.planningPointGroup} layerOnly={props.planningSelection?.type==='layer'} editable={w.enabled&&!w.mergedInto&&!w.splitInto} onSavePoint={props.onSavePoint} onSaveLayerOrPass={props.onSaveLayerOrPass} onOffsetPreview={props.onOffsetPreview} onOffsetPreviewEnd={props.onOffsetPreviewEnd}/></>:<div className="wa-scan-settings">
    <h3 className="wa-section-heading">扫描配置</h3>
    <Row label="精测量方式"><Options label="精测量方式" value={precisionMethod} values={precisionMethods} onChange={precisionMethod=>updateScan({precisionMethod})}/></Row>
    {precisionMethod==='separateEnds'?<>
     <Row label="起点精测量方式"><Options label="起点精测量方式" required value={endpointMethod(scan.startPrecisionMethod)} values={endpointPrecisionMethods} onChange={startPrecisionMethod=>updateScan({startPrecisionMethod})}/></Row>
     <Row label="终点精测量方式"><Options label="终点精测量方式" required value={endpointMethod(scan.endPrecisionMethod)} values={endpointPrecisionMethods} onChange={endPrecisionMethod=>updateScan({endPrecisionMethod})}/></Row>
    </>:precisionMethod&&!['laserSweep','continuous'].includes(precisionMethod)&&<Row label="精测量范围"><Options label="精测量范围" value={scan.measurementScope??'both'} values={[[ 'start','仅精测量起点'],['both','首尾精测量']]} onChange={measurementScope=>updateScan({measurementScope})}/></Row>}
    <Row label="扫描方向"><Options label="扫描方向" disabled={!precisionMethod} value={scan.direction||'forward'} values={[[ 'forward','沿焊接方向'],['reverse','逆焊接方向']]} onChange={direction=>updateScan({direction})}/></Row>
    {props.measurementPreview?<MeasurementPreview key={w.id+':'+precisionMethod} {...props.measurementPreview} disabled={blocked}
     localPoints={scan.customPoints?.[precisionMethod]??[]}
     onEditPoints={(points,removed)=>{
      const edits=scan.pointAdjustments?.[precisionMethod]??{};
      const remaining=removed?Object.fromEntries(Object.entries(edits).filter(([id])=>id!==removed&&!id.startsWith(removed+':'))):edits;
      updateScan({customPoints:{...scan.customPoints,[precisionMethod]:points},pointAdjustments:{...scan.pointAdjustments,[precisionMethod]:remaining}});
     }}
     adjustment={scan.cameraAdjustments?.[props.measurementPreview.plan.camera]}
     onAdjustment={adjustment=>updateScan({cameraAdjustments:{...scan.cameraAdjustments,[props.measurementPreview.plan.camera]:adjustment}})}/>:<p className="wa-muted">{!precisionMethod?'请选择精测量方式':
     ['laserSweep','fixedPhoto','continuous'].includes(precisionMethod)?'当前焊缝暂无可预览的测量点位':'当前方式暂无测量轨迹预览'}</p>}
   </div>}
  </div>
  <footer className="wa-footer">{props.onCancel&&<button type="button" className="btn" onClick={props.onCancel}>取消</button>}{tab==='welding'&&props.planningPointGroup?<button type="submit" form={planningFormId} disabled={blocked} className="btn primary">应用</button>:<button type="button" className="btn primary" disabled={props.busy||wrapFocus?.picking} onClick={()=>{for(const field of panel.current.querySelectorAll('input,select'))if(!field.checkValidity()){const section=field.closest('details');if(section)section.open=true;field.reportValidity();return;}onSave();}}>应用</button>}</footer>
 </section>;
}
