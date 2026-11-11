import React from 'react';
const number=value=>Number(value.toFixed(2));
const offsetFields=[['x','X 偏移'],['y','Y 偏移'],['z','Z 偏移']];
const poseFields=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
function PointAdjustment({point,onChange}){
 const field=([key,label],pose)=><label key={key}><span>{label} ({pose?'°':'mm'})</span><input
  aria-label={'点位'+label} type="number" step="any" value={point.override[key]??''}
  min={pose?-360:undefined} max={pose?360:undefined} placeholder={pose?String(point.originalPose[key]??0):'0'}
  onChange={event=>onChange(point.overrideKey,key,event.target.value===''?null:event.target.valueAsNumber)}/></label>;
 return <fieldset className="wa-point-adjustment"><legend>{point.name} · 偏移与姿态</legend>
  {offsetFields.map(item=>field(item,false))}{poseFields.map(item=>field(item,true))}
 </fieldset>;
}
export default function WeldPlanningPointList({groups,selectedId,onSelect,onAdjust}){
 const count=groups.reduce((sum,group)=>sum+group.points.length,0);
 const selected=groups.flatMap(group=>group.points).find(point=>point.id===selectedId);
 return <section className="wa-planning-points" aria-label="当前焊道规划点位"><header><strong>焊道点位</strong><span>{count} 个点</span></header>{selected?.overrideKey&&onAdjust&&<PointAdjustment point={selected} onChange={onAdjust}/>}
  {groups.map(group=><div className="wa-point-group" key={group.id}><h4>{group.name}</h4>{group.points.map((point,index)=><button type="button" className={(point.id===selectedId?'selected ':'')+point.source} key={point.id} aria-label={`规划点 ${group.name} ${point.name}`} aria-pressed={point.id===selectedId} onClick={()=>onSelect?.(point.id)}><span className="wa-point-index">{String(index+1).padStart(2,'0')}</span><span><strong>{point.name}</strong><small>{point.position?point.position.map(number).join(' / ')+' mm':'模型坐标待补充'}</small></span><em>{point.source==='template'?'模板点':point.source==='strategy'?'策略点':'焊道点'}</em></button>)}</div>)}</section>;
}
