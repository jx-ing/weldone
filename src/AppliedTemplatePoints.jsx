import React,{useState} from 'react';
import {effectivePointOverrides} from './processParameterModel.mjs';
export default function AppliedTemplatePoints({weld}) {
  const [active,setActive]=useState('');
  const displayLayers=weld.layers?.length?weld.layers:(weld.localApplications||[]).flatMap(a=>a.layers.map((l,i)=>({...l,name:`${a.name} · 第${a.startSegment}–${a.endSegment}段 · ${l.name}`,processLayerIndex:i,baseProcessParameters:a.baseProcessParameters})));
  const passes=displayLayers.flatMap(layer=>(layer.passes||[]).map((pass,passIndex)=>({...pass,layer,passIndex,layerIndex:layer.processLayerIndex??displayLayers.indexOf(layer)})));
  const selected=passes.find(p=>p.id===active)||passes[0],points=selected?.controlPoints||weld.controlPoints||[];
  const baseProcess=selected?.layer.baseProcessParameters||weld.processParameters;
  const process=baseProcess?.processLayers?baseProcess.processLayers[selected?.layerIndex||0]?.passes[selected?.passIndex||0]:baseProcess,mode=process?.machineMode;
  const names={current:'电流',voltage:'电压',speed:'速度',amplitude:'摆幅',frequency:'频率',dwellLeft:'左停留',dwellRight:'右停留'};
  return <div className="applied-template-points">{weld.automaticPoses?.length>0&&<p>自动姿态：已计算 {weld.automaticPoses.length} 处，覆盖未采用局部模板的位置。</p>}{mode==='job'&&<p>JOB 模式下，点位的电流、电压覆盖不生效。</p>}{mode==='synergic'&&<p>一元模式下，点位的电压覆盖不生效。</p>}{passes.length>0&&<><label className="tpl-field"><span>{displayLayers.length} 层 · {passes.length} 道</span><select aria-label="查看已应用焊道" value={selected.id} onChange={e=>setActive(e.target.value)}>{passes.map(p=><option key={p.id} value={p.id}>{p.layer.name} / {p.name}</option>)}</select></label><p>层高 {selected.layer.height} mm · 道间横移 {selected.offset.y} mm · 附加高度 {selected.offset.z} mm</p></>}{points.length?points.map(p=><div key={p.id}><strong>{p.name}</strong><span>{p.referenceId?`基准：${points.find(a=>a.id===p.referenceId)?.name||'基准点'}`:`第 ${p.segment} 段基准点`} · {p.tracking}</span><small>XYZ 相对偏移：{p.offset.x} / {p.offset.y} / {p.offset.z} mm</small><small>前进/旋转/工作角：{p.angles.advance} / {p.angles.rotation} / {p.angles.work}°</small><small>工艺覆盖：{Object.entries(effectivePointOverrides(p.overrides,mode)).map(([k,v])=>`${names[k]} ${v}`).join('，')||'沿用基础工艺'}</small></div>):<p>尚未应用模板控制点</p>}</div>;
}
