/** Geometry-only endpoint actions. Tool shape, TCP, robot parameters and
 * collision/avoidance results do not participate in these decisions. */
import * as THREE from 'three'
import type { EdgesData, PartsData, Weld, WeldsData } from '@/types/weld'
import type { BaojiaoEndpoint, BaojiaoResult, BaojiaoSubtype, WeldBaojiao } from './baojiao'
import { endpointWrapDirections, endpointWrapSide } from './baojiaoFrame'
import {
  CORNER_VARIANT_KEYS, POSITION_CODES, defaultCornerDistances, emptyVariant,
  computeCornerInstances, classifyCorner, defaultSchemeUsage, endpointVariantKey, matchEndpointScheme, matchScheme, cornerPoints, weldGroove, weldLegValue, weldPositionCode,
  type CornerInstance, type CornerScheme,
} from './cornerSchemes'
import { computeAxialDetection } from './gapDetection'
import { getPartGeometryIndex } from './partGeometryIndex'
import { abstractEndpointSpace, endpointAxialObstacle, measureEndpointClearance, type UnifiedEndpointInfo } from './endpointClearance'
import { decideEndpointProcess, type EndpointProcessConfig } from './endpointProcessDecision'
import { FINITE_INTERVAL_JOIN_TOLERANCE, type MergeResult } from './weldMerge'
import { subplateContactEndpointEvidence, type WeldSplit } from './weldSplit'
// These existing helpers only read the weld polyline and CAD face normals.
// They neither load a tool nor calculate a tool pose.
import { endpointSample, weldNormalsAt, weldWithExtensions, type DemoTarget } from './torch'
import { geometryBoundaryCadCorners } from './cadPathCornerGeometry'
import { geometryWrapBoundaryFaceNormal } from './geometryWrapBoundary'
import { filterThicknessWrapCorners, keepsThicknessMemberCorner } from './thicknessWeldPolicy'
import { geometryAutomaticWrapUnavailableReason, limitGeometryAutomaticWrap, supportsGeometryAutomaticWrap } from './geometryWrapPolicy'

export interface GeometryActionOptions {
  extendThreshold: number | null
  edgesData?: EdgesData | null
  wrapDistanceRatio?: number
  /** Pause matching/default path parameters while retaining geometry actions. */
  schemesEnabled?: boolean
  /** Current non-deferred process diagram; omit to restore the former rules. */
  endpointProcessConfig?: EndpointProcessConfig
  /** Explicit restoration/testing of the retained former endpoint rules. */
  endpointRule?: 'unified' | 'legacy'
  /** A thinner source-proved T-end connector remains wrap travel, not corners. */
  thicknessWeldThresholdMm?: number
}

/** Temporary process capability applied after geometric endpoint recognition. */
export const GEOMETRY_WRAP_CAPABILITIES = { verticalFullWrap: false }
/** Retains the former feature-based implementation for a future restoration. */
export const GEOMETRY_ENDPOINT_RULES = { unified: true }

interface Feature {
  特征类型?: string
  角类型?: string | null
  角度?: number | null
  圆类型?: string | null
  R1?: number | null
  L1?: number | null
  包角待确认?: boolean
  包角转角?: number | null
  默认动作?: string
}

function labelOf(feature?: Feature): string {
  if (!feature) return '直角'
  if (['未识别', '普通端点', '平角'].includes(feature.特征类型 ?? '')) return feature.特征类型!
  if (feature.特征类型 === '角' && feature.角类型) return feature.角类型
  if (feature.特征类型 === '圆' && feature.圆类型) return feature.圆类型
  return '直角'
}

function angleOf(label: string, feature?: Feature): number | null {
  if (typeof feature?.包角转角 === 'number' && Number.isFinite(feature.包角转角)) return feature.包角转角
  if (['直角', '锐角', '优角'].includes(label)) {
    return typeof feature?.角度 === 'number' && Number.isFinite(feature.角度)
      ? feature.角度 : label === '直角' ? 90 : null
  }
  if (label === 'D圆弧') return 180
  if (['凹圆弧', '凸圆弧', '长圆弧'].includes(label) && typeof feature?.R1 === 'number'
    && feature.R1 > 1e-9 && typeof feature.L1 === 'number' && feature.L1 >= 0) return feature.L1 / feature.R1 * 180 / Math.PI
  return null
}

function subtypeOf(angle: number | null): BaojiaoSubtype {
  return angle === null ? '待定' : angle < 1 ? '不变姿态包角' : angle <= 30 ? '原地包角' : '变姿态包角'
}

function thicknessOf(weld: Weld, parts: PartsData, which: 'start' | 'end'): number | null {
  const side = endpointWrapSide(weld, which), raw = weld.properties.厚度
  const value = typeof raw === 'object' && raw !== null
    ? (raw as Record<string, unknown>)[side === 'main' ? '主板厚度' : '副板厚度'] : side === 'sub' ? raw : undefined
  const thickness = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value
    : parts.parts.find((part) => part.id === (side === 'main' ? weld.mainPartId : weld.subPartId))?.thickness
  return typeof thickness === 'number' && Number.isFinite(thickness) && thickness > 0 ? thickness : null
}

function ownBoundaryDistances(weld: Weld, edges?: EdgesData | null, split?: WeldSplit) {
  const result: Record<'start' | 'end', number | null> = { start: null, end: null }
  const axial = edges ? computeAxialDetection(weld, edges) : null
  const gap = weld.properties.间隙检测 as Record<string, unknown> | undefined
  const groups = axial ?? gap?.extend ?? gap?.沿轴线方向
  for (const group of Object.values(groups && typeof groups === 'object' ? groups : {})) {
    if (!group || typeof group !== 'object') continue
    for (const [which, label] of [['start', '起点'], ['end', '终点']] as const) {
      for (const [key, value] of Object.entries(group)) {
        if (key.startsWith(label) && key.includes('距离') && typeof value === 'number'
          && Number.isFinite(value) && value >= 0) result[which] = Math.min(result[which] ?? Infinity, value)
      }
    }
  }
  if (!weld.closed && split?.weldId === weld.id) {
    for (const which of ['start', 'end'] as const) {
      const extension = which === 'start' ? split.startExtension : split.endExtension
      if (extension?.规则 === 'extend小于阈值' && extension.延伸到.length === 3
        && extension.延伸到.every((n, axis) => Number.isFinite(n) && Math.abs(n - weld[which][axis]) <= 1e-9)) result[which] = 0
    }
  }
  return result
}

const partBoxes = new WeakMap<PartsData, Map<string, THREE.Box3>>()
function boxesOf(parts: PartsData) {
  let boxes = partBoxes.get(parts)
  if (!boxes) {
    boxes = new Map(parts.parts.map((part) => [part.id, new THREE.Box3(
      new THREE.Vector3().fromArray(part.bbox.min), new THREE.Vector3().fromArray(part.bbox.max))]))
    partBoxes.set(parts, boxes)
  }
  return boxes
}

/** A free edge of either joint plate is not a geometric obstruction. Only
 * finite third-part material along the outward path can request an inner
 * endpoint preparation. No virtual gun envelope is created in this mode. */
function outwardBoundary(weld: Weld, sample: NonNullable<ReturnType<typeof endpointSample>>,
  which: 'start' | 'end', parts: PartsData, mesh: Float32Array, threshold: number | null) {
  if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) return null
  const direction = sample.tangent.clone().normalize().multiplyScalar(which === 'start' ? -1 : 1)
  const ray = new THREE.Ray(sample.pos, direction), hitAt = new THREE.Vector3(), boxes = boxesOf(parts)
  let closest: { partId: string; distance: number } | null = null
  for (const part of parts.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue
    const box = boxes.get(part.id)
    if (!box || !ray.intersectBox(box, hitAt)
      || !box.containsPoint(sample.pos) && hitAt.distanceTo(sample.pos) >= (closest?.distance ?? threshold)) continue
    const tree = getPartGeometryIndex(mesh, part).tree
    if (!tree) continue
    const hit = tree.raycastFirst(ray, THREE.DoubleSide, 0, closest?.distance ?? threshold)
    if (hit && Number.isFinite(hit.distance) && hit.distance >= 0 && hit.distance < threshold
      && (!closest || hit.distance < closest.distance)) closest = { partId: part.id, distance: hit.distance }
  }
  return closest
}

function closedEndpoint(): BaojiaoEndpoint {
  return { feature: '—', type: '无', subtype: null, rule: '闭合焊缝无暴露端点', wrapAngle: null,
    coll: null, poses: null, offsetDir: null, offsetDist: null, rotDeg: null, scheme: null, movePose: null }
}

function legacyEndpoint(weld: Weld, which: 'start' | 'end', parts: PartsData, mesh: Float32Array,
  schemes: CornerScheme[], options: GeometryActionOptions, extendDistance: number | null): BaojiaoEndpoint {
  const fp = weld.properties[which === 'start' ? '起点特征' : '终点特征'] as Feature | undefined
  const detected = labelOf(fp), feature = weld.parameterAudit && detected === '未识别' ? '普通端点' : detected
  const angle = angleOf(feature, fp), side = endpointWrapSide(weld, which), sample = endpointSample(weld, parts, mesh, which)
  const thickness = thicknessOf(weld, parts, which)
  const base: BaojiaoEndpoint = { feature, type: '不包角', subtype: null, rule: '', wrapAngle: angle,
    wrapSide: side, extendDistance, extendThreshold: options.extendThreshold,
    coll: null, poses: null, offsetDir: null, offsetDist: null, rotDeg: null, scheme: null, movePose: null }
  const matched = (action: 'wrap' | 'pose-change', theta: number | null) => {
    if (!sample) return { scheme: null, variantKey: undefined }
    if (options.schemesEnabled === false) return { scheme: null, variantKey: endpointVariantKey(sample, which, side, action) }
    const hit = matchEndpointScheme(weld, feature, theta, sample, schemes, which, side, action)
    const variant = hit?.scheme.variants[hit.variantKey]
    return { variantKey: endpointVariantKey(sample, which, side, action), scheme: hit && variant
      ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c } : null }
  }
  const boundary = sample ? outwardBoundary(weld, sample, which, parts, mesh, options.extendThreshold) : null
  const preparation: BaojiaoEndpoint | null = boundary ? { ...base, type: '变姿态', wrapAngle: angle && angle > 0 ? angle : 90,
    ...matched('pose-change', angle && angle > 0 ? angle : 90),
    extendDistance: boundary.distance, offsetDist: thickness,
    rule: `沿端点外切线至第三零件 ${boundary.partId} 的几何余量 ${Math.round(boundary.distance * 100) / 100}mm < ${options.extendThreshold}mm → 端点变姿态${options.schemesEnabled === false ? '（独立几何动作）' : '（内角方案）'}` } : null
  const noWrap = feature === '普通端点' || fp?.默认动作 === '不包角'
    || ['平角', '优角', '钝角', '凸圆弧'].includes(feature) || !!(weld.parameterAudit && fp?.包角待确认)
  if (noWrap) return { ...base, rule: `${feature} → 不包角（几何判定）`, ...(preparation ? { poseChange: preparation } : {}) }
  if (feature === '未识别' || fp?.包角待确认 || !sample) return { ...base, type: '待定', subtype: '待定',
    rule: `${feature} → 几何证据不足`, ...(preparation ? { poseChange: preparation } : {}) }
  const explicitSubtype = ['原地包角', '不变姿态包角', '变姿态包角'].includes(fp?.默认动作 ?? '')
    ? fp!.默认动作 as BaojiaoSubtype : null
  const position = sample.weldingPosition ?? weldPositionCode(weld)
  const verticalLimited = !GEOMETRY_WRAP_CAPABILITIES.verticalFullWrap && (position === 'PF' || position === 'PG')
  // A curved relief is not a free straight outer edge. Its feature label alone
  // cannot establish a full wrap; retain half wrap unless explicitly specified.
  const curvedRelief = ['凹圆弧', '长圆弧'].includes(feature) && fp?.默认动作 !== '全包'
  const half = verticalLimited || curvedRelief || feature === 'D圆弧' || fp?.默认动作 === '半包' || explicitSubtype !== null
  const match = matched('wrap', angle)
  const directions = endpointWrapDirections(sample, which, side)
  const variant = match.scheme ? schemes.find((scheme) => scheme.id === match.scheme!.id)?.variants[match.variantKey!] : null
  const distances = options.schemesEnabled === false ? null : variant ?? defaultCornerDistances({ turnAngle: angle ?? 90, leg: weldLegValue(weld),
    thicknessIn: thickness ?? undefined, thicknessOut: thickness ?? undefined })
  const ratio = options.wrapDistanceRatio ?? 2 / 3
  const requested = distances ? which === 'start' ? distances.a : distances.b : (thickness ?? 0) * ratio
  const wrapDistance = thickness && Number.isFinite(ratio) && ratio > 0 && Number.isFinite(requested) && requested >= 0
    ? Math.min(thickness * ratio, requested) : 0
  return { ...base, ...match, type: half ? '半包' : '全包', subtype: half && options.schemesEnabled !== false ? explicitSubtype ?? subtypeOf(angle) : null,
    rule: `${feature} → ${half ? explicitSubtype ?? '半包' : '全包'}（几何判定）${curvedRelief ? '；圆弧缺口默认半包' : ''}${verticalLimited ? `；立焊 ${position} 暂不支持全包，限制为半包` : ''}`,
    offsetDir: directions.wrapDir.toArray(), offsetDist: thickness,
    wrapPathDistance: options.schemesEnabled !== false && explicitSubtype === '原地包角' ? 0 : wrapDistance,
    ...(preparation ? { poseChange: preparation } : {}) }
}

export function decideUnifiedEndpoint(info: UnifiedEndpointInfo, position: string,
  explicitAction?: string, extendThreshold?: number | null, processConfig?: EndpointProcessConfig, jointType = 'T接'): {
    type: BaojiaoEndpoint['type']; subtype: BaojiaoSubtype | null; reason: string
    processDecision?: BaojiaoEndpoint['processDecision']
  } {
  const space = abstractEndpointSpace(info, extendThreshold)
  if (!supportsGeometryAutomaticWrap(position, jointType)) {
    const automatic = processConfig ? { ...decideEndpointProcess(space, processConfig), config: processConfig } : null
    const reason = geometryAutomaticWrapUnavailableReason(position, jointType)
    return { type: '不包角', subtype: null, reason,
      ...(automatic ? { processDecision: { ...automatic,
        status: automatic.status === 'not-applicable' ? 'not-applicable' as const : 'resolved' as const, wrap: 'none' as const,
        action: 'no-wrap' as const,
        travelWrapDistance: false, reason: `${automatic.reason}；${reason}` } } : {}) }
  }
  const vertical = !GEOMETRY_WRAP_CAPABILITIES.verticalFullWrap && ['PF', 'PG'].includes(position)
  if (processConfig) {
    let processDecision: NonNullable<BaojiaoEndpoint['processDecision']> = {
      ...decideEndpointProcess(space, processConfig), config: processConfig,
    }
    if (processDecision.status === 'resolved' && processDecision.wrap === 'full' && vertical) processDecision = {
      ...processDecision, wrap: 'half', action: 'half-wrap-with-pose', postureChange: true,
      reason: `${processDecision.reason}；立焊暂不支持全包，限制为变姿态半包`,
    }
    if (['不包角', '半包', '全包', '原地包角', '不变姿态包角', '变姿态包角'].includes(explicitAction ?? '')) return {
      ...decideUnifiedEndpoint(info, position, explicitAction, extendThreshold, undefined, jointType),
      processDecision: { ...processDecision, manuallyOverridden: true },
    }
    const type = processDecision.status === 'pending' ? '待定' : processDecision.wrap === 'full' ? '全包'
      : processDecision.wrap === 'half' ? '半包' : '不包角'
    return { type, subtype: type === '待定' ? '待定' : type === '半包'
      ? processDecision.postureChange ? '变姿态包角' : '不变姿态包角' : null,
      reason: processDecision.reason, processDecision }
  }
  const explicitSubtype = ['原地包角', '不变姿态包角', '变姿态包角'].includes(explicitAction ?? '')
    ? explicitAction as BaojiaoSubtype : null
  if (explicitAction === '不包角') return { type: '不包角', subtype: null, reason: '明确指定不包角' }
  if (explicitSubtype || explicitAction === '半包' || explicitAction === '全包') {
    const type = explicitAction === '全包' && !vertical ? '全包' : '半包'
    return { type, subtype: type === '半包' ? explicitSubtype ?? subtypeOf(info.turnAngleDeg) : null,
      reason: `明确指定${explicitSubtype ?? explicitAction}${vertical && explicitAction === '全包' ? '；立焊暂不支持全包，限制半包' : ''}` }
  }
  if (space.isEndpoint === false) return {
    type: '不包角', subtype: null, reason: '当前接头沿实际支撑边界连续延续，无暴露绕板端点' }
  if (space.isEndpoint === null) return {
    type: '待定', subtype: '待定', reason: '端部让位空间或边界连通性证据不足' }
  // The compact endpoint class/opening dimensions drive the process choice.
  // Complete CAD connectivity remains proof for traversing the entire thickness.
  const full = info.status === 'verified' && space.endpointType === '自由端' && space.passHoleSize === null
    && info.sidesConnected === true && info.thicknessMm !== null && info.thicknessMm > 0
    && info.wrapAvailableMm !== null && info.wrapAvailableMm >= info.thicknessMm - 0.1
  if (full && !vertical) return { type: '全包', subtype: null,
    reason: '自由端无过焊孔，两侧接头连续连通，已验证板厚方向完整绕行长度' }
  if (info.wrapAvailableMm === null) return { type: '待定', subtype: '待定', reason: '包角方向可通行长度未验证' }
  const stationary = info.wrapAvailableMm <= 0.01
  return { type: '半包', subtype: stationary ? '原地包角' : subtypeOf(info.turnAngleDeg),
    reason: `${stationary ? '端部包角方向无通行长度，原地焊接' : space.endpointType === '干涉端' ? '干涉端默认半包，变姿态后的完整全包路线尚未验证' : space.passHoleSize ? '过焊孔提供局部通行空间，采用半包' : '端边具备局部绕行空间，自动全包条件尚未全部验证，采用半包'}${vertical ? '；立焊暂不支持全包' : ''}` }
}

function endpoint(weld: Weld, which: 'start' | 'end', parts: PartsData, mesh: Float32Array,
  schemes: CornerScheme[], options: GeometryActionOptions, extendDistance: number | null): BaojiaoEndpoint {
  if (options.endpointRule === 'legacy' || !GEOMETRY_ENDPOINT_RULES.unified) return limitGeometryAutomaticWrap(
    legacyEndpoint(weld, which, parts, mesh, schemes, options, extendDistance), weldPositionCode(weld), weld.jointType)
  const measured = measureEndpointClearance(weld, which, parts, mesh, options.edgesData,
    { extendThreshold: options.extendThreshold, axialClearanceMm: extendDistance })
  // A division inside the original contact path is geometric provenance. It
  // does not introduce an opening in the plate, regardless of old labels.
  const interior = (weld.properties.几何内部端点 as { start?: boolean; end?: boolean } | undefined)?.[which] === true
  const contact = (weld.properties.几何干涉端点 as Partial<Record<'start' | 'end', { partId: string | null }>> | undefined)?.[which]
  const info: UnifiedEndpointInfo = contact ? { ...measured, offsetSubplateContact: contact,
    basis: [...measured.basis, `端点由 offset 方向实体 ${contact.partId ?? '未命名零件'} 与副板直接接触的几何打断产生`],
    summary: `${measured.summary}；offset 方向实体与副板直接接触，该打断端点为干涉端`,
  } : interior ? { ...measured,
    status: measured.status === 'unknown' ? 'partial' : measured.status,
    kind: 'interior', geometryConnection: 'continuous',
    basis: [...measured.basis, '端点来自原接头焊道内部的几何分段，未形成新的板厚端边'],
    summary: `${measured.summary}；原接头内部打断点，接头几何向外延续`,
  } : measured
  const fp = weld.properties[which === 'start' ? '起点特征' : '终点特征'] as Feature | undefined
  const sample = endpointSample(weld, parts, mesh, which), side = info.wrapSide
  const position = sample?.weldingPosition ?? weldPositionCode(weld)
  const space = abstractEndpointSpace(info, options.extendThreshold)
  // The configured diagram replaces old CAD-derived action defaults. Actual
  // property-panel edits are applied afterwards and retain their priority.
  const legacyDefault = interior || options.endpointProcessConfig ? undefined : fp?.默认动作
  const decision = decideUnifiedEndpoint(info, position, legacyDefault, options.extendThreshold, options.endpointProcessConfig, weld.jointType)
  const base: BaojiaoEndpoint = { feature: labelOf(fp), type: decision.type,
    subtype: options.schemesEnabled === false && decision.type === '半包' ? null : decision.subtype,
    unifiedInfo: info, rule: `${space.summary} → ${decision.reason}`,
    ...(decision.processDecision ? { processDecision: decision.processDecision } : {}),
    wrapAngle: info.turnAngleDeg, wrapSide: side, extendDistance: info.axialClearanceMm,
    extendThreshold: options.extendThreshold, coll: null, poses: null, offsetDir: null,
    offsetDist: info.thicknessMm, rotDeg: null, scheme: null, movePose: null }
  const matched = (action: 'wrap' | 'pose-change', angle: number | null) => {
    if (!sample) return { scheme: null, variantKey: undefined }
    if (options.schemesEnabled === false) return { scheme: null, variantKey: endpointVariantKey(sample, which, side, action) }
    const hit = matchEndpointScheme(weld, '端部让位', angle, sample, schemes, which, side, action)
    const variant = hit?.scheme.variants[hit.variantKey]
    return { variantKey: endpointVariantKey(sample, which, side, action), scheme: hit && variant
      ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c } : null }
  }
  const obstacle = endpointAxialObstacle(info, options.extendThreshold), threshold = options.extendThreshold
  const process = decision.processDecision ?? null
  if (process ? process.postureChange === true : !!obstacle && space.interference.axial) {
    // The preparation angle is obtained from the local weld/material frame,
    // even when a straight continuation has no exterior wrapping turn.
    const frameAngle = sample ? Math.acos(THREE.MathUtils.clamp(sample.tangent.clone().normalize().dot(
      endpointWrapDirections(sample, which, side).wrapDir), -1, 1)) * 180 / Math.PI : null
    const angle = info.turnAngleDeg !== null && info.turnAngleDeg > 0 ? info.turnAngleDeg : frameAngle
    base.poseChange = { ...base, type: '变姿态', subtype: null, wrapAngle: angle,
      ...matched('pose-change', angle), extendDistance: obstacle?.distance ?? info.axialClearanceMm,
      rule: process ? `不缓焊端点规则 → ${process.reason}`
        : `统一端部信息 → ${obstacle!.source === 'joint' ? '接头板回入材料' : '第三零件'} ${obstacle!.partId} 几何余量 ${Math.round(obstacle!.distance * 100) / 100}mm < ${threshold}mm，端点变姿态${options.schemesEnabled === false ? '（独立几何动作）' : '（内角方案）'}` }
  }
  if (!sample || !['全包', '半包'].includes(base.type)) return { ...base, wrapPathDistance: 0 }
  const match = matched('wrap', info.turnAngleDeg), directions = endpointWrapDirections(sample, which, side)
  const variant = match.scheme ? schemes.find((scheme) => scheme.id === match.scheme!.id)?.variants[match.variantKey!] : null
  const distances = options.schemesEnabled === false ? null : variant ?? defaultCornerDistances({ turnAngle: info.turnAngleDeg ?? 90,
    leg: weldLegValue(weld), thicknessIn: info.thicknessMm ?? undefined, thicknessOut: info.thicknessMm ?? undefined })
  const ratio = options.wrapDistanceRatio ?? 2 / 3
  const requested = distances ? which === 'start' ? distances.a : distances.b : (info.thicknessMm ?? 0) * ratio
  const distance = info.thicknessMm && ratio > 0 && Number.isFinite(ratio) && requested >= 0 && Number.isFinite(requested)
    ? Math.min(info.thicknessMm * ratio, requested, info.wrapAvailableMm ?? 0) : 0
  return { ...base, ...match, offsetDir: directions.wrapDir.toArray(),
    wrapPathDistance: base.subtype === '原地包角' || !process?.manuallyOverridden && process?.travelWrapDistance === false ? 0 : distance }
}

/** Geometry-only counterpart of the retained tool-aware analyzer. */
export function computeGeometryWeldBaojiao(weld: Weld, partsData: PartsData, mesh: Float32Array,
  schemes: CornerScheme[] = [], split?: WeldSplit,
  options: GeometryActionOptions = { extendThreshold: null }): WeldBaojiao {
  if (weld.closed && !split?.subWelds.some((sub) => !sub.closed)) return {
    closed: true, 起点: closedEndpoint(), 终点: closedEndpoint() }
  const current = weldWithExtensions(weld, split), distances = ownBoundaryDistances(current, options.edgesData, split)
  const result: WeldBaojiao = { closed: weld.closed,
    起点: weld.closed ? closedEndpoint() : endpoint(current, 'start', partsData, mesh, schemes, options, distances.start),
    终点: weld.closed ? closedEndpoint() : endpoint(current, 'end', partsData, mesh, schemes, options, distances.end) }
  if (split?.weldId === weld.id && split.subWelds.some((sub) => sub.起点来源.类型 === '打断点' || sub.终点来源.类型 === '打断点')) {
    result.bySubWeld = {}
    for (const [index, sub] of split.subWelds.entries()) {
      const local: Weld = { ...current, closed: sub.closed, start: sub.start, end: sub.end, length: sub.length,
        jointType: (sub.geometryProperties?.接头形式 as { 类型?: string } | undefined)?.类型 ?? current.jointType,
        segments: [{ ...weld.segments[0], start: sub.start, end: sub.end, points: sub.points, length: sub.length }],
        properties: { ...current.properties, ...sub.geometryProperties, 间隙检测: {},
          几何干涉端点: subplateContactEndpointEvidence(sub),
          起点特征: sub.起点来源.类型 === '打断点' ? { 特征类型: '平角' } : split.startFeature ?? current.properties.起点特征,
          终点特征: sub.终点来源.类型 === '打断点' ? { 特征类型: '平角' } : split.endFeature ?? current.properties.终点特征,
          几何内部端点: { start: sub.起点来源.类型 === '打断点', end: sub.终点来源.类型 === '打断点' } } }
      const localDistances = ownBoundaryDistances(local, options.edgesData)
      const sourcePosition = current.properties.焊接位置 as { 代号?: string } | undefined
      const localPosition = local.properties.焊接位置 as { 代号?: string } | undefined
      const localJoint = local.properties.接头形式 as { 类型?: string } | undefined
      const sourceJoint = current.properties.接头形式 as { 类型?: string } | undefined
      const metadataChanged = local.properties.焊脚 !== current.properties.焊脚
        || localPosition?.代号 !== sourcePosition?.代号 || localJoint?.类型 !== sourceJoint?.类型
      const at = (which: 'start' | 'end') => sub[which === 'start' ? '起点来源' : '终点来源'].类型 !== '打断点' && !metadataChanged
        ? result[which === 'start' ? '起点' : '终点'] : sub.closed ? closedEndpoint()
          : endpoint(local, which, partsData, mesh, schemes, options, localDistances[which])
      result.bySubWeld[index] = { 起点: at('start'), 终点: at('end') }
    }
  }
  return result
}

/** Same stable ids as the full-mode schemes; no tool-pose defaults are solved. */
export function createGeometryPositionDefaultSchemes(modelKey: string, weldsData: WeldsData, partsData: PartsData): CornerScheme[] {
  const positions = [...new Set(weldsData.welds.map(weldPositionCode))]
    .sort((a, b) => POSITION_CODES.indexOf(a) - POSITION_CODES.indexOf(b))
  const median = (numbers: number[], fallback: number) => {
    const values = numbers.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b), i = Math.floor(values.length / 2)
    return !values.length ? fallback : values.length % 2 ? values[i] : (values[i - 1] + values[i]) / 2
  }
  return positions.map((position) => {
    const welds = weldsData.welds.filter((weld) => weldPositionCode(weld) === position)
    const leg = median(welds.map(weldLegValue), 8)
    const thickness = median(welds.map((weld) => partsData.parts.find((part) => part.id === weld.subPartId)?.thickness ?? 0), 0)
    const distances = defaultCornerDistances({ turnAngle: 90, leg, thicknessIn: thickness, thicknessOut: thickness })
    return { id: `CD:${modelKey}:${position}`, name: `${position === '—' ? '倾斜焊' : position} · 默认转角方案`,
      match: { 位置1: position, 位置2: position, 焊脚: [leg], 接头形式: welds[0].jointType,
        夹角min: 0, 夹角max: 180, 坡口: [...new Set(welds.map(weldGroove))] },
      variants: Object.fromEntries(CORNER_VARIANT_KEYS.map((key) => [key, { ...emptyVariant(), ...distances }])) as CornerScheme['variants'],
      positionDefault: { modelKey, position,
        basis: `焊脚中位数 ${Math.round(leg * 100) / 100}mm；板厚中位数 ${Math.round(thickness * 100) / 100}mm；90°几何模板，距离 r×tan(θ/2)，c=0`,
        sources: Object.fromEntries(CORNER_VARIANT_KEYS.map((key) => [key, 'template'])) as NonNullable<CornerScheme['positionDefault']>['sources'] } }
  })
}

interface GeometryEndpoint { weld: Weld; ep: BaojiaoEndpoint; which: 'start' | 'end' }
export interface GeometryEndpointContext {
  weldsData: WeldsData; partsData: PartsData; mesh: Float32Array
  splits: Map<string, WeldSplit> | null; merges: MergeResult | null; schemes: CornerScheme[]
  options?: Pick<GeometryActionOptions, 'schemesEnabled' | 'wrapDistanceRatio'>
}

/** Suppress applied library metadata while preserving the independent geometry
 * and endpoint preparation. Stored choices remain untouched for restoration. */
export function withoutGeometryEndpointSchemes(ep: BaojiaoEndpoint, ratio = 2 / 3): BaojiaoEndpoint {
  const next = { ...ep, scheme: null }
  delete next.geometryManualScheme
  if (next.type === '半包') next.subtype = null
  const wrap = ['全包', '半包'].includes(next.type)
  const travel = !next.processDecision || next.processDecision.manuallyOverridden || next.processDecision.travelWrapDistance !== false
  next.wrapPathDistance = wrap && travel && next.offsetDist !== null && Number.isFinite(next.offsetDist)
    && Number.isFinite(ratio) && ratio > 0 ? Math.max(0, Math.min(next.offsetDist * ratio, next.unifiedInfo?.wrapAvailableMm ?? 0)) : 0
  if (ep.poseChange) next.poseChange = withoutGeometryEndpointSchemes(ep.poseChange, ratio)
  return next
}

/** Include a closed chain's final-to-first junction without changing the
 * retained full-mode matcher. CAD/native tangents still suppress G1 arc joins;
 * individual tessellation chords are never treated as extra turn points. */
export function computeGeometryCornerInstances(merges: MergeResult | null, weldsData: WeldsData,
  partsData: PartsData, mesh: Float32Array, schemes: CornerScheme[],
  options?: Pick<GeometryActionOptions, 'schemesEnabled' | 'edgesData' | 'thicknessWeldThresholdMm'>): CornerInstance[] {
  const position = (code: string, direction: number[]) => (code === 'PF' || code === 'PG') && Math.abs(direction[2]) > 1e-8
    ? direction[2] < 0 ? 'PG' : 'PF' : code
  const cyclic = merges ? { ...merges, groups: merges.groups.filter(group => !group.geometryBoundary).map((group) => group.closed && group.members.length > 1
    ? { ...group, members: [...group.members, group.members[0]] } : group) } : null
  const ordinary = computeCornerInstances(cyclic, weldsData, partsData, mesh, schemes, undefined, options).filter(corner => {
    const group = merges?.groups.find(item => item.id === corner.groupId)
    return !group || keepsThicknessMemberCorner(group, weldsData.welds, partsData,
      corner.memberIndex, (corner.memberIndex + 1) % group.members.length, options?.thicknessWeldThresholdMm)
  }).map((corner) => {
    const group = merges?.groups.find((item) => item.id === corner.groupId)
    const m1 = group?.members[corner.memberIndex], m2 = group?.members[(corner.memberIndex + 1) % group.members.length]
    const feature = { ...corner.feature,
      位置1: position(m1?.weldingPosition ?? corner.feature.位置1, corner.d1),
      位置2: position(m2?.weldingPosition ?? corner.feature.位置2, corner.d2),
      焊脚: [m1?.焊脚 ?? corner.feature.焊脚[0], m2?.焊脚 ?? corner.feature.焊脚[1]] as [number, number],
      接头形式: [m1?.jointType ?? corner.feature.接头形式[0], m2?.jointType ?? corner.feature.接头形式[1]] as [string, string] }
    if (JSON.stringify(feature) === JSON.stringify(corner.feature)) return corner
    if (options?.schemesEnabled === false) return { ...corner, feature }
    const hit = matchScheme(schemes, feature), variant = hit.scheme?.variants[corner.variantKey]
    return { ...corner, feature,
      match: hit.scheme ? { id: hit.scheme.id, name: hit.scheme.name } : null,
      未匹配原因: hit.scheme ? null : hit.reason,
      applied: variant ? { a: variant.a, b: variant.b, c: variant.c, ...cornerPoints(
        new THREE.Vector3().fromArray(corner.pos), new THREE.Vector3().fromArray(corner.d1),
        new THREE.Vector3().fromArray(corner.d2), variant.a, variant.b, variant.c) } : null }
  })
  const byGroup = new Map<string, CornerInstance[]>()
  for (const corner of ordinary) {
    const items = byGroup.get(corner.groupId)
    if (items) items.push(corner)
    else byGroup.set(corner.groupId, [corner])
  }
  const weldById = new Map(weldsData.welds.map(weld => [weld.id, weld]))
  const round = (vector: THREE.Vector3) => vector.toArray().map(value => Math.round(value * 100) / 100 || 0)
  for (const group of merges?.groups ?? []) {
    if (!group.geometryBoundary) continue
    const sources = [...new Set(group.members.map(member => member.weldId))].flatMap(id => weldById.get(id) ?? [])
    const rawMeasured = geometryBoundaryCadCorners(group, sources, options?.edgesData)
    const measured = rawMeasured && filterThicknessWrapCorners(rawMeasured, group, partsData, options?.thicknessWeldThresholdMm)
    const corners: CornerInstance[] = []
    const entry = measured?.find(item => !item.incomingBoundaryId && item.outgoingBoundaryId)
    const exit = measured?.find(item => item.incomingBoundaryId && !item.outgoingBoundaryId)
    const outward = entry?.d1 ?? exit?.d2.map(value => -value)
    const faceNormal = outward ? geometryWrapBoundaryFaceNormal(group.geometryBoundary, options?.edgesData, outward) : null
    // A missing current CAD proof cannot fall back to a sampled arc chord.
    // [] from the resolver deliberately means a wholly G1-smooth join.
    for (const [index, item] of (measured ?? []).entries()) {
      const m1 = group.members[item.incomingMemberIndex], m2 = group.members[item.outgoingMemberIndex]
      const w1 = m1 && weldById.get(m1.weldId), w2 = m2 && weldById.get(m2.weldId)
      if (!m1 || !m2 || !w1 || !w2) continue
      const pos = new THREE.Vector3().fromArray(item.pos), d1 = new THREE.Vector3().fromArray(item.d1).normalize(),
        d2 = new THREE.Vector3().fromArray(item.d2).normalize()
      const angle = Math.round(Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1)) * 1800 / Math.PI) / 10
      if (angle < 1) continue
      const n1 = weldNormalsAt(w1, partsData, mesh, item.pos as [number, number, number]),
        n2 = weldNormalsAt(w2, partsData, mesh, item.pos as [number, number, number])
      const boundaryNormals = (normals: typeof n1, weld: Weld, boundaryId: string | undefined) => {
        if (!boundaryId || !faceNormal) return normals
        const normal = new THREE.Vector3().fromArray(faceNormal)
        return { nMain: weld.mainPartId === group.geometryBoundary!.partId ? normal : normals.nMain,
          nSub: weld.subPartId === group.geometryBoundary!.partId ? normal : normals.nSub }
      }
      const incomingNormals = boundaryNormals(n1, w1, item.incomingBoundaryId),
        outgoingNormals = boundaryNormals(n2, w2, item.outgoingBoundaryId)
      const classification = classifyCorner(d1, d2, incomingNormals.nMain.clone().add(incomingNormals.nSub),
        outgoingNormals.nMain.clone().add(outgoingNormals.nSub))
      const nMain = incomingNormals.nMain.clone().add(outgoingNormals.nMain), nSub = incomingNormals.nSub.clone().add(outgoingNormals.nSub)
      const feature: CornerInstance['feature'] = { 位置1: position(m1.weldingPosition ?? weldPositionCode(w1), item.d1),
        位置2: position(m2.weldingPosition ?? weldPositionCode(w2), item.d2), 焊脚: [m1.焊脚, m2.焊脚], 接头形式: [m1.jointType, m2.jointType],
        夹角: angle, 坡口: [weldGroove(w1), weldGroove(w2)] }
      const hit = options?.schemesEnabled === false ? { scheme: null, reason: null } : matchScheme(schemes, feature)
      const variant = hit.scheme?.variants[classification.key]
      corners.push({ id: `${group.id}#cad:${index}`, groupId: group.id, memberIndex: item.memberIndex,
        fromId: m1.id, toId: m2.id, pos: round(pos), d1: round(d1), d2: round(d2),
        nMain: round(nMain.lengthSq() > 1e-9 ? nMain.normalize() : n1.nMain),
        nSub: round(nSub.lengthSq() > 1e-9 ? nSub.normalize() : n1.nSub), feature, variantKey: classification.key,
        判定依据: `真实 CAD 边界接点；${classification.依据}${hit.scheme?.positionDefault ? `；${defaultSchemeUsage(hit.scheme, feature)}` : ''}`,
        overridden: false, match: hit.scheme ? { id: hit.scheme.id, name: hit.scheme.name } : null,
        未匹配原因: hit.scheme ? null : hit.reason,
        applied: variant ? { a: variant.a, b: variant.b, c: variant.c, ...cornerPoints(pos, d1, d2, variant.a, variant.b, variant.c) } : null })
    }
    byGroup.set(group.id, corners)
  }
  return (merges?.groups ?? []).flatMap(group => {
    const corners = byGroup.get(group.id) ?? []
    if (group.closed) return corners
    const start = new THREE.Vector3().fromArray(group.start), end = new THREE.Vector3().fromArray(group.end)
    return corners.filter(corner => {
      const point = new THREE.Vector3().fromArray(corner.pos)
      return point.distanceTo(start) > FINITE_INTERVAL_JOIN_TOLERANCE && point.distanceTo(end) > FINITE_INTERVAL_JOIN_TOLERANCE
    })
  })
}

function rematch(ep: BaojiaoEndpoint, geometry: Weld, which: 'start' | 'end', sourceWhich: 'start' | 'end',
  source: Weld, context: GeometryEndpointContext): BaojiaoEndpoint {
  const sample = endpointSample(geometry, context.partsData, context.mesh, which)
  const finish = (value: BaojiaoEndpoint) => limitGeometryAutomaticWrap(value,
    sample?.weldingPosition ?? weldPositionCode(geometry), geometry.jointType)
  if (!sample) return finish(context.options?.schemesEnabled === false ? withoutGeometryEndpointSchemes(ep, context.options.wrapDistanceRatio) : ep)
  const side = ep.wrapSide ?? endpointWrapSide(source, sourceWhich)
  if (context.options?.schemesEnabled === false) {
    const clean = withoutGeometryEndpointSchemes(ep, context.options.wrapDistanceRatio)
    return finish({ ...clean, wrapSide: side, variantKey: endpointVariantKey(sample, which, side, 'wrap'),
      ...(clean.poseChange ? { poseChange: { ...clean.poseChange,
        variantKey: endpointVariantKey(sample, which, side, 'pose-change') } } : {}) })
  }
  const position = source.properties.焊接位置 as Record<string, unknown> | undefined
  const matchingWeld = sample.weldingPosition && sample.weldingPosition !== position?.代号
    ? { ...source, properties: { ...source.properties, 焊接位置: { ...position, 代号: sample.weldingPosition } } } : source
  const update = (action: BaojiaoEndpoint, kind: 'wrap' | 'pose-change') => {
    if (action.geometryManualScheme) return action
    const hit = matchEndpointScheme(matchingWeld, action.feature, action.wrapAngle, sample, context.schemes, which, side, kind)
    const variant = hit?.scheme.variants[hit.variantKey]
    return { ...action, wrapSide: side, variantKey: endpointVariantKey(sample, which, side, kind),
      scheme: hit && variant ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c } : null }
  }
  return finish({ ...update(ep, ep.type === '变姿态' ? 'pose-change' : 'wrap'),
    ...(ep.poseChange ? { poseChange: update(ep.poseChange, 'pose-change') } : {}) })
}

/** Resolve only exposed geometric endpoints, including reversed merge chains. */
export function geometryTargetEndpoints(target: DemoTarget, context: GeometryEndpointContext, result: BaojiaoResult):
  { start: GeometryEndpoint | null; end: GeometryEndpoint | null } {
  const find = (weldId: string, subIndex?: number) => {
    const weld = context.weldsData.welds.find((candidate) => candidate.id === weldId), wb = result.byWeld.get(weldId)
    if (!weld || !wb) return null
    return { weld, eps: subIndex !== undefined ? wb.bySubWeld?.[subIndex] ?? wb : wb }
  }
  const current = (ep: BaojiaoEndpoint, weld: Weld, properties = weld.properties) => {
    const position = properties.焊接位置 as { 代号?: string } | undefined
    const joint = properties.接头形式 as { 类型?: string } | undefined
    const limited = limitGeometryAutomaticWrap(ep, position?.代号 ?? weldPositionCode(weld), joint?.类型 ?? weld.jointType)
    return context.options?.schemesEnabled === false
      ? withoutGeometryEndpointSchemes(limited, context.options.wrapDistanceRatio) : limited
  }
  if (target.kind !== 'merge') {
    const found = target.weldId ? find(target.weldId, target.kind === 'subweld' ? target.subIndex : undefined) : null
    const properties = found && target.kind === 'subweld' && target.subIndex !== undefined
      ? context.splits?.get(found.weld.id)?.subWelds[target.subIndex]?.geometryProperties : undefined
    return found ? { start: { weld: found.weld, ep: current(found.eps.起点, found.weld, properties), which: 'start' },
      end: { weld: found.weld, ep: current(found.eps.终点, found.weld, properties), which: 'end' } } : { start: null, end: null }
  }
  const group = context.merges?.groups.find((candidate) => candidate.id === target.mergeId)
  if (!group || group.closed || !group.members.length) return { start: null, end: null }
  const manual = result.geometryMergeEndpoints?.[group.id]
  if (manual) {
    const first = context.weldsData.welds.find((weld) => weld.id === group.members[0].weldId)
    const last = context.weldsData.welds.find((weld) => weld.id === group.members.at(-1)!.weldId)
    if (first && last) {
      return { start: { weld: first, ep: current(manual.起点, first, group.geometryProperties), which: 'start' },
        end: { weld: last, ep: current(manual.终点, last, group.geometryProperties), which: 'end' } }
    }
  }
  const at = (which: 'start' | 'end'): GeometryEndpoint | null => {
    const member = which === 'start' ? group.members[0] : group.members.at(-1)!, found = find(member.weldId, member.subIndex)
    if (!found) return null
    const sub = context.splits?.get(member.weldId)?.subWelds[member.subIndex]
    const sourceStart = sub?.start ?? found.weld.start, sourceEnd = sub?.end ?? found.weld.end
    const exposed = new THREE.Vector3().fromArray(group[which])
    const sourceWhich = exposed.distanceToSquared(new THREE.Vector3().fromArray(sourceStart))
      <= exposed.distanceToSquared(new THREE.Vector3().fromArray(sourceEnd)) ? 'start' : 'end'
    const ep = found.eps[sourceWhich === 'start' ? '起点' : '终点']
    const properties = group.geometryProperties ?? sub?.geometryProperties ?? found.weld.properties
    const geometry: Weld = { ...found.weld, jointType: member.jointType,
      properties: { ...properties, 焊接位置: { ...(properties.焊接位置 as object), 代号: member.weldingPosition ?? weldPositionCode(found.weld) } },
      start: member.start.toArray(), end: member.end.toArray(),
      segments: [{ ...found.weld.segments[0], start: member.start.toArray(), end: member.end.toArray(), points: member.points, length: member.length }] }
    return { weld: found.weld, ep: rematch(ep, geometry, which, sourceWhich, found.weld, context), which }
  }
  return { start: at('start'), end: at('end') }
}
