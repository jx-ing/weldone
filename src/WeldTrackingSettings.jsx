import React from 'react';
import {Info} from 'lucide-react';

export default function WeldTrackingSettings({value,onChange,capabilities={},showHeading=true}){
 const change=(key,next)=>onChange({...value,[key]:next});
 const laser=capabilities.laserTracking!==false,arc=capabilities.arcTracking!==false;
 return <section aria-label="焊缝跟踪设置" className="planning-tracking-settings">{showHeading&&<h3>焊缝跟踪设置</h3>}
  {laser&&<><div className="tracking-toggle-row"><label><span>激光跟踪</span><input type="checkbox" role="switch" aria-label="激光跟踪" checked={value.laserEnabled} onChange={event=>change('laserEnabled',event.target.checked)}/></label></div>
  <fieldset className="tracking-laser-parameters" aria-label="激光跟踪参数" disabled={!value.laserEnabled}>
   {[['minLineLength','最小直线长度'],['minArcDiameter','最小圆弧直径'],['minEdgeWidth','最小边缘宽度']].map(([key,label])=><label key={key}><span>{label}</span><span className="planning-value"><input type="number" aria-label={label} min={0} step="any" value={typeof value[key]==='number'?value[key].toFixed(2):value[key]??''} onChange={event=>change(key,event.target.value)}/><small>mm</small></span></label>)}
  </fieldset></>}
  {arc&&<div className="tracking-toggle-row"><label><span>电弧跟踪</span><input type="checkbox" role="switch" aria-label="电弧跟踪" checked={value.arcEnabled} onChange={event=>change('arcEnabled',event.target.checked)}/></label>{laser&&<span className="tracking-priority-note"><Info size={14}/>同时开启优先激光跟踪</span>}</div>}
 </section>;
}
