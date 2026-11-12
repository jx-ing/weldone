import React,{useState} from 'react';
import {DEFAULT_TEMPLATE_CAPTURE_RANGE,TEMPLATE_CAPTURE_FIELDS,validTemplateCaptureRange} from './templateCaptureRange.mjs';

export function TemplateCaptureRangeFields({value,onChange}){
 return <div className="tpl-form-grid">
  {TEMPLATE_CAPTURE_FIELDS.map(([key,label])=><label className="tpl-field" key={key}><span>{label}</span>
   <span className="tpl-number"><input type="number" aria-label={label} min={(key==='along'||key==='across') ? 0.1 : 0} step="any" required
    value={value[key]} onChange={event=>onChange({...value,[key]:event.target.value===''?'':event.target.valueAsNumber})}/><small>mm</small></span>
  </label>)}
 </div>;
}

export default function TemplateCaptureSettings({value,onSave,onCancel}){
 const [draft,setDraft]=useState(()=>({...DEFAULT_TEMPLATE_CAPTURE_RANGE,...value}));
 const [error,setError]=useState('');
 function save(event){
  event.preventDefault();
  if(!validTemplateCaptureRange(draft)){setError('沿焊缝与两侧的范围须大于 0，上下范围合计须大于 0。');return;}
  setError(onSave(draft)||'');
 }
 return <form onSubmit={save}>
  <div className="tpl-editor-body template-capture-settings">
   <p>从当前焊缝向外扩展截取范围。新建模板会用同一范围显示局部模型并搜索距离。下方以模型高度的负方向为准。</p>
   <TemplateCaptureRangeFields value={draft} onChange={next=>{setDraft(next);setError('');}}/>
   {error&&<p className="tpl-errors" role="alert">{error}</p>}
  </div>
  <footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary">保存</button></footer>
 </form>;
}
