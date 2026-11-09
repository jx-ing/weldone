// Adapt the generated runtime only. Keep vendored source evidence and its
// original manifest intact; sync-planning-rules reapplies this extension.
export function applyPlanningEdgeAdapter(source){
 const marker='// Local planning edge threshold adapter';
 const measurements='\nexport { computeAxialDetection as measurePlanningAxial, computeBoundaryOffsetSpans as measurePlanningBoundaries };\n';
 if(source.includes(marker))return source.includes(' as measurePlanningAxial')?source:source+measurements;
 const replace=(from,to)=>{if(source.split(from).length!==2)throw Error('边缘打断适配点已变化，请检查几何引擎');source=source.replace(from,to);};
 replace('function computeWeldSplit(weld, meshData, partsData, edgesData, contactPairs, offset, extendThreshold, offsetThreshold) {',
  `function computeWeldSplit(weld, meshData, partsData, edgesData, contactPairs, offset, extendThreshold, offsetThreshold) {
  ${marker}
  const edgeThreshold = weld.planningEdgeBreakThreshold === undefined ? offsetThreshold : weld.planningEdgeBreakThreshold;
  const edgeOffset = Number.isFinite(edgeThreshold) ? Math.max(offset, edgeThreshold) : offset;`);
 replace('const perp = getPerpCached(weld, meshData, partsData, edgesData, offset);',
  'const perp = getPerpCached(weld, meshData, partsData, edgesData, offset);\n    const edgePerp = edgeOffset === offset ? perp : getPerpCached(weld, meshData, partsData, edgesData, edgeOffset);');
 const start=source.indexOf('      if (!finiteConnectedContour && !semantic && g['),end=source.indexOf('  rawPoints.sort(',start);
 if(start<0||end<start)throw Error('边缘打断范围适配失败');
 let block=source.slice(start,end).replaceAll('offsetThreshold','edgeThreshold').replace('Math.min(offset, edgeThreshold)','Math.min(edgeOffset, edgeThreshold)').replaceAll('g[','edgePerp[gKey][');
 source=source.slice(0,start)+block+source.slice(end);
 return source+measurements;
}
