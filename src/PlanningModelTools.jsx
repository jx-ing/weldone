import NumericInput from './NumericInput.jsx';
import React from 'react';
import {Combine,Plus,Scissors,X,RotateCcw} from 'lucide-react';
import {multiSplitPreview,splitWeldPreview} from './manualSplitModel.mjs';
import {pathLength} from './manualWeldModel.mjs';
import {manualPointCount} from './manualWeldIntersection.mjs';

function ManualWeldEditor({draft,onChange,onUndo,onConfirm,onClose,disabled}){
 const {method,kind,picks,paths,error}=draft;
 const label=method==='face'?'面':method==='solid'?'实体':'点';
 const count=method==='point'?manualPointCount(kind):2;
 return <>
  <label className="planning-create-field">创建方式<select aria-label="创建方式" value={method} disabled={disabled} onChange={event=>onChange({method:event.target.value})}>
   <option value="face">选面求交</option><option value="solid">选实体求交</option><option value="point">选点创建</option>
  </select></label>
  {method==='point'&&<label className="planning-create-field">焊缝形状<select aria-label="焊缝形状" value={kind} disabled={disabled} onChange={event=>onChange({kind:event.target.value})}>
   <option value="line">直线</option><option value="circle">圆</option><option value="arc">圆弧</option>
  </select></label>}
  <p aria-live="polite">在模型中选 {count} 个{label}，已选 {picks.length} / {count}{method==='point'&&kind==='arc'?'。按起点、经过点、终点的顺序选择。':''}</p>
  {paths.length>0&&<div role="status" className="planning-merge-selected">预览 {paths.length} 条焊缝 · {paths.reduce((sum,path)=>sum+pathLength(path.points),0).toFixed(2)} mm</div>}
  {error&&<p role="alert" className="planning-tool-error">{error}</p>}
  <div className="planning-tool-footer">
   <button type="button" className="btn" disabled={disabled||!picks.length} onClick={onUndo}>撤回拾取</button>
   <button type="button" className="btn" disabled={disabled} onClick={onClose}>取消</button>
   <button type="button" className="btn primary" disabled={disabled||!paths.length} onClick={onConfirm}>确认创建</button>
  </div>
 </>;
}

export default function PlanningModelTools({
 mode,onMode,weld,ids,onMerge,onUndoMerge,splitAt,onSplitAt,onSplit,onUndoSplit,canUndoSplit,
 canUndo,onUndo,splitByFace,faceStations,onSplitByFace,disabled,error,
 manualCreate,onCreateMethod,onCreateUndo,onCreateConfirm,creating
}){
 const editable=!!weld?.enabled&&!weld.splitInto&&!weld.mergedInto;
 let preview,problem='';
 if(mode==='split'&&editable)try{
  if(splitByFace){if(faceStations.length)preview=multiSplitPreview(weld,faceStations);}
  else if(splitAt!=='')preview=splitWeldPreview(weld,Number(splitAt));
 }catch(reason){problem=reason.message;}
 const input=(label,value,onChange)=><label className="planning-setting-row"><span>{label}</span><span className="planning-value"><NumericInput
  aria-label={label} min="0" max={weld?.length} step="any" disabled={!editable} value={value}
  onChange={event=>onChange(event.target.value)}/><small>mm</small></span></label>;
 const endDistance=editable&&splitAt!==''?Number((weld.length-Number(splitAt)).toFixed(4)):'';
 const blocked=disabled||creating;
 const title=mode==='create'?'手动创建焊缝':mode==='merge'?'手动合并':'手动打断';
 return <div className="planning-model-tools">
  <div className="planning-model-actions" role="group" aria-label="模型焊道编辑">
   <button type="button" className={mode==='create'?'active':''} aria-pressed={mode==='create'} disabled={blocked} onClick={()=>onMode(mode==='create'?'':'create')}><Plus size={15}/>手动创建焊缝</button>
   <button type="button" className={mode==='merge'?'active':''} aria-pressed={mode==='merge'} disabled={blocked||(!weld&&mode!=='merge')} onClick={()=>onMode(mode==='merge'?'':'merge')}><Combine size={15}/>手动合并</button>
   <button type="button" className={mode==='split'?'active':''} aria-pressed={mode==='split'} disabled={blocked||!editable} onClick={()=>onMode(mode==='split'?'':'split')}><Scissors size={15}/>手动打断</button>
   <button type="button" disabled={!canUndo||blocked} onClick={onUndo}><RotateCcw size={14}/>撤销</button>
  </div>
  {mode&&<section className="planning-model-editor" aria-label={title+'设置'}>
   <header><strong>{title}</strong><button type="button" aria-label="退出焊道编辑" disabled={creating} onClick={()=>onMode('')}><X size={14}/></button></header>
   {mode==='create'&&manualCreate?<ManualWeldEditor draft={manualCreate} onChange={onCreateMethod} onUndo={onCreateUndo}
    onConfirm={onCreateConfirm} onClose={()=>onMode('')} disabled={blocked}/>:mode==='merge'?<>
    <p>点击模型焊道选择或取消，也可在左侧勾选。</p>
    <div className="planning-merge-selected">{ids.length?ids.join('、'):'尚未选择焊道'}</div>
    <button type="button" className="btn primary" disabled={ids.length<2} onClick={onMerge}>预览合并（{ids.length}）</button>
    {!canUndo&&weld?.mergeHistory&&<button type="button" className="btn" onClick={onUndoMerge}>撤销合并</button>}
   </>:<>
    <p>{splitByFace?'在三维模型中点击打断面。':'点击焊缝选点，或输入断点距起点、终点的距离。'}</p>
    <strong>{weld?.id||'请选择焊道'}</strong>
    <label><input type="checkbox" checked={splitByFace} disabled={!editable} onChange={event=>onSplitByFace(event.target.checked)}/>面打断</label>
    {!splitByFace&&<>
     {input('距起点',splitAt,onSplitAt)}
     {input('距终点',endDistance,value=>onSplitAt(value===''?'':String(Number((weld.length-Number(value)).toFixed(4)))))}
    </>}
    {preview&&<p>{preview.pieces.length===1?'打开闭合焊道':'打断后'}：{preview.lengths.map(value=>value.toFixed(2)+' mm').join(' + ')}</p>}
    {(error||problem)&&<p role="alert" className="planning-tool-error">{error||problem}</p>}
    <div className="planning-tool-footer">
     {!canUndo&&canUndoSplit&&<button type="button" className="btn" onClick={onUndoSplit}>撤销打断</button>}
     <button type="button" className="btn" onClick={()=>onMode('')}>取消打断</button>
     <button type="button" className="btn primary" disabled={!preview} onClick={onSplit}>确认打断</button>
    </div>
   </>}
  </section>}
 </div>;
}
