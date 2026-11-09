import React,{useEffect,useRef,useState} from 'react';
import {FileInput,FileOutput} from 'lucide-react';
import {createPortal} from 'react-dom';
import {Modal} from './TemplateLibrary';
import {exportDeviceLibrary,importDeviceLibraries} from './processLibraryTransfer.mjs';

export default function ProcessLibraryActions({entries,deviceProfiles=[],onImport,notify}){
 const file=useRef();
 const [target,setTarget]=useState(null),[selected,setSelected]=useState(null);
 useEffect(()=>{setTarget(document.querySelector('.process-library-view .bar-actions'));},[]);
 function download(){
  for(const profile of deviceProfiles.filter(value=>selected.includes(value.id))){
   const data=exportDeviceLibrary(entries,profile);
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
   const anchor=document.createElement('a');
   anchor.href=url;
   anchor.download=profile.name.replace(/[<>:"/\\|?*]/g,'_')+'-工艺参数库.json';
   anchor.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  setSelected(null);
 }
 async function read(event){
  const input=event.target,files=Array.from(input.files??[]);
  input.value='';
  if(!files.length)return;
  try{
   const documents=await Promise.all(files.map(async file=>JSON.parse(await file.text())));
   const error=onImport(importDeviceLibraries(entries,deviceProfiles,documents));
   if(error)throw Error(error);
   notify('设备信息与工艺参数库已导入');
  }catch(error){notify(error.message);}
 }
 const toggle=id=>setSelected(ids=>ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]);
 return <>{target&&createPortal(<div className="process-transfer-tools">
  <button className="icon" type="button" aria-label="导入工艺参数库" title="导入工艺参数库" onClick={()=>file.current.click()}><FileInput size={18}/></button>
  <button className="icon" type="button" aria-label="导出工艺参数库" title="导出工艺参数库" disabled={!deviceProfiles.length} onClick={()=>setSelected([])}><FileOutput size={18}/></button>
  <input hidden multiple ref={file} type="file" accept=".json,application/json" onChange={read}/>
 </div>,target)}{selected&&<Modal title="导出工艺参数库" onClose={()=>setSelected(null)}>
  <div className="tpl-confirm-body">
   <label><input type="checkbox" checked={selected.length===deviceProfiles.length} onChange={event=>setSelected(event.target.checked?deviceProfiles.map(value=>value.id):[])}/>全选</label>
   {deviceProfiles.map(profile=><div key={profile.id}><label><input type="checkbox" checked={selected.includes(profile.id)} onChange={()=>toggle(profile.id)}/>{profile.name}</label></div>)}
  </div>
  <footer><button className="btn" onClick={()=>setSelected(null)}>取消</button><button className="btn primary" disabled={!selected.length} onClick={download}>导出</button></footer>
 </Modal>}</>;
}
