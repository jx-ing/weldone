import {useEffect,useState} from 'react';
import {Folder,Plus,Search,Trash2} from 'lucide-react';
import {TextInput} from './FormInput.jsx';
import {EmptyState,PageHeader} from './WorkspaceUI';
import './workpieceLibrary.css';

export default function WorkpieceLibrary({projects,project,records,loading,error,onSave,onApply,onEdit,onRemove,onNewProject,canSave}){
 const [selection,setSelection]=useState(project),[query,setQuery]=useState('');
 useEffect(()=>setSelection(project),[project]);
 const activeProject=projects.includes(selection)?selection:projects[0];
 const projectRows=records.filter(record=>record.project===activeProject);
 const text=query.trim().toLowerCase();
 const visible=projectRows.filter(record=>record.name.toLowerCase().includes(text)||record.model.toLowerCase().includes(text));
 return <section className="workpiece-library" aria-label="工件库">
  <PageHeader title="工件库" actions={<button type="button" className="btn primary" disabled={!canSave}
   title={!canSave?'请先载入 STEP 并完成焊缝规划':undefined} onClick={()=>onSave(activeProject)}>保存当前工件</button>}/>
  <div className="workpiece-workspace">
   <aside className="process-sidebar tpl-project-sidebar" aria-label="工件项目列表">
    <div className="process-sidebar-heading"><span>项目</span><button type="button" className="icon" aria-label="新建项目" title="新建项目"
     onClick={onNewProject}><Plus size={15}/></button></div>
    {projects.map(name=><div className={'tpl-project-row'+(name===activeProject?' active':'')} key={name}>
     <button type="button" className="tpl-project-select" aria-pressed={name===activeProject}
      onClick={()=>{setSelection(name);setQuery('');}}><Folder size={16}/><span>{name}</span>
      <small>{records.filter(record=>record.project===name).length}</small></button>
    </div>)}
   </aside>
   <div className="workpiece-catalog">
    <div className="workpiece-catalog-heading"><h2>{activeProject??'项目'}</h2>
     <label className="workpiece-search"><Search size={15}/><TextInput aria-label="搜索工件模板" placeholder="请输入"
      value={query} onChange={event=>setQuery(event.target.value)}/></label>
    </div>
    {error?<p role="alert" className="workpiece-error">{error}</p>:loading?<p role="status" className="wa-muted">正在读取工件库…</p>:
     !visible.length?<EmptyState text={query?'未找到工件模板':'当前项目暂无工件模板'}/>:
     <div className="workpiece-table-scroll"><table>
      <thead><tr><th scope="col">工件模板</th><th scope="col">模型</th><th scope="col">焊缝数量</th><th scope="col">保存时间</th><th scope="col">操作</th></tr></thead>
      <tbody>{visible.map(record=><tr key={record.id}><th scope="row"><div className="workpiece-title">
       {record.cover&&<img src={record.cover} alt="" loading="lazy"/>}<span>{record.name}</span></div></th><td>{record.model}</td>
       <td>{record.weldCount} 条</td><td>{new Date(record.updatedAt).toLocaleString('zh-CN',{hour12:false})}</td>
       <td><div className="workpiece-row-actions"><button type="button" className="btn" onClick={()=>onApply(record)}>复用</button>
        <button type="button" className="btn" onClick={()=>onEdit(record)}>编辑</button>
        <button type="button" className="icon danger-text" aria-label={'删除 '+record.name}
         title="删除工件模板" onClick={()=>onRemove(record)}><Trash2 size={15}/></button></div></td>
      </tr>)}</tbody>
     </table></div>}
   </div>
  </div>
 </section>;
}
