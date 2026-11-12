import React,{useState} from 'react';
import {POSITIONS,geometryOptions,validateTemplate} from './templateModel.mjs';
import {templateMatchParameters} from './templateMatchingParameters.mjs';
import {processPositionLabel} from './processLibraryView.mjs';
import {ENDPOINT_TYPES,ENDPOINT_DIMENSIONS,geometryConditionEnabled,hasDistanceProfile,geometryRuleErrors,roundEndpointGap,savedGeometryRules,shortSegmentRange,SHORT_SEGMENT_MM,updateDistanceIntervals} from './templateGeometryRules.mjs';
import {defaultDistanceInterval} from './templateDistanceProfile.mjs';
import GrooveFields from './GrooveFields';
import './templateMatchInformation.css';

function Field({label,children}){return <label className="matching-field"><span>{label}</span>{children}</label>;}
function NumberField({label,value,onChange,unit,min=0,max,step='any',optional=false,precision,disabled=false}){const [focused,setFocused]=useState(false);const formatted=precision===1&&!focused&&Number.isFinite(value)?value.toFixed(1):value??'';return <span className="matching-number"><input type="number" aria-label={label} min={min} max={max} step={step} disabled={disabled} required={!optional} placeholder={optional?'不限':undefined} value={formatted} onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);if(precision===1&&Number.isFinite(value)&&roundEndpointGap(value)!==value)onChange(roundEndpointGap(value));}} onChange={event=>onChange(event.target.value===''?optional?null:'':Number(event.target.value))}/>{unit&&<small>{unit}</small>}</span>;}
function Select({label,value,values,onChange,placeholder='请选择'}){return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>{!values.some(item=>(Array.isArray(item)?item[0]:item)===value)&&<option value={value} disabled>{value||placeholder}</option>}{values.map(item=>{const [key,text]=Array.isArray(item)?item:[item,item];return <option key={key} value={key}>{text}</option>;})}</select>;}

function FeatureField({label,feature,selected,onSelect,children}){
 if(!onSelect)return <Field label={label}>{children}</Field>;
 return <div className="matching-field" onFocusCapture={()=>onSelect(feature)}>
  <button type="button" className="matching-feature-button" aria-label={'高亮'+label} aria-pressed={selected===feature} onClick={()=>onSelect(feature)}>{label}</button>
  {children}
 </div>;
}

function MatchToggle({label,enabled,onChange}){
 return <label className="matching-enable"><input type="checkbox" aria-label={label+'参与匹配'} checked={enabled}
  onChange={event=>onChange(event.target.checked)}/>参与匹配</label>;
}

function DistanceRange({label,feature,value,onChange,precision,selected,onSelect,measured,enabled,onEnabledChange,disabledInputs=enabled===false}){
 return <div className="matching-distance">
 <FeatureField label={label} feature={feature} selected={selected} onSelect={onSelect}>
  <span className="matching-range">{['min','max'].map(key=><NumberField key={key}
   label={label+(key==='min'?'最小值':'最大值')} value={value?.[key]} unit="mm" step={precision===1?.1:'any'} precision={precision}
   optional disabled={disabledInputs} onChange={number=>{
    const next={min:null,max:null,...value,[key]:number};
    onChange(next.min===null&&next.max===null?null:next);
   }}/>)}</span>
  {measured!==undefined&&<small className="matching-measurement" aria-label={label+'实测值'}>{measured===null?'范围内未命中':'实测 '+(precision===1?measured.toFixed(1):Number(measured.toFixed(2)))+' mm'}</small>}
 </FeatureField>
 {onEnabledChange&&<MatchToggle label={label} enabled={enabled} onChange={onEnabledChange}/>}
 </div>;
}

export function GeometryMatchFields({rules,changeRules,holeFlags={},title='整条焊缝起终点条件',selected,onSelect,evidence}){
 const featureProps={selected,onSelect};
 return <section aria-label={title}>
  <h3>{title}</h3>
  <div className="matching-field-grid">
   <Field label="焊接方式"><Select label="匹配焊接方式" value={String(rules.machineCount)} values={[[ '1','单机焊接'],['2','双机焊接']]} onChange={value=>changeRules({machineCount:Number(value)})}/></Field>
   <Field label="焊缝形式"><Select label="匹配焊缝形式" value={rules.weldType} values={['角焊缝','搭接焊缝','对接焊缝']} onChange={weldType=>changeRules({weldType})}/></Field>
   {!rules.captureRange&&<DistanceRange label="焊缝边缘距离" value={rules.edgeDistance} onChange={edgeDistance=>changeRules({edgeDistance})}
    enabled={geometryConditionEnabled(rules,'edgeDistance')} onEnabledChange={edgeDistanceEnabled=>changeRules({edgeDistanceEnabled})}/>}
  </div>
  {[['start','起点'],['end','终点']].map(([key,label])=><fieldset key={key} className="matching-segment">
   <legend>{label}条件</legend>
   <div className="matching-field-grid">
    <FeatureField label={label+'类型'} feature={key+':type'} {...featureProps}>
     <Select label={label+'匹配类型'} value={rules[key].type} values={[[ '', '不限'],...ENDPOINT_TYPES]} onChange={type=>changeRules({[key]:{...rules[key],type}})}/>
    </FeatureField>
    {ENDPOINT_DIMENSIONS.map(([dimension,name])=><DistanceRange key={dimension} feature={key+':'+dimension} label={label+name} {...featureProps}
     value={rules[key][dimension]??(dimension==='holeSize'&&holeFlags[key]===false?{min:0,max:0}:null)}
     enabled={geometryConditionEnabled(rules[key],dimension)} onEnabledChange={enabled=>changeRules({[key]:{...rules[key],
      ...(enabled&&dimension==='holeSize'&&rules[key].holeSize==null&&holeFlags[key]===false?{holeSize:{min:0,max:0}}:{}),
      [dimension+'Enabled']:enabled}})}
     precision={dimension==='holeSize'?undefined:1} measured={evidence?(dimension==='holeSize'?evidence[key]?.holeSize:evidence[key]?.[dimension]?.distance)??null:undefined}
     onChange={value=>changeRules({[key]:{...rules[key],[dimension]:value}})}/>)}
   </div>
  </fieldset>)}
 </section>;
}

function DistanceProfileFields({value,onChange,profile,length,index,selected,onSelect,enabled,onEnabledChange,solid=false}){
 const label=(solid?'焊缝段间隙':'焊缝段边缘距离')+' · 第 '+(index+1)+' 段';
 const feature='segment:'+index+':'+(solid?'gap':'edgeDistance'),surface=solid?'实体表面':'底板边缘';
 const nearest=value.mode==='nearest',intervals=value.intervals??[];
 const select=key=>onSelect?.(key);
 const update=rows=>onChange({...value,intervalsEdited:true,intervals:updateDistanceIntervals(rows,profile)});
 const hit=profile?.nearest;
 const closest=profile?hit&&{station:hit.station,boundary:hit.kind,distance:hit.distance}:value.closest;
 const chooseMode=mode=>{
  const initial=defaultDistanceInterval(profile);
  onChange({...value,mode,
   nearest:value.nearest??(hit?{min:roundEndpointGap(hit.distance),max:roundEndpointGap(hit.distance)}:null),closest,
   intervals:value.intervals??updateDistanceIntervals(initial?[initial]:[],profile)});
  select(feature);
 };
 return <div className="matching-baseplate-edge">
  <div className="matching-baseplate-heading">
   <FeatureField label={label} feature={feature} selected={selected} onSelect={onSelect}/>
   {profile||onSelect?<Select label={label+'记录方式'} value={value.mode} values={[[ 'continuous','连续距离'],['nearest','最近点']]} onChange={chooseMode}/>
    :<small>{nearest?'最近点':'连续距离'}</small>}
  </div>
  <MatchToggle label={label} enabled={enabled} onChange={onEnabledChange}/>
  {nearest?<><DistanceRange label={solid?'最近实体距离':'最近点距离'} feature={feature} selected={selected} onSelect={onSelect} precision={1}
   disabledInputs={!enabled} measured={profile?hit?.distance??null:undefined} value={value.nearest} onChange={distance=>onChange({...value,nearest:distance})}/>
   {closest&&<small className="matching-measurement">{solid?surface:closest.boundary==='hole'?'底板孔边':'底板板边'} · 距本段起点 {closest.station.toFixed(1)} mm</small>}</>
   :<>
    {profile?.spans.length>0&&<p className="matching-edge-hint">起点和终点均为从本段起点沿焊缝量取的距离。</p>}
    {!intervals.length&&<small className="matching-measurement">{profile?'截取范围内未找到连续'+surface:'不限'}</small>}
    {intervals.map((interval,i)=>{
     const key=feature+':'+i,name='区间 '+(i+1);
     return <div className="matching-edge-interval" key={i} onFocusCapture={()=>select(key)}>
      <div className="matching-edge-interval-heading">
       {onSelect?<button type="button" className="matching-feature-button" aria-label={'高亮'+label+name} aria-pressed={selected===key} onClick={()=>select(key)}>{name}</button>:<span>{name}</span>}
       {profile&&<button type="button" className="icon" aria-label={'删除'+label+name} onClick={()=>{update(intervals.filter((_,j)=>i!==j));select(feature);}}>×</button>}
      </div>
      {profile?<div className="matching-range">
       {[[ 'start','起点'],['end','终点']].map(([field,text])=><Field label={text} key={field}>
        <NumberField label={label+name+text} value={interval[field]} max={length+.001} unit="mm" disabled={!enabled}
         onChange={number=>update(intervals.map((row,j)=>i===j?{...row,[field]:number}:row))}/>
       </Field>)}
      </div>:<small>{interval.start}–{interval.end} mm</small>}
      <small className="matching-measurement">{interval.distance?
       (solid?'间隙 ':'边缘距离 ')+interval.distance.min.toFixed(1)+(interval.distance.max===interval.distance.min?'':'–'+interval.distance.max.toFixed(1))+' mm':
       '区间内未找到连续的'+surface}</small>
     </div>;
    })}
    {profile?.spans.length>0&&<button type="button" className="btn matching-edge-add" onClick={()=>{
     const available=intervals.filter(row=>Number.isFinite(row.start)&&Number.isFinite(row.end)&&row.end>row.start)
      .reduce((spans,row)=>spans.flatMap(span=>row.end<=span.start||row.start>=span.end?[span]:[
       {start:span.start,end:Math.min(span.end,row.start)},{start:Math.max(span.start,row.end),end:span.end}
      ].filter(part=>part.end-part.start>=.001)),profile.spans);
     const suggested=defaultDistanceInterval({spans:available});
     update([...intervals,suggested??{start:'',end:''}]);
     select(feature+':'+intervals.length);
    }}>添加区间</button>}
   </>}
 </div>;
}

export function TemplateSegmentMatchFields({template,parameters,rules,change,changeRules,selected,onSelect,evidence}){
 const segmentChange=(index,key,value)=>change({segments:parameters.segments.map((segment,i)=>i===index?{...segment,[key]:value}:segment)});
 const distanceChange=(index,key,value)=>changeRules({segmentDistances:rules.segmentDistances.map((segment,i)=>i===index?{...segment,[key]:value}:segment)});
 const featureProps={selected,onSelect};
 return <section aria-label="焊缝段几何">
  <h3>焊缝段几何</h3>
  {parameters.segments.map((segment,index)=>{
   const conditions=rules?.segmentDistances?.[index],gapEvidence=evidence?.segments[index]?.solidGap;
   const gapRule=conditions?.solidGap??(conditions&&gapEvidence?{mode:'nearest',nearest:conditions.gap}:null);
   return <fieldset className="matching-segment" key={index}>
   <legend>第 {index+1} 段 · {Number(template.segments[index].length.toFixed(1))} mm</legend>
   <div className="matching-field-grid three">
    <FeatureField label={'第 '+(index+1)+' 段几何'} feature={'segment:'+index+':geometry'} {...featureProps}>
     <Select label={`第${index+1}段匹配几何类型`} value={segment.geometry} values={geometryOptions(template.closure)} onChange={value=>segmentChange(index,'geometry',value)}/>
    </FeatureField>
    {conditions&&!gapRule&&<DistanceRange label={'焊缝段间隙 · 第 '+(index+1)+' 段'} feature={'segment:'+index+':gap'} {...featureProps}
     value={rules.segmentDistances[index]?.gap} precision={1} measured={evidence?evidence.segments[index]?.gap?.distance??null:undefined}
     enabled={geometryConditionEnabled(rules.segmentDistances[index],'gap')} onEnabledChange={value=>distanceChange(index,'gapEnabled',value)}
     onChange={value=>distanceChange(index,'gap',value)}/>}
    {rules?.segmentDistances&&!rules.segmentDistances[index]?.baseplateEdge&&<DistanceRange label={'焊缝段边缘距离 · 第 '+(index+1)+' 段'}
     value={rules.segmentDistances[index]?.edgeDistance} precision={1} onChange={value=>distanceChange(index,'edgeDistance',value)}
     enabled={geometryConditionEnabled(rules.segmentDistances[index],'edgeDistance')} onEnabledChange={value=>distanceChange(index,'edgeDistanceEnabled',value)}/>}
    {template.segments[index].length<SHORT_SEGMENT_MM&&<>
     <Field label="适用最小长度"><NumberField label={`第${index+1}段匹配最小长度`} min={.1} value={segment.minLength} unit="mm" onChange={value=>segmentChange(index,'minLength',value)}/></Field>
     <Field label="适用最大长度"><NumberField label={`第${index+1}段匹配最大长度`} min={.1} max={SHORT_SEGMENT_MM} value={segment.maxLength??shortSegmentRange(template.segments[index]).maxLength} unit="mm" onChange={value=>segmentChange(index,'maxLength',value)}/></Field>
    </>}
   </div>
   {rules?.segmentDistances?.[index]?.baseplateEdge&&<DistanceProfileFields index={index} length={template.segments[index].length}
    value={rules.segmentDistances[index].baseplateEdge} profile={evidence?.segments[index]?.baseplate}
    enabled={geometryConditionEnabled(rules.segmentDistances[index],'edgeDistance',hasDistanceProfile(rules.segmentDistances[index].baseplateEdge))}
    onEnabledChange={value=>distanceChange(index,'edgeDistanceEnabled',value)}
    onChange={value=>distanceChange(index,'baseplateEdge',value)} {...featureProps}/>}
   {gapRule&&<DistanceProfileFields solid index={index} length={template.segments[index].length}
    value={gapRule} profile={gapEvidence}
    enabled={geometryConditionEnabled(conditions,'gap',hasDistanceProfile(gapRule))}
    onEnabledChange={value=>distanceChange(index,'gapEnabled',value)}
    onChange={value=>distanceChange(index,'solidGap',value)} {...featureProps}/>}
  </fieldset>;})}
 </section>;
}

export function TemplateCornerMatchFields({template,parameters,change,selected,onSelect}){
 const cornerChange=(index,key,value)=>change({corners:parameters.corners.map((corner,i)=>i===index?{...corner,[key]:value}:corner)});
 return <section aria-label="焊缝段间转角">
  <h3>焊缝段间转角</h3>
  {!parameters.corners.length&&<p className="matching-editor-note">当前焊缝无段间转角。</p>}
  {parameters.corners.map((corner,index)=><fieldset className="matching-segment" key={index}>
   <legend>第 {index+1} 段 → 第 {index+2} 段</legend>
   <FeatureField label={'转角 '+(index+1)+' · '+Number(template.corners[index].standard.toFixed(1))+'°'} feature={'corner:'+index} selected={selected} onSelect={onSelect}>
    <span className="matching-range">
     <NumberField label={`转角${index+1}最小匹配角度`} max={360} value={corner.angleMin} unit="°" onChange={value=>cornerChange(index,'angleMin',value)}/>
     <NumberField label={`转角${index+1}最大匹配角度`} max={360} value={corner.angleMax} unit="°" onChange={value=>cornerChange(index,'angleMax',value)}/>
    </span>
   </FeatureField>
  </fieldset>)}
 </section>;
}

const initialMatch=template=>{const match=templateMatchParameters(template);return template.requirementsMatch||template.shortSegmentMatch?match:{...match,segments:match.segments.map((segment,index)=>({...segment,...shortSegmentRange(template.segments[index])}))};};

export default function TemplateMatchInformation({templates,onSave,onCancel,measureNeighborhood}){
 const [selectedId,setSelectedId]=useState(templates[0]?.id||''),[drafts,setDrafts]=useState(()=>Object.fromEntries(templates.map(template=>[template.id,initialMatch(template)]))),[error,setError]=useState(''),[ruleDrafts,setRuleDrafts]=useState(()=>Object.fromEntries(templates.map(template=>[template.id,structuredClone(template.requirementsMatch)])));
 const template=templates.find(value=>value.id===selectedId),draft=drafts[selectedId];
 const rules=ruleDrafts[selectedId];
 const evidence=React.useMemo(()=>template?.sourceWeld&&rules?.captureRange?
  measureNeighborhood?.(template,rules.captureRange):null,[template,rules?.captureRange,measureNeighborhood]);
 const changeRules=values=>setRuleDrafts(previous=>({...previous,[selectedId]:{...previous[selectedId],...values}}));

 const change=values=>{setDrafts(previous=>({...previous,[selectedId]:{...previous[selectedId],...values}}));setError('');};
 function save(event){
  event.preventDefault();
  const changed=templates.filter(value=>value.id===selectedId&&(value.matchParameters?.version!==2||!value.matchParameters.corners.every(corner=>'angleMin' in corner&&'angleMax' in corner))||JSON.stringify(drafts[value.id])!==JSON.stringify(initialMatch(value))||JSON.stringify(ruleDrafts[value.id])!==JSON.stringify(value.requirementsMatch));
  for(const value of changed){const candidate={...value,shortSegmentMatch:true,matchParameters:drafts[value.id],requirementsMatch:ruleDrafts[value.id]};const issues=[...validateTemplate(candidate),...geometryRuleErrors(candidate)];if(issues.length){setSelectedId(value.id);setError(issues.join('；'));return;}}
  const result=onSave(changed.map(value=>({...value,shortSegmentMatch:true,requirementsMatch:structuredClone(savedGeometryRules(ruleDrafts[value.id])),matchParameters:structuredClone(drafts[value.id]),updatedAt:new Date().toISOString()})));if(result)setError(result);
 }
 return <form className="template-match-editor" onSubmit={save}>
  <div className="matching-editor-body">
   {!template?<p>暂无焊接模板。</p>:<>
    <div className="matching-editor-title">{templates.length>1?<Field label="焊接模板"><Select label="选择匹配参数模板" value={selectedId} values={templates.map(value=>[value.id,value.name])} onChange={setSelectedId}/></Field>:<strong>{template.name}</strong>}<span>{template.closure==='closed'?'闭合':'开放'} · {template.segments.length} 段 · {template.corners.length} 个转角</span></div>
    <section aria-label="基本匹配参数"><h3>基本匹配参数</h3><div className="matching-field-grid three">
     <Field label="焊脚高度"><NumberField label="匹配焊脚高度" min={.5} step={.5} value={draft.leg} unit="mm" onChange={leg=>change({leg})}/></Field>
     <Field label="焊接位置"><Select label="匹配焊接位置" value={draft.position??''} placeholder="各段不同（保留原值）" values={POSITIONS.map(value=>[value,processPositionLabel(value)])} onChange={position=>change({position})}/></Field>
    </div></section>
    <TemplateSegmentMatchFields template={template} parameters={draft} rules={rules} change={change} changeRules={changeRules} evidence={evidence}/>
    <TemplateCornerMatchFields template={template} parameters={draft} change={change}/>
    {rules&&<GeometryMatchFields rules={rules} changeRules={changeRules} holeFlags={{start:template.startHole,end:template.endHole}}/>}
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
