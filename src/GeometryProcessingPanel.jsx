import React from 'react';
export default function GeometryProcessingPanel({progress,result,onUndo,canUndo}){
  if(!progress&&!result)return null;
  const s=result?.summary,c=result?.config;
  return <section className="geometry-processing" aria-label="焊道几何处理结果">
    {progress?<div role="status"><strong>{progress.stage}</strong><progress max="100" value={progress.percent}/><span>{progress.percent}%</span></div>:<>
      <div><strong>焊道处理完成</strong><span>{s.cadCandidateCount} 条候选 → {s.subWeldCount} 个打断段 → {s.survivingUnitCount} 个保留段 → <b>{s.processedWeldCount} 条焊道</b></span>{canUndo&&<button type="button" onClick={onUndo}>撤销本次处理</button>}</div>
      <details><summary>处理规则与依据 · {s.mergedGroupCount} 组合并</summary><div className="geometry-rule-details">
        <p>沿用工艺规划平台的提取、打断和合并规则。{s.referenceOnlyCount} 条拓扑参考候选不作为独立焊道；{s.deletedUnitCount} 个段按短段、遮挡及端部保留规则筛选。</p>
        <p>打断：端部偏移 {c.offset} mm，延伸阈值 {c.extendThreshold} mm，接触投影阈值 {c.offsetThreshold} mm。最短段阈值 {c.minimumWeldLength} mm，端部规则最小值 {c.endpointMinimumMm} mm；拓扑保留规则优先。</p>
        <p>合并：焊接位置一致，{c.mergeGapCheck===true?`最大间隙 ${c.mergeParams.最大合并距离} mm`:'间隙阈值检查已关闭'}，夹角 {c.mergeParams.夹角阈值下限}–{c.mergeParams.夹角阈值上限}°，通过高度 ≥{c.mergeParams.最小通过高度} mm，通过距离 ≤{c.mergeParams.最长通过距离} mm；禁止同源打断段及重叠路径自动合并。</p>
        {s.rejectedMergeGroupCount>0&&<p>{s.rejectedMergeGroupCount} 组未能形成有效的延长线交点，已保留为独立焊道；不生成间隙连接段。</p>}
        <p>待确认：焊接位置 {s.unknownPositionCount} 条，坡口 {s.unconfirmedGrooveCount} 条。焊脚沿用板厚计算规则；电流、电压和速度由匹配工艺提供。</p>
        <a href={result.extraction.rawDataPath} target="_blank" rel="noreferrer">查看提取候选</a><a href={result.extraction.analysisPath} target="_blank" rel="noreferrer">查看几何分析依据</a>
      </div></details>
    </>}
  </section>;
}
