/** Default geometry planning shared by saved demonstrations and the live UI.
 * Input model data has already passed loadModelData/finalizeFramedModelData.
 * This path deliberately has no property edits, manual merges, intermittent
 * welding, tool poses or library matching. Those remain on the editable path. */
import type { WeldsData } from '@/types/weld'
import type { ModelData } from './loadData'
import { defaultVerticalUpWeldDirections } from './weldDirection'
import { withUnifiedGeometrySupport } from './unifiedGeometrySupport'
import {
  applyGeometrySourceEdits, applyGeometrySplitEdits, applyGeometryMergeEdits,
  applyGeometryBaojiaoEdits, applyGeometryCornerEdits, DEFAULT_GEOMETRY_LEG_SETTINGS,
  type GeometryLegSettings,
} from './geometryEditing'
import { summarizeSplits, type WeldSplit } from './weldSplit'
import { DEFAULT_MERGE_PARAMS, computeMerges, type MergeParams, type MergeResultFiltered } from './weldMerge'
import { applyIntermittentWeldEndpointRules } from './intermittentWelding'
import type { GeometryManualMergeOperation } from './geometryManualMerge'
import { computeGeometryWeldBaojiao, computeGeometryCornerInstances, type GeometryActionOptions } from './geometryActions'
import { summarizeBaojiao, type BaojiaoResult, type WeldBaojiao } from './baojiao'
import type { CornerInstance } from './cornerSchemes'
import { applyThicknessWeldThreshold, DEFAULT_THICKNESS_WELD_THRESHOLD_MM } from './thicknessWeldPolicy'

/** Bump when any post-split stage or its interpretation changes. Split geometry
 * has its own WELD_SPLIT_ALGORITHM_REVISION and source-content validation. */
export const PROCESSED_GEOMETRY_PLAN_REVISION = 5

export interface ProcessedGeometryPlanConfig {
  offset: number
  extendThreshold: number | null
  offsetThreshold: number | null
  endpointMinimumMm: number
  wrapDistanceRatio: number
  thicknessWeldThresholdMm: number
  mergeParams: MergeParams
  legSettings: GeometryLegSettings
  /** null means every source workface/joint, as in curated demo defaults. */
  workfaces: Record<string, boolean> | null
  jointTypes: Record<string, boolean> | null
}

export const DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG: Readonly<ProcessedGeometryPlanConfig> = {
  offset: 50, extendThreshold: 50, offsetThreshold: 50, endpointMinimumMm: 40,
  wrapDistanceRatio: 2 / 3,
  thicknessWeldThresholdMm: DEFAULT_THICKNESS_WELD_THRESHOLD_MM,
  mergeParams: { ...DEFAULT_MERGE_PARAMS }, legSettings: { ...DEFAULT_GEOMETRY_LEG_SETTINGS },
  workfaces: null, jointTypes: null,
}

export interface ProcessedGeometryPlanSummary {
  extractedWeldCount: number
  activeWeldCount: number
  splitWeldCount: number
  subWeldCount: number
  deletedUnitCount: number
  deletedGroupCount: number
  deletedGroupMemberCount: number
  survivingUnitCount: number
  automaticMergeGroupCount: number
  fullWrapMergeGroupCount: number
  mergedGroupCount: number
  /** This is App's merges.合并后总数, the displayed “处理焊道” count. */
  processedWeldCount: number
  cornerCount: number
  fullWrapOperationCount: number
  fullWrapPassCount: number
}

export interface ProcessedGeometryPlan {
  config: ProcessedGeometryPlanConfig
  splits: Map<string, WeldSplit>
  automaticMerges: MergeResultFiltered
  merges: MergeResultFiltered
  baojiao: BaojiaoResult
  corners: CornerInstance[]
  automaticFullWrapOperations: GeometryManualMergeOperation[]
  deletedUnitKeys: Set<string>
  hiddenUnitKeys: Set<string>
  summary: ProcessedGeometryPlanSummary
}

export function processedGeometryPlanConfig(input: Partial<ProcessedGeometryPlanConfig> = {}): ProcessedGeometryPlanConfig {
  return { ...DEFAULT_PROCESSED_GEOMETRY_PLAN_CONFIG, ...input,
    mergeParams: { ...DEFAULT_MERGE_PARAMS, ...input.mergeParams },
    legSettings: { ...DEFAULT_GEOMETRY_LEG_SETTINGS, ...input.legSettings },
    workfaces: input.workfaces ? { ...input.workfaces } : null,
    jointTypes: input.jointTypes ? { ...input.jointTypes } : null }
}

/** The split input must use these unedited geometric welds, while subsequent
 * merging/endpoint judgments use data's calculated default leg properties. */
export function prepareProcessedGeometryData(source: ModelData,
  legSettings: GeometryLegSettings = DEFAULT_GEOMETRY_LEG_SETTINGS,
  thicknessWeldThresholdMm = DEFAULT_THICKNESS_WELD_THRESHOLD_MM): { data: ModelData; splitWeldsData: WeldsData } {
  const splitWeldsData = withUnifiedGeometrySupport(defaultVerticalUpWeldDirections(source.weldsData))
  return { splitWeldsData, data: { ...source,
    weldsData: applyThicknessWeldThreshold(applyGeometrySourceEdits(splitWeldsData, source.partsData, legSettings, {}),
      source.partsData, thicknessWeldThresholdMm) } }
}

function activeWelds(data: WeldsData, config: ProcessedGeometryPlanConfig): WeldsData {
  return { welds: data.welds.filter(weld => {
    if (config.jointTypes?.[weld.jointType] === false) return false
    const face = weld.properties.焊缝所在工作面
    return typeof face !== 'string' || config.workfaces?.[face] !== false
  }) }
}

/** Obstruction evidence excludes a segment from merging and planning. Length is not a deletion criterion. */
function automaticMerges(data: ModelData, welds: WeldsData, splits: Map<string, WeldSplit>,
  config: ProcessedGeometryPlanConfig) {
  const deletedUnitKeys = new Set<string>()
  for (const split of splits.values()) split.subWelds.forEach((sub, index) => {
    if (sub.geometryObstruction) deletedUnitKeys.add(split.weldId + '|' + index)
  })
  const raw = computeMerges(splits, welds, data.partsData, config.mergeParams, deletedUnitKeys)
  const result: MergeResultFiltered = { ...raw, 删除组数: 0, 删除组成员数: 0, deletedGroupUnitKeys: new Set<string>() }
  return { result, deletedUnitKeys }
}

/** data must be the prepared geometry data (including default leg values), and
 * sourceSplits must have been calculated from its unedited splitWeldsData.
 * No source geometry or input split is mutated. Full-wrap actions remain
 * endpoint properties and never trigger automatic T-side merging. */
export function computeProcessedGeometryPlan(data: ModelData, sourceSplits: Map<string, WeldSplit>,
  inputConfig: Partial<ProcessedGeometryPlanConfig> = {}): ProcessedGeometryPlan {
  const config = processedGeometryPlanConfig(inputConfig)
  const welds = activeWelds(data.weldsData, config), ids = new Set(welds.welds.map(weld => weld.id))
  if (welds.welds.some(weld => !sourceSplits.has(weld.id))) throw new Error('处理焊道所需的源焊缝打断数据不完整')
  const activeSplits = new Map([...sourceSplits].filter(([id]) => ids.has(id)))
  const splits = applyGeometrySplitEdits(activeSplits, data.weldsData, {})!
  const options: GeometryActionOptions = { extendThreshold: config.extendThreshold, edgesData: data.edgesData,
    wrapDistanceRatio: config.wrapDistanceRatio, schemesEnabled: false, thicknessWeldThresholdMm: config.thicknessWeldThresholdMm,
    endpointProcessConfig: { dimensionMode: 'min-dimension', minimumMm: config.endpointMinimumMm } }
  const began = performance.now(), byWeld = new Map<string, WeldBaojiao>()
  for (const weld of data.weldsData.welds)
    byWeld.set(weld.id, computeGeometryWeldBaojiao(weld, data.partsData, data.mesh, [], splits.get(weld.id), options))
  const rawBaojiao: BaojiaoResult = { byWeld, 焊缝数: data.weldsData.welds.length,
    耗时ms: Math.round(performance.now() - began), 统计: summarizeBaojiao(byWeld) }
  const automatic = automaticMerges(data, welds, splits, config)
  const merges = applyGeometryMergeEdits(automatic.result, data.weldsData, splits, {})!
  const context = { weldsData: data.weldsData, partsData: data.partsData, mesh: data.mesh,
    splits, merges, schemes: [], options }
  const baojiao = applyIntermittentWeldEndpointRules(applyGeometryBaojiaoEdits(rawBaojiao, context, {})!, splits, merges)!
  const corners = applyGeometryCornerEdits(computeGeometryCornerInstances(merges, data.weldsData, data.partsData,
    data.mesh, [], options), context, {})
  const hiddenUnitKeys = new Set([...automatic.deletedUnitKeys, ...merges.deletedGroupUnitKeys])
  const counts = summarizeSplits(splits)
  const summary: ProcessedGeometryPlanSummary = {
    extractedWeldCount: data.weldsData.welds.length, activeWeldCount: welds.welds.length,
    splitWeldCount: counts.被打断焊缝数, subWeldCount: counts.打断后总段数,
    deletedUnitCount: automatic.deletedUnitKeys.size, deletedGroupCount: merges.删除组数,
    deletedGroupMemberCount: merges.删除组成员数, survivingUnitCount: merges.单元总数,
    automaticMergeGroupCount: merges.groups.filter(group => !group.id.startsWith('H')).length,
    fullWrapMergeGroupCount: 0,
    mergedGroupCount: merges.groups.length, processedWeldCount: merges.合并后总数,
    cornerCount: corners.length, fullWrapOperationCount: 0, fullWrapPassCount: 1,
  }
  return { config, splits, automaticMerges: automatic.result, merges, baojiao, corners,
    automaticFullWrapOperations: [], deletedUnitKeys: automatic.deletedUnitKeys, hiddenUnitKeys, summary }
}
