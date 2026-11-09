import React,{useEffect,useRef,useId} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft} from 'lucide-react';
export default function EditorPage({title,onBack,backLabel='返回列表',children}){
  const heading=useRef();
  useEffect(()=>{heading.current?.focus();},[]);
  return <section className="tpl-editor-page" aria-label={title}>
    <header><button type="button" className="btn" onClick={onBack}><ArrowLeft size={15}/>{backLabel}</button><h2 tabIndex={-1} ref={heading}>{title}</h2></header>
    {children}
  </section>;
}
export function EditorExitNotice({onContinue,onDiscard}){
  const dialog=useRef(),titleId=useId(),descriptionId=useId();
  useEffect(()=>{
    const previous=document.activeElement,current=dialog.current;
    current.showModal();
    current.querySelector('button')?.focus();
    return ()=>{current.close();if(previous?.isConnected)previous.focus();};
  },[]);
  return createPortal(<dialog ref={dialog} className="tpl-exit-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={e=>e.stopPropagation()} onCancel={e=>{e.preventDefault();onContinue();}}><h2 id={titleId}>未保存的修改</h2><p id={descriptionId}>当前修改尚未保存，是否放弃修改并返回？</p><footer><button type="button" className="btn" onClick={onContinue}>继续编辑</button><button type="button" className="btn primary" onClick={onDiscard}>放弃修改并返回</button></footer></dialog>,document.body);
}
