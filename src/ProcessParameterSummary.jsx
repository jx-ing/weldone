import React,{useState} from 'react';
import {MACHINE_MODES,WELDING_MODES,processPasses} from './processParameterModel.mjs';
export default function ProcessParameterSummary({parameters:p}){
  const [active,setActive]=useState(''),rows=processPasses(p),row=rows.find(v=>v.pass.id===active)||rows[0],v=row.pass,a=p.applicability;
  const phase=(label,value)=><div><strong>{label}</strong><span>{v.machineMode==='job'?`JOB ${value.job}`:`${value.current} A · ${v.machineMode==='synergic'?`修正 ${value.correction}`:`${value.voltage} V`}`}{value.time!==undefined?` · ${value.time} s`:''}{value.speed!==undefined?` · ${value.speed} mm/min`:''}</span></div>;
  return <div className="process-summary">
    {a?<small className="process-applicability">{a.welderModel} · {a.wireType} Φ{a.wireDiameter} mm<br/>{a.gas} · {a.method} · {a.material}</small>:<small>适用条件待补充</small>}
    <small>焊脚：{p.leg!==undefined?`${p.leg} mm`:'待补充'} · {p.position||'焊接位置待补充'}</small>
    {p.processLayers&&<label className="process-pass-select"><span>{p.processLayers.length} 层 / {rows.length} 道</span><select aria-label="查看工艺层道" value={v.id} onChange={e=>setActive(e.target.value)}>{rows.map(r=><option key={r.pass.id} value={r.pass.id}>{r.layer.name} / {r.pass.name}</option>)}</select></label>}
    <p>{MACHINE_MODES[v.machineMode]}{v.machineMode!=='job'?` · ${WELDING_MODES[v.weldingMode]}`:' · 使用焊机 JOB 保存的内容'}</p>
    {phase('起弧',v.start)}{phase('焊接',v.weld)}{phase('收弧',v.end)}
    <small>Y / Z 偏移：{v.offset.y} / {v.offset.z} mm</small><small>推拉 / 俯仰角：{v.angles.pushPull} / {v.angles.pitch}°</small><small>摆动：{v.weave.enabled?`${v.weave.amplitude} mm / ${v.weave.frequency} Hz，左停留 ${v.weave.dwellLeft} s / 右停留 ${v.weave.dwellRight} s`:'关闭'}</small>
  </div>;
}
