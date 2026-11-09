import React,{useState} from 'react';
import './permissionManagement.css';

export default function PermissionManagement({mode,onSave,onCancel}){
 const [draft,setDraft]=useState(mode),[password,setPassword]=useState(''),[error,setError]=useState('');
 return <form className="permission-management" onSubmit={event=>{event.preventDefault();setError(onSave(draft,password)||'');}}>
  <fieldset><legend>选择模式</legend>{[['operation','操作模式','可编辑包角、间断焊、焊缝合并和焊缝打断设置。'],['debug','调试模式','可编辑全部工艺规划设置及焊接模板的详细匹配参数。']].map(([value,label,description])=><label key={value} className={draft===value?'selected':''}><input type="radio" name="permission-mode" value={value} checked={draft===value} onChange={()=>{setDraft(value);setError('');}}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</fieldset>
  {draft==='debug'&&mode!=='debug'&&<label className="permission-password">调试模式密码<input aria-label="调试模式密码" type="password" inputMode="numeric" autoComplete="off" required value={password} onChange={event=>{setPassword(event.target.value);setError('');}}/></label>}
  {error&&<p role="alert">{error}</p>}
  <footer><button type="button" className="btn" onClick={onCancel}>取消</button><button type="submit" className="btn primary">确定</button></footer>
 </form>;
}
