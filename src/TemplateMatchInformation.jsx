import React,{useState} from 'react';
import {POSITIONS,JOINTS,geometryOptions,validateTemplate} from './templateModel.mjs';
import {templateMatchParameters} from './templateMatchingParameters.mjs';
import {processPositionLabel} from './processLibraryView.mjs';
import {ENDPOINT_TYPES,ENDPOINT_DIMENSIONS,geometryRuleErrors,shortSegmentRange,SHORT_SEGMENT_MM} from './templateGeometryRules.mjs';
import GrooveFields from './GrooveFields';
import './templateMatchInformation.css';

function Field({label,children}){return <label className="matching-field"><span>{label}</span>{children}</label>;}
function NumberField({label,value,onChange,unit,min=0,max,step='any',optional=false}){return <span className="matching-number"><input type="number" aria-label={label} min={min} max={max} step={step} required={!optional} placeholder={optional?'不限':undefined} value={value??''} onChange={event=>onChange(event.target.value===''?optional?null:'':Number(event.target.value))}/>{unit&&<small>{unit}</small>}</span>;}
function Select({label,value,values,onChange,placeholder='请选择'}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{!values.some(item=>(Array.isArray(item)?item[0]:item)===value)&&<option value={value} disabled>{value||placeholder}</option>}{values.map(item=>{const [key,text]=Array.isArray(item)?item:[item,item];return <option key={key} value={key}>{text}</option>;})}</select>;}

const initialMatch=template=>{const match=templateMatchParameters(template);return template.requirementsMatch||template.shortSegmentMatch?match:{...match,segments:match.segments.map((segment,index)=>({...segment,...shortSegmentRange(template.segments[index])}))};};

export default function TemplateMatchInformation({templates,onSave,onCancel}){
 const [selectedId,setSelectedId]=useState(templates[0]?.id||''),[drafts,setDrafts]=useState(()=>Object.fromEntries(templates.map(template=>[template.id,initialMatch(template)]))),[error,setError]=useState(''),[ruleDrafts,setRuleDrafts]=useState(()=>Object.fromEntries(templates.map(template=>[template.id,structuredClone(template.requirementsMatch)])));
 const template=templates.find(value=>value.id===selectedId),draft=drafts[selectedId];
 const rules=ruleDrafts[selectedId];
 const changeRules=values=>setRuleDrafts(previous=>({...previous,[selectedId]:{...previous[selectedId],...values}}));
 const range=(label,value,onChange)=><Field label={label}><span className="planning-angle-range">{['min','max'].map(key=><NumberField key={key} label={label+(key==='min'?'最小值':'最大值')} value={value?.[key]} unit="mm" optional onChange={number=>{const next={min:null,max:null,...value,[key]:number};onChange(next.min===null&&next.max===null?null:next);}}/>)}</span></Field>;
 const change=values=>{setDrafts(previous=>({...previous,[selectedId]:{...previous[selectedId],...values}}));setError('');};
 const segmentChange=(index,key,value)=>change({segments:draft.segments.map((segment,i)=>i===index?{...segment,[key]:value}:segment)});
 const cornerChange=(index,key,value)=>change({corners:draft.corners.map((corner,i)=>i===index?{...corner,[key]:value}:corner)});
 function save(event){
  event.preventDefault();
  const changed=templates.filter(value=>value.id===selectedId&&(value.matchParameters?.version!==2||!value.matchParameters.corners.every(corner=>'angleMin' in corner&&'angleMax' in corner))||JSON.stringify(drafts[value.id])!==JSON.stringify(initialMatch(value))||JSON.stringify(ruleDrafts[value.id])!==JSON.stringify(value.requirementsMatch));
  for(const value of changed){const candidate={...value,shortSegmentMatch:true,matchParameters:drafts[value.id],requirementsMatch:ruleDrafts[value.id]};const issues=[...validateTemplate(candidate),...geometryRuleErrors(candidate)];if(issues.length){setSelectedId(value.id);setError(issues.join('；'));return;}}
  const result=onSave(changed.map(value=>({...value,shortSegmentMatch:true,requirementsMatch:structuredClone(ruleDrafts[value.id]),matchParameters:structuredClone(drafts[value.id]),updatedAt:new Date().toISOString()})));if(result)setError(result);
 }
 return <form className="template-match-editor" onSubmit={save}>
  <div className="matching-editor-body">
   {!template?<p>暂无焊接模板。</p>:<>
    <div className="matching-editor-title">{templates.length>1?<Field label="焊接模板"><Select label="选择匹配参数模板" value={selectedId} values={templates.map(value=>[value.id,value.name])} onChange={setSelectedId}/></Field>:<strong>{template.name}</strong>}<span>{template.closure==='closed'?'闭合':'开放'} · {template.segments.length} 段 · {template.corners.length} 个转角</span></div>
    <section aria-label="基本匹配参数"><h3>基本匹配参数</h3><div className="matching-field-grid three">
     <Field label="焊脚高度"><NumberField label="匹配焊脚高度" min={.5} step={.5} value={draft.leg} unit="mm" onChange={leg=>change({leg})}/></Field>
     <Field label="焊接位置"><Select label="匹配焊接位置" value={draft.position??''} placeholder="各段不同（保留原值）" values={POSITIONS.map(value=>[value,processPositionLabel(value)])} onChange={position=>change({position})}/></Field>
     <Field label="接头类型"><Select label="匹配接头类型" value={draft.joint??''} placeholder="各段不同（保留原值）" values={JOINTS} onChange={joint=>change({joint})}/></Field>
    </div></section>
    <section aria-label="焊缝段匹配参数"><h3>焊缝段匹配参数</h3>{draft.segments.map((segment,index)=><fieldset className="matching-segment" key={index}><legend>第 {index+1} 段</legend><div className="matching-field-grid three">
     <Field label="几何类型"><Select label={`第${index+1}段匹配几何类型`} value={segment.geometry} values={geometryOptions(template.closure)} onChange={value=>segmentChange(index,'geometry',value)}/></Field>
     {(template.segments[index].length<SHORT_SEGMENT_MM)?<><Field label="适用最小长度"><NumberField label={`第${index+1}段匹配最小长度`} min={.1} value={segment.minLength} unit="mm" onChange={value=>segmentChange(index,'minLength',value)}/></Field>
     <Field label="适用最大长度"><NumberField label={`第${index+1}段匹配最大长度`} min={.1} max={SHORT_SEGMENT_MM} value={segment.maxLength??shortSegmentRange(template.segments[index]).maxLength} unit="mm" onChange={value=>segmentChange(index,'maxLength',value)}/></Field></>:<p className="matching-editor-note">此段长度不参与匹配</p>}
    </div></fieldset>)}</section>
    <section aria-label="转角匹配参数"><h3>转角匹配参数</h3>{!draft.corners.length?<p className="matching-editor-note">当前模板无转角。</p>:draft.corners.map((corner,index)=><fieldset className="matching-segment" key={index}><legend>转角 {index+1} · 角度范围</legend><div className="matching-field-grid">
     <Field label="最小角度"><NumberField label={`转角${index+1}最小匹配角度`} max={360} value={corner.angleMin} unit="°" onChange={value=>cornerChange(index,'angleMin',value)}/></Field>
     <Field label="最大角度"><NumberField label={`转角${index+1}最大匹配角度`} max={360} value={corner.angleMax} unit="°" onChange={value=>cornerChange(index,'angleMax',value)}/></Field>
    </div></fieldset>)}</section>
    {rules&&<section aria-label="端点与尺寸匹配条件"><h3>端点与尺寸匹配条件</h3><div className="matching-field-grid three"><Field label="焊接方式"><Select label="匹配焊接方式" value={String(rules.machineCount)} values={[[ '1','单机焊接'],['2','双机焊接']]} onChange={value=>changeRules({machineCount:Number(value)})}/></Field><Field label="焊缝形式"><Select label="匹配焊缝形式" value={rules.weldType} values={['角焊缝','搭接焊缝','对接焊缝']} onChange={weldType=>changeRules({weldType})}/></Field>{range('焊缝边缘距离',rules.edgeDistance,edgeDistance=>changeRules({edgeDistance}))}</div>{[['start','起点'],['end','终点']].map(([key,label])=><fieldset key={key} className="matching-segment"><legend>{label}条件</legend><div className="matching-field-grid three"><Field label={label+'特征'}><Select label={label+'匹配特征'} value={rules[key].type} values={[[ '', '不限'],...ENDPOINT_TYPES]} onChange={type=>changeRules({[key]:{...rules[key],type}})}/></Field>{ENDPOINT_DIMENSIONS.map(([dimension,name])=><React.Fragment key={dimension}>{range(label+name,rules[key][dimension],value=>changeRules({[key]:{...rules[key],[dimension]:value}}))}</React.Fragment>)}</div></fieldset>)}</section>}
    <section aria-label="坡口与过焊孔匹配参数"><h3>坡口与过焊孔</h3><div className="matching-field-grid three">
     <GrooveFields prefix="匹配" value={draft.groove} onChange={groove=>change({groove})}/>
     {[['startHole','起点过焊孔'],['endHole','终点过焊孔']].map(([key,label])=><Field key={key} label={label}><Select label={'匹配'+label} value={String(draft[key])} values={[[ 'false','无'],['true','有']]} onChange={value=>change({[key]:value==='true'})}/></Field>)}
    </div></section>
   </>}
   {error&&<p className="matching-editor-error" role="alert">{error}</p>}
  </div>
  <footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary" disabled={!template}>保存参数</button></footer>
 </form>;
}
