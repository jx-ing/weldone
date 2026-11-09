import React from 'react';
import {GROOVE_TYPES,grooveType,grooveValue,grooveFieldsFor} from './grooveModel.mjs';
export default function GrooveFields({value,onChange,disabled=false,prefix=''}){
 const set=values=>onChange({rootGap:0,rootRadius:0,...value,...values}),type=grooveType(value.type),inactive=disabled||type==='无坡口';
 return <><label className="tpl-field"><span>坡口类型</span><select aria-label={prefix+'坡口类型'} disabled={disabled} value={type} onChange={e=>set({type:e.target.value,...(e.target.value==='无坡口'?{angle:0,depth:0,rootGap:0,rootRadius:0}:{})})}>{!GROOVE_TYPES.includes(type)&&<option value={type} disabled>{type}</option>}{GROOVE_TYPES.map(v=><option key={v} value={v}>{v==='V 形'?'V形':v}</option>)}</select></label>{grooveFieldsFor(type).map(([key,label,unit,max])=><label className="tpl-field" key={key}><span>{label}</span><span className="tpl-number"><input aria-label={prefix+label} type="number" min={0} max={max} step="any" disabled={inactive} value={grooveValue(value,key)??''} onChange={e=>set({[key]:e.target.value===''?'':+e.target.value})}/><small>{unit}</small></span></label>)}</>;
}
