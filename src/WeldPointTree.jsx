import React from 'react';
import {Layers,MapPin,Plus,Trash2} from 'lucide-react';

export default function WeldPointTree({weldId,groups,selection,onSelect,onAddPoint,onAddPass,onRemove,editable}){
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
 const remove=(label,target)=><button type="button" className="weld-point-action weld-remove-action"
  title={'删除'+label} aria-label={'删除'+label} onClick={()=>onRemove({weldId,label,...target})}><Trash2 size={12}/></button>;
 const points=group=>group.points.map(point=><div className="weld-point-row" key={point.id}>
  {node('point',point.id,point.name,MapPin)}
  {editable&&point.raw.kind==='control'&&remove(point.name,{type:'point',layerId:group.layerId,passId:group.id,pointId:point.raw.id})}
 </div>);
 return <div className="weld-point-tree" role="group" aria-label={weldId+' 层道与点位'}>
  {[...layers.entries()].map(([id,passes],index)=>{
   const {layerName,templateName}=passes[0];
   return <div className="weld-point-layer" key={id}>
    <div className="weld-point-row">
     {node('layer',id,[templateName,layerName].filter(Boolean).join(' · '),Layers)}
     {editable&&<>
      <button type="button" className="weld-point-action" title="添加点位" aria-label={layerName+' 添加点位'} onClick={()=>onAddPoint(id)}><MapPin size={14}/></button>
      {index>0&&<button type="button" className="weld-point-action" title="新建道" aria-label={layerName+' 新建道'} onClick={()=>onAddPass(id)}><Plus size={14}/></button>}
      {index>0&&remove(layerName,{type:'layer',layerId:id})}
     </>}
    </div>
    {passes.map(group=><div className="weld-point-pass" key={group.id}>
     <div className="weld-point-row">{node('pass',group.id,group.passName,Layers)}
      {editable&&index>0&&passes.length>1&&remove(layerName+' '+group.passName,{type:'pass',layerId:id,passId:group.id})}
     </div>
     <div className="weld-pass-points">{points(group)}</div>
    </div>)}
   </div>;
  })}
 </div>;
}
