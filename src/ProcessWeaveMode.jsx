import React from 'react';
import {WEAVE_PATTERNS} from './processParameterModel.mjs';

export default function ProcessWeaveMode({value,editing,label,onChange,mixed=false}){
 const mode=mixed?'mixed':value.enabled?(value.pattern||'sine'):'none';
 return editing?<select aria-label={label} value={mode} onChange={event=>{const pattern=event.target.value;onChange({...value,enabled:pattern!=='none',pattern:pattern==='none'?(value.pattern||'sine'):pattern});}}>{mixed&&<option value="mixed" disabled>请选择统一方式</option>}<option value="none">不摆动</option>{Object.entries(WEAVE_PATTERNS).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select>:mode==='mixed'?'未统一':mode==='none'?'不摆动':WEAVE_PATTERNS[mode]||'—';
}
