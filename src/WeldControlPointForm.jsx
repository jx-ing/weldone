import React,{useState} from 'react';
import {point,TRACKING,OVERRIDES} from './templateModel.mjs';
import {weldControlPointError} from './weldPlanningPoints.mjs';
import WeldPoseHelp from './WeldPoseHelp';

const xyzFields=[['x','X 偏移'],['y','Y 偏移'],['z','Z 偏移']];
const angleFields=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];

export default function WeldControlPointForm({groups,initialGroup,existing,onSave,onCancel}){
 const [draft,setDraft]=useState(()=>{
  let index=1;
  while(existing.some(item=>item.name==='控制点'+index))index++;
  return {...point('control',1,0,'控制点'+index),referenceId:groups.find(group=>group.id===initialGroup)?.points[0]?.raw.id??groups[0]?.points[0]?.raw.id??'',groupId:initialGroup??groups[0]?.id??''};
 });
 const [error,setError]=useState('');
 const group=groups.find(group=>group.id===draft.groupId);
 const anchors=(group?.points??[]).filter(p=>p.source==='weld').map(p=>({...p,id:p.raw.id}));
 const change=(key,value)=>{setDraft(previous=>({...previous,[key]:value}));setError('');};
 const number=(key,label,unit,value,onChange,limits={})=><label className="tpl-field" key={key}>
  <span>{label}</span><span className="tpl-number"><input aria-label={label} type="number" step="any" value={value??''}
   min={limits.min} max={limits.max} required={limits.required} onChange={event=>onChange(event.target.value===''?'':event.target.valueAsNumber)}/><small>{unit}</small></span>
 </label>;
 async function submit(event){
  event.preventDefault();
  const saved={...draft,name:draft.name.trim()};
  const issue=weldControlPointError(saved,anchors);
  setError(issue||await onSave(saved)||'');
 }
 return <form className="weld-control-point-form" onSubmit={submit}>
  <div className="dialog-body">
   <div className="tpl-form-grid">
    <label className="tpl-field"><span>点位名称</span><input aria-label="点位名称" required maxLength={40} value={draft.name} onChange={event=>change('name',event.target.value)}/></label>
    <label className="tpl-field"><span>所属层道</span><select aria-label="所属层道" value={draft.groupId} onChange={event=>{const group=groups.find(item=>item.id===event.target.value);setDraft(previous=>({...previous,groupId:group.id,referenceId:group.points[0]?.raw.id??''}));setError('');}}>
     {groups.map(group=><option key={group.id} value={group.id}>{group.layerId?[group.templateName,group.layerName,group.passName].filter(Boolean).join(' / '):'焊缝点位'}</option>)}
    </select></label>
    <label className="tpl-field"><span>基准点</span><select aria-label="基准点" required value={draft.referenceId} onChange={event=>change('referenceId',event.target.value)}>
     <option value="">请选择基准点</option>{anchors.map(anchor=><option key={anchor.id} value={anchor.id}>{anchor.name}</option>)}
    </select></label>
    <label className="tpl-field"><span>跟踪方式</span><select aria-label="跟踪方式" value={draft.tracking} onChange={event=>change('tracking',event.target.value)}>
     {TRACKING.map(mode=><option key={mode}>{mode}</option>)}
    </select></label>
   </div>
   <h3>位置偏移</h3>
   <div className="tpl-form-grid three">{xyzFields.map(([key,label])=>number(key,label,'mm',draft.offset[key],value=>change('offset',{...draft.offset,[key]:value}),{required:true}))}</div>
   <h3>姿态</h3>
   <WeldPoseHelp/>
   <div className="tpl-form-grid three">{angleFields.map(([key,label])=>number(key,label,'°',draft.angles[key],value=>change('angles',{...draft.angles,[key]:value}),{min:-360,max:360,required:true}))}</div>
   <h3>工艺覆盖</h3>
   <div className="tpl-form-grid three">{Object.entries(OVERRIDES).map(([key,[label,unit,min]])=>number(key,label,unit,draft.overrides[key],value=>{
    const overrides={...draft.overrides};
    if(value==='')delete overrides[key];else overrides[key]=value;
    change('overrides',overrides);
   },{min}))}</div>
   {error&&<p role="alert" className="tpl-errors">{error}</p>}
  </div>
  <footer>{onCancel&&<button type="button" className="btn" onClick={onCancel}>取消</button>}<button type="submit" className="btn primary">添加点位</button></footer>
 </form>;
}
