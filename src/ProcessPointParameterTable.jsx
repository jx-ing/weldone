import React from 'react';
import {PROCESS_POINT_GROUPS,sharedCornerPoint} from './processFeaturePoints.mjs';
import {editOptionalProcessValues} from './processParameterEditing.mjs';
import {processNumberAttributes} from './processNumberRules.mjs';

const show=value=>value==null||value===''?'--':value;
function Heading({label}){
 const match=label.match(/^(.*?)\s*(\(.*\))$/);
 return match?<>{match[1]}<small>{match[2]}</small></>:label;
}

export default function ProcessPointParameterTable({rows,kind,editing,onChange,onDistanceChange,modern=false}){
 const {label}=PROCESS_POINT_GROUPS[kind];
 const corner=kind==='inner'?'内角':'外角';
 const headings=['焊道','层数','拐角前距离 (mm)','拐角后距离 (mm)','电流 (A)','电压/修正值 (V)','动作时间 (s)','机器人工艺号'];
 return <div className="process-parameter-scroll">
  <table className="process-parameter-table process-point-parameter-table" aria-label={label}>
   <thead><tr>{headings.map(heading=><th key={heading} scope="col"><Heading label={heading}/></th>)}</tr></thead>
   <tbody>{rows.map(({pass,layerIndex},index)=>{
    const name=`P${index+1} ${corner}`;
    const point=sharedCornerPoint(pass,kind);
    const field=(key,caption,active=true)=>editing?
     <input aria-label={name+caption} type="number" {...processNumberAttributes(key)} required={point.enabled&&active}
      disabled={!active} placeholder="--" value={!point.enabled&&['correction','time'].includes(key)&&point[key]===0?'':point[key]??''}
      onChange={event=>onChange(pass,kind,editOptionalProcessValues(point,{[key]:event.target.value===''?null:Number(event.target.value)},pass.machineMode))}/>:
     show(active?point[key]:null);
    return <tr key={pass.id} aria-label={name}>
     <td>P{index+1}</td><td>{layerIndex+1}</td>
     {[['before','拐角前距离'],['after','拐角后距离']].map(([key,caption])=><td key={key}>{editing?
      <input type="number" {...processNumberAttributes('distance')} aria-label={name+caption}
       placeholder={modern?'30':'--'} value={pass.cornerDistances?.[kind]?.[key]??''}
       onChange={event=>onDistanceChange(pass,kind,key,event.target.value===''?null:Number(event.target.value))}/>:
      show(pass.cornerDistances?.[kind]?.[key]??(modern?30:null))}</td>)}
     <td>{field('current','电流',pass.machineMode!=='job')}</td>
     <td>{field(pass.machineMode==='synergic'?'correction':'voltage','电压',pass.machineMode!=='job')}</td>
     <td>{field('time','动作时间')}</td>
     <td>{field('job','机器人工艺号',pass.machineMode==='job')}</td>
    </tr>;
   })}</tbody>
  </table>
 </div>;
}

