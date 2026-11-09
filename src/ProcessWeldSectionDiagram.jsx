import React,{useId,useMemo,useState} from 'react';
import {Maximize2,RotateCcw} from 'lucide-react';
import {processPasses} from './processParameterModel.mjs';
import {processWeldSection,sectionCurve} from './processWeldSectionModel.mjs';
import './processWeldSection.css';

const W=410,H=390,LEFT=52,BOTTOM=358;
const clean=value=>Number(value.toFixed(2));
function ticks(min,max){const span=max-min,power=10**Math.floor(Math.log10(span/10)),step=[1,2,5,10].map(v=>v*power).find(v=>v>=span/10)||power*10;return Array.from({length:Math.floor(span/(step/10))+1},(_,i)=>({value:clean(min+i*step/10),major:i%10===0}));}
export default function ProcessWeldSectionDiagram({entry,selectedId,onSelect}){
 const [fit,setFit]=useState(false),id=useId(),model=useMemo(()=>processWeldSection(entry,selectedId,fit),[entry,selectedId,fit]),rows=processPasses(entry);
 const x=value=>LEFT+(value-model.domain.x[0])/(model.domain.x[1]-model.domain.x[0])*(W-LEFT-14),y=value=>BOTTOM-(value-model.domain.y[0])/(model.domain.y[1]-model.domain.y[0])*(BOTTOM-14),point=value=>`${x(value[0])},${y(value[1])}`;
 const control=(distance,start,end)=>{const a=sectionCurve(distance,start),b=sectionCurve(distance,end),mid=sectionCurve(distance,(start+end)/2);return mid.map((v,i)=>2*v-(a[i]+b[i])/2);};
 const shape=bead=>`M${point(sectionCurve(bead.inner,bead.start))} Q${point(control(bead.inner,bead.start,bead.end))} ${point(sectionCurve(bead.inner,bead.end))} L${point(sectionCurve(bead.outer,bead.end))} Q${point(control(bead.outer,bead.end,bead.start))} ${point(sectionCurve(bead.outer,bead.start))} Z`;
 const angle=model.angle===null?0:((model.angle%360)+540)%360-180,radius=Math.max(3,Math.min(6,(model.leg||6)*.7)),center=model.wire?.from,arcEnd=center?.map((v,i)=>v+radius*(i?Math.sin(angle*Math.PI/180):Math.cos(angle*Math.PI/180)));
 return <figure className="process-weld-section" aria-label="层道与工作角示意图">
  <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="焊道截面示意图"><title>焊道截面及焊丝工作角</title><desc>{model.layerCount}层{model.passCount}道，{model.active?.pass.name}，工作角{model.angle===null?'未设置':model.angle+'度'}。示意图随层道配置更新。</desc><defs><clipPath id={id+'-clip'}><rect x={LEFT} y={0} width={W-LEFT} height={BOTTOM}/></clipPath></defs>
   <rect width={W} height={H} fill="#f5f6f8"/><rect x={13} y={0} width={39} height={BOTTOM} fill="#b7b7b7"/><rect x={13} y={BOTTOM-56} width={39} height={H-BOTTOM+56} fill="#181525"/><rect x={LEFT} y={BOTTOM} width={W-LEFT} height={H-BOTTOM} fill="#181525"/>
   <g clipPath={`url(#${id}-clip)`}>{model.beads.map(bead=><path key={bead.id} className="process-section-bead" data-pass-id={bead.id} data-layer-index={bead.layerIndex} data-pass-index={bead.passIndex} d={shape(bead)} fill={bead.id===model.active?.pass.id?'#b9bec6':['#d5d7da','#c9cdd2','#bcc4cc','#adb8c3'][bead.layerIndex%4]} stroke={bead.id===model.active?.pass.id?'#555':'#8a919a'} strokeWidth={bead.id===model.active?.pass.id?1.5:.8} vectorEffect="non-scaling-stroke" role="button" tabIndex={bead.id===model.active?.pass.id?0:-1} aria-label={'示意焊道 '+bead.label} aria-pressed={bead.id===model.active?.pass.id} onClick={()=>onSelect?.(bead.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect?.(bead.id);}}}><title>{bead.label}</title></path>)}
   {model.wire&&<><line x1={x(model.wire.from[0])} y1={y(model.wire.from[1])} x2={x(model.wire.to[0])} y2={y(model.wire.to[1])} stroke="#fff" strokeWidth={4} strokeLinecap="round"/><line className="process-section-wire" data-work-angle={model.angle} x1={x(model.wire.from[0])} y1={y(model.wire.from[1])} x2={x(model.wire.to[0])} y2={y(model.wire.to[1])} stroke="#333" strokeWidth={2.5} strokeLinecap="round"/>{Math.abs(angle)>.001&&<path d={`M${x(center[0]+radius)},${y(center[1])} A${radius*(W-LEFT-14)/(model.domain.x[1]-model.domain.x[0])},${radius*(BOTTOM-14)/(model.domain.y[1]-model.domain.y[0])} 0 0 ${angle>0?0:1} ${point(arcEnd)}`} fill="none" stroke="#4c4c4c" strokeWidth={1}/>}</>}
   </g>
   <line x1={LEFT} y1={0} x2={LEFT} y2={BOTTOM} stroke="#ff8908" strokeWidth={1.6}/><line x1={LEFT} y1={BOTTOM} x2={W} y2={BOTTOM} stroke="#ff8908" strokeWidth={1.6}/>
   {ticks(...model.domain.x).map(tick=><g key={'x'+tick.value}><line x1={x(tick.value)} y1={BOTTOM} x2={x(tick.value)} y2={BOTTOM+(tick.major?7:3)} stroke="#ff8908" strokeWidth={tick.major?1.3:.8}/>{tick.major&&<><rect x={x(tick.value)-12} y={BOTTOM+10} width={24} height={20} rx={1.5} fill="#33323b"/><text x={x(tick.value)} y={BOTTOM+24} textAnchor="middle" fill="#fff" fontSize={13} fontFamily="Arial,sans-serif">{tick.value}</text></>}</g>)}
   {ticks(...model.domain.y).map(tick=><g key={'y'+tick.value}><line x1={LEFT-(tick.major?7:3)} y1={y(tick.value)} x2={LEFT} y2={y(tick.value)} stroke="#ff8908" strokeWidth={tick.major?1.3:.8}/>{tick.major&&<><rect x={26} y={y(tick.value)-10} width={25} height={20} rx={1.5} fill="#555"/><text x={38.5} y={y(tick.value)+4} textAnchor="middle" fill="#fff" fontSize={13} fontFamily="Arial,sans-serif">{tick.value}</text></>}</g>)}
  </svg>
  <figcaption className="process-section-controls"><div><span>焊道</span><select aria-label="示意图焊道" value={model.active?.pass.id||''} onChange={event=>onSelect?.(event.target.value)}>{rows.map(({pass,layer},index)=><option key={pass.id} value={pass.id}>P{index+1} · {layer.name} / {pass.name}</option>)}</select><button type="button" aria-label={fit?'恢复100毫米视图':'适应焊脚范围'} title={fit?'恢复100毫米视图':'适应焊脚范围'} onClick={()=>setFit(value=>!value)}>{fit?<RotateCcw size={13}/>:<Maximize2 size={13}/>}</button></div><span>{model.layerCount} 层 · {model.passCount} 道 · 工作角 {model.angle===null?'—':clean(model.angle)+'°'}</span></figcaption>
  {!model.leg&&<span className="process-section-empty">请先填写焊脚高度</span>}
 </figure>;
}
