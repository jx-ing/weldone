import * as THREE from 'three'
import type { EdgesData, PartsData, Weld, WeldsData } from '@/types/weld'
import { extendedEndpointFeature, isWeldExtensionSupported, isWeldSpanSupported, type EndpointFeature } from './endpointFeatures'
import { collarGapPlanning } from './collarGapPlanning'
import { lugOuterContour } from './lugContours'
import { getSubplateOffsetContacts } from './subplateOffsetContact'
import {
  computeAxialDetection, computeBoundaryOffsetSpans, computePerpendicularDetection, getPartMesh, hasSemanticBoundaries, weldPolyline,
  type AxialResult, type PerpendicularResult,
} from './gapDetection'

/** Changes to geometric decisions invalidate both cached welds and UI snapshots. */
export const WELD_SPLIT_ALGORITHM_REVISION = 9

/**
 * 焊缝打断 (split) —— 按用户规则图对焊缝折线实时打断, 纯前端派生数据, 不写回 welds.json
 *
 * 四类触发:
 *  extend小于阈值: 实时沿端点向外轴线的首次边界命中距离 < extend 检测阈值
 *                  → 端点延伸到对应关联点
 *  extend接触副板: 端点沿轴线方向射线 (0, d] 命中零件 X 且 X 与副板直接接触 (contacts.json)
 *                  → 端点延伸到命中点
 *  offset小于阈值: offset「接触」段最小接触距离 < offset 检测阈值, 或真实边界连续线段
 *                  进入阈值范围 → 近距区间的投影跨度两端成为内部打断点
 *  offset接触副板: offset 方向实体 X 与副板实际直接接触 (不受检测距离及阈值限制)
 *                  → 投影跨度两端成为内部打断点
 *
 * 阈值未启用 (null) 时对应的"小于阈值"规则不触发；offset 接触副板独立核验实体几何。
 */

export type SplitRule =
  | 'extend小于阈值'
  | 'extend接触副板'
  | 'offset小于阈值'
  | 'offset接触副板'

export interface SplitTrigger {
  规则: SplitRule
  /** 关联零件 id; extend小于阈值 无关联零件 (null) */
  关联零件: string | null
  /** 触发距离: extend=端点最近距离或命中距离; offset=接触距离或孔/边缘距离 */
  距离: number
  /** Actual subplate/third-part contact, detected independently of thresholds. */
  subplateContact?: true
}

export interface SplitPoint extends SplitTrigger {
  /** 弧长参数 (在延伸后的折线上, mm) */
  s: number
  位置: number[]
}

export interface SubWeldEndSource {
  类型: '原焊缝起点' | '原焊缝终点' | '打断点'
  /** 原端点被 extend 规则延伸时记录 */
  延伸?: (SplitTrigger & { 延伸到: number[] }) | null
  /** 打断点时记录触发信息 */
  触发?: SplitTrigger
}

export interface SubWeld {
  id: string
  index: number // 1-based, 按弧长排序
  length: number
  closed: boolean
  start: number[]
  end: number[]
  startTangent: number[]
  endTangent: number[]
  /** 子折线点 (模型坐标) */
  points: number[][]
  起点来源: SubWeldEndSource
  终点来源: SubWeldEndSource
  /** Pure geometry edits are scoped to this child, preserving source data. */
  geometryProperties?: Record<string, unknown>
  geometryOriginalStart?: number[]
  geometryOriginalEnd?: number[]
  geometryOriginalPoints?: number[][]
  geometryEdited?: boolean
  /** Pure geometry exclusion: a finite third-part offset contact covers this
   * whole interval. Keep the raw interval/index for provenance and editing. */
  geometryObstruction?: { partIds: string[]; directions: string[]; minimumDistanceMm: number }
  /** A short, supported surviving terminal reaches the original CAD boundary. */
  geometryRetainTerminal?: boolean
}

export function subplateContactEndpointEvidence(sub: SubWeld) {
  const evidence: Partial<Record<'start' | 'end', { partId: string | null }>> = {}
  for (const which of ['start', 'end'] as const) {
    const original = which === 'start' ? sub.geometryOriginalStart : sub.geometryOriginalEnd
    if (original && original.some((coordinate, axis) => Math.abs(coordinate - sub[which][axis]) > .02)) continue
    const source = sub[which === 'start' ? '起点来源' : '终点来源']
    if (source.类型 === '打断点' && source.触发?.subplateContact)
      evidence[which] = { partId: source.触发.关联零件 }
  }
  return evidence
}

export interface WeldSplit {
  algorithmRevision?: number
  weldId: string
  splitPoints: SplitPoint[]
  subWelds: SubWeld[]
  startExtension: (SplitTrigger & { 延伸到: number[] }) | null
  endExtension: (SplitTrigger & { 延伸到: number[] }) | null
  /** Extended endpoints are classified at the actual displayed coordinate. */
  startFeature?: EndpointFeature
  endFeature?: EndpointFeature
}

/** Cropping a covered interval keeps its obstruction proof; native-edge tail
 * protection follows only children that still contain that real outer end. */
export function inheritedGeometrySplitEvidence(sub: SubWeld, points: number[][]): Pick<SubWeld, 'geometryObstruction' | 'geometryRetainTerminal'> {
  const retains = (point: number[]) => [points[0], points.at(-1)].some(end => end
    && end.reduce((sum, value, index) => sum + (value - point[index]) ** 2, 0) <= .02 ** 2)
  return { geometryObstruction: sub.geometryObstruction,
    geometryRetainTerminal: sub.geometryRetainTerminal && (
      sub.起点来源.类型 === '原焊缝起点' && retains(sub.start)
      || sub.终点来源.类型 === '原焊缝终点' && retains(sub.end)) || undefined }
}

export interface SplitSummary {
  焊缝总数: number
  被打断焊缝数: number
  打断后总段数: number
}

const EXT_EPS = 0.1 // mm, extend 射线起点偏移
const MERGE_EPS = 1.0 // mm, 打断点弧长去重窗口
const END_EPS = 0.5 // mm, 距端点不足该值的打断点忽略 (避免零长子焊缝)

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

// --------------------------------------------- offset 检测结果缓存 (按焊缝+检测距离)
const perpCache = new WeakMap<Float32Array,
  WeakMap<PartsData, WeakMap<EdgesData, WeakMap<Weld, Map<number, PerpendicularResult>>>>>()

export function getPerpCached(
  weld: Weld,
  meshData: Float32Array,
  partsData: PartsData,
  edgesData: EdgesData,
  offset: number,
): PerpendicularResult {
  let byParts = perpCache.get(meshData)
  if (!byParts) { byParts = new WeakMap(); perpCache.set(meshData, byParts) }
  let byEdges = byParts.get(partsData)
  if (!byEdges) { byEdges = new WeakMap(); byParts.set(partsData, byEdges) }
  let m = byEdges.get(edgesData)
  if (!m) {
    m = new WeakMap()
    byEdges.set(edgesData, m)
  }
  let byOffset = m.get(weld)
  if (!byOffset) {
    byOffset = new Map()
    m.set(weld, byOffset)
  }
  let res = byOffset.get(offset)
  if (!res) {
    res = computePerpendicularDetection(weld, meshData, partsData, edgesData, offset)
    if (byOffset.size >= 8) byOffset.delete(byOffset.keys().next().value!)
    byOffset.set(offset, res)
  }
  return res
}

// ---------------------------------------------------------------- 折线工具

/** 累计弧长 */
function cumLengths(poly: THREE.Vector3[]): number[] {
  const cum = [0]
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + poly[i].distanceTo(poly[i - 1]))
  return cum
}

/** 弧长 s 处的插值点与所在段切向 */
function pointAt(poly: THREE.Vector3[], cum: number[], s: number): {
  p: THREE.Vector3
  t: THREE.Vector3
} {
  const L = cum[cum.length - 1]
  const sc = Math.max(0, Math.min(L, s))
  let i = 0
  while (i < cum.length - 2 && cum[i + 1] < sc) i++
  const segLen = cum[i + 1] - cum[i]
  const t = segLen > 1e-9
    ? new THREE.Vector3().subVectors(poly[i + 1], poly[i]).normalize()
    : new THREE.Vector3(1, 0, 0)
  const k = segLen > 1e-9 ? (sc - cum[i]) / segLen : 0
  return { p: poly[i].clone().addScaledVector(t, k * segLen), t }
}

/** 空间点投影到折线: 最近点弧长/位置/距离 */
function projectToPolyline(pt: THREE.Vector3, poly: THREE.Vector3[], cum: number[]): {
  s: number
  point: THREE.Vector3
  dist: number
} {
  let best = Infinity
  let bestS = 0
  const bestPt = new THREE.Vector3()
  const a = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const proj = new THREE.Vector3()
  for (let i = 0; i < poly.length - 1; i++) {
    ab.subVectors(poly[i + 1], poly[i])
    const len2 = ab.lengthSq()
    let t = 0
    if (len2 > 1e-12) {
      a.subVectors(pt, poly[i])
      t = Math.max(0, Math.min(1, a.dot(ab) / len2))
    }
    proj.copy(poly[i]).addScaledVector(ab, t)
    const d = proj.distanceTo(pt)
    if (d < best) {
      best = d
      bestS = cum[i] + Math.sqrt(len2) * t
      bestPt.copy(proj)
    }
  }
  return { s: bestS, point: bestPt, dist: best }
}

/** 切出 [s0, s1] 区间的子折线 */
function cutPolyline(poly: THREE.Vector3[], cum: number[], s0: number, s1: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [pointAt(poly, cum, s0).p]
  for (let i = 0; i < poly.length; i++) {
    if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) out.push(poly[i].clone())
  }
  const endP = pointAt(poly, cum, s1).p
  if (out[out.length - 1].distanceToSquared(endP) > 1e-12) out.push(endP)
  return out
}

// ---------------------------------------------------------------- extend 规则

const isVec3 = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')

interface ExtCandidate extends SplitTrigger {
  延伸到: number[]
  extLen: number // 沿轴线方向的延伸长度
}

/** A detection ray is not a weld. Curves need native curve continuation, and
 * finite fitting/projection intervals must not be extrapolated past their
 * verified mating region just because another boundary lies within range. */
export function canExtendWeldEndpoint(weld: Weld, which: 'start' | 'end'): boolean {
  if (weld.closed || weld.properties['装配间隙'] || weld.properties['投影搭接'] || lugOuterContour(weld)) return false
  const segments = weld.segments.filter(segment => segment.points.length >= 2)
  const segment = which === 'start' ? segments[0] : segments.at(-1)
  return !!segment && (segment.type === '直线' || segment.type === 'line')
}

/** extend 规则 1: 与显示共用的沿轴线边界距离 < 阈值 → 延伸到对应交点 */
function extendByThreshold(
  weld: Weld, axial: AxialResult | null, endKind: '起点' | '终点', dir: THREE.Vector3, endPt: THREE.Vector3,
  threshold: number | null,
): ExtCandidate | null {
  if (threshold === null) return null
  let bestDist = Infinity
  let bestAssoc: number[] | null = null
  if (axial) {
    for (const group of Object.values(axial)) {
      const distance = group[`${endKind}距离`]
      const association = group[`${endKind}关联点`]
      if (distance !== null && distance < bestDist && isVec3(association)) {
        bestDist = distance
        bestAssoc = association
      }
    }
  } else {
    // Older models have no semantic wire topology. Preserve their established
    // static extend behavior until those models are re-exported in the new schema.
    const gap = weld.properties?.间隙检测 as Record<string, unknown> | undefined
    const legacy = (gap?.extend ?? gap?.沿轴线方向) as Record<string, unknown> | undefined
    if (legacy && typeof legacy === 'object') for (const raw of Object.values(legacy)) {
      if (!raw || typeof raw !== 'object') continue
      const group = raw as Record<string, unknown>
      for (const [key, value] of Object.entries(group)) {
        if (typeof value !== 'number' || !key.startsWith(endKind) || !key.includes('距离')) continue
        const association = group[`${endKind}关联点`]
        if (value < bestDist && isVec3(association)) {
          bestDist = value
          bestAssoc = association
        }
      }
    }
  }
  if (!bestAssoc || bestDist >= threshold) return null
  const a = new THREE.Vector3(bestAssoc[0], bestAssoc[1], bestAssoc[2])
  const extLen = a.clone().sub(endPt).dot(dir)
  if (extLen <= 0.01) return null // 关联点不在延伸方向上, 不收缩焊缝
  return {
    规则: 'extend小于阈值', 关联零件: null, 距离: r1(bestDist),
    延伸到: [r2(a.x), r2(a.y), r2(a.z)], extLen,
  }
}

/** extend 规则 2: 端点沿轴线射线 (0,d] 命中零件 X 且 X 与副板直接接触 → 延伸到命中点 */
function extendByContact(
  weld: Weld, dir: THREE.Vector3, endPt: THREE.Vector3,
  meshData: Float32Array, partsData: PartsData,
  contactPairs: Set<string> | null, d: number,
): ExtCandidate | null {
  if (!contactPairs) return null
  const endBox = new THREE.Box3(endPt.clone(), endPt.clone()).expandByScalar(d)
  const candidates: { partId: string; mesh: THREE.Mesh }[] = []
  for (const part of partsData.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue
    const pb = new THREE.Box3(
      new THREE.Vector3(...(part.bbox.min as [number, number, number])),
      new THREE.Vector3(...(part.bbox.max as [number, number, number])),
    )
    if (!pb.intersectsBox(endBox)) continue
    const mesh = getPartMesh(meshData, partsData, part.id)
    if (mesh) candidates.push({ partId: part.id, mesh })
  }
  if (candidates.length === 0) return null
  const raycaster = new THREE.Raycaster(endPt.clone(), dir.clone(), EXT_EPS, d)
  const hits = raycaster.intersectObjects(candidates.map((c) => c.mesh), false)
  for (const h of hits) { // 按距离升序, 取第一个与副板接触的零件
    const cand = candidates.find((c) => c.mesh === (h.object as THREE.Mesh))
    if (!cand) continue
    if (!contactPairs.has(`${cand.partId}|${weld.subPartId}`)) continue
    const extLen = h.distance
    if (extLen <= 0.01) return null
    return {
      规则: 'extend接触副板', 关联零件: cand.partId, 距离: r1(h.distance),
      延伸到: [r2(h.point.x), r2(h.point.y), r2(h.point.z)], extLen,
    }
  }
  return null
}

// ---------------------------------------------------------------- 主入口

export function computeAllSplits(
  weldsData: WeldsData,
  meshData: Float32Array,
  partsData: PartsData,
  edgesData: EdgesData | null,
  contactPairs: Set<string> | null,
  offset: number,
  extendThreshold: number | null,
  offsetThreshold: number | null,
): Map<string, WeldSplit> {
  const result = new Map<string, WeldSplit>()
  for (const weld of weldsData.welds) {
    result.set(weld.id, computeWeldSplit(
      weld, meshData, partsData, edgesData, contactPairs, offset, extendThreshold, offsetThreshold))
  }
  return result
}

function computeWeldSplit(
  weld: Weld,
  meshData: Float32Array,
  partsData: PartsData,
  edgesData: EdgesData | null,
  contactPairs: Set<string> | null,
  offset: number,
  extendThreshold: number | null,
  offsetThreshold: number | null,
): WeldSplit {
  const poly = weldPolyline(weld)
  const mkTrivial = (): WeldSplit => ({
    algorithmRevision: WELD_SPLIT_ALGORITHM_REVISION,
    weldId: weld.id,
    splitPoints: [],
    startExtension: null,
    endExtension: null,
    subWelds: [{
      id: `${weld.id}-1`, index: 1, length: weld.length, closed: weld.closed,
      start: weld.start, end: weld.end,
      startTangent: poly.length > 1
        ? r2vecT(new THREE.Vector3().subVectors(poly[1], poly[0]).normalize()) : [1, 0, 0],
      endTangent: poly.length > 1
        ? r2vecT(new THREE.Vector3().subVectors(poly[poly.length - 1], poly[poly.length - 2]).normalize())
        : [1, 0, 0],
      points: poly.map((p) => [p.x, p.y, p.z]),
      起点来源: { 类型: '原焊缝起点' },
      终点来源: { 类型: '原焊缝终点' },
    }],
  })
  if (poly.length < 2) return mkTrivial()

  // ---------------- 端点延伸 (两条 extend 规则候选取延伸更远者)
  // 闭合焊缝 (整圈圆等) 无端点: 跳过 extend 检测, 延伸会破坏首尾重合
  const t0 = new THREE.Vector3().subVectors(poly[1], poly[0]).normalize()
  const tn = new THREE.Vector3().subVectors(poly[poly.length - 1], poly[poly.length - 2]).normalize()
  const startDir = t0.clone().negate()
  const endDir = tn.clone()
  const axial = computeAxialDetection(weld, edgesData ?? { edges: [] })
  const noEndpoints = weld.closed || poly[0].distanceToSquared(poly[poly.length - 1]) < 1e-12

  const startCands = noEndpoints || !canExtendWeldEndpoint(weld, 'start') ? [] : [
    extendByThreshold(weld, axial, '起点', startDir, poly[0], extendThreshold),
    extendByContact(weld, startDir, poly[0], meshData, partsData, contactPairs, offset),
  ].filter((c): c is ExtCandidate => c !== null).filter((c) => isWeldExtensionSupported(weld, false, c.延伸到, edgesData))
  const endCands = noEndpoints || !canExtendWeldEndpoint(weld, 'end') ? [] : [
    extendByThreshold(weld, axial, '终点', endDir, poly[poly.length - 1], extendThreshold),
    extendByContact(weld, endDir, poly[poly.length - 1], meshData, partsData, contactPairs, offset),
  ].filter((c): c is ExtCandidate => c !== null).filter((c) => isWeldExtensionSupported(weld, true, c.延伸到, edgesData))
  startCands.sort((a, b) => b.extLen - a.extLen)
  endCands.sort((a, b) => b.extLen - a.extLen)
  const startExt = startCands[0] ?? null
  const endExt = endCands[0] ?? null

  // ---------------- 延伸后的完整折线
  const fp = poly.map((p) => p.clone())
  if (startExt) fp.unshift(new THREE.Vector3(...(startExt.延伸到 as [number, number, number])))
  if (endExt) fp.push(new THREE.Vector3(...(endExt.延伸到 as [number, number, number])))
  const cum = cumLengths(fp)
  const L = cum[cum.length - 1]

  // ---------------- offset 内部打断点
  const rawPoints: SplitPoint[] = []
  const continuousContactPoints = new WeakSet<SplitPoint>()
  const ownOuterBoundaryPoints = new WeakSet<SplitPoint>()
  const startOuterTailPoints = new WeakSet<SplitPoint>()
  const endOuterTailPoints = new WeakSet<SplitPoint>()
  const obstructionSpans: { start: number; end: number; partId: string; direction: string; directions?: string[]; distance: number }[] = []
  // Verified collar fits/projections already carry finite CAD clipping. Their
  // own mating boundaries are a connected support, not another obstruction.
  // Projecting chord fragments back onto the weld creates false internal cuts.
  // Third-part contact spans still split it, including thin obstructions.
  const finiteConnectedContour = !!weld.properties['投影搭接'] || !!collarGapPlanning(weld) || !!lugOuterContour(weld)
  // This condition is geometric contact, not a proximity threshold. Inspect
  // each physically touching entity in the offset directions over its finite
  // geometry even when the normal offset query would stop before reaching it.
  const exactSubplateContacts = getSubplateOffsetContacts(weld, meshData, partsData, edgesData, contactPairs)
  const exactContactChannels = new Set(exactSubplateContacts.map(contact => `${contact.faceKey}|${contact.partId}|${contact.direction}`))
  const projectedContacts = exactSubplateContacts.map(contact => {
    const first = projectToPolyline(new THREE.Vector3().fromArray(contact.start), fp, cum)
    const last = projectToPolyline(new THREE.Vector3().fromArray(contact.end), fp, cum)
    return { partId: contact.partId, start: Math.min(first.s, last.s), end: Math.max(first.s, last.s),
      distanceMm: contact.distanceMm, directions: [contact.direction as string] }
  }).sort((a, b) => a.partId.localeCompare(b.partId) || a.start - b.start || a.end - b.end)
  const contactIntervals: typeof projectedContacts = []
  for (const contact of projectedContacts) {
    const previous = contactIntervals.at(-1)
    // One entity can be visible from both joint faces. Its overlapping finite
    // projections are one interval, not an extra cut at each channel boundary.
    if (previous && previous.partId === contact.partId && contact.start <= previous.end + 1e-7) {
      previous.end = Math.max(previous.end, contact.end)
      previous.distanceMm = Math.min(previous.distanceMm, contact.distanceMm)
      previous.directions = [...new Set([...previous.directions, ...contact.directions])]
    } else contactIntervals.push({ ...contact })
  }
  for (const contact of contactIntervals) {
    const trigger: SplitTrigger = { 规则: 'offset接触副板', 关联零件: contact.partId, 距离: contact.distanceMm, subplateContact: true }
    for (const s of [contact.start, contact.end]) {
      const at = pointAt(fp, cum, s).p
      const point = { ...trigger, s, 位置: [r2(at.x), r2(at.y), r2(at.z)] }
      rawPoints.push(point)
      continuousContactPoints.add(point)
    }
    if (contact.end - contact.start > .02) obstructionSpans.push({
      start: contact.start, end: contact.end, partId: contact.partId,
      direction: contact.directions[0], directions: contact.directions, distance: contact.distanceMm,
    })
  }
  if (edgesData) {
    const perp = getPerpCached(weld, meshData, partsData, edgesData, offset)
    const semantic = hasSemanticBoundaries(edgesData)
    const groups: (keyof PerpendicularResult)[] = ['主板面', '副板面']
    const addSplitAt = (posArr: unknown, trig: SplitTrigger, continuousContact = false, ownOuterBoundary = false,
      outerStartTail = false, outerEndTail = false) => {
      if (!isVec3(posArr)) return
      const proj = projectToPolyline(new THREE.Vector3(posArr[0], posArr[1], posArr[2]), fp, cum)
      const point = { ...trig, s: proj.s, 位置: [r2(proj.point.x), r2(proj.point.y), r2(proj.point.z)] }
      rawPoints.push(point)
      if (continuousContact) continuousContactPoints.add(point)
      if (ownOuterBoundary) ownOuterBoundaryPoints.add(point)
      if (outerStartTail) startOuterTailPoints.add(point)
      if (outerEndTail) endOuterTailPoints.add(point)
    }
    for (const gKey of groups) {
      const g = perp[gKey]
      // 接触段: 规则1 (阈值) + 规则2 (接触副板)
      if (g.接触) {
        for (const seg of Object.values(g.接触) as Record<string, unknown>[]) {
          const partId = seg.接触零件 as string
          // This channel already has continuous, finite triangle geometry.
          // Keeping its sampled approximation adds false slivers at its edges.
          if (exactContactChannels.has(`${gKey}|${partId}|${seg.方向}`)) continue
          const minD = seg.最小接触距离 as number
          const continuousContact = seg.方向 === '焊缝贴面'
          // A body-level contact table cannot qualify a remote hit on the
          // opposite side of the selected subplate face. Nonzero offset
          // contacts use the finite-face proof above; a direct weld crossing
          // remains independently valid at the actual root itself.
          const directSubplateContact = continuousContact && !!contactPairs?.has(`${partId}|${weld.subPartId}`)
          const triggers = offsetThreshold !== null && minD < offsetThreshold
            || directSubplateContact
          if (triggers && partId !== weld.mainPartId && partId !== weld.subPartId
            && isVec3(seg.投影点1) && isVec3(seg.投影点2)) {
            const first = projectToPolyline(new THREE.Vector3().fromArray(seg.投影点1), fp, cum).s
            const last = projectToPolyline(new THREE.Vector3().fromArray(seg.投影点2), fp, cum).s
            if (Math.abs(last - first) > .02) obstructionSpans.push({ start: Math.min(first, last), end: Math.max(first, last),
              partId, direction: String(seg.方向), distance: minD })
          }
          if (directSubplateContact) {
            addSplitAt(seg.投影点1, { 规则: 'offset接触副板', 关联零件: partId, 距离: minD, subplateContact: true }, continuousContact)
            addSplitAt(seg.投影点2, { 规则: 'offset接触副板', 关联零件: partId, 距离: minD, subplateContact: true }, continuousContact)
          }
          if (offsetThreshold !== null && minD < offsetThreshold) {
            addSplitAt(seg.投影点1, { 规则: 'offset小于阈值', 关联零件: partId, 距离: minD }, continuousContact)
            addSplitAt(seg.投影点2, { 规则: 'offset小于阈值', 关联零件: partId, 距离: minD }, continuousContact)
          }
        }
      }
      if (!finiteConnectedContour && !semantic && g['孔/边缘'] && offsetThreshold !== null) {
        const partId = gKey === '主板面' ? weld.mainPartId : weld.subPartId
        for (const segment of Object.values(g['孔/边缘']) as Record<string, unknown>[]) {
          const d1 = segment.起点到焊缝的距离 as number
          const d2 = segment.终点到焊缝的距离 as number
          if (d1 < offsetThreshold) addSplitAt(segment.投影点1, { 规则: 'offset小于阈值', 关联零件: partId, 距离: d1 })
          if (d2 < offsetThreshold) addSplitAt(segment.投影点2, { 规则: 'offset小于阈值', 关联零件: partId, 距离: d2 })
        }
      }
    }
    // Apply the threshold to continuous geometry, not rounded display endpoints.
    // In particular, a closed circle must yield its full near-boundary span;
    // chord junctions are not independent weld split points.
    if (!finiteConnectedContour && semantic && offsetThreshold !== null && offsetThreshold > 0) {
      const boundaryResults = computeBoundaryOffsetSpans(weld, edgesData, Math.min(offset, offsetThreshold))
      for (const { edge, spans } of boundaryResults) for (const span of spans) {
        if (span.minDistance >= offsetThreshold - 1e-9) continue
        const trigger: SplitTrigger = { 规则: 'offset小于阈值', 关联零件: edge.partId, 距离: r1(span.minDistance) }
        // A sloped outer edge can stay within a 50 mm offset for much more
        // than 50 mm along the weld. Keep its actual connection to the native
        // endpoint; longitudinal tail length is not a discontinuity test.
        const outer = edge.wire === 'outer'
        const startTail = outer && span.startPoint.distanceTo(poly[0]) <= .02
        const endTail = outer && span.endPoint.distanceTo(poly.at(-1)!) <= .02
        addSplitAt(span.startPoint.toArray(), trigger, false, outer, startTail, endTail)
        addSplitAt(span.endPoint.toArray(), trigger, false, outer, startTail, endTail)
      }
    }
  }

  // 去重: 按弧长排序, 窗口内保留先触发者 (规则优先级 = 收集顺序);
  // 落在原焊缝端点上的打断点无意义 (切不出新段, 还会把延伸段割裂出来), 丢弃
  rawPoints.sort((a, b) => a.s - b.s)
  const origStart = poly[0]
  const origEnd = poly[poly.length - 1]
  const splitPoints: SplitPoint[] = []
  for (const p of rawPoints) {
    if (p.s < END_EPS || p.s > L - END_EPS) continue
    const pv = new THREE.Vector3(p.位置[0], p.位置[1], p.位置[2])
    if (pv.distanceTo(origStart) < END_EPS || pv.distanceTo(origEnd) < END_EPS) continue
    const previous = splitPoints.at(-1)
    // Preserve the two real boundaries of a thin obstruction. The wider legacy
    // deduplication window was for sampled/rounded projections, not geometry.
    const mergeEps = continuousContactPoints.has(p) || (previous && continuousContactPoints.has(previous)) ? 0.01 : MERGE_EPS
    if (previous && p.s - previous.s < mergeEps) {
      // A coincident third-part/hole trigger must still protect this cut from
      // terminal-tail rejoining, even when the display keeps the first point.
      if (!ownOuterBoundaryPoints.has(p)) {
        ownOuterBoundaryPoints.delete(previous)
        startOuterTailPoints.delete(previous)
        endOuterTailPoints.delete(previous)
      } else if (ownOuterBoundaryPoints.has(previous)) {
        if (startOuterTailPoints.has(p)) startOuterTailPoints.add(previous)
        if (endOuterTailPoints.has(p)) endOuterTailPoints.add(previous)
      }
      if (continuousContactPoints.has(p)) continuousContactPoints.add(previous)
      continue
    }
    splitPoints.push(p)
  }

  // ---------------- 切开
  const subWelds: SubWeld[] = []
  const n = splitPoints.length
  const mkEnd = (sp: SplitPoint): SubWeldEndSource => ({
    类型: '打断点',
    触发: { 规则: sp.规则, 关联零件: sp.关联零件, 距离: sp.距离,
      ...(sp.subplateContact ? { subplateContact: true } : {}) },
  })
  const stripExt = (c: ExtCandidate | null): (SplitTrigger & { 延伸到: number[] }) | null =>
    c ? { 规则: c.规则, 关联零件: c.关联零件, 距离: c.距离, 延伸到: c.延伸到 } : null

  const buildSub = (
    index: number, pts: THREE.Vector3[], length: number, closed: boolean,
    t0v: THREE.Vector3, t1v: THREE.Vector3,
  ) => ({
    id: `${weld.id}-${index}`,
    index,
    length: r1(length),
    closed,
    start: [r2(pts[0].x), r2(pts[0].y), r2(pts[0].z)],
    end: [r2(pts[pts.length - 1].x), r2(pts[pts.length - 1].y), r2(pts[pts.length - 1].z)],
    startTangent: r2vecT(t0v),
    endTangent: r2vecT(t1v),
    points: pts.map((p) => [r2(p.x), r2(p.y), r2(p.z)]),
    起点来源: { 类型: '打断点' } as SubWeldEndSource,
    终点来源: { 类型: '打断点' } as SubWeldEndSource,
  })
  const buildOpen = (index: number, s0: number, s1: number, closed: boolean) =>
    buildSub(index, cutPolyline(fp, cum, s0, s1), s1 - s0, closed,
      pointAt(fp, cum, s0).t, pointAt(fp, cum, s1).t)

  if (n === 0) {
    const sub = buildOpen(1, 0, L, weld.closed)
    sub.起点来源 = { 类型: '原焊缝起点', 延伸: stripExt(startExt) }
    sub.终点来源 = { 类型: '原焊缝终点', 延伸: stripExt(endExt) }
    subWelds.push(sub)
  } else if (!weld.closed) {
    // 开放焊缝: n 个打断点 → n+1 段
    const bounds = [0, ...splitPoints.map((p) => p.s), L]
    for (let i = 0; i < bounds.length - 1; i++) {
      const sub = buildOpen(i + 1, bounds[i], bounds[i + 1], false)
      sub.起点来源 = i === 0
        ? { 类型: '原焊缝起点', 延伸: stripExt(startExt) }
        : mkEnd(splitPoints[i - 1])
      sub.终点来源 = i === bounds.length - 2
        ? { 类型: '原焊缝终点', 延伸: stripExt(endExt) }
        : mkEnd(splitPoints[i])
      subWelds.push(sub)
    }
  } else {
    // 闭合焊缝: n 个打断点 → n 段 (末段跨回起点)
    for (let i = 0; i < n; i++) {
      const s0 = splitPoints[i].s
      let sub
      if (i + 1 < n) {
        sub = buildOpen(i + 1, s0, splitPoints[i + 1].s, false)
      } else {
        const pts = [
          ...cutPolyline(fp, cum, s0, L),
          ...cutPolyline(fp, cum, 0, splitPoints[0].s).slice(1),
        ]
        sub = buildSub(i + 1, pts, (L - s0) + splitPoints[0].s, false,
          pointAt(fp, cum, s0).t, pointAt(fp, cum, splitPoints[0].s).t)
      }
      sub.起点来源 = mkEnd(splitPoints[i])
      sub.终点来源 = mkEnd(splitPoints[(i + 1) % n])
      subWelds.push(sub)
    }
  }

  // Outer boundaries of the supporting plate can split a continuous native
  // contact into terminal pieces. Rejoin short supported tails, and longer
  // tails with a measured outer-boundary span reaching that native endpoint.
  // Complete material support is still mandatory; third-part and inner-hole
  // cuts remain intact even when they coincide with an outer-boundary cut.
  if (!weld.closed && !startExt && edgesData?.wires?.length) {
    while (subWelds.length > 1) {
      const boundary = splitPoints[0]
      const tail = subWelds[0], after = subWelds[1]
      const joinedPoints = [...tail.points, ...after.points.slice(1)]
      if (!boundary || !ownOuterBoundaryPoints.has(boundary)
        || tail.length >= 50 && !startOuterTailPoints.has(boundary)
        || !joinedPoints.slice(1).every((point, index) => isWeldSpanSupported(weld, joinedPoints[index], point, edgesData))) break
      after.points = joinedPoints
      after.length = r1(cumLengths(joinedPoints.map((point) => new THREE.Vector3().fromArray(point))).at(-1)!)
      after.start = tail.start
      after.startTangent = tail.startTangent
      after.起点来源 = tail.起点来源
      subWelds.shift()
      splitPoints.shift()
    }
  }
  if (!weld.closed && !endExt && edgesData?.wires?.length) {
    while (subWelds.length > 1) {
      const boundary = splitPoints.at(-1)
      const tail = subWelds.at(-1)!, before = subWelds.at(-2)!
      const joinedPoints = [...before.points, ...tail.points.slice(1)]
      if (!boundary || !ownOuterBoundaryPoints.has(boundary)
        || tail.length >= 50 && !endOuterTailPoints.has(boundary)
        || !joinedPoints.slice(1).every((point, index) => isWeldSpanSupported(weld, joinedPoints[index], point, edgesData))) break
      before.points.push(...tail.points.slice(1))
      before.length = r1(cumLengths(before.points.map((p) => new THREE.Vector3().fromArray(p))).at(-1)!)
      before.end = tail.end
      before.endTangent = tail.endTangent
      before.终点来源 = tail.终点来源
      subWelds.pop()
      splitPoints.pop()
    }
  }

  for (const sub of subWelds) {
    const start = projectToPolyline(new THREE.Vector3().fromArray(sub.start), fp, cum).s
    const end = projectToPolyline(new THREE.Vector3().fromArray(sub.end), fp, cum).s
    // Do not use a root's bounding box, a nearby hole, or an extrapolated ray:
    // only a measured finite third-part span can exclude a derived interval.
    const covered = obstructionSpans.filter(span => span.start <= Math.min(start, end) + .03
      && span.end >= Math.max(start, end) - .03)
    if (!sub.closed && covered.length) sub.geometryObstruction = {
      partIds: [...new Set(covered.map(span => span.partId))], directions: [...new Set(covered.flatMap(span => span.directions ?? [span.direction]))],
      minimumDistanceMm: Math.min(...covered.map(span => span.distance)),
    }
    if (sub.closed || sub.geometryObstruction || sub.length >= 50 || !edgesData?.wires?.length
      || sub.起点来源.类型 !== '打断点' && sub.终点来源.类型 !== '打断点') continue
    const originalBoundary = (['起点', '终点'] as const).some(which => {
      const source = which === '起点' ? sub.起点来源 : sub.终点来源
      if (source.类型 !== `原焊缝${which}` || source.延伸) return false
      return axial && Object.values(axial).some(group => group[`${which}距离`] !== null && group[`${which}距离`]! <= .02)
    })
    if (originalBoundary && sub.points.slice(1).every((point, index) =>
      isWeldSpanSupported(weld, sub.points[index], point, edgesData))) sub.geometryRetainTerminal = true
  }

  return {
    algorithmRevision: WELD_SPLIT_ALGORITHM_REVISION,
    weldId: weld.id,
    splitPoints,
    subWelds,
    startExtension: stripExt(startExt),
    endExtension: stripExt(endExt),
    ...(startExt ? { startFeature: extendedEndpointFeature(weld, false, subWelds[0].start, edgesData) } : {}),
    ...(endExt ? { endFeature: extendedEndpointFeature(weld, true, subWelds.at(-1)!.end, edgesData) } : {}),
  }
}

function r2vecT(v: THREE.Vector3): number[] {
  return [r2(v.x), r2(v.y), r2(v.z)]
}

/** 汇总统计 (顶栏计数 / 调试钩子用) */
export function summarizeSplits(splits: Map<string, WeldSplit>): SplitSummary {
  let subCount = 0
  let splitCount = 0
  for (const sp of splits.values()) {
    subCount += sp.subWelds.length
    if (sp.subWelds.length > 1) splitCount++
  }
  return { 焊缝总数: splits.size, 被打断焊缝数: splitCount, 打断后总段数: subCount }
}
