import React from 'react';
import {SAMPLING_AXES} from './planningConfiguration.mjs';
function Diagram({axis,angle}){
 const rotation=-(Number.isFinite(Number(angle))?Number(angle):0);
 return <svg className="sampling-angle-diagram" viewBox="0 0 300 145" role="img" aria-label={axis+'角度示意图'}><rect x="35" y="113" width="230" height="15" fill="#eee" stroke="#333" strokeWidth="2"/>{axis==='前进角'?<><path d="M65 113V33H235V113 M150 113V22" fill="none" stroke="#333" strokeWidth="2"/><path d="M150 113L96 59 M150 113L204 59" stroke="#aaa"/><text x="80" y="52">45°</text><text x="204" y="52">-45°</text><text x="147" y="17">0°</text></>:<><path d="M75 113V27H89V113" fill="#eee" stroke="#333" strokeWidth="2"/><path d="M89 63Q140 63 140 113" fill="none" stroke="#aaa"/><text x="95" y="58">90°</text><text x="146" y="111">0°</text></>}<path d={axis==='前进角'?'M150 113V42':'M89 113H160'} transform={`rotate(${rotation} ${axis==='前进角'?150:89} 113)`} stroke="#fa8c16" strokeWidth="3"/></svg>;
}
export default function SamplingAvoidanceSettings({value,onChange}){
 function update(key,field,next){onChange({...value,[key]:{...value[key],[field]:next}});}
 const input=(key,label,field,disabled=false)=><span className="planning-value"><input type="number" min="-360" max="360" step="any" disabled={disabled} aria-label={label} value={value[key][field]??''} onChange={e=>update(key,field,e.target.value)}/><small>°</small></span>;
 return <section aria-label="采样避障"><div className="planning-sampling-grid">{SAMPLING_AXES.map(([key,label,referenceAngle])=><fieldset className="planning-sampling-axis" key={key}><legend>{label}</legend><Diagram axis={label} angle={referenceAngle}/><label className="sampling-enable"><span>采样</span><input type="checkbox" role="switch" aria-label={label+'采样'} checked={value[key].enabled} onChange={e=>update(key,'enabled',e.target.checked)}/></label><label><span>采样范围</span>{input(key,label+'采样范围最小值','min',!value[key].enabled)}</label><label><span>至</span>{input(key,label+'采样范围最大值','max',!value[key].enabled)}</label></fieldset>)}</div></section>;
}
