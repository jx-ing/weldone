import {processFeaturePoints,newProcessPointWeave} from './processFeaturePoints.mjs';
const field=kind=>kind==='wrap'?'wrapWeave':'cornerWeave';
export function groupWeaveState(pass,kind){
 const explicit=pass[field(kind)];if(explicit)return {value:explicit,mixed:false};
 const points=kind==='wrap'?processFeaturePoints(pass,'wrap'):[...processFeaturePoints(pass,'inner'),...processFeaturePoints(pass,'outer')];
 const values=points.map(p=>p.weave||newProcessPointWeave());
 if(!values.length)return {value:newProcessPointWeave(),mixed:false};
 const signature=v=>!v.enabled?'none':JSON.stringify(Object.fromEntries(['enabled','pattern','amplitude','frequency','dwellLeft','dwellRight','centerOffset'].map(k=>[k,v[k]??null])));
 const mixed=values.some(v=>signature(v)!==signature(values[0]));
 return {value:mixed?newProcessPointWeave():values[0],mixed};
}
export function groupWeaveChanges(pass,kind,value){
 const weave=structuredClone(value),points=type=>processFeaturePoints(pass,type).map(p=>({...p,weave:structuredClone(weave)}));
 return kind==='wrap'?{wrapWeave:weave,wrapParameters:points('wrap')}:{cornerWeave:weave,cornerParameters:{inner:points('inner'),outer:points('outer')},...(Array.isArray(pass.cornerParameters)?{legacyCornerParameters:structuredClone(pass.cornerParameters)}:{})};
}
