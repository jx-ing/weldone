import React from 'react';
import {PROCESS_POINT_GROUPS,sharedCornerPoint} from './processFeaturePoints.mjs';
import {editOptionalProcessValues} from './processParameterEditing.mjs';
import {processNumberAttributes} from './processNumberRules.mjs';

const distanceFields=[['before','转角前距离'],['after','转角后距离']];
const show=value=>value==null||value===''?'--':value;
function Heading({label,diagram,description}){
 const match=label.match(/^(.*?)\s*(\(.*\))$/);
 return match?<>{match[1]}<small>{match[2]}</small>{diagram&&<img className="process-corner-diagram" src={diagram} alt={description}/>}</>:label;
}

export default function ProcessPointParameterTable({rows,kind,position,editing,onChange,onDistanceChange,onSpeedChange,onOffsetChange,modern=false}){
 const {label}=PROCESS_POINT_GROUPS[kind];
 const corner=kind==='inner'?'内角':'外角';
 const flat=position==='PB';
 const verticalOuter=['PF','PG'].includes(position)&&kind==='outer';
 const offsetDiagram=flat
  ? ['/assets/process-library/flat-'+kind+'-corner-offset.png','平角焊'+corner+'转角点偏移示意图']
  : verticalOuter
   ? ['/assets/process-library/vertical-outer-corner-offset.png','立焊外角转角点偏移示意图']
   : ['/assets/corner-point-offset.png','转角点偏移示意图'];
 const headings=[
  ['焊道'],['层数'],
  ...distanceFields.map(([key,caption])=>[
   caption+' (mm)',
   verticalOuter?'/assets/process-library/vertical-corner-distance-'+key+'.png':
    flat?'/assets/process-library/corner-distance-'+key+'.png':undefined,
   (verticalOuter?'立焊':'')+caption+'示意图'
  ]),
  ['转角速度 (cm/min)'],['转角点偏移 (mm)',...offsetDiagram],
  ['电流 (A)'],['电压/修正值 (V)'],['动作时间 (s)'],['机器人工艺号']
 ];
 return <div className="process-parameter-scroll">
  <table className="process-parameter-table process-point-parameter-table" aria-label={label}>
   <thead><tr>{headings.map(([heading,diagram,description])=><th key={heading} scope="col"><Heading label={heading} diagram={diagram} description={description}/></th>)}</tr></thead>
   <tbody>{rows.map(({pass,layerIndex},index)=>{
    const name=`P${index+1} ${corner}`;
    const point=sharedCornerPoint(pass,kind);
    const field=(key,caption,active=true)=>editing?
     <input aria-label={name+caption} type="number" {...processNumberAttributes(key)} required={point.enabled&&active}
      disabled={!active} placeholder="--" value={!point.enabled&&['correction','time'].includes(key)&&point[key]===0?'':point[key]??''}
      onChange={event=>onChange(pass,kind,editOptionalProcessValues(point,{[key]:event.target.value===''?null:Number(event.target.value)},pass.machineMode))}/>:
     show(active?point[key]:null);
    const speed=pass.cornerSpeeds?.[kind];
    const offset=pass.cornerOffsets?.[kind];
    return <tr key={pass.id} aria-label={name}>
     <td>P{index+1}</td><td>{layerIndex+1}</td>
     {distanceFields.map(([key,caption])=><td key={key}>{editing?
      <input type="number" {...processNumberAttributes('distance')} aria-label={name+caption}
       placeholder={modern?'30':'--'} value={pass.cornerDistances?.[kind]?.[key]??''}
       onChange={event=>onDistanceChange(pass,kind,key,event.target.value===''?null:Number(event.target.value))}/>:
      show(pass.cornerDistances?.[kind]?.[key]??(modern?30:null))}</td>)}
     <td>{editing?<input type="number" min={modern?1:0} step={modern?1:'any'} aria-label={name+'转角速度'} placeholder={pass.weld.speed==null?'沿用焊接速度':String(pass.weld.speed/10)} value={speed==null?'':speed/10} onChange={event=>onSpeedChange(pass,kind,event.target.value===''?null:Number(event.target.value)*10)}/>:show((speed??pass.weld.speed)==null?null:(speed??pass.weld.speed)/10)}</td>
     <td>{editing?<input type="number" min={modern?-50:undefined} max={modern?50:undefined} step={modern ? .1 : 'any'} aria-label={name+'转角点偏移'} placeholder="0" value={offset??''} onChange={event=>onOffsetChange(pass,kind,event.target.value===''?null:Number(event.target.value))}/>:show(offset??0)}</td>
     <td>{field('current','电流',pass.machineMode!=='job')}</td>
     <td>{field(pass.machineMode==='synergic'?'correction':'voltage','电压',pass.machineMode!=='job')}</td>
     <td>{field('time','动作时间')}</td>
     <td>{field('job','机器人工艺号',pass.machineMode==='job')}</td>
    </tr>;
   })}</tbody>
  </table>
 </div>;
}

