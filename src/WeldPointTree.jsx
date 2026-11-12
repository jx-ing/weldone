import React from 'react';
import {Layers,MapPin} from 'lucide-react';

export default function WeldPointTree({weldId,groups,selection,onSelect}){
 const layers=new Map();
 for(const group of groups){
  if(!group.layerId)continue;
  if(!layers.has(group.layerId))layers.set(group.layerId,[]);
  layers.get(group.layerId).push(group);
 }
 const node=(type,id,label,Icon)=>(
  <button type="button" className={'weld-point-node '+type} aria-pressed={selection?.type===type&&selection.id===id} title={label} onClick={()=>onSelect(type,id)}>
   <Icon size={13}/><span>{label}</span>
  </button>
 );
 const points=group=>group.points.map(point=><div key={point.id}>{node('point',point.id,point.name,MapPin)}</div>);
 return <div className="weld-point-tree" role="group" aria-label={weldId+' 层道与点位'}>
  {groups.filter(group=>!group.layerId).map(group=><div key={group.id}>{points(group)}</div>)}
  {[...layers.entries()].map(([id,passes])=>{
   const {layerName,templateName}=passes[0];
   return <div className="weld-point-layer" key={id}>
    {node('layer',id,[templateName,layerName].filter(Boolean).join(' · '),Layers)}
    {passes.map(group=><div className="weld-point-pass" key={group.id}>
     {node('pass',group.id,group.passName,Layers)}
     <div className="weld-pass-points">{points(group)}</div>
    </div>)}
   </div>;
  })}
 </div>;
}
