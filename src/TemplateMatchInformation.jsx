import {formatDecimal} from './numericPrecision.mjs';
import NumericInput from './NumericInput.jsx';
import React,{useState} from 'react';
import {POSITIONS,geometryOptions} from './templateModel.mjs';
import {processPositionLabel} from './processLibraryView.mjs';
import {ENDPOINT_TYPES,ENDPOINT_DIMENSIONS,geometryConditionEnabled,hasDistanceProfile,measuredDistanceRange,measuredEndpointDistance,roundEndpointGap,segmentLengthRange,SHORT_SEGMENT_MM,updateDistanceIntervals} from './templateGeometryRules.mjs';
import {defaultDistanceInterval,distanceModeAvailable,measureDistanceInterval} from './templateDistanceProfile.mjs';
import GrooveFields from './GrooveFields';
import './templateMatchInformation.css';

function Field({label,children}){return <label className="matching-field"><span>{label}</span>{children}</label>;}
function NumberField({label,value,onChange,unit,min=0,max,step='any',optional=false,precision,disabled=false}){const [focused,setFocused]=useState(false);const formatted=precision===1&&!focused&&Number.isFinite(value)?value.toFixed(1):value??'';return <span className="matching-number"><NumericInput aria-label={label} min={min} max={max} step={step} disabled={disabled} required={!optional} placeholder={optional?'不限':undefined} value={formatted} onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);if(precision===1&&Number.isFinite(value)&&roundEndpointGap(value)!==value)onChange(roundEndpointGap(value));}} onChange={event=>onChange(event.target.value===''?optional?null:'':Number(event.target.value))}/>{unit&&<small>{unit}</small>}</span>;}
function Select({label,value,values,onChange,placeholder='请选择',disabled=false}){return <select aria-label={label} disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}>{!values.some(item=>(Array.isArray(item)?item[0]:item)===value)&&<option value={value} disabled>{value||placeholder}</option>}{values.map(item=>{const [key,text,unavailable]=Array.isArray(item)?item:[item,item];return <option key={key} value={key} disabled={unavailable}>{text}</option>;})}</select>;}

function FeatureField({label,feature,selected,onSelect,children,disabled=false}){
 if(!onSelect)return <Field label={label}>{children}</Field>;
 return <div className="matching-field" onFocusCapture={disabled?undefined:()=>onSelect(feature)}>
  <button type="button" className="matching-feature-button" aria-label={'高亮'+label} aria-pressed={selected===feature&&!disabled} disabled={disabled} onClick={()=>onSelect(feature)}>{label}</button>
  {children}
 </div>;
}

function MatchToggle({label,enabled,onChange,disabled=false,text='参与匹配'}){
 return <label className="matching-enable"><input type="checkbox" aria-label={label+'参与匹配'} checked={!!enabled&&!disabled}
  disabled={disabled} onChange={event=>onChange(event.target.checked)}/>{text}</label>;
}

function DistanceRange({label,feature,value,onChange,precision,selected,onSelect,measured,enabled,onEnabledChange,disabledInputs=enabled===false,zeroUnavailable=false}){
 const unavailable=measured===null||zeroUnavailable&&roundEndpointGap(measured)===0;
 return <div className={'matching-distance'+(unavailable?' is-unavailable':'')}>
 <FeatureField label={label} feature={feature} selected={selected} onSelect={onSelect} disabled={unavailable}>
  <span className="matching-range">{['min','max'].map(key=><NumberField key={key}
   label={label+(key==='min'?'最小值':'最大值')} value={value?.[key]} unit="mm" step={precision===1?.1:'any'} precision={precision}
   optional disabled={disabledInputs||unavailable} onChange={number=>onChange({min:null,max:null,...value,[key]:number})}/>)}</span>
  {measured!==undefined&&<small className="matching-measurement" aria-label={label+'实测值'}>{measured===null?'范围内未命中':'实测 '+(precision===1?measured.toFixed(1):Number(measured.toFixed(2)))+' mm'}</small>}
 </FeatureField>
 {onEnabledChange&&<MatchToggle label={label} enabled={enabled} disabled={unavailable} onChange={onEnabledChange}/>}
 </div>;
}

export function GeometryMatchFields({rules,changeRules,holeFlags={},title='整条焊缝起终点条件',selected,onSelect,evidence,section}){
 const featureProps={selected,onSelect};
 const scoped=!!rules.captureRange;
 return <section aria-label={title}>
  {!section&&<h3>{title}</h3>}
  {(!section||section==='overall')&&<div className="matching-field-grid">
   <Field label="焊接方式"><Select label="匹配焊接方式" value={String(rules.machineCount)} values={[[ '1','单机焊接'],['2','双机焊接']]} onChange={value=>changeRules({machineCount:Number(value)})}/></Field>
   <Field label="焊缝形式"><Select label="匹配焊缝形式" value={rules.weldType} values={['角焊缝','搭接焊缝','对接焊缝']} onChange={weldType=>changeRules({weldType})}/></Field>
   {!rules.captureRange&&<DistanceRange label="焊缝边缘距离" value={rules.edgeDistance} onChange={edgeDistance=>changeRules({edgeDistance})}
    enabled={geometryConditionEnabled(rules,'edgeDistance')} onEnabledChange={edgeDistanceEnabled=>changeRules({edgeDistanceEnabled})}/>}
  </div>}
  {[['start','起点'],['end','终点']].filter(([key])=>!section||key===section).map(([key,label])=>{
   const endpoint=rules[key];
   const typeUnavailable=scoped&&!ENDPOINT_TYPES.includes(evidence?.[key]?.type);
   return <fieldset key={key} className="matching-segment">
   <legend>{label}条件</legend>
   <div className="matching-field-grid matching-endpoint-fields">
    <FeatureField label={label+'类型'} feature={key+':type'} {...featureProps} disabled={typeUnavailable}>
     <Select label={label+'匹配类型'} value={endpoint.type} values={[[ '', typeUnavailable?'未检测到':'不限'],...ENDPOINT_TYPES]} disabled={typeUnavailable} onChange={type=>changeRules({[key]:{...endpoint,type}})}/>
    </FeatureField>
    {ENDPOINT_DIMENSIONS.map(([dimension,name])=>{
     const measured=scoped||evidence?measuredEndpointDistance(evidence,key,dimension):undefined;
     const initial=measuredDistanceRange(measured)??(!scoped&&dimension==='holeSize'&&holeFlags[key]===false?{min:0,max:0}:null);
     const value=endpoint[dimension]??initial;
     const enabledRange=value?.min==null&&value?.max==null?initial:value;
     return <DistanceRange key={dimension} feature={key+':'+dimension} label={label+name} {...featureProps}
      value={value} enabled={geometryConditionEnabled(endpoint,dimension)}
      onEnabledChange={enabled=>changeRules({[key]:{...endpoint,[dimension+'Enabled']:enabled,
       ...(enabled?{[dimension]:enabledRange}:{})}})}
      precision={1} measured={measured} zeroUnavailable onChange={value=>changeRules({[key]:{...endpoint,[dimension]:value}})}/>;
    })}
   </div>
  </fieldset>;})}
 </section>;
}

function DistanceProfileFields({value,onChange,profile,measurementKnown,length,index,selected,onSelect,enabled,onEnabledChange,solid=false}){
 const label=(solid?'焊缝段间隙':'焊缝段边缘距离')+' · 第 '+(index+1)+' 段';
 const feature='segment:'+index+':'+(solid?'gap':'edgeDistance'),surface=solid?'实体表面':'底板边缘';
 const nearest=value.mode==='nearest',intervals=value.intervals??[];
 const unavailable=mode=>measurementKnown&&!distanceModeAvailable(profile,mode);
 const disabled=unavailable(value.mode);
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
   <FeatureField label={label} feature={feature} selected={selected} onSelect={onSelect} disabled={disabled}/>
   {profile||onSelect?<Select label={label+'记录方式'} value={value.mode} values={[[ 'continuous','连续距离',unavailable('continuous')],['nearest','最近点',unavailable('nearest')]]} disabled={unavailable('continuous')&&unavailable('nearest')} onChange={chooseMode}/>
    :<small>{nearest?'最近点':'连续距离'}</small>}
  </div>
  <MatchToggle label={label} enabled={enabled} disabled={disabled} onChange={onEnabledChange}/>
  {nearest?<><DistanceRange label={solid?'最近实体距离':'最近点距离'} feature={feature} selected={selected} onSelect={onSelect} precision={1}
   disabledInputs={!enabled||disabled} measured={measurementKnown?hit?.distance??null:undefined} value={value.nearest} onChange={distance=>onChange({...value,nearest:distance})}/>
   {closest&&<small className="matching-measurement">{solid?surface:closest.boundary==='hole'?'底板孔边':'底板板边'} · 距本段起点 {closest.station.toFixed(1)} mm</small>}</>
   :<>
    {!disabled&&profile?.spans.length>0&&<p className="matching-edge-hint">起点和终点均为从本段起点沿焊缝量取的距离。</p>}
    {(disabled||!intervals.length)&&<small className="matching-measurement">{disabled?'截取范围内未找到连续'+surface:measurementKnown?'未设置区间':'不限'}</small>}
    {intervals.map((interval,i)=>{
     const key=feature+':'+i,name='区间 '+(i+1);
     const measured=solid&&measurementKnown?measureDistanceInterval(profile,interval.start,interval.end):interval.distance;
     const min=measured?.min.toFixed(1),max=measured?.max.toFixed(1);
     return <div className="matching-edge-interval" key={i} onFocusCapture={disabled?undefined:()=>select(key)}>
      <div className="matching-edge-interval-heading">
       {onSelect?<button type="button" className="matching-feature-button" aria-label={'高亮'+label+name} aria-pressed={selected===key&&!disabled} disabled={disabled} onClick={()=>select(key)}>{name}</button>:<span>{name}</span>}
       {profile&&<button type="button" className="icon" aria-label={'删除'+label+name} disabled={!enabled||disabled} onClick={()=>{update(intervals.filter((_,j)=>i!==j));select(feature);}}>×</button>}
      </div>
      {profile?<div className="matching-range">
       {[[ 'start','起点'],['end','终点']].map(([field,text])=><Field label={text} key={field}>
        <NumberField label={label+name+text} value={interval[field]} max={length+.001} unit="mm" disabled={!enabled||disabled}
         onChange={number=>update(intervals.map((row,j)=>i===j?{...row,[field]:number}:row))}/>
       </Field>)}
      </div>:<small>{formatDecimal(interval.start)}–{formatDecimal(interval.end)} mm</small>}
      <small className="matching-measurement">{measured?
       (solid?'间隙 ':'边缘距离 ')+min+(max===min?'':'–'+max)+' mm':
       '区间内未找到连续的'+surface}</small>
     </div>;
    })}
    {!disabled&&profile?.spans.length>0&&<button type="button" className="btn matching-edge-add" disabled={!enabled} onClick={()=>{
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

export function TemplateSegmentMatchFields({template,parameters,rules,change,changeRules,selected,onSelect,evidence,onlyIndex}){
 const changeSegment=(index,values)=>change({segments:parameters.segments.map((segment,i)=>i===index?{...segment,...values}:segment)});
 const segmentChange=(index,key,value)=>changeSegment(index,{[key]:value});
 const distanceChange=(index,key,value)=>changeRules({segmentDistances:rules.segmentDistances.map((segment,i)=>i===index?{...segment,[key]:value}:segment)});
 const featureProps={selected,onSelect};
 const measurementKnown=!!(rules?.captureRange||evidence);
 return <section aria-label="焊缝段几何">
  {onlyIndex===undefined&&<h3>焊缝段几何</h3>}
  {parameters.segments.map((segment,index)=>{
   if(onlyIndex!==undefined&&index!==onlyIndex)return null;
   const source=template.segments[index],short=source.length<SHORT_SEGMENT_MM;
   const conditions=rules?.segmentDistances?.[index],gapEvidence=evidence?.segments?.[index]?.solidGap;
   const gapRule=conditions?.solidGap??(conditions&&gapEvidence?{mode:'nearest',nearest:conditions.gap}:null);
   return <fieldset className="matching-segment" key={index}>
   {onlyIndex===undefined&&<legend>第 {index+1} 段 · {Number(template.segments[index].length.toFixed(1))} mm</legend>}
   <div className="matching-field-grid three matching-segment-geometry">
    <FeatureField label={'第 '+(index+1)+' 段几何'} feature={'segment:'+index+':geometry'} {...featureProps}>
     <Select label={`第${index+1}段匹配几何类型`} value={segment.geometry} values={geometryOptions(template.closure)} onChange={value=>segmentChange(index,'geometry',value)}/>
    </FeatureField>
    {conditions&&!gapRule&&<DistanceRange label={'焊缝段间隙 · 第 '+(index+1)+' 段'} feature={'segment:'+index+':gap'} {...featureProps}
     value={rules.segmentDistances[index]?.gap} precision={1} measured={measurementKnown?evidence?.segments?.[index]?.gap?.distance??null:undefined}
     enabled={geometryConditionEnabled(rules.segmentDistances[index],'gap')} onEnabledChange={value=>distanceChange(index,'gapEnabled',value)}
     onChange={value=>distanceChange(index,'gap',value)}/>}
    {rules?.segmentDistances&&!rules.segmentDistances[index]?.baseplateEdge&&<DistanceRange label={'焊缝段边缘距离 · 第 '+(index+1)+' 段'}
     value={rules.segmentDistances[index]?.edgeDistance} precision={1} measured={measurementKnown?evidence?.segments?.[index]?.edge?.distance??null:undefined} onChange={value=>distanceChange(index,'edgeDistance',value)}
     enabled={geometryConditionEnabled(rules.segmentDistances[index],'edgeDistance')} onEnabledChange={value=>distanceChange(index,'edgeDistanceEnabled',value)}/>}
   </div>
   {!short&&<MatchToggle label={`第${index+1}段长度范围`} text="段长参与匹配" enabled={segment.lengthMatchEnabled} onChange={lengthMatchEnabled=>changeSegment(index,{
    ...(lengthMatchEnabled&&segment.maxLength==null?segmentLengthRange(source):{}),lengthMatchEnabled
   })}/>}
   {(short||segment.lengthMatchEnabled)&&<div className="matching-field-grid">
     <Field label="适用最小长度"><NumberField label={`第${index+1}段匹配最小长度`} min={.1} value={segment.minLength} unit="mm" onChange={value=>segmentChange(index,'minLength',value)}/></Field>
     <Field label="适用最大长度"><NumberField label={`第${index+1}段匹配最大长度`} min={.1} max={short?SHORT_SEGMENT_MM:undefined} value={segment.maxLength??(short?segmentLengthRange(source).maxLength:null)} unit="mm" onChange={value=>segmentChange(index,'maxLength',value)}/></Field>
   </div>}
   {rules?.segmentDistances?.[index]?.baseplateEdge&&<DistanceProfileFields index={index} length={template.segments[index].length}
    value={rules.segmentDistances[index].baseplateEdge} profile={evidence?.segments?.[index]?.baseplate} measurementKnown={measurementKnown}
    enabled={geometryConditionEnabled(rules.segmentDistances[index],'edgeDistance',hasDistanceProfile(rules.segmentDistances[index].baseplateEdge))}
    onEnabledChange={value=>distanceChange(index,'edgeDistanceEnabled',value)}
    onChange={value=>distanceChange(index,'baseplateEdge',value)} {...featureProps}/>}
   {gapRule&&<DistanceProfileFields solid index={index} length={template.segments[index].length}
    value={gapRule} profile={gapEvidence} measurementKnown={measurementKnown}
    enabled={geometryConditionEnabled(conditions,'gap',hasDistanceProfile(gapRule))}
    onEnabledChange={value=>distanceChange(index,'gapEnabled',value)}
    onChange={value=>distanceChange(index,'solidGap',value)} {...featureProps}/>}
  </fieldset>;})}
 </section>;
}

export function TemplateCornerMatchFields({template,parameters,change,selected,onSelect,onlyIndex}){
 const cornerChange=(index,key,value)=>change({corners:parameters.corners.map((corner,i)=>i===index?{...corner,[key]:value}:corner)});
 return <section aria-label="焊缝段间转角">
  {onlyIndex===undefined&&<h3>焊缝段间转角</h3>}
  {!parameters.corners.length&&<p className="matching-editor-note">当前焊缝无段间转角。</p>}
  {parameters.corners.map((corner,index)=>(onlyIndex===undefined||index===onlyIndex)&&<fieldset className="matching-segment" key={index}>
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

export function TemplateBasicMatchFields({parameters,change,section,calculatedLeg}){
 if(section==='start'||section==='end'){
  const key=section+'Hole',label=section==='start'?'起点过焊孔':'终点过焊孔';
  return <Field label={label}><Select label={'匹配'+label} value={String(parameters[key])} values={[[ 'false','无'],['true','有']]} onChange={value=>change({[key]:value==='true'})}/></Field>;
 }
 if(section!=='overall')return null;
 return <section className="matching-basic" aria-label="基本匹配参数">
  <div className="matching-field-grid">
   <Field label="焊脚高度"><NumberField label="匹配焊脚高度" min={calculatedLeg?0:.5} step={calculatedLeg?'any':.5} value={parameters.leg} unit="mm" onChange={leg=>change({leg})}/></Field>
   <Field label="焊接位置"><Select label="匹配焊接位置" value={parameters.position??''} placeholder="各段不同（保留原值）" values={POSITIONS.map(value=>[value,processPositionLabel(value)])} onChange={position=>change({position})}/></Field>
   <GrooveFields prefix="匹配" value={parameters.groove} onChange={groove=>change({groove})}/>
  </div>
 </section>;
}
