import React,{useState} from 'react';
import {DEVICE_TRACKING_MODES,PRECISION_CAMERA_TYPES,newDeviceHardware} from './processDeviceModel.mjs';
import {WIRE_TYPES} from './processParameterModel.mjs';

export default function PlanningDeviceForm({initial,capabilities,onSave,onCancel}){
 const [value,setValue]=useState(()=>{
  const defaults=newDeviceHardware();
  defaults.trackingModes=DEVICE_TRACKING_MODES.filter(([key])=>capabilities[key+'Tracking']!==false).map(([key])=>key);
  for(const [key] of PRECISION_CAMERA_TYPES)defaults.precisionCameras[key].enabled=capabilities[key+'Precision']!==false;
  return {...defaults,...initial,precisionCameras:{...defaults.precisionCameras,...initial?.precisionCameras}};
 });
 const [error,setError]=useState('');
 const patch=values=>setValue(previous=>({...previous,...values}));
 const changeCamera=(key,update)=>setValue(previous=>({...previous,precisionCameras:{
  ...previous.precisionCameras,[key]:{...previous.precisionCameras[key],...update}
 }}));
 const model=(key,label)=><label className="form-label" key={key}>{label}
  <input type="text" maxLength={80} value={value[key]??''} onChange={event=>patch({[key]:event.target.value})}/>
 </label>;
 function submit(event){
  event.preventDefault();
  const next={...value};
  for(const key of ['coarseCameraModel','robotModel','welderModel'])next[key]=(next[key]??'').trim();
  next.precisionCameras=Object.fromEntries(PRECISION_CAMERA_TYPES.map(([key])=>{
   const camera=value.precisionCameras[key];
   return [key,{...camera,model:camera.model.trim()}];
  }));
  setError(onSave(next));
 }
 return <form onSubmit={submit}>
  <div className="dialog-body planning-device-form">
   <fieldset className="process-device-hardware">
    <legend>精定位相机型号</legend>
    {PRECISION_CAMERA_TYPES.map(([key,label])=>{
     const camera=value.precisionCameras[key];
     return <div className="process-device-camera" key={key}>
      <label><input type="checkbox" checked={camera.enabled} onChange={event=>changeCamera(key,{enabled:event.target.checked})}/>{label}相机</label>
      <input type="text" aria-label={label+'精定位相机型号'} maxLength={80} disabled={!camera.enabled} placeholder="填写型号" value={camera.model} onChange={event=>changeCamera(key,{model:event.target.value})}/>
     </div>;
    })}
   </fieldset>
   {model('coarseCameraModel','粗定位相机型号')}
   {model('robotModel','机械臂型号')}
   {model('welderModel','焊机型号')}
   <label className="form-label">耗材类型<select value={value.wireType??''} onChange={event=>patch({wireType:event.target.value})}>
    <option value="">请选择</option>{[...new Set([...WIRE_TYPES,...(value.wireType?[value.wireType]:[])])].map(type=><option key={type}>{type}</option>)}
   </select></label>
   <fieldset className="process-device-hardware">
    <legend>设备支持的跟踪方式</legend>
    <div className="process-device-tracking">{DEVICE_TRACKING_MODES.map(([key,label])=><label key={key}>
     <input type="checkbox" checked={value.trackingModes.includes(key)} onChange={event=>patch({
      trackingModes:event.target.checked?[...value.trackingModes,key]:value.trackingModes.filter(mode=>mode!==key)
     })}/>{label}
    </label>)}</div>
   </fieldset>
   {error&&<p role="alert" className="tpl-errors">{error}</p>}
  </div>
  <footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary">保存</button></footer>
 </form>;
}
