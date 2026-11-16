import React,{useEffect,useRef} from 'react';
import {ChevronDown,Settings} from 'lucide-react';

export const DEFAULT_PLANNING_VIEW={
 grid:true,model:true,welds:true,passes:true,head:true,labels:true,order:true,transparent:false
};

const ANNOTATIONS=[['labels','焊缝名称'],['order','顺序编号']];
const GEOMETRY=[['model','模型'],['welds','焊缝'],['passes','层道'],['head','机头'],['grid','网格']];

export default function PlanningViewDisplay({view,onChange,geometry=false}){
 const details=useRef(null);
 useEffect(()=>{
  const menu=details.current;
  function dismiss(event){
   if(!menu.open)return;
   if(event.type==='pointerdown'&&!menu.contains(event.target))menu.open=false;
   if(event.type==='keydown'&&event.key==='Escape'){
    menu.open=false;
    menu.firstElementChild.focus();
   }
  }
  document.addEventListener('pointerdown',dismiss);
  menu.addEventListener('keydown',dismiss);
  return ()=>{
   document.removeEventListener('pointerdown',dismiss);
   menu.removeEventListener('keydown',dismiss);
  };
 },[]);
 return <details ref={details} name="planning-view-display" className={geometry?'planning-model-display':'display-wrap planning-label-display'}>
  {geometry?<summary aria-label="模型显示选项" title="模型显示选项"><Settings size={19}/></summary>:
   <summary className="btn">视图显示 <ChevronDown size={15}/></summary>}
  <div className="display-pop">
   {(geometry?GEOMETRY:ANNOTATIONS).map(([key,label])=><label key={key}>
    <input type="checkbox" checked={view[key]} onChange={event=>{
     const checked=event.target.checked;
     onChange(previous=>({...previous,[key]:checked}));
    }}/>{label}
   </label>)}
  </div>
 </details>;
}
