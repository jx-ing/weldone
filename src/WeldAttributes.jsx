import React,{useEffect,useId,useRef,useState} from 'react';
import {formatLength} from './WorkspaceUI';
import {FileOutput,Info,ChevronDown,Plus,TriangleAlert} from 'lucide-react';
import {POSITIONS} from './templateModel.mjs';
import {weldForm,weldPositionCode} from './planningRequirements.mjs';
import {grooveType,grooveValue,GROOVE_TYPES,grooveFieldsFor} from './grooveModel.mjs';
import {weldWrapJunctions} from './weldWrapJunctions.mjs';
import {weldTravelReversed} from './weldDirectionGeometry.mjs';
import {processPositionLabel} from './processLibraryView.mjs';
import {WELD_TYPES,patchWeldGroup,patchWeldSegment,patchWeldGroove,segmentName} from './weldAttributeModel.mjs';
import WeldPlanningPointDetails from './WeldPlanningPointDetails';
import './weldAttributes.css';

const tabs=[['information','焊缝信息'],['welding','焊接规划'],['scanning','扫描规划']];
const precisionMethods=[['laserSweep','线激光推扫'],['lineIntersection','打线求交'],['fixedPhoto','定点拍照'],['manual','手动精定位'],['continuous','连续扫描'],['separateEnds','首尾分别设置']];
const endpointPrecisionMethods=precisionMethods.slice(0,5);
function Row({label,children}){return <div className="wa-row"><span>{label}</span>{children}</div>;}
function Options({label,value,onChange,values,placeholder='请选择',...props}){return <span className="wa-select"><select aria-label={label} value={value??''} onChange={event=>onChange(event.target.value)} {...props}>{!value&&<option value="">{placeholder}</option>}{value&&!values.some(v=>(Array.isArray(v)?v[0]:v)===value)&&<option value={value}>{value}</option>}{values.map(item=>{const [id,name]=Array.isArray(item)?item:[item,item];return <option key={id} value={id}>{name}</option>;})}</select><ChevronDown size={12}/></span>;}
function NumberField({label,value,onChange,unit,min=0,max,step='any',disabled=false}){return <span className={'wa-number'+(disabled?' disabled':'')}><input aria-label={label} type="number" min={min} max={max} step={step} disabled={disabled} required={!disabled} value={value??''} onChange={event=>{const number=event.target.value===''?'':+event.target.value;if(number===''||Number.isFinite(number)&&number>=min&&(max===undefined||number<=max))onChange(number);}}/>{unit&&<small>{unit}</small>}</span>;}

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
 useEffect(()=>{setSegmentIndex(0);},[w.id]);
 useEffect(()=>{const body=panel.current?.querySelector('.wa-scroll');if(body)body.scrollTop=0;},[tab,w.id,props.planningSelection]);
 const index=Math.min(segmentIndex,Math.max(0,w.segments.length-1)),segment=w.segments[index],groove=w.groove||{type:'无坡口',angle:0,depth:0},inactive=grooveType(groove.type)==='无坡口';
 const template=templates.find(t=>t.id===w.templateId&&t.enabled!==false),process=processLibrary.find(p=>p.id===w.processId);
 const setGroup=(key,value)=>onPatch('segments',patchWeldGroup(w,key,value)),setSegment=(key,value)=>onPatch('segments',patchWeldSegment(w,index,key,value)),setGroove=(key,value)=>onPatch('groove',patchWeldGroove(w,key,value));
 const wrapJunctions=weldWrapJunctions(w);
 const wrapChoices=[['U','U形包角'],['L','L形包角'],['none','不包角']];
 const wrapValues=[['none','不包角'],['half','半包角'],['full','全包角']],scan=w.scanSettings||{};
 const reverse=weldTravelReversed(w);
 const wrapEndpoint=side=>{
  const key=reverse?(side==='start'?'end':'start'):side;
  const mode=key+'WrapMode',kind=key+'WrapKind',endpoint=index===(key==='start'?0:w.segments.length-1);
  const next=w.segments[index+(reverse?-1:1)];
  if(side==='start'&&weldPositionCode(segment?.position)==='PF'||side==='end'&&weldPositionCode(next?.position)==='PF')return {mode,value:'none',kind:null};
  return {mode,value:segment?.[mode]??(endpoint?w[mode]:undefined)??'none',kind:segment?.[kind]};
 };
 const precisionMethod=scan.precisionMethod??(scan.mode==='laser'?'laserSweep':'');
 const canReverse=w.closure!=='closed'&&w.segments.length>0&&w.segments.every(
  segment=>weldPositionCode(segment.position)==='PB'&&segment.pathPoints?.length>=2
 );
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
  <div className="wa-summary">
   <div className="wa-group">
    <input aria-label="焊缝名称" required maxLength={80} value={w.name} title={w.name} onChange={event=>onPatch('name',event.target.value)}/>
    {props.onSeparateSegments&&<button type="button" className="btn wa-separate-button" onClick={props.onSeparateSegments}>拆分</button>}
    <div className="wa-segments" role="group" aria-label="选择焊缝段">{w.segments.map((s,i)=><button type="button" key={i} title={segmentName(w,i)} aria-pressed={i===index} className={i===index?'active':''} onClick={()=>setSegmentIndex(i)}>{segmentName(w,i)}</button>)}</div>
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
    {canReverse&&<Row label="焊接方向"><Options label="焊接方向" value={w.direction==='反向'?'反向':'正向'}
     disabled={!w.enabled||!!w.mergedInto||!!w.splitInto}
     onChange={value=>onPatch('direction',value)} values={['正向','反向']}/></Row>}
    <Row label="焊脚高度"><NumberField label="焊脚尺寸" min={w.calculatedLeg?0:.5} step={w.calculatedLeg?'any':.5} value={w.leg} unit="mm" onChange={value=>{if(value>0&&(w.calculatedLeg||Number.isInteger(value*2)))onPatch('leg',value);}}/></Row>
    </details><details className="wa-section" open><summary>包角</summary>
    {wrapJunctions.length>0?wrapJunctions.map(({id,type,canUseU},index)=>{
     const label='段连接点'+(wrapJunctions.length>1?index+1:'');
     return <Row key={id} label={label}><Options label={label} value={type} disabled={!w.enabled||!!w.mergedInto||!!w.splitInto}
      values={canUseU?wrapChoices:wrapChoices.slice(1)} onChange={next=>props.onWrapChange(id,next)}/></Row>;
    }):[['start','起点包角'],['end','终点包角']].map(([side,label])=>{
     const {mode,value,kind}=wrapEndpoint(side);
     return <Row key={side} label={label}>{kind!==undefined?<span className="wa-readonly" aria-label={label}>{kind?kind+'形包角':'不包角'}</span>:
      <Options label={label} value={value} onChange={next=>setSegment(mode,next)} values={wrapValues}/>}</Row>;
    })}
    </details>{w.collisionState&&<Row label="机头碰撞检测"><span className="wa-readonly">{w.collisionState}</span></Row>}<Row label="焊缝长度"><span className="wa-readonly wa-length"><span>{Number.isFinite(w.length)?formatLength(w.length):'—'}</span><small>mm</small></span></Row>
    <Row label="焊缝跟踪"><div className="wa-tracking" role="group" aria-label="焊缝跟踪">
     {[['arcTracking','effectiveArcTracking','电弧跟踪'],['laserTracking','effectiveLaserTracking','激光跟踪']].map(([key,resolved,label])=><label key={key}>
      <input type="checkbox" checked={props.trackingSegments?.[index]?.[resolved]??false} onChange={event=>setSegment(key,event.target.checked)}/>{label}
     </label>)}
    </div></Row>
    <details className="wa-section"><summary>坡口 · {grooveType(groove.type)}</summary><Row label="坡口类型"><Options label="焊道坡口类型" required placeholder={GROOVE_TYPES.includes(grooveType(groove.type))?'请选择':'请选择支持的坡口类型'} value={GROOVE_TYPES.includes(grooveType(groove.type))?grooveType(groove.type):''} onChange={value=>setGroove('type',value)} values={GROOVE_TYPES.map(value=>[value,value.replace(' ','')])}/></Row>
    <h4 className="wa-groove-heading">坡口尺寸<Info size={11}/></h4>
    <div className="wa-groove-grid">{grooveFieldsFor(groove.type).map(([key,label,unit,max])=><label key={key}><span>{label}</span><NumberField label={'焊道'+label} min={0} max={max} disabled={inactive} value={key==='rootFace'?(groove.rootFace??0):grooveValue(groove,key)} onChange={value=>setGroove(key,value)}/></label>)}</div>
   </details></div>:tab==='welding'?<WeldPlanningPointDetails point={props.planningPoint} actualPose={props.planningPointPose} passPreview={props.planningPassPreview} basePosition={props.planningPointBasePosition} formId={planningFormId} group={props.planningPointGroup} layerOnly={props.planningSelection?.type==='layer'} editable={w.enabled&&!w.mergedInto&&!w.splitInto} onSavePoint={props.onSavePoint} onSaveLayerOrPass={props.onSaveLayerOrPass} onOffsetPreview={props.onOffsetPreview} onOffsetPreviewEnd={props.onOffsetPreviewEnd}/>:<div className="wa-scan-settings">
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
  <footer className="wa-footer">{props.onCancel&&<button type="button" className="btn" onClick={props.onCancel}>取消</button>}{tab==='welding'&&props.planningPointGroup?<button type="submit" form={planningFormId} disabled={!w.enabled||!!w.mergedInto||!!w.splitInto} className="btn primary">应用</button>:<button type="button" className="btn primary" onClick={()=>{for(const field of panel.current.querySelectorAll('input,select'))if(!field.checkValidity()){const section=field.closest('details');if(section)section.open=true;field.reportValidity();return;}onSave();}}>应用</button>}</footer>
 </section>;
}
