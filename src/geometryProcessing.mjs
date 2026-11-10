import {loadModelData,prepareProcessedGeometryData,computeAllSplitsAsync,computeProcessedGeometryPlan,processedGeometryPlanConfig} from './vendor/geometry-engine.mjs';
import {DEMO_SOURCE_SHA256,convertGeometryPlan,validateGeometryOptions} from './geometryProcessingModel.mjs';
import {roundWeldLeg} from './planningRequirements.mjs';
import {withPlanningEdgeThresholds} from './planningEdgeThreshold.mjs';
export async function processDemoGeometry(options,onProgress=()=>{}){
  const errors=validateGeometryOptions(options);if(errors.length)throw Error(errors.join('；'));
  onProgress({stage:'读取真实几何提取数据',percent:5});
  const loaded=await loadModelData('/models/111-rules',undefined,{geometryOnly:true,thicknessWeldThresholdMm:options.thicknessWeldThresholdMm});
  if(loaded.analysis?.sourceSha256!==DEMO_SOURCE_SHA256)throw Error('模型源文件指纹校验失败');
  if(!loaded.edgesData?.edges?.length||!loaded.contactPairs?.size)throw Error('边界或零件接触数据缺失，请重新加载后处理');
  // The native topology normalization is saved once with the extraction files.
  // This retains the exact source rules while keeping floating-point shell
  // boundary decisions identical across Node and browser JavaScript engines.
  const response=await fetch('/models/111-rules/planning-input.json',{cache:'no-store'});
  if(!response.ok)throw Error('几何归一化数据加载失败');
  const canonical=await response.json();
  if(canonical.sourceSha256!==DEMO_SOURCE_SHA256||canonical.geometryPlanRevision!==5||!Array.isArray(canonical.weldsData?.welds))throw Error('几何归一化数据与模型或规则版本不一致');
  loaded.weldsData=canonical.weldsData;
  const config={...processedGeometryPlanConfig(options),mergeGapCheck:options.mergeGapCheck===true,...(options.maxMergeCount!==undefined?{maxMergeCount:options.maxMergeCount}:{}),...(options.maxMergeLength!==undefined?{maxMergeLength:options.maxMergeLength}:{})},{data,splitWeldsData}=prepareProcessedGeometryData(loaded,config.legSettings,config.thicknessWeldThresholdMm);
  if(options.planningRevision===3){
    const action=options.actionParameters??{};
    data.weldsData={...data.weldsData,welds:data.weldsData.welds.map(weld=>{
      const properties={...weld.properties,焊脚:roundWeldLeg(action.legMode==='global'?action.legHeight:weld.properties.焊脚)};
      const position=properties.焊接位置?.代号;
      if(position==='PF'||position==='PG')properties.焊接位置={...properties.焊接位置,代号:action.verticalDown?'PG':'PF'};
      return {...weld,properties};
    })};
  }
  const splitInput=withPlanningEdgeThresholds(splitWeldsData,data.weldsData.welds,options.splitParameters);
  const splits=await computeAllSplitsAsync([splitInput,data.mesh,data.partsData,data.edgesData,data.contactPairs,config.offset,config.extendThreshold,config.offsetThreshold],{budgetMs:50,onProgress:p=>onProgress({stage:`打断焊道 ${p.completed}/${p.total}`,percent:10+Math.round(p.completed/Math.max(1,p.total)*65)})});
  if(!splits)throw Error('焊道打断未完成');onProgress({stage:'筛选短段并按规则合并',percent:80});
  const runtimeConfig=config.mergeGapCheck?config:{...config,mergeParams:{...config.mergeParams,最大合并距离:Infinity}};
  const plan=computeProcessedGeometryPlan(data,splits,runtimeConfig),welds=convertGeometryPlan(data,plan,options);
  const merged=welds.filter(w=>w.sourceEvidence.unitKeys.length>1).length,rejected=new Set(welds.map(w=>w.sourceEvidence.rejectedMergeKey).filter(Boolean)).size;
  onProgress({stage:'处理完成',percent:100});
  return {welds,sourceSha256:DEMO_SOURCE_SHA256,config,summary:{...plan.summary,sourceRuleMergedGroupCount:plan.summary.mergedGroupCount,mergedGroupCount:merged,automaticMergeGroupCount:merged,rejectedMergeGroupCount:rejected,processedWeldCount:welds.length,cornerCount:welds.reduce((sum,w)=>sum+w.cornerAngles.length,0),cadCandidateCount:loaded.analysis.summary.candidateWeldCount,referenceOnlyCount:loaded.analysis.summary.candidateWeldCount-data.weldsData.welds.length,unknownPositionCount:welds.filter(w=>w.position==='待确认').length,unconfirmedGrooveCount:welds.filter(w=>w.groove.type==='待确认'||w.groove.depth===null).length},extraction:{partCount:loaded.analysis.summary.partCount,method:loaded.analysis.method,sourceSha256:DEMO_SOURCE_SHA256,rawDataPath:'/models/111-rules/welds.json',analysisPath:'/models/111-rules/analysis.json'}};
}
