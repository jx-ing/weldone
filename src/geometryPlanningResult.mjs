import {isConfirmedNonWeldKey} from './confirmedNonWelds.mjs';
import {deletedGeometryForModel,excludeDeletedGeometry,installGeometryResult,retainedGeometryWelds} from './geometryProcessingModel.mjs';
import {mergeIncludedAngleRange,DEFAULT_MERGE_ANGLE_RANGE,DEFAULT_MERGE_GAP} from './planningConfiguration.mjs';
import {settingsDefaults} from './planningSettingsModel.mjs';
import {preprocessExtractedWelds} from './weldPreprocessing.mjs';

export function prepareExtractedPlanningWorkspace(current,result,settings,measure,{restoreDeleted}){
  const effective=settingsDefaults(settings);
  const range=mergeIncludedAngleRange(settings.mergeParameters);
  const merge={
    ...(Number.isFinite(range.angleMin)&&Number.isFinite(range.angleMax)?range:DEFAULT_MERGE_ANGLE_RANGE),
    maxGroove:effective.mergeParameters.gapThreshold??DEFAULT_MERGE_GAP,
    maxLength:effective.mergeParameters.lengthEnabled?effective.mergeParameters.maxLength:undefined,
    maxCount:effective.mergeParameters.countEnabled?effective.mergeParameters.count:undefined
  };
  const manuallyDeleted=restoreDeleted?[]:deletedGeometryForModel(current,result.sourceSha256);
  const reserved=new Set(retainedGeometryWelds(current,{restoreDeleted}).filter(weld=>weld.source==='extracted').map(weld=>weld.processingKey));
  const source=[],confirmedNonWelds=[];
  for(const weld of result.welds){
    if(reserved.has(weld.processingKey))continue;
    if(!current.stepModel&&isConfirmedNonWeldKey(weld.sourceSha256,weld.processingKey))confirmedNonWelds.push(weld);
    else source.push(weld);
  }
  const welds=preprocessExtractedWelds(excludeDeletedGeometry(source,manuallyDeleted),effective.weldPreprocessing,merge,measure,effective.wrapParameters);
  const summary={
    ...result.summary,
    processedWeldCount:welds.length,
    mergedGroupCount:welds.filter(weld=>weld.segments.length>1).length,
    cornerCount:welds.reduce((count,weld)=>count+weld.cornerAngles.length,0)
  };
  return installGeometryResult(current,{...result,welds:[...welds,...confirmedNonWelds],summary},{restoreDeleted});
}
