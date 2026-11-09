import React,{useEffect,useId,useRef,useState} from 'react';
import {FileOutput,Info,ChevronDown} from 'lucide-react';
import {POSITIONS} from './templateModel.mjs';
import {weldForm} from './planningRequirements.mjs';
import {grooveType,grooveValue,GROOVE_TYPES,grooveFieldsFor} from './grooveModel.mjs';
import {processPositionLabel} from './processLibraryView.mjs';
import {WELD_TYPES,workFacesForType,patchWeldGroup,patchWeldSegment,patchWeldGroove,segmentName} from './weldAttributeModel.mjs';
import WeldPlanningPointList from './WeldPlanningPointList';
import {weldPlanningPointGroups} from './weldPlanningPoints.mjs';
import './weldAttributes.css';

const tabs=[['information','焊缝信息'],['welding','焊接规划'],['scanning','扫描规划']];
const precisionMethods=[['laserSweep','线激光推扫'],['lineIntersection','打线求交'],['fixedPhoto','定点拍照'],['manual','手动精定位'],['continuous','连续扫描'],['separateEnds','首尾分别设置']];
const endpointPrecisionMethods=precisionMethods.slice(0,5);
function Row({label,children}){return <div className="wa-row"><span>{label}</span>{children}</div>;}
function Options({label,value,onChange,values,placeholder='请选择',...props}){return <span className="wa-select"><select aria-label={label} value={value??''} onChange={event=>onChange(event.target.value)} {...props}>{!value&&<option value="">{placeholder}</option>}{value&&!values.some(v=>(Array.isArray(v)?v[0]:v)===value)&&<option value={value}>{value}</option>}{values.map(item=>{const [id,name]=Array.isArray(item)?item:[item,item];return <option key={id} value={id}>{name}</option>;})}</select><ChevronDown size={12}/></span>;}
function Toggle({label,value,onChange,values}){return <div className="wa-toggle" role="group" aria-label={label}>{values.map(([id,name])=><button type="button" key={id} aria-pressed={value===id} className={value===id?'active':''} onClick={()=>onChange(id)}>{name}</button>)}</div>;}
function NumberField({label,value,onChange,unit,min=0,max,step='any',disabled=false}){return <span className={'wa-number'+(disabled?' disabled':'')}><input aria-label={label} type="number" min={min} max={max} step={step} disabled={disabled} required={!disabled} value={value??''} onChange={event=>{const number=event.target.value===''?'':+event.target.value;if(number===''||Number.isFinite(number)&&number>=min&&(max===undefined||number<=max))onChange(number);}}/>{unit&&<small>{unit}</small>}</span>;}

function MatchCard({label,value,onChoose,onCreate,needsCreation}){
 return <div className="wa-match-card">
  <button className="wa-choose-match" type="button" aria-label={'选择'+label} onClick={onChoose}>
   <span>{label}<FileOutput size={13}/></span><small>{value||'未选择'+label}</small>
  </button>
  {needsCreation&&(onCreate?
   <button className="wa-create-match" type="button" onClick={onCreate}>需要创建{label}</button>:
   <p className="wa-create-match">需要创建{label}</p>)}
 </div>;
}

export default function WeldAttributes(props){
 const {weld:w,templates,processLibrary,onPatch,onSave,deviceProfiles=[]}=props,id=useId(),panel=useRef();
 const [tab,setTab]=useState('information'),[segmentIndex,setSegmentIndex]=useState(0);
 useEffect(()=>{props.onPlanningViewChange?.(tab==='welding');return()=>props.onPlanningViewChange?.(false);},[tab,props.onPlanningViewChange]);
 useEffect(()=>{setSegmentIndex(0);},[w.id]);
 useEffect(()=>{const body=panel.current?.querySelector('.wa-scroll');if(body)body.scrollTop=0;},[tab,w.id]);
 const index=Math.min(segmentIndex,Math.max(0,w.segments.length-1)),segment=w.segments[index],groove=w.groove||{type:'无坡口',angle:0,depth:0},inactive=grooveType(groove.type)==='无坡口';
 const template=templates.find(t=>t.id===w.templateId)||templates.find(t=>t.name===w.template),process=processLibrary.find(p=>p.id===w.processId),robot=w.robotModel||w.robotName||deviceProfiles.find(p=>p.enabled)?.applicability?.robotModel;
 const setGroup=(key,value)=>onPatch('segments',patchWeldGroup(w,key,value)),setSegment=(key,value)=>onPatch('segments',patchWeldSegment(w,index,key,value)),setGroove=(key,value)=>onPatch('groove',patchWeldGroove(w,key,value));
 const wrapValues=[['none','不包角'],['half','半包角'],['full','全包角']],scan=w.scanSettings||{};
 const precisionMethod=scan.precisionMethod??(scan.mode==='laser'?'laserSweep':'');
 const updateScan=values=>onPatch('scanSettings',{...scan,...values});
 const pending=w.enabled&&props.decision?.route==='blocked'?props.decision:null;
 const needsProcess=pending?.creation==='template-or-process';
 const needsTemplate=needsProcess||pending?.creation==='template';
 const workFaces=workFacesForType(props.workpieceType),workFaceValid=workFaces.includes(w.workFace),workFacePending=!!w.workFace&&!workFaceValid;
 function tabKey(event){const at=tabs.findIndex(([key])=>key===tab),next=event.key==='ArrowRight'?(at+1)%tabs.length:event.key==='ArrowLeft'?(at+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;if(next<0)return;event.preventDefault();setTab(tabs[next][0]);event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus();}
 return <section ref={panel} className="weld-attributes-panel" aria-label="焊缝属性">
  <header className="wa-header">焊缝属性</header>
  <div className="wa-summary">
   <div className="wa-group"><input aria-label="焊缝名称" required maxLength={80} value={w.name} title={w.name} onChange={event=>onPatch('name',event.target.value)}/><div className="wa-segments" role="group" aria-label="选择焊缝段">{w.segments.map((s,i)=><button type="button" key={i} title={segmentName(w,i)} aria-pressed={i===index} className={i===index?'active':''} onClick={()=>setSegmentIndex(i)}>{segmentName(w,i)}</button>)}</div></div>
   <div className="wa-template-cards" key={w.id}>
    <MatchCard label="焊接模板" value={template?.name||w.template} onChoose={props.onChooseTemplate}
     onCreate={props.onCreateWhole} needsCreation={needsTemplate}/>
    <MatchCard label="工艺参数" value={process?.name||w.processName||template?.baseProcess?.name} onChoose={props.onChooseProcess}
     onCreate={props.onCreateProcess} needsCreation={needsProcess}/>
   </div>
   {pending&&<div className="wa-pending-actions">
    <button type="button" onClick={props.onDisable}>屏蔽焊缝</button>
    <button type="button" onClick={props.onDelete}>删除焊缝</button>
   </div>}
   <div className="wa-tabs" role="tablist" aria-label="焊缝属性标签页">{tabs.map(([key,label])=><button type="button" key={key} role="tab" id={id+'-'+key} aria-selected={tab===key} aria-controls={id+'-panel'} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={tabKey}>{label}</button>)}</div>
  </div>
  <div className="wa-scroll" role="tabpanel" id={id+'-panel'} aria-labelledby={id+'-'+tab}>
   {tab==='information'?<div className="wa-information">
    <h3 className="wa-section-heading">焊缝组</h3>
    <Row label="焊缝形式"><Options label="焊缝形式" value={weldForm(w)} onChange={value=>onPatch('weldType',value)} values={WELD_TYPES.map(([name])=>name)}/></Row>
    <Row label="焊接方式"><Options label="焊接方式" value={String(w.machineCount??1)} onChange={value=>onPatch('machineCount',Number(value))} values={[[ '1','单机焊接'],['2','双机焊接']]}/></Row>
    <Row label="接头形式"><Options label="接头形式" value={w.joint} onChange={value=>setGroup('joint',value)} values={['T 形接头','角接头','搭接接头','对接接头']}/></Row>
    <Row label="工作面"><Options label="工作面" required={workFaces.length>0} disabled={!workFaces.length} value={workFaceValid?w.workFace:''} placeholder={workFaces.length?'请选择':'请先选择工件种类'} onChange={value=>{if(workFaces.includes(value))onPatch('workFace',value);}} values={workFaces}/></Row>
    {workFacePending&&<p className="wa-work-face-note">原工作面“{w.workFace}”已保留，{workFaces.length?'不适用于当前工件种类，请重新选择。':'请先选择工件种类后确认。'}</p>}
    <Row label="焊接位置"><Options label="焊接位置" value={w.position} onChange={value=>setGroup('position',value)} values={POSITIONS.map(value=>[value,value.startsWith('PF')?'立向上焊':value.startsWith('PG')?'立向下焊':processPositionLabel(value)])}/></Row>
    <Row label="焊脚高度"><NumberField label="焊脚尺寸" min={.5} step={.5} value={w.leg} unit="mm" onChange={value=>{if(value!==''&&Number.isInteger(value*2))onPatch('leg',value);}}/></Row>
    <h3 className="wa-section-heading wa-segment-heading">{segmentName(w,index)}</h3>
    <Row label="执行机器人"><span className="wa-readonly" title={robot||'未配置'}>{robot||'未配置'}</span></Row>
    <Row label="起点包角"><Options label="起点包角" value={segment?.startWrapMode??w.startWrapMode??'none'} onChange={value=>setSegment('startWrapMode',value)} values={wrapValues}/></Row>
    <Row label="终点包角"><Options label="终点包角" value={segment?.endWrapMode??w.endWrapMode??'none'} onChange={value=>setSegment('endWrapMode',value)} values={wrapValues}/></Row>
    <Row label="焊缝长度"><span className="wa-readonly wa-length"><span>{Number.isFinite(w.length)?Number(w.length.toFixed(1)):'—'}</span><small>mm</small></span></Row>
    <Row label="焊缝跟踪"><Toggle label="焊缝跟踪" value={segment?.tracking??w.tracking??'无跟踪'} onChange={value=>setSegment('tracking',value)} values={[[ '无跟踪','无'],['激光跟踪','激光跟踪'],['电弧跟踪','电弧跟踪']]}/></Row>
    <Row label="坡口类型"><Options label="焊道坡口类型" required placeholder={GROOVE_TYPES.includes(grooveType(groove.type))?'请选择':'请选择支持的坡口类型'} value={GROOVE_TYPES.includes(grooveType(groove.type))?grooveType(groove.type):''} onChange={value=>setGroove('type',value)} values={GROOVE_TYPES.map(value=>[value,value.replace(' ','')])}/></Row>
    {segment?.endpointFacts&&<details className="wa-geometry-details"><summary>焊缝段几何信息</summary><dl><dt>几何轮廓</dt><dd>{segment.geometry} · {w.closure==='closed'?'闭合':'开放'}</dd><dt>焊缝段长度</dt><dd>{Number(segment.length.toFixed(1))} mm</dd><dt>板厚</dt><dd>{segment.plateThickness?.主板厚度??'—'} / {segment.plateThickness?.副板厚度??'—'} mm</dd><dt>主副板夹角</dt><dd>{Number.isFinite(segment.jointAngle)?segment.jointAngle+'°':'—'}</dd><dt>焊缝边缘距离</dt><dd>{Number.isFinite(segment.edgeDistance)?segment.edgeDistance.toFixed(1)+' mm':'—'}</dd>{[['start','起点'],['end','终点']].map(([key,label])=>{const facts=segment.endpointFacts[key];return <React.Fragment key={key}><dt>{label}特征</dt><dd>{facts?.type??'—'}</dd><dt>{label}过焊孔尺寸</dt><dd>{Number.isFinite(facts?.holeSize)?facts.holeSize.toFixed(1)+' mm':'—'}</dd><dt>{label}间隙距离</dt><dd>{Number.isFinite(facts?.gap)?facts.gap.toFixed(1)+' mm':'—'}</dd><dt>{label}到主板端部距离</dt><dd>{Number.isFinite(facts?.mainEdgeDistance)?facts.mainEdgeDistance.toFixed(1)+' mm':'—'}</dd></React.Fragment>;})}</dl></details>}
    <h4 className="wa-groove-heading">坡口尺寸<Info size={11}/></h4>
    <div className="wa-groove-grid">{grooveFieldsFor(groove.type).map(([key,label,unit,max])=><label key={key}><span>{label}</span><NumberField label={'焊道'+label} min={0} max={max} disabled={inactive} value={key==='rootFace'?(groove.rootFace??0):grooveValue(groove,key)} onChange={value=>setGroove(key,value)}/></label>)}</div>
   </div>:tab==='welding'?<WeldPlanningPointList groups={props.planningPointGroups||weldPlanningPointGroups(w,props.decision,templates,processLibrary)} selectedId={props.selectedPlanningPointId} onSelect={props.onPlanningPointSelect}/>:<div className="wa-scan-settings">
    <h3 className="wa-section-heading">扫描配置</h3>
    <Row label="精测量方式"><Options label="精测量方式" value={precisionMethod} values={precisionMethods} onChange={precisionMethod=>updateScan({precisionMethod})}/></Row>
    {precisionMethod==='separateEnds'?<>
     <Row label="起点精测量方式"><Options label="起点精测量方式" required value={scan.startPrecisionMethod} values={endpointPrecisionMethods} onChange={startPrecisionMethod=>updateScan({startPrecisionMethod})}/></Row>
     <Row label="终点精测量方式"><Options label="终点精测量方式" required value={scan.endPrecisionMethod} values={endpointPrecisionMethods} onChange={endPrecisionMethod=>updateScan({endPrecisionMethod})}/></Row>
    </>:precisionMethod&&<Row label="精测量范围"><Options label="精测量范围" value={scan.measurementScope??'both'} values={[[ 'start','仅精测量起点'],['both','首尾精测量']]} onChange={measurementScope=>updateScan({measurementScope})}/></Row>}
    <Row label="扫描方向"><Options label="扫描方向" disabled={!precisionMethod} value={scan.direction||'forward'} values={[[ 'forward','沿焊接方向'],['reverse','逆焊接方向']]} onChange={direction=>updateScan({direction})}/></Row>
    <p className="wa-muted">{precisionMethod?'未连接扫描设备':'当前焊缝未设置精测量方式'}</p>
   </div>}
  </div>
  <footer className="wa-footer">{props.onCancel&&<button type="button" className="btn" onClick={props.onCancel}>取消</button>}<button type="button" className="btn primary" onClick={()=>{for(const field of panel.current.querySelectorAll('input,select'))if(!field.checkValidity()){field.reportValidity();return;}onSave();}}>应用</button></footer>
 </section>;
}
