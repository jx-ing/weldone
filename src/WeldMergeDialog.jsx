import React from 'react';
import {Modal} from './TemplateLibrary';
import PathPreview from './TemplatePathPreview';
import {mergeWeldPreview} from './manualMergeModel.mjs';
export default function WeldMergeDialog({welds,ids,onClose,onMerge,error,settings}){
  const preview=mergeWeldPreview(welds,ids,.001,settings);
  return <Modal title="合并所选焊道" onClose={onClose} closeLabel="关闭焊道合并窗口"><div className="weld-merge-body">
    <p>已选择 {ids.length} 条焊道。系统按端点自动排序，检查首尾连续性和过焊孔尺寸。</p>
    {preview.ok?<>{preview.requiresTemplate&&<p role="alert">所选焊缝的焊脚、位置、焊缝形式或接头形式不同，合并后须创建焊接模板。</p>}<h3>连接顺序</h3><ol>{preview.order.map(r=><li key={r.weld.id}>{r.weld.id} · {r.weld.name}{r.reverse?'（反向连接）':''} · {[...new Set(r.weld.segments.map(s=>s.position))].join(' / ')}</li>)}</ol><p>{preview.closed?'闭合':'开放'} · {preview.segments.length} 段 · {preview.length.toFixed(2)} mm</p>{preview.gaps.length>0&&<p>原连接间隙：{preview.gaps.map(n=>n.toFixed(2)+' mm').join('、')}；已通过相邻段延长线的交点连接，不新增焊缝段。</p>}<PathPreview template={{segments:preview.segments,closure:preview.closed?'closed':'open',points:[],corners:preview.cornerAngles.map(standard=>({standard,tolerance:0}))}} segmentsOnly/><p>合并后保留原焊道并屏蔽其参与规划；新焊道需重新匹配模板和工艺，可在模型视图的手动合并面板撤销合并。</p></>:<div className="tpl-errors" role="alert">{preview.errors.map(v=><p key={v}>{v}</p>)}</div>}
    {error&&<p className="tpl-errors" role="alert">{error}</p>}
  </div><footer><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn primary" disabled={!preview.ok} onClick={onMerge}>确认合并</button></footer></Modal>;
}
