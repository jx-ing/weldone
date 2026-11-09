import React from 'react';
import {Combine,Scissors,X,RotateCcw} from 'lucide-react';
import {multiSplitPreview,splitWeldPreview} from './manualSplitModel.mjs';

export default function PlanningModelTools({
 mode,onMode,weld,ids,onMerge,onUndoMerge,splitAt,onSplitAt,onSplit,onUndoSplit,canUndoSplit,
 canUndo,onUndo,splitByFace,faceStations,onSplitByFace,disabled,error
}){
 const editable=!!weld?.enabled&&!weld.splitInto&&!weld.mergedInto;
 let preview,problem='';
 if(mode==='split'&&editable)try{
  if(splitByFace){if(faceStations.length)preview=multiSplitPreview(weld,faceStations);}
  else if(splitAt!=='')preview=splitWeldPreview(weld,Number(splitAt));
 }catch(reason){problem=reason.message;}
 const input=(label,value,onChange)=><label className="planning-setting-row"><span>{label}</span><span className="planning-value"><input
  aria-label={label} type="number" min="0" max={weld?.length} step="any" disabled={!editable} value={value}
  onChange={event=>onChange(event.target.value)}/><small>mm</small></span></label>;
 const endDistance=editable&&splitAt!==''?Number((weld.length-Number(splitAt)).toFixed(4)):'';
 return <div className="planning-model-tools">
  <div className="planning-model-actions" role="group" aria-label="模型焊道编辑">
   <button type="button" className={mode==='merge'?'active':''} aria-pressed={mode==='merge'} disabled={disabled} onClick={()=>onMode(mode==='merge'?'':'merge')}><Combine size={15}/>手动合并</button>
   <button type="button" className={mode==='split'?'active':''} aria-pressed={mode==='split'} disabled={disabled} onClick={()=>onMode(mode==='split'?'':'split')}><Scissors size={15}/>手动打断</button>
   <button type="button" disabled={!canUndo||disabled} onClick={onUndo}><RotateCcw size={14}/>撤销</button>
  </div>
  {mode&&<section className="planning-model-editor" aria-label={mode==='merge'?'手动合并设置':'手动打断设置'}>
   <header><strong>{mode==='merge'?'手动合并':'手动打断'}</strong><button type="button" aria-label="退出焊道编辑" onClick={()=>onMode('')}><X size={14}/></button></header>
   {mode==='merge'?<>
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
