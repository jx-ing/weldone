// Adapt the generated runtime only. Keep vendored source evidence and its
// original manifest intact; sync-planning-rules reapplies this extension.
function withEdgeBreakEvidence(source){
 if(source.includes('edgeBoundaryBreak: true'))return source;
 const start=source.indexOf('      if (!finiteConnectedContour && !semantic && edgePerp['),end=source.indexOf('  rawPoints.sort(',start);
 if(start<0||end<start)throw Error('未找到边缘打断证据适配点');
 const block=source.slice(start,end)
  .replace('d1 });','d1, edgeBoundaryBreak: true });')
  .replace('d2 });','d2, edgeBoundaryBreak: true });')
  .replace(/(\br\d*\(span\.minDistance\)) \};/,'$1, edgeBoundaryBreak: true };');
 if((block.match(/edgeBoundaryBreak: true/g)||[]).length!==3)throw Error('边缘打断证据标记不完整');
 const evidence='...sp.subplateContact ? { subplateContact: true } : {}';
 if(!source.includes(evidence))throw Error('未找到打断端点证据输出');
 return (source.slice(0,start)+block+source.slice(end))
  .replace(evidence,evidence+',\n      ...sp.edgeBoundaryBreak ? { edgeBoundaryBreak: true } : {}');
}

export function retainAllWeldLengths(source){
 const start=source.indexOf('function isPlateEndUnit('),
   mergeStart=start<0?source.indexOf('function automaticMerges('):start,
   end=source.indexOf('function computeProcessedGeometryPlan(',mergeStart);
 if(mergeStart<0||end<mergeStart)throw Error('未找到焊缝长度处理适配点');
 const merge=[
  "function automaticMerges(data, welds, splits, config) {",
  "  const deletedUnitKeys = new Set();",
  "  for (const split of splits.values()) split.subWelds.forEach((sub, index) => {",
  "    if (sub.geometryObstruction) deletedUnitKeys.add(split.weldId + \"|\" + index);",
  "  });",
  "  const raw = computeMerges(splits, welds, data.partsData, config.mergeParams, deletedUnitKeys);",
  "  return { result: { ...raw, 删除组数: 0, 删除组成员数: 0, deletedGroupUnitKeys: new Set() }, deletedUnitKeys };",
  "}",
  ''
 ].join('\n');
 const splitStart=source.indexOf('  const buildSub = (index, pts, ');
 if(splitStart<0)throw Error('未找到短焊缝坐标精度适配点');
 const splitEnd=source.indexOf('  const buildOpen',splitStart),split=source.slice(splitStart,splitEnd);
 const preserve=split.includes(".toArray() : [")?split:split.replace(/length: (r1\d*\((\w+)\)),/,'length: $1 || $2,')
  .replace(/\[(r2\d*)\((pts\[0\]|pts\[pts.length - 1\]|p)\.x\), \1\(\2\.y\), \1\(\2\.z\)\]/g,
   (_,round,point)=>'('+split.match(/length: r1\d*\((\w+)\)/)[1]+' < 0.1 ? '+point+'.toArray() : ['+["x","y","z"].map(axis=>round+"("+point+"."+axis+")").join(", ")+'])');
 return (source.slice(0,mergeStart)+merge+source.slice(end)).replace(split,()=>preserve)
  .replace(/^  (minimumWeldLength|retainPlateEndWelds):[^\n]*\n/gm,'')
  .replace('automaticMerges(data, welds, splits, config, byWeld)','automaticMerges(data, welds, splits, config)');
}

export function applyPlanningEdgeAdapter(source){
 const marker='// Local planning edge threshold adapter';
 const measurements='\nexport { computeAxialDetection as measurePlanningAxial, computeBoundaryOffsetSpans as measurePlanningBoundaries };\n';
 if(source.includes(marker))return retainAllWeldLengths(withEdgeBreakEvidence(source.includes(' as measurePlanningAxial')?source:source+measurements));
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
 return retainAllWeldLengths(withEdgeBreakEvidence(source+measurements));
}
