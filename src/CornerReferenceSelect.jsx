import React from 'react';
import {REFERENCE_PLANES,validReferenceNormal} from './weldDirectionGeometry.mjs';
export default function CornerReferenceSelect({normal,onChange,model=false,label='转角参考面'}){
  const option=REFERENCE_PLANES.find(p=>validReferenceNormal(normal)&&p[2].every((v,i)=>Math.abs(v-normal[i])<1e-6)),value=option?.[0]||(validReferenceNormal(normal)?'custom':'model');
  return <><label>{label}<select aria-label={label} value={value} onChange={e=>{const p=REFERENCE_PLANES.find(p=>p[0]===e.target.value);onChange(p?p[2]:null);}}><option value="model">{model?'模型参考面（逐段）':'待确认参考面'}</option>{value==='custom'&&<option value="custom">模型参考面</option>}{REFERENCE_PLANES.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><p className="manual-pick-help">从参考面正面看，沿焊接方向：左转为内角，右转为外角。</p></>;
}
