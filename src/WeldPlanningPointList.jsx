import React from 'react';
const number=value=>Number(value.toFixed(2));
export default function WeldPlanningPointList({groups,selectedId,onSelect}){
 const count=groups.reduce((sum,group)=>sum+group.points.length,0);
 return <section className="wa-planning-points" aria-label="当前焊道规划点位"><header><strong>焊道点位</strong><span>{count} 个点</span></header>{groups.map(group=><div className="wa-point-group" key={group.id}><h4>{group.name}</h4>{group.points.map((point,index)=><button type="button" className={(point.id===selectedId?'selected ':'')+point.source} key={point.id} aria-label={`规划点 ${group.name} ${point.name}`} aria-pressed={point.id===selectedId} onClick={()=>onSelect?.(point.id)}><span className="wa-point-index">{String(index+1).padStart(2,'0')}</span><span><strong>{point.name}</strong><small>{point.position?point.position.map(number).join(' / ')+' mm':'模型坐标待补充'}</small></span><em>{point.source==='template'?'模板点':point.source==='strategy'?'策略点':'焊道点'}</em></button>)}</div>)}</section>;
}
