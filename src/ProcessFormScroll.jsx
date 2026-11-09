import React,{useEffect,useRef,useState} from 'react';

export default function ProcessFormScroll({children,kind='form',thumb=155}) {
 const scroll=useRef(),drag=useRef(),[position,setPosition]=useState({ratio:0,overflow:false});
 const update=()=>{const el=scroll.current,max=el.scrollHeight-el.clientHeight;setPosition({ratio:max>0?el.scrollTop/max:0,overflow:max>1});};
 useEffect(()=>{const observer=new ResizeObserver(update);observer.observe(scroll.current);observer.observe(scroll.current.firstElementChild);update();return()=>observer.disconnect();},[]);
 return <div className={`process-${kind}-viewport`}><div className={`process-${kind}-scroll`} ref={scroll} tabIndex={0} aria-label={kind==='detail'?'工艺参数滚动区域':'工艺表单滚动区域'} onScroll={update}>{children}</div>{position.overflow&&<div className={`process-${kind}-scroll-track`}><div className={`process-${kind}-scroll-thumb`} style={{height:`calc(${thumb} * var(--ps))`,top:`calc(${position.ratio} * (100% - ${thumb} * var(--ps)))`}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={y:e.clientY,top:scroll.current.scrollTop};}} onPointerMove={e=>{if(!drag.current)return;const el=scroll.current,track=e.currentTarget.parentElement,travel=track.clientHeight-e.currentTarget.clientHeight;if(travel>0)el.scrollTop=drag.current.top+(e.clientY-drag.current.y)*(el.scrollHeight-el.clientHeight)/travel;}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/></div>}</div>;
}
