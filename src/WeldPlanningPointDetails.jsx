import React from 'react';
import {OVERRIDES} from './templateModel.mjs';
import {PASS_OFFSET_FIELDS,passOffsetValues} from './templatePassOffsets.mjs';

const positionFields=[['x','X'],['y','Y'],['z','Z']];
const poseFields=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
const display=(value,unit)=>Number.isFinite(value)?Number(value.toFixed(3))+' '+unit:'—';

function Values({rows}){
 return <dl className="wa-point-values">{rows.map(([label,value,unit])=><div key={label}><dt>{label}</dt><dd>{display(value,unit)}</dd></div>)}</dl>;
}

function PointAdjustment({point,onChange}){
 const field=([key,label],pose)=><label key={key}><span>{label} ({pose?'°':'mm'})</span><input
  aria-label={'点位'+label} type="number" step="any" value={point.override[key]??''}
  min={pose?-360:undefined} max={pose?360:undefined} placeholder={pose?String(point.originalPose[key]??0):'0'}
  onChange={event=>onChange(point.overrideKey,key,event.target.value===''?null:event.target.valueAsNumber)}/></label>;
 return <details className="wa-point-edit"><summary>调整偏移与姿态</summary><div className="wa-point-adjustment">
  {positionFields.map(([key,label])=>field([key,label+' 偏移'],false))}{poseFields.map(item=>field(item,true))}
 </div></details>;
}

export default function WeldPlanningPointDetails({point,group,layerOnly,onAdjust}){
 if(group&&!point){
  const offset=passOffsetValues(group.passOffset);
  return <section className="wa-point-details" aria-label="层道偏移">
   <h3>层道偏移</h3>
   <p className="wa-point-context">{[group.templateName,group.layerName,!layerOnly&&group.passName].filter(Boolean).join(' / ')}</p>
   <Values rows={[['层高',group.layerHeight??0,'mm'],...(!layerOnly?PASS_OFFSET_FIELDS.map(([key,label,unit])=>[label,offset[key],unit]):[])]}/>
  </section>;
 }
 if(!point)return <p className="wa-point-details wa-muted">在结构树中选择点位或层道。</p>;
 const pose=point.pose??point.angles;
 const overrides=Object.entries(OVERRIDES).filter(([key])=>Number.isFinite(point.overrides?.[key]));
 return <section className="wa-point-details" aria-label="点位详情">
  <h3>{point.name}</h3>
  {point.source==='manual'&&<p className="wa-point-context">基准点 {point.referenceName??'待确认'}</p>}
  <h4>位置</h4>
  <Values rows={positionFields.map(([,label],index)=>[label,point.position?.[index],'mm'])}/>
  <h4>姿态</h4>
  <Values rows={poseFields.map(([key,label])=>[label,pose?.[key],'°'])}/>
  <h4>工艺参数</h4>
  {point.tracking&&<p className="wa-point-context">跟踪方式 {point.tracking}</p>}
  {overrides.length?<Values rows={overrides.map(([key,[label,unit]])=>[label,point.overrides[key],unit])}/>:<p className="wa-muted">未设置点位工艺覆盖。</p>}
  {point.overrideKey&&onAdjust&&<PointAdjustment point={point} onChange={onAdjust}/>}
 </section>;
}
