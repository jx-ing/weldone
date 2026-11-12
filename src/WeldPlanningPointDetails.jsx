import React,{useState} from 'react';
import {OVERRIDES,TRACKING} from './templateModel.mjs';
import {PASS_OFFSET_FIELDS,passOffsetValues,validPassOffsets} from './templatePassOffsets.mjs';
import {weldControlPointError} from './weldPlanningPoints.mjs';

const positionFields=['X','Y','Z'];
const poseFields=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
const display=(value,unit)=>Number.isFinite(value)?Number(value.toFixed(3))+' '+unit:'—';

function LayerOrPassEditor({group,layerOnly,editable,onSave,formId}){
 const [draft,setDraft]=useState(()=>layerOnly?{name:group.layerName,height:group.layerHeight}:{name:group.passName,offset:passOffsetValues(group.passOffset)});
 const [status,setStatus]=useState('');
 const change=values=>{setDraft(previous=>({...previous,...values}));setStatus('');};
 const number=(label,unit,value,onChange)=><label key={label}><span>{label} ({unit})</span>
  <input aria-label={label} type="number" step="any" required max={unit==='°'?360:undefined} min={unit==='°'?-360:undefined}
   value={value} onChange={event=>onChange(event.target.value===''?'':event.target.valueAsNumber)}/>
 </label>;
 function save(event){
  event.preventDefault();
  const name=draft.name.trim();
  if(!name)return setStatus('请输入名称');
  if(layerOnly?!Number.isFinite(draft.height):!validPassOffsets(draft.offset))return setStatus('请输入有效的偏移值');
  setStatus(onSave(group,{...draft,name},layerOnly)||'已保存');
 }
 return <form id={formId} className="wa-point-details" aria-label="层道偏移" onSubmit={save}>
  <h3>层道偏移</h3>
  <p className="wa-point-context">{[group.layerName,!layerOnly&&group.passName].filter(Boolean).join(' / ')}</p>
  {group.derived&&<p className="wa-point-context">相对第一层第一道</p>}
  <fieldset className="wa-point-adjustment" disabled={!editable}>
   <label><span>{layerOnly?'层名称':'道名称'}</span><input aria-label={layerOnly?'层名称':'道名称'} value={draft.name} maxLength={40} required onChange={event=>change({name:event.target.value})}/></label>
   {layerOnly?number('层高','mm',draft.height,height=>change({height})):
    PASS_OFFSET_FIELDS.map(([key,label,unit])=>number(label,unit,draft.offset[key],value=>change({offset:{...draft.offset,[key]:value}})))}
  </fieldset>
  {status&&<p role="status">{status}</p>}
 </form>;
}

function offsetValue(event,blank){
 return event.target.value===''?blank:event.target.valueAsNumber;
}

function OffsetRow({label,offsetLabel,base,unit,value,onChange,disabled,optional=false,min,max}){
 return <label className="wa-offset-row">
  <span>{label}</span>
  <span className="wa-offset-value">{display(base,unit)}</span>
  <span aria-hidden="true">+</span>
  <span className="wa-offset-input"><input aria-label={offsetLabel} type="number" step="any" min={min} max={max}
   value={value??''} placeholder={optional?'—':undefined} disabled={disabled} required={!optional}
   onChange={event=>onChange(offsetValue(event,optional?null:''))}/><span>{unit}</span></span>
 </label>;
}

function PointEditor({point,basePosition,group,editable,onSave,formId}){
 const derived=group.derived&&['start','end'].includes(point.kind);
 const [draft,setDraft]=useState(()=>({
  ...point.raw,
  offset:{...point.raw.offset},
  poseOffset:Object.fromEntries(poseFields.map(([key])=>[key,(point.raw.poseOffset?.[key]??0)+(derived?point.raw.angles[key]:0)])),
  processOffset:{...point.raw.processOffset}
 }));
 const [status,setStatus]=useState('');
 const change=(section,key,value)=>{setDraft(previous=>({...previous,[section]:{...previous[section],[key]:value}}));setStatus('');};
 const poseDelta=key=>(point.raw.poseOffset?.[key]??0)+(derived?point.raw.angles[key]:0);
 function save(event){
  event.preventDefault();
  const processOffset=Object.fromEntries(Object.entries(draft.processOffset).filter(([,value])=>value!==null));
  for(const [key,value] of Object.entries(processOffset)){
   if(!Number.isFinite(value)||(point.processBase[key]??0)+value<OVERRIDES[key][2])return setStatus(OVERRIDES[key][0]+'叠加偏移后超出有效范围');
  }
  const saved={...draft,name:draft.name.trim(),groupId:group.id,processOffset};
  if(derived){saved.angles=draft.poseOffset;delete saved.poseOffset;}
  const anchors=group.points.filter(p=>p.source==='weld').map(p=>({...p,id:p.raw.id}));
  setStatus(weldControlPointError(saved,anchors)||onSave(saved)||'已保存');
 }
 return <form id={formId} className="wa-point-details" aria-label="点位详情" onSubmit={save}>
  <label className="wa-point-title"><span>点位名称</span>
   <input aria-label="点位名称" value={draft.name} required maxLength={40} disabled={!editable}
    onChange={event=>{setDraft(previous=>({...previous,name:event.target.value}));setStatus('');}}/>
  </label>
  {point.kind==='control'&&<label className="wa-offset-row wa-point-tracking"><span>基准点</span>
   <select aria-label="基准点" value={draft.referenceId} disabled={!editable} onChange={event=>{setDraft(previous=>({...previous,referenceId:event.target.value}));setStatus('');}}>
    {group.points.filter(p=>p.source==='weld').map(p=><option key={p.id} value={p.raw.id}>{p.name}</option>)}
   </select>
  </label>}
  <h4>位置</h4>
  <p className="wa-point-context">位置偏移沿焊缝局部坐标轴</p>
  {positionFields.map((label,index)=><OffsetRow key={label} label={label+' + '+label.toLowerCase()} offsetLabel={label+' 偏移'}
   base={basePosition?.[index]} unit="mm" value={draft.offset[label.toLowerCase()]} disabled={!editable}
   onChange={value=>change('offset',label.toLowerCase(),value)}/>)}
  <h4>姿态</h4>
  {poseFields.map(([key,label])=><OffsetRow key={key} label={label} offsetLabel={label+'偏移'}
   base={point.pose?.[key]-poseDelta(key)} unit="°" value={draft.poseOffset[key]} min={-360} max={360}
   disabled={!editable} onChange={value=>change('poseOffset',key,value)}/>)}
  <h4>工艺参数</h4>
  <label className="wa-offset-row wa-point-tracking"><span>跟踪方式</span>
   <select aria-label="跟踪方式" value={draft.tracking} disabled={!editable} onChange={event=>{setDraft(previous=>({...previous,tracking:event.target.value}));setStatus('');}}>
    {derived&&<option value="">继承第一层第一道</option>}
    {TRACKING.map(mode=><option key={mode}>{mode}</option>)}
   </select>
  </label>
  {Object.entries(OVERRIDES).map(([key,[label,unit]])=><OffsetRow key={key} label={label} offsetLabel={label+'偏移'}
   base={point.processBase[key]} unit={unit} value={draft.processOffset[key]} optional disabled={!editable}
   onChange={value=>change('processOffset',key,value)}/>)}
  {status&&<p role="status" className="wa-offset-status">{status}</p>}
 </form>;
}

export default function WeldPlanningPointDetails({point,basePosition,group,layerOnly,editable,onSavePoint,onSaveLayerOrPass,formId}){
 if(group&&!point)return <LayerOrPassEditor key={layerOnly?group.layerId:group.id} formId={formId} group={group} layerOnly={layerOnly} editable={editable} onSave={onSaveLayerOrPass}/>;
 if(!point||!group)return <p className="wa-point-details wa-muted">在结构树中选择点位或层道。</p>;
 return <PointEditor key={point.id} formId={formId} point={point} basePosition={basePosition} group={group} editable={editable} onSave={onSavePoint}/>;
}
