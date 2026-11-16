import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import TemplateCreationWorkbench from './TemplateCreationWorkbench';
import {templateMatchParameters} from './templateMatchingParameters.mjs';
import {geometryRuleErrors,geometryRulesFromWeld,geometryRulesWithMeasuredAvailability,savedGeometryRules,shortSegmentRange,updateGeometryRuleMeasurements} from './templateGeometryRules.mjs';
import {validTemplateCaptureRange} from './templateCaptureRange.mjs';
import {createTemplateNeighborhoodMeasurer} from './templateNeighborhood.mjs';
import {loadStepNeighborhood} from './stepModelStore.mjs';
import {validateTemplate} from './templateModel.mjs';

function initialParameters(template){
 const parameters=templateMatchParameters(template);
 if(template.requirementsMatch||template.shortSegmentMatch)return parameters;
 return {...parameters,segments:parameters.segments.map((segment,index)=>segment.lengthMatchEnabled?segment:{
  ...segment,...shortSegmentRange(template.segments[index])
 })};
}

export default function TemplateMatchEditor({template,measureNeighborhood,onSave,onClose}){
 const [initial]=useState(()=>initialParameters(template));
 const [parameters,setParameters]=useState(initial);
 const [rules,setRules]=useState(()=>structuredClone(template.requirementsMatch));
 const [captureInput,setCaptureInput]=useState(rules?.captureRange);
 const [captureError,setCaptureError]=useState('');
 const [errors,setErrors]=useState([]);
 const [feature,selectFeature]=useState('segment:0:geometry');
 const [storedMeasure,setStoredMeasure]=useState(null);
 const modelCapture=useRef(null);
 const source=template.sourceWeld;
 const sha=source?.stepModel?.sourceSha256;
 useEffect(()=>{
  if(!sha||!template.requirementsMatch?.captureRange)return;
  let active=true;
  loadStepNeighborhood(sha).then(geometry=>{
   if(active&&geometry)setStoredMeasure(()=>createTemplateNeighborhoodMeasurer(geometry));
  }).catch(()=>{});
  return()=>{active=false;};
 },[sha,template.requirementsMatch]);

 const measure=useCallback(range=>source?(measureNeighborhood?.(template,range)??storedMeasure?.(template,range)):null,
  [source,template,measureNeighborhood,storedMeasure]);
 const resolved=useMemo(()=>{
  if(!rules?.captureRange)return {evidence:null};
  try{return {evidence:measure(rules.captureRange)};}catch(error){return {evidence:null,error:error.message};}
 },[rules?.captureRange,measure]);
 const activeRules=useMemo(()=>geometryRulesWithMeasuredAvailability(rules,resolved.evidence),[rules,resolved.evidence]);
 const draft={...template,requirementsMatch:rules};
 function changeCaptureRange(range){
  setCaptureInput(range);
  if(!validTemplateCaptureRange(range)){setCaptureError('请输入有效截取范围。');return;}
  try{
   const evidence=measure(range);
   if(!evidence)throw Error('来源模型的测量数据尚未加载，请稍后再调整截取范围。');
   const previous=geometryRulesFromWeld(template,rules.captureRange,resolved.evidence);
   const next=geometryRulesFromWeld(template,range,evidence);
   setRules(current=>updateGeometryRuleMeasurements(current,previous,next,evidence));
   setCaptureError('');setErrors([]);
  }catch(error){setCaptureError(error.message);}
 }
 async function save(event){
  event.preventDefault();
  if(captureError)return;
  if(template.matchParameters?.version===2&&template.matchParameters.corners.every(corner=>'angleMin' in corner&&'angleMax' in corner)&&
     JSON.stringify(parameters)===JSON.stringify(initial)&&JSON.stringify(activeRules)===JSON.stringify(template.requirementsMatch)){
   onClose();return;
  }
  const candidate={...draft,requirementsMatch:activeRules,shortSegmentMatch:true,matchParameters:parameters};
  const issues=[...new Set([...validateTemplate(candidate),...geometryRuleErrors(candidate)])];
  if(issues.length){setErrors(issues);return;}
  if(source&&JSON.stringify(rules?.captureRange)!==JSON.stringify(template.requirementsMatch?.captureRange)){
   if(!modelCapture.current){setErrors(['请等待三维焊缝域模型加载完成后保存']);return;}
   try{candidate.cover=modelCapture.current({id:source.id,leg:template.leg,segments:template.segments});}
   catch(error){setErrors([error.message]);return;}
  }
  const error=await onSave({...candidate,requirementsMatch:savedGeometryRules(activeRules),updatedAt:new Date().toISOString()});
  if(error)setErrors([error]);
 }
 return <TemplateCreationWorkbench initial={template} draft={draft} parameters={parameters}
  changeParameters={values=>{setParameters(current=>({...current,...values}));setErrors([]);}}
  changeRules={values=>{setRules(current=>({...current,...values}));setErrors([]);}}
  evidence={resolved.evidence} captureInput={captureInput} changeCaptureRange={changeCaptureRange}
  captureError={captureError} captureNotice={captureInput&&!resolved.evidence?(resolved.error||'当前缺少来源模型的测量数据。'):''}
  onCaptureReady={capture=>{modelCapture.current=capture;}} feature={feature} onSelect={selectFeature}
  onSave={save} onClose={onClose} errors={errors} editMatchingParameters saveLabel="保存参数"/>;
}
