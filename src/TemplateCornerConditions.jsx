import React from 'react';
import { Plus,Trash2 } from 'lucide-react';
import {CORNER_SIDES,cornerSide,changeCornerSide,changeCornerStandard} from './templateCornerAngles.mjs';

export default function CornerConditions({ template, onChange, onAdd,onRemove,readOnlyStandard=false }) {
  function update(index, key, value) {
    onChange({ corners: template.corners.map((corner,i) => i !== index?corner:key==='angleSide'?changeCornerSide(corner,value):key==='standard'?changeCornerStandard(corner,value):{...corner,[key]:value === '' ? '' : Number(value)}) });
  }
  return <section className="tpl-corner-conditions">
    <div className="tpl-section-title"><div><h3>{template.type === 'whole' ? '焊缝转角设置' : '局部转角设置'}</h3><p>系统自动计算转向，沿焊接方向左转为内角、右转为外角。切换类型不换算标准角度；内角有向角为0–180°，外角为180–360°。匹配同时检查实际转向和有向角度。</p></div>{onAdd && <button type="button" className="btn" onClick={onAdd} disabled={template.cornerCount >= (template.type === 'local' ? 2 : 29)}><Plus size={14}/>新增转角</button>}</div>
    {template.corners.length > 0 ? <div className="tpl-table-wrap"><table className="tpl-segment-table"><thead><tr><th>转角</th><th>内角 / 外角</th><th>标准角度</th><th>角度容差</th><th>兼容范围</th><th/></tr></thead><tbody>
      {template.corners.map((corner,index) => <tr key={index}>
        <td><b>转角 {index+1}</b><small className="tpl-corner-segments">第 {index+1} → {index+2} 段</small></td>
        <td><select aria-label={`转角${index+1}内角外角`} disabled={readOnlyStandard} value={cornerSide(corner)} onChange={e=>update(index,'angleSide',e.target.value)}>{Object.entries(CORNER_SIDES).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></td>
        <td><span className="tpl-number"><input type="number" step="any" min={0} max={360} aria-label={`转角${index+1}标准角度`} disabled={readOnlyStandard||template.type!=='whole'&&template.closure==='closed'&&index===template.segments.length-2} title={readOnlyStandard?'标准角度来自模型焊道':template.type!=='whole'&&template.closure==='closed'&&index===template.segments.length-2?'闭合收尾角度随轮廓自动计算':undefined} value={corner.standard} onChange={e => update(index,'standard',e.target.value)}/><small>°</small></span></td>
        <td><span className="tpl-number"><small className="tpl-tolerance-prefix">±</small><input type="number" step="any" min={0} max={360} aria-label={`转角${index+1}角度容差`} value={corner.tolerance} onChange={e => update(index,'tolerance',e.target.value)}/><small>°</small></span></td>
        <td className="tpl-corner-range">{Number.isFinite(corner.standard) && Number.isFinite(corner.tolerance) ? `${Math.max(0,Math.round((corner.standard-corner.tolerance)*100)/100)}° ～ ${Math.min(360,Math.round((corner.standard+corner.tolerance)*100)/100)}°` : '待填写'}</td>
        <td>{onRemove&&<button className="icon" type="button" aria-label={`删除转角${index+1}`} onClick={()=>onRemove(index)}><Trash2 size={13}/></button>}</td>
      </tr>)}
    </tbody></table></div> : <div className="tpl-no-corners">{readOnlyStandard?'当前来源焊道无转角。':'当前为无转角焊道。新增转角时，会在需要时同步补充焊缝段。'}</div>}
  </section>;
}
