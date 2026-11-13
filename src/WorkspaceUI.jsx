import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {CircleCheck, CircleAlert, Info, TriangleAlert} from 'lucide-react';

export function PageHeader({title,breadcrumb,actions,children}) {
 return <header className="page-bar workspace-page-header">
  <div className="page-heading">{breadcrumb&&<nav aria-label="面包屑" className="page-breadcrumb">{breadcrumb}</nav>}<h1>{title}</h1></div>
  {children}
  {actions&&<div className="bar-actions">{actions}</div>}
 </header>;
}

export function EmptyState({model=false,text,description,actions,className=''}) {
 return <div className={'empty workspace-empty '+className}>
  <img src={'/assets/'+(model?'empty-model':'empty-data')+'.svg'} alt=""/>
  {text&&<p>{text}</p>}
  {description&&<small>{description}</small>}
  {actions&&<div className="empty-actions">{actions}</div>}
 </div>;
}

export function Feedback({message,tone='info',action,onDismiss}) {
 const Icon={success:CircleCheck,warning:TriangleAlert,error:CircleAlert,info:Info}[tone];
 return <div className={'toast toast-'+tone} role={tone==='warning'||tone==='error'?'alert':'status'}>
  <Icon size={18}/><span>{message}</span>
  {action&&<button type="button" className="btn" onClick={action.onClick}>{action.label}</button>}
  {tone==='warning'&&<button type="button" className="icon" aria-label="关闭提示" title="关闭提示" onClick={onDismiss}>×</button>}
 </div>;
}

let scrollLocks=0;
let previousOverflow='';
export function useModalScrollLock() {
 useEffect(()=>{
  if(scrollLocks++===0){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
  return ()=>{if(--scrollLocks===0)document.body.style.overflow=previousOverflow;};
 },[]);
}

export function IconTooltips() {
 const [tooltip,setTooltip]=useState(null);
 useEffect(()=>{
  let timer,anchor;
  function clear(){
   clearTimeout(timer);
   anchor=null;
   setTooltip(null);
  }
  function show(event){
   const target=event.target.closest?.('button[aria-label],summary[aria-label],[data-tooltip]');
   if(!target||target.closest('.wa-match-card')||target===anchor)return;
   const label=target.dataset.tooltip||(!target.textContent.trim()&&(target.title||target.getAttribute('aria-label')));
   if(!label)return;
   clear();
   anchor=target;
   timer=setTimeout(()=>{
    if(!target.isConnected)return;
    const rect=target.getBoundingClientRect();
    setTooltip({label,x:Math.min(window.innerWidth-95,Math.max(95,rect.left+rect.width/2)),y:rect.bottom+7,above:rect.bottom+46>window.innerHeight,top:rect.top});
   },200);
  }
  function leave(event){
   if(anchor?.contains(event.target)&&!anchor.contains(event.relatedTarget))clear();
  }
  document.addEventListener('pointerover',show);
  document.addEventListener('focusin',show);
  document.addEventListener('pointerout',leave);
  document.addEventListener('focusout',leave);
  document.addEventListener('click',clear);
  document.addEventListener('scroll',clear,true);
  return ()=>{
   clearTimeout(timer);
   document.removeEventListener('pointerover',show);
   document.removeEventListener('focusin',show);
   document.removeEventListener('pointerout',leave);
   document.removeEventListener('focusout',leave);
   document.removeEventListener('click',clear);
   document.removeEventListener('scroll',clear,true);
  };
 },[]);
 return tooltip&&createPortal(<div className={'icon-tooltip'+(tooltip.above?' above':'')} aria-hidden="true" style={{left:tooltip.x,top:tooltip.above?tooltip.top-7:tooltip.y}}>{tooltip.label}</div>,document.body);
}

export const formatLength=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:1}).format;
