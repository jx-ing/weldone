import GrooveFields from './GrooveFields';
import React from 'react';
import {POSITIONS,JOINTS,GROOVES,geometryOptions,isModelWholeTemplate,changeTemplateClosure,changeTemplateSegment,resizeSegments,resizeCorners,reconcileTemplateGeometry,addTemplateCorner,deleteTemplateCorner} from './templateModel.mjs';
import {validateProcessEntry} from './processParameterModel.mjs';
import {bindLocalProcess} from './localTemplateConditions.mjs';
import CornerConditions from './TemplateCornerConditions';
import PathPreview from './TemplatePathPreview';
import ShapeControls from './TemplateShapeControls';
import TemplateModelEditor from './TemplateModelEditor';
import {hasTemplateModelPath} from './templateModelEditing.mjs';

function Field({label,children}){return <label className="tpl-field"><span>{label}</span>{children}</label>;}
function Numeric({value,onChange,unit,...props}){return <span className="tpl-number"><input type="number" step="any" value={value} onChange={e=>onChange(e.target.value===''?'':+e.target.value)} {...props}/>{unit&&<small>{unit}</small>}</span>;}
function Select({values,value,onChange,...props}){return <select value={value} onChange={e=>onChange(e.target.value)} {...props}>{values.map(v=><option key={v}>{v}</option>)}</select>;}

export default function MatchConditions({draft,setDraft,onChange,fixedOnly=false,processLibrary=[],onCaptureReady}){
  const locked=isModelWholeTemplate(draft),whole=draft.type==='whole',local=draft.type==='local'&&!fixedOnly;
  const set=values=>onChange(values);
  return <>
    {!whole&&<div className="tpl-info">{locked?'匹配条件已从来源焊道自动填入。可在三维焊缝域中修改路径点，长度与转角同步更新。':whole?'焊缝模板仅匹配具有完整起点、终点的焊道。各段条件按焊接方向依次匹配。':'局部模板最多 3 段，可匹配焊道上任意符合条件的连续段组合，单段焊道也可匹配。'}</div>}
    <div className="tpl-match-overview"><div className="tpl-match-rules">
      <div className="tpl-section-title"><h3>基本匹配条件</h3><span className="tag">{locked?'来自模型焊道':whole?'焊缝匹配':'焊缝段组合'}</span></div>
      <div className="tpl-form-grid three">
        <Field label="焊道形式"><select aria-label="焊道形式" disabled={locked} value={draft.closure} onChange={e=>setDraft(t=>changeTemplateClosure(t,e.target.value))}><option value="open">开放</option><option value="closed">闭合</option></select></Field>
        {local&&<Field label="挂载工艺参数"><select aria-label="局部模板挂载工艺参数" value={draft.baseProcessId||''} onChange={e=>setDraft(t=>bindLocalProcess(t,processLibrary.find(p=>p.id===e.target.value)))}><option value="">请选择已有工艺参数方案</option>{draft.baseProcessId&&!processLibrary.some(p=>p.id===draft.baseProcessId)&&<option value={draft.baseProcessId} disabled>原方案已失效，请重新选择</option>}{processLibrary.map(p=><option key={p.id} value={p.id} disabled={validateProcessEntry(p).length>0}>{p.name} · 焊脚 {p.leg??'待完善'} mm{validateProcessEntry(p).length?'（参数待完善）':''}</option>)}</select></Field>}
        <Field label={local?'焊脚（由挂载工艺带入）':'焊脚'}><Numeric aria-label="模板焊脚" readOnly={locked||local} placeholder={local?'选择工艺后自动带入':undefined} min={.5} step={.5} unit="mm" value={local&&!draft.baseProcessId?'':draft.leg??''} onChange={leg=>set({leg})}/></Field>
        <Field label="焊缝段数量 n"><Numeric aria-label="焊缝段数量" readOnly={locked} min={1} max={whole?30:3} step={1} value={draft.segments.length} onChange={n=>Number.isInteger(n)&&n>=1&&n<=(whole?30:3)&&setDraft(t=>changeTemplateClosure(resizeSegments(t,n),t.closure))}/></Field>
        <Field label="转角数量 k"><Numeric aria-label="转角数量" readOnly={locked} min={0} max={draft.segments.length-1} step={1} value={draft.cornerCount} onChange={n=>Number.isInteger(n)&&n>=0&&n<draft.segments.length&&setDraft(t=>reconcileTemplateGeometry(resizeCorners(t,n)))}/></Field>
      </div>
      {local&&<p className="tpl-local-condition-note">焊脚取自所选工艺，保存时同时检查工艺与模板条件是否兼容。{!processLibrary.length&&<strong> 当前工艺参数库为空，请先新建工艺参数方案。</strong>}</p>}
      <CornerConditions template={draft} readOnlyStandard={locked} onChange={set} onAdd={locked?undefined:()=>setDraft(addTemplateCorner)} onRemove={locked?undefined:index=>setDraft(t=>deleteTemplateCorner(t,index))}/>
    </div><section className="tpl-match-preview" aria-label="匹配条件焊缝段预览">
      <div className="tpl-section-title"><h3>焊缝段示意图</h3><span className="tag">{draft.segments.length} 段 · {draft.cornerCount} 个转角</span></div>{hasTemplateModelPath(draft)?<TemplateModelEditor template={draft} onChange={setDraft} onCaptureReady={onCaptureReady}/>:<><PathPreview template={draft} segmentsOnly/><ShapeControls template={draft} onChange={setDraft} readOnly={locked}/></>}
    </section></div>
    {!whole&&<section className="tpl-detail-card"><header><h3>焊缝段条件</h3></header><div className="tpl-section-title tpl-segment-caption"><div><p>按第 1 段至第 {draft.segments.length} 段的顺序匹配焊接位置、接头类型和几何类型。</p></div></div>
      <div className="tpl-table-wrap"><table className="tpl-segment-table"><thead><tr><th>焊缝段</th><th>焊接位置</th><th>接头类型</th><th>几何类型</th></tr></thead><tbody>{draft.segments.map((s,i)=><tr key={i}><td><b>{String(i+1).padStart(2,'0')}</b></td>{[['position',POSITIONS,'焊接位置'],['joint',JOINTS,'接头类型'],['geometry',geometryOptions(draft.closure),'几何类型']].map(([key,values,label])=><td key={key}><Select aria-label={`第${i+1}段${label}`} disabled={locked} values={values} value={s[key]} onChange={value=>setDraft(t=>changeTemplateSegment(t,i,{[key]:value,...(key==='geometry'?{shape:undefined}:{})}))}/></td>)}</tr>)}</tbody></table></div>
    </section>}
    <section className="tpl-detail-card"><header><h3>坡口{whole?'与过焊孔':''}</h3></header><div className="tpl-form-grid three tpl-detail-groove-fields">
      <GrooveFields value={draft.groove} disabled={locked} onChange={groove=>set({groove})}/>
      {whole&&[['startHole','起点过焊孔'],['endHole','终点过焊孔']].map(([k,label])=><Field key={k} label={label}><select aria-label={label} disabled={locked} value={String(draft[k])} onChange={e=>set({[k]:e.target.value==='true'})}><option value="false">无</option><option value="true">有</option></select></Field>)}
    </div></section>
  </>;
}
