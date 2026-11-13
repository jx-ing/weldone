import React,{useId} from 'react';
import {Info} from 'lucide-react';

export default function WeldTrackingSettings({value,onChange,capabilities={},showHeading=true,fieldProps}){
 const id=useId();
 const validation=key=>{
  const {fieldId,error}=fieldProps(key);
  return {error,attrs:{'data-setting-field':fieldId,'aria-invalid':error?true:undefined,'aria-describedby':error?id+'-'+key:undefined}};
 };
 const change=(key,next)=>onChange({...value,[key]:next});
 const laser=capabilities.laserTracking!==false,arc=capabilities.arcTracking!==false;
 return <section aria-label="焊缝跟踪设置" className="planning-tracking-settings">{showHeading&&<h3>焊缝跟踪设置</h3>}
  {laser&&<><div className="tracking-toggle-row"><label><span>激光跟踪</span><input type="checkbox" role="switch" aria-label="激光跟踪" {...validation('laserEnabled').attrs} checked={value.laserEnabled} onChange={event=>change('laserEnabled',event.target.checked)}/></label>{validation('laserEnabled').error&&<span id={id+'-laserEnabled'} className="planning-field-error">{validation('laserEnabled').error}</span>}</div>
  <fieldset className="tracking-laser-parameters" aria-label="激光跟踪参数" disabled={!value.laserEnabled}>
   {[['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径'],['minEdgeWidth','最小边缘宽度']].map(([key,label])=>{
    const {error,attrs}=validation(key);
    return <div key={key} className="planning-tracking-field">
     <label><span>{label}</span><span className="planning-value"><input type="number" aria-label={label} {...attrs} min={0} step="any" value={typeof value[key]==='number'?value[key].toFixed(2):value[key]??''} onChange={event=>change(key,event.target.value)}/><small>mm</small></span></label>
     {error&&<span id={id+'-'+key} className="planning-field-error">{error}</span>}
    </div>;
   })}
  </fieldset></>}
  {arc&&<div className="tracking-toggle-row"><label><span>电弧跟踪</span><input type="checkbox" role="switch" aria-label="电弧跟踪" {...validation('arcEnabled').attrs} checked={value.arcEnabled} onChange={event=>change('arcEnabled',event.target.checked)}/></label>{validation('arcEnabled').error&&<span id={id+'-arcEnabled'} className="planning-field-error">{validation('arcEnabled').error}</span>}{laser&&<span className="tracking-priority-note"><Info size={14}/>同时开启优先激光跟踪</span>}</div>}
 </section>;
}
