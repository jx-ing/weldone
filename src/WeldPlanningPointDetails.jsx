import React,{useEffect,useRef,useState} from 'react';
import {OVERRIDES,TRACKING} from './templateModel.mjs';
import {PASS_OFFSET_FIELDS,passOffsetValues,validPassOffsets} from './templatePassOffsets.mjs';
import {weldControlPointError} from './weldPlanningPoints.mjs';
import WeldPoseHelp from './WeldPoseHelp';

const positionFields=['X','Y','Z'];
const poseFields=[['advance','前进角'],['work','工作角'],['rotation','旋转角']];
const display=(value,unit)=>Number.isFinite(value)?Number(value.toFixed(3))+' '+unit:'—';

function PassPlayback({preview,seekVersion}){
 const [playing,setPlaying]=useState(false);
 const distance=useRef(preview.pose.distance);
 const {from,to,speedAt,onStation,collision}=preview;
 const speed=speedAt(distance.current);
 const canPlay=Number.isFinite(speed)&&speed>0;
 const seek=station=>{setPlaying(false);distance.current=station;onStation(station);};
 useEffect(()=>{
  if(!playing)return;
  let frame,previous;
  function advance(now){
   const speed=speedAt(distance.current);
   if(!Number.isFinite(speed)||speed<=0){setPlaying(false);return;}
   if(previous!==undefined){
    distance.current=Math.min(to,distance.current+(now-previous)*speed/60000);
    onStation(distance.current);
   }
   previous=now;
   if(distance.current>=to)setPlaying(false);
   else frame=requestAnimationFrame(advance);
  }
  frame=requestAnimationFrame(advance);
  return ()=>cancelAnimationFrame(frame);
 },[playing,speedAt,to,onStation]);
 useEffect(()=>{setPlaying(false);},[seekVersion]);
 useEffect(()=>{if(!playing)distance.current=preview.pose.distance;},[preview.pose.distance,playing]);
 const issue=collision?.contact??collision?.closest;
 return <div className="wa-playback">
  <button type="button" className="btn" disabled={!canPlay&&!playing}
   title={!canPlay?'请先配置有效的焊接速度':undefined}
   onClick={()=>{if(!playing&&distance.current>=to){distance.current=from;onStation(from);}setPlaying(!playing);}}>
   {playing?'暂停':'播放机头'}
  </button>
  {canPlay&&<span>{display(speed,'mm/min')}</span>}
  {collision?.ranges.length>0&&<label><span>碰撞区间</span>
   <select aria-label="碰撞区间" value="" onChange={event=>seek(Number(event.target.value))}>
    <option value="" disabled>选择并定位</option>
    {collision.ranges.map(([from,to])=><option key={from} value={from}>
     {display(from,'mm')} – {display(to,'mm')}
    </option>)}
   </select>
  </label>}
  {issue&&<p>{issue.collision?'碰撞':'最近间隙 '+display(issue.distance,'mm')} · {issue.part} · <button type="button" className="btn" onClick={()=>seek(issue.station)}>{display(issue.station,'mm')}</button><br/>
   位置 {issue.point.map(value=>Number(value.toFixed(2))).join(' / ')} mm
  </p>}
 </div>;
}

function LayerOrPassEditor({group,layerOnly,editable,onSave,formId,passPreview}){
 const [draft,setDraft]=useState(()=>layerOnly?{name:group.layerName,height:group.layerHeight,offsetY:group.layerOffsetY}:{name:group.passName,offset:passOffsetValues(group.passOffset)});
 const [status,setStatus]=useState('');
 const [seekVersion,setSeekVersion]=useState(0);
 const seek=station=>{setSeekVersion(value=>value+1);passPreview.onStation(station);};
 const change=values=>{setDraft(previous=>({...previous,...values}));setStatus('');};
 const number=(label,unit,value,onChange)=><label key={label}><span>{label} ({unit})</span>
  <input aria-label={label} type="number" step="any" required max={unit==='°'?360:undefined} min={unit==='°'?-360:undefined}
   value={value} onChange={event=>onChange(event.target.value===''?'':event.target.valueAsNumber)}/>
 </label>;
 async function save(event){
  event.preventDefault();
  const name=draft.name.trim();
  if(!name)return setStatus('请输入名称');
  if(layerOnly?![draft.height,draft.offsetY].every(Number.isFinite):!validPassOffsets(draft.offset))return setStatus('请输入有效的偏移值');
  setStatus(await onSave(group,{...draft,name},layerOnly)||'已保存');
 }
 return <form id={formId} className="wa-point-details" aria-label="层道偏移" onSubmit={save}>
  {passPreview&&<div className="wa-pass-preview">
   <label><span>机头预览里程</span><output>{display(passPreview.pose.distance,'mm')}</output>
    <input type="range" aria-label="机头预览里程" min={passPreview.from} max={passPreview.to} step="any"
     value={passPreview.pose.distance} onChange={event=>seek(event.target.valueAsNumber)}/></label>
   {passPreview.sampleStations.length>0&&<>
    <div className="wa-sample-ticks" aria-hidden="true">
     {passPreview.sampleStations.map(station=><span key={station}
      className={station===passPreview.sampleStation?'active':undefined}
      style={{left:100*(station-passPreview.from)/(passPreview.to-passPreview.from)+'%'}}/>)}
    </div>
    <label className="wa-sample-select">
     <span>采样点（{passPreview.sampleStations.length}）</span>
     <select aria-label="采样点" value={passPreview.sampleStation??''}
      onChange={event=>seek(Number(event.target.value))}>
      <option value="" disabled>选择采样点</option>
      {passPreview.sampleStations.map((station,index)=><option key={station} value={station}>
       {index+1} · {display(station,'mm')}
      </option>)}
     </select>
    </label>
   </>}
   <PassPlayback preview={passPreview} seekVersion={seekVersion}/>
   <dl className="wa-point-values">{poseFields.map(([key,label])=><div key={key}><dt>{label}</dt>
    <dd>{display(passPreview.pose.angles[key],'°')}</dd></div>)}
    <div><dt>导电嘴距离</dt><dd>{passPreview.pose.contactDistance==null?'待标定':display(passPreview.pose.contactDistance,'mm')}</dd></div>
   </dl>
  </div>}
  <h3>层道偏移</h3>
  <p className="wa-point-context">{[group.layerName,!layerOnly&&group.passName].filter(Boolean).join(' / ')}</p>
  {group.derived&&<p className="wa-point-context">{!layerOnly&&group.processOffsetBase?'工艺偏移基准为原焊缝，另叠加层偏移':'相对第一层第一道'}</p>}
  <fieldset className="wa-point-adjustment" disabled={!editable}>
   <label><span>{layerOnly?'层名称':'道名称'}</span><input aria-label={layerOnly?'层名称':'道名称'} value={draft.name} maxLength={40} required onChange={event=>change({name:event.target.value})}/></label>
   {layerOnly?<>{number('层高','mm',draft.height,height=>change({height}))}
    {number('层水平偏移 Y','mm',draft.offsetY,offsetY=>change({offsetY}))}</>:
    PASS_OFFSET_FIELDS.map(([key,label,unit])=>number(label,unit,draft.offset[key],value=>change({offset:{...draft.offset,[key]:value}})))}
  </fieldset>
  {status&&<p role="status">{status}</p>}
 </form>;
}

function offsetValue(event,blank){
 return event.target.value===''?blank:event.target.valueAsNumber;
}

function OffsetRow({label,offsetLabel,base,unit,value,onChange,disabled,optional=false,min,max,showActual=false}){
 return <label className={showActual?'wa-offset-row wa-actual-pose':'wa-offset-row'}>
  <span>{label}</span>
  <span className="wa-offset-value" aria-label={showActual?'实际'+label:undefined}>{display(base,unit)}</span>
  {!showActual&&<span aria-hidden="true">+</span>}
  <span className="wa-offset-input"><input aria-label={offsetLabel} type="number" step="any" min={min} max={max}
   value={value??''} placeholder={optional?'—':undefined} disabled={disabled} required={!optional}
   onChange={event=>onChange(offsetValue(event,optional?null:''))}/><span>{unit}</span></span>
 </label>;
}

function PointEditor({point,actualPose,basePosition,group,editable,onSave,onOffsetPreview,onOffsetPreviewEnd,formId}){
 const derived=group.derived&&['start','end'].includes(point.kind);
 const [draft,setDraft]=useState(()=>({
  ...point.raw,
  offset:{...point.raw.offset},
  poseOffset:Object.fromEntries(poseFields.map(([key])=>[key,(point.raw.poseOffset?.[key]??0)+(derived?point.raw.angles[key]:0)])),
  processOffset:{...point.raw.processOffset}
 }));
 const [status,setStatus]=useState('');
 const change=(section,key,value)=>{setDraft(previous=>({...previous,[section]:{...previous[section],[key]:value}}));setStatus('');};
 useEffect(()=>()=>onOffsetPreviewEnd(point.id),[point.id,onOffsetPreviewEnd]);
 function changePlacement(section,key,value){
  const next={...draft,[section]:{...draft[section],[key]:value}};
  change(section,key,value);
  const patch={};
  if(Object.values(next.offset).every(Number.isFinite))patch.offset=next.offset;
  if(Object.values(next.poseOffset).every(angle=>Number.isFinite(angle)&&Math.abs(angle)<=360)){
   if(derived){patch.angles=next.poseOffset;patch.poseOffset=undefined;}
   else patch.poseOffset=next.poseOffset;
  }
  onOffsetPreview({pointId:point.id,patch});
 }
 async function save(event){
  event.preventDefault();
  const processOffset=Object.fromEntries(Object.entries(draft.processOffset).filter(([,value])=>value!==null));
  for(const [key,value] of Object.entries(processOffset)){
   if(!Number.isFinite(value)||(point.processBase[key]??0)+value<OVERRIDES[key][2])return setStatus(OVERRIDES[key][0]+'叠加偏移后超出有效范围');
  }
  const saved={...draft,name:draft.name.trim(),groupId:group.id,processOffset};
  if(derived){saved.angles=draft.poseOffset;saved.poseOffset=undefined;}
  const anchors=group.points.filter(p=>p.source==='weld').map(p=>({...p,id:p.raw.id}));
  const issue=weldControlPointError(saved,anchors)||await onSave(saved);
  if(!issue)onOffsetPreviewEnd(point.id);
  setStatus(issue||'已保存');
 }
 return <form id={formId} className="wa-point-details" aria-label="点位详情" onSubmit={save}>
  <label className="wa-point-title"><span>点位名称</span>
   <input aria-label="点位名称" value={draft.name} required maxLength={40} disabled={!editable}
    onChange={event=>{setDraft(previous=>({...previous,name:event.target.value}));setStatus('');}}/>
  </label>
  {point.kind==='control'&&<label className="wa-offset-row wa-point-tracking"><span>基准点</span>
   <select aria-label="基准点" value={draft.referenceId} disabled={!editable} onChange={event=>{setDraft(previous=>({...previous,referenceId:event.target.value}));setStatus('');}}>
    {group.points.filter(p=>p.source==='weld').map(p=><option key={p.id} value={p.raw.id}>{p.name}</option>)}
   </select>
  </label>}
  <h4>位置</h4>
  <p className="wa-point-context">位置偏移沿焊缝局部坐标轴</p>
  {positionFields.map((label,index)=><OffsetRow key={label} label={label} offsetLabel={label+' 偏移'}
   base={basePosition?.[index]} unit="mm" value={draft.offset[label.toLowerCase()]} disabled={!editable}
   onChange={value=>changePlacement('offset',label.toLowerCase(),value)}/>)}
  <h4>姿态</h4>
  <WeldPoseHelp/>
  <div className="wa-offset-row wa-actual-pose wa-actual-pose-header" aria-hidden="true">
   <span>角度</span><span>实际姿态</span><span>点位偏移</span>
  </div>
  {poseFields.map(([key,label])=><OffsetRow key={key} label={label} offsetLabel={label+'偏移'} showActual
   base={actualPose?.[key]} unit="°" value={draft.poseOffset[key]} min={-360} max={360}
   disabled={!editable} onChange={value=>changePlacement('poseOffset',key,value)}/>)}
  <h4>工艺参数</h4>
  <label className="wa-offset-row wa-point-tracking"><span>跟踪方式</span>
   <select aria-label="跟踪方式" value={draft.tracking} disabled={!editable} onChange={event=>{setDraft(previous=>({...previous,tracking:event.target.value}));setStatus('');}}>
    {derived&&<option value="">继承第一层第一道</option>}
    {TRACKING.map(mode=><option key={mode}>{mode}</option>)}
   </select>
  </label>
  {Object.entries(OVERRIDES).map(([key,[label,unit]])=><OffsetRow key={key} label={label} offsetLabel={label+'偏移'}
   base={point.processBase[key]} unit={unit} value={draft.processOffset[key]} optional disabled={!editable}
   onChange={value=>change('processOffset',key,value)}/>)}
  {status&&<p role="status" className="wa-offset-status">{status}</p>}
 </form>;
}

export default function WeldPlanningPointDetails({point,actualPose,passPreview,basePosition,group,layerOnly,editable,onSavePoint,onSaveLayerOrPass,onOffsetPreview,onOffsetPreviewEnd,formId}){
 if(group&&!point)return <LayerOrPassEditor key={layerOnly?group.layerId:group.id} formId={formId} group={group} layerOnly={layerOnly} editable={editable} onSave={onSaveLayerOrPass} passPreview={passPreview}/>;
 if(!point||!group)return <p className="wa-point-details wa-muted">在结构树中选择点位或层道。</p>;
 return <PointEditor key={point.id} formId={formId} point={point} actualPose={actualPose??point.pose} basePosition={basePosition} group={group} editable={editable} onSave={onSavePoint}
  onOffsetPreview={onOffsetPreview} onOffsetPreviewEnd={onOffsetPreviewEnd}/>;
}
