import React,{useState} from 'react';
import {weldForm} from './planningRequirements.mjs';
import {templateProjectGroups,templateProjectName} from './templateProjects.mjs';
import {templateForMatching} from './templateMatchingParameters.mjs';
import {PROCESS_CATEGORIES,processCategory,processInCategory,processPositionLabel,processWeldType} from './processLibraryView.mjs';
import {validTemplateCover} from './templateCoverModel.mjs';
import './planningLibraryPicker.css';

export default function PlanningLibraryPicker({kind,weld,templates,processLibrary,project,projectNames,onConfirm,onCancel}){
 const templateMode=kind==='template',entries=templateMode?templates.filter(value=>value.type==='whole'):processLibrary;
 const groups=templateMode?templateProjectGroups(templates,project,projectNames).map(value=>({id:value.name,name:value.name})):PROCESS_CATEGORIES.concat(entries.some(value=>processCategory(value)==='other')?[{id:'other',name:'其他焊缝'}]:[]);
 const initial=templateMode?project:processCategory(entries.find(value=>value.id===weld.processId)||{weldForms:[weldForm(weld)]});
 const [group,setGroup]=useState(groups.some(value=>value.id===initial)?initial:groups[0]?.id||''),[search,setSearch]=useState(''),[position,setPosition]=useState(''),[leg,setLeg]=useState(''),[page,setPage]=useState(1),[selectedId,setSelectedId]=useState(templateMode?weld.templateId||'':weld.processId||''),[error,setError]=useState('');
 const data=entries.map(entry=>({entry,conditions:templateMode?templateForMatching(entry):entry}));
 const current=data.filter(({entry})=>templateMode?templateProjectName(entry,project)===group:processInCategory(entry,group));
 const positions=[...new Set(current.flatMap(({conditions})=>templateMode?conditions.segments.map(segment=>segment.position):[conditions.position]).filter(Boolean))],legs=[...new Set(current.map(({conditions})=>conditions.leg).filter(Number.isFinite))].sort((a,b)=>a-b);
 const filtered=current.filter(({entry,conditions})=>entry.name.toLowerCase().includes(search.trim().toLowerCase())&&(!position||(templateMode?conditions.segments.every(segment=>segment.position===position):conditions.position===position))&&(!leg||String(conditions.leg)===leg));
 const totalPages=Math.max(1,Math.ceil(filtered.length/8)),currentPage=Math.min(page,totalPages),visible=filtered.slice((currentPage-1)*8,currentPage*8),selected=entries.find(value=>value.id===selectedId);
 function select(id){setSelectedId(id);setError('');}
 function changeGroup(id){setGroup(id);setSearch('');setPosition('');setLeg('');setPage(1);setSelectedId('');setError('');}
 function confirm(){if(!selected)return;try{onConfirm(selected);}catch(failure){setError(failure.reasons?.length?failure.reasons:failure.message||'选择失败，请重新选择。');}}
 return <section className="planning-library-picker" aria-label={templateMode?'选择焊接模板':'选择工艺参数'}>
  <div className="library-picker-context">当前焊缝：<strong>{weld.id}</strong><span>{weld.name}</span></div>
  <div className={'library-picker-layout'+(templateMode?' template-picker-layout':'')}>{!templateMode&&<aside aria-label="工艺焊缝分类"><strong>焊缝分类</strong>{groups.map(value=><button type="button" key={value.id} aria-pressed={group===value.id} onClick={()=>changeGroup(value.id)}>{value.name}</button>)}</aside>}
   <div className="library-picker-main"><div className="library-picker-filters">{templateMode&&<label>项目<select aria-label="模板项目" value={group} onChange={event=>changeGroup(event.target.value)}>{groups.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
    <label>{templateMode?'模板名称':'工艺参数名称'}<input aria-label={templateMode?'搜索焊接模板':'搜索工艺参数'} placeholder="请输入名称" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label>
    <label>焊接位置<select aria-label="选择库焊接位置筛选" value={position} onChange={event=>{setPosition(event.target.value);setPage(1);}}><option value="">全部</option>{positions.map(value=><option key={value} value={value}>{processPositionLabel(value)}</option>)}</select></label>
    <label>焊脚高度<select aria-label="选择库焊脚高度筛选" value={leg} onChange={event=>{setLeg(event.target.value);setPage(1);}}><option value="">全部</option>{legs.map(value=><option key={value} value={String(value)}>{value} mm</option>)}</select></label>
    <button type="button" className="btn" onClick={()=>{setSearch('');setPosition('');setLeg('');setPage(1);}}>重置</button>
   </div><div className="library-picker-results">
    {templateMode?<div className="library-picker-cards">{visible.map(({entry,conditions})=><label key={entry.id} className={'library-template-option'+(selectedId===entry.id?' selected':'')+(entry.enabled===false?' unavailable':'')}>
     {validTemplateCover(entry.cover,entry.sourceWeld)?<img src={entry.cover.dataUrl} alt={entry.name+' 焊缝域模型封面'}/>:null}
     <h3>{entry.name}</h3><p>{conditions.leg} mm · {conditions.segments.length} 段 · {conditions.closure==='closed'?'闭合':'开放'}</p><span><input type="radio" name="planning-template-choice" aria-label={'选择焊接模板 '+entry.name} checked={selectedId===entry.id} disabled={entry.enabled===false} onChange={()=>select(entry.id)}/>{entry.enabled===false?'已停用':'选择'}</span>
    </label>)}</div>:<table aria-label="可选工艺参数"><thead><tr><th>选择</th><th>工艺参数名称</th><th>焊接位置</th><th>焊脚高度</th><th>坡口类型</th><th>焊道类型</th></tr></thead><tbody>{visible.map(({entry})=><tr key={entry.id} className={selectedId===entry.id?'selected':''}><td><input type="radio" name="planning-process-choice" aria-label={'选择工艺参数 '+entry.name} checked={selectedId===entry.id} onChange={()=>select(entry.id)}/></td><td>{entry.name}</td><td>{processPositionLabel(entry.position)}</td><td>{entry.leg??'待补充'} mm</td><td>{entry.groove?.type||'待补充'}</td><td>{processWeldType(entry)==='single'?'单道焊':'多层多道'}</td></tr>)}</tbody></table>}
    {!filtered.length&&<div className="library-picker-empty">{current.length?'未找到符合条件的'+(templateMode?'焊接模板':'工艺参数'):'当前'+(templateMode?'项目暂无焊接模板':'分类暂无工艺参数')}</div>}
   </div><nav className="library-picker-pagination" aria-label="选择库分页"><span>共 {filtered.length} 条</span><button type="button" className="btn" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage} / {totalPages}</span><button type="button" className="btn" disabled={currentPage===totalPages} onClick={()=>setPage(currentPage+1)}>下一页</button></nav></div>
  </div>
  {error&&<div className="library-picker-error" role="alert">{Array.isArray(error)?<>
   <strong>焊接模板匹配失败</strong><ul>{error.map((reason,index)=><li key={index}>{reason}</li>)}</ul>
  </>:error}</div>}
  <footer><span>{selected?'已选择：'+selected.name:'请选择'+(templateMode?'焊接模板':'工艺参数')}</span><button type="button" className="btn" onClick={onCancel}>取消</button><button type="button" className="btn primary" disabled={!selected||templateMode&&selected.enabled===false} onClick={confirm}>{templateMode?'应用模板':'应用工艺参数'}</button></footer>
 </section>;
}
