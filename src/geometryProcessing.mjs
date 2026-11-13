import {loadModelData,prepareProcessedGeometryData,computeAllSplitsAsync,computeProcessedGeometryPlan,processedGeometryPlanConfig} from './vendor/geometry-engine.mjs';
import {DEMO_SOURCE_SHA256,convertGeometryPlan,validateGeometryOptions} from './geometryProcessingModel.mjs';
import {roundWeldLeg,weldPositionCode} from './planningRequirements.mjs';
import {settingsDefaults} from './planningSettingsModel.mjs';
import {withPlanningEdgeThresholds} from './planningEdgeThreshold.mjs';
import {EXAMPLE_MODEL} from './manualWeldModel.mjs';
import {loadStepMesh} from './stepModelStore.mjs';

export async function processDemoGeometry(options,onProgress=()=>{}){
  const base='/models/111-rules';
  return processGeometry(options,onProgress,{base,model:EXAMPLE_MODEL,sourceSha256:DEMO_SOURCE_SHA256,canonical:true});
}

export async function processImportedStep(model,reference,options,onProgress){
  const mesh=await loadStepMesh(model,reference);
  if(!mesh.sourceFile){
    const error=Error('此模型导入时未保留原始 STEP，请重新选择同一文件后再点击一键规划');
    error.code='STEP_SOURCE_MISSING';
    throw error;
  }
  onProgress({stage:'正在分析 STEP 实体与零件接触边界',percent:2});
  const response=await fetch('/api/step-extraction',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:mesh.sourceFile});
  const job=await response.json().catch(()=>null);
  if(!response.ok||!job?.dataPath)throw Error(job?.error||'当前预览未启用本机 STEP 几何提取服务');
  try{
    return await processGeometry(options,onProgress,{base:job.dataPath,model,sourceSha256:reference.sourceSha256});
  }finally{
    await fetch(job.dataPath,{method:'DELETE'}).catch(()=>{});
  }
}

async function processGeometry(options,onProgress,{base,model,sourceSha256,canonical}){
  const errors=validateGeometryOptions(options);if(errors.length)throw Error(errors.join('；'));
  onProgress({stage:'读取真实几何提取数据',percent:5});
  const loaded=await loadModelData(base,undefined,{geometryOnly:true,thicknessWeldThresholdMm:options.thicknessWeldThresholdMm});
  if(loaded.analysis?.sourceSha256!==sourceSha256)throw Error('模型源文件指纹校验失败');
  if(!Array.isArray(loaded.edgesData?.edges)||!loaded.contactPairs)throw Error('边界或零件接触数据缺失，请重新加载后处理');
  if(canonical){
    // Preserve the demo's frozen native topology decisions across JS engines.
    const response=await fetch(base+'/planning-input.json',{cache:'no-store'});
    if(!response.ok)throw Error('几何归一化数据加载失败');
    const input=await response.json();
    if(input.sourceSha256!==sourceSha256||input.geometryPlanRevision!==5||!Array.isArray(input.weldsData?.welds))throw Error('几何归一化数据与模型或规则版本不一致');
    loaded.weldsData=input.weldsData;
  }
  const config={...processedGeometryPlanConfig(options),mergeGapCheck:options.mergeGapCheck===true,...(options.maxMergeCount!==undefined?{maxMergeCount:options.maxMergeCount}:{}),...(options.maxMergeLength!==undefined?{maxMergeLength:options.maxMergeLength}:{})},{data,splitWeldsData}=prepareProcessedGeometryData(loaded,config.legSettings,config.thicknessWeldThresholdMm);
  if(options.planningRevision===3){
    const action=options.weldPreprocessing?settingsDefaults({topologyVersion:1,weldPreprocessing:{},actionParameters:options.actionParameters}).actionParameters:options.actionParameters??{};
    const parts=new Map(data.partsData.parts.map(part=>[part.id,part]));
    const calculatedLegs=new Map();
    data.weldsData={...data.weldsData,welds:data.weldsData.welds.map(weld=>{
      const position=weldPositionCode(weld.properties.焊接位置?.代号);
      const legGroup=position==='PB'?'flat':position==='PF'?'vertical':null;
      const defaultLeg=legGroup&&action.defaultLegs?.[legGroup];
      const thickness=weld.properties.厚度;
      const knownThickness=Number.isFinite(thickness)&&thickness>0?thickness:null;
      const plates=[knownThickness??thickness?.主板厚度??parts.get(weld.mainPartId)?.thickness,knownThickness??thickness?.副板厚度??parts.get(weld.subPartId)?.thickness].filter(value=>Number.isFinite(value)&&value>0);
      const height=action.defaultLegs
        ? (defaultLeg?.mode==='coefficient'&&plates.length?Math.min(...plates)*defaultLeg.coefficient:defaultLeg?.mode==='fixed'||defaultLeg?.enabled?defaultLeg.height:weld.properties.焊脚)
        : (action.legMode==='global'?action.legHeight:weld.properties.焊脚);
      const calculated=defaultLeg?.mode==='coefficient'&&plates.length&&Number.isFinite(height)&&height>0;
      if(calculated)calculatedLegs.set(weld.id,Number(height.toPrecision(12)));
      const properties={...weld.properties,焊脚:roundWeldLeg(height)};
      if(position==='PF')properties.焊接位置={...properties.焊接位置,代号:'PF',位置:'立向上焊位置'};
      return {...weld,properties};
    })};
    options={...options,calculatedLegs};
  }
  const splitInput=withPlanningEdgeThresholds(splitWeldsData,data.weldsData.welds,options.weldPreprocessing?{edgeThreshold:null}:options.splitParameters);
  const splits=await computeAllSplitsAsync([splitInput,data.mesh,data.partsData,data.edgesData,data.contactPairs,config.offset,config.extendThreshold,config.offsetThreshold],{budgetMs:50,onProgress:p=>onProgress({stage:`打断焊道 ${p.completed}/${p.total}`,percent:10+Math.round(p.completed/Math.max(1,p.total)*65)})});
  if(!splits)throw Error('焊道打断未完成');onProgress({stage:options.weldPreprocessing?'读取端点几何和过焊孔':'按几何规则合并焊缝',percent:80});
  const runtimeConfig=config.mergeGapCheck?config:{...config,mergeParams:{...config.mergeParams,最大合并距离:Infinity}};
  const plan=computeProcessedGeometryPlan(data,splits,runtimeConfig),welds=convertGeometryPlan(data,plan,options,{model,sourceSha256});
  const merged=welds.filter(w=>w.sourceEvidence.unitKeys.length>1).length,rejected=new Set(welds.map(w=>w.sourceEvidence.rejectedMergeKey).filter(Boolean)).size;
  onProgress({stage:'处理完成',percent:100});
  return {welds,sourceSha256,config,summary:{...plan.summary,sourceRuleMergedGroupCount:plan.summary.mergedGroupCount,mergedGroupCount:merged,automaticMergeGroupCount:merged,rejectedMergeGroupCount:rejected,processedWeldCount:welds.length,cornerCount:welds.reduce((sum,w)=>sum+w.cornerAngles.length,0),cadCandidateCount:loaded.analysis.summary.candidateWeldCount,referenceOnlyCount:loaded.analysis.summary.candidateWeldCount-data.weldsData.welds.length,unknownPositionCount:welds.filter(w=>w.position==='待确认').length,unconfirmedGrooveCount:welds.filter(w=>w.groove.type==='待确认'||w.groove.depth===null).length},
    extraction:{partCount:loaded.analysis.summary.partCount,method:loaded.analysis.method,sourceSha256,
      ...(canonical?{rawDataPath:base+'/welds.json',analysisPath:base+'/analysis.json'}:{})},
    ...(!canonical?{neighborhood:{parts:loaded.partsData.parts,mesh:loaded.mesh,edges:loaded.edgesData,sourceWelds:loaded.weldsData.welds}}:{})};
}
