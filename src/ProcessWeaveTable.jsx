import React from 'react';
import ProcessWeaveMode from './ProcessWeaveMode';
import {processNumberAttributes} from './processNumberRules.mjs';
const fields=[['amplitude','振幅'],['frequency','频率'],['dwellLeft','左停留时间'],['dwellRight','右停留时间'],['centerOffset','中央隆起度']];
const show=v=>v===null||v===undefined||v===''?'--':v;
function Heading({label}){const match=label.match(/^(.*?)\s*(\(.*\))$/);return match?<>{match[1]}<small>{match[2]}</small></>:label;}
export default function ProcessWeaveTable({rows,editing,prefix,getValue,onChange,getMixed,disabled,label='摆弧参数'}){
 return <div className="process-parameter-scroll"><table className="process-parameter-table" aria-label={label}><colgroup>{[0,1].map(i=><col key={i} style={{width:'calc(100 * var(--ps))'}}/>)}{Array.from({length:6},(_,i)=><col key={i}/>)}</colgroup><thead><tr>{['焊道','层数','摆动方式','振幅 (mm)','频率 (Hz)','左停留时间 (s)','右停留时间 (s)','中央隆起度 (mm)'].map(label=><th key={label}><Heading label={label}/></th>)}</tr></thead><tbody>{rows.map(({pass,layerIndex},i)=>{const v=getValue(pass),set=value=>onChange(pass,value);return <tr key={pass.id}><td>P{i+1}</td><td>{layerIndex+1}</td><td><ProcessWeaveMode value={v} mixed={getMixed?.(pass)} editing={editing&&!disabled?.(pass)} label={`P${i+1} ${prefix}摆动方式`} onChange={set}/></td>{fields.map(([key,name])=><td key={key}>{editing?<input aria-label={`P${i+1} ${prefix}${name}`} type="number" {...processNumberAttributes('weave')} required={v.enabled} disabled={!v.enabled||disabled?.(pass)} placeholder="--" value={v[key]??''} onChange={e=>set({...v,[key]:e.target.value===''?null:+e.target.value})}/>:show(v[key])}</td>)}</tr>;})}</tbody></table></div>;
}
