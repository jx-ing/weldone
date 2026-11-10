import GrooveFields from './GrooveFields';
import React from 'react';
import {Undo2,Check,Trash2,X} from 'lucide-react';
import {POSITIONS} from './templateModel.mjs';
import {WELD_TYPES} from './weldAttributeModel.mjs';
import {pathLength,pathGeometry,distance} from './manualWeldModel.mjs';
export default function ManualWeldPanel({draft,onChange,onUndo,onClear,onFinish,onCancel,onCloseLoop}){
  const settings=draft.settings,patch=values=>onChange({...draft,settings:{...settings,...values}}),segments=draft.segments,closed=segments.length&&distance(segments[0].points[0],segments.at(-1).points.at(-1))<.5;
  const select=(label,key,options)=><label>{label}<select aria-label={`人工焊道${label}`} value={settings[key]??options[0]} onChange={e=>patch({[key]:e.target.value})}>{options.map(v=><option key={v}>{v}</option>)}</select></label>;
  return <div className="manual-weld-panel"><header><strong>人工点选焊道</strong><button className="icon" aria-label="取消点选焊道" onClick={onCancel}><X size={17}/></button></header><div className="manual-weld-fields">
    <div className="manual-pick-modes">{[['edge','选择模型边线'],['point','依次点选位置']].map(([id,label])=><button type="button" key={id} className={draft.mode===id?'active':''} onClick={()=>onChange({...draft,mode:id})}>{label}</button>)}</div>
    <p className="manual-pick-help">{draft.mode==='edge'?'将鼠标移到模型边线上，边线高亮后单击加入；继续选择相接边线。':'在模型表面依次单击起点、连接点、终点。拖动旋转视角，滚轮缩放。'}</p>
    {draft.mode==='point'&&<label className="manual-snap"><input type="checkbox" checked={draft.snap} onChange={e=>onChange({...draft,snap:e.target.checked})}/>靠近边线和端点时吸附</label>}
    <div className="manual-selection-summary"><strong>{segments.length} 段</strong><span>{segments.reduce((n,s)=>n+pathLength(s.points),0).toFixed(2)} mm</span><span>{closed?'闭合':'开放'}</span></div>
    <div className="manual-pick-actions"><button className="btn" onClick={onUndo} disabled={!draft.history.length}><Undo2 size={13}/>撤销</button><button className="btn" onClick={onClear} disabled={!segments.length&&!draft.start}><Trash2 size={13}/>清空</button><button className="btn" onClick={onCloseLoop} disabled={!segments.length||!!closed}>闭合到起点</button></div>
    {draft.start&&!segments.length&&<p className="manual-pick-help">已选起点，请继续选择下一点。</p>}
    <label>焊道名称<input aria-label="人工焊道名称" value={settings.name} maxLength={80} onChange={e=>patch({name:e.target.value})}/></label>
    <label>焊脚 / mm<input aria-label="人工焊道焊脚" type="number" min="0.5" step="0.5" value={settings.leg} onChange={e=>patch({leg:e.target.value===''?'':+e.target.value})}/></label>
    {select('焊接位置','position',POSITIONS)}{select('焊缝形式','weldType',WELD_TYPES)}
    {segments.length>0&&<section className="manual-segments"><h4>已选焊缝段</h4>{segments.map((s,i)=><div key={i}><b>{i+1}. {pathGeometry(s.points).geometry} · {pathLength(s.points).toFixed(2)} mm</b><small>{s.edgeId?`模型边线 ${s.edgeId}`:'人工取点直线'}</small><select aria-label={`人工第${i+1}段焊接位置`} value={s.position||settings.position} onChange={e=>onChange({...draft,segments:segments.map((s,j)=>i===j?{...s,position:e.target.value}:s)})}>{POSITIONS.map(v=><option key={v}>{v}</option>)}</select></div>)}</section>}
    <GrooveFields prefix="人工焊道" value={settings.groove} onChange={groove=>patch({groove})}/>
    <label className="manual-snap"><input type="checkbox" checked={settings.startHole} onChange={e=>patch({startHole:e.target.checked})}/>起点过焊孔</label><label className="manual-snap"><input type="checkbox" checked={settings.endHole} onChange={e=>patch({endHole:e.target.checked})}/>终点过焊孔</label>
    {draft.error&&<p className="tpl-reference-warning" role="alert">{draft.error}</p>}
    <p className="manual-pick-help">焊道由所选位置建立，请确认焊脚、焊接位置及焊缝形式。完成后可基于此焊道新建焊缝模板。</p>
  </div><footer><button className="btn" onClick={onCancel}>取消</button><button className="btn primary" disabled={!segments.length} onClick={onFinish}><Check size={14}/>生成焊道</button></footer></div>;
}
