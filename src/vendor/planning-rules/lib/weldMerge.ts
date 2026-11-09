import * as THREE from 'three'
import type { GeometryWrapBoundaryProof } from './geometryWrapBoundary'
import type { PartsData, WeldsData } from '@/types/weld'
import type { WeldSplit } from './weldSplit'
import { WELD_POSITION_NAMES } from './weldParameters'
import { compositeShellRing, compositeShellTangent, type CompositeShellRing } from './compositeShellWelds'
import { thicknessWeldDecision } from './thicknessWeldPolicy'

/**
 * 焊缝合并 —— 按用户规则图对「打断后的当前焊缝段列表」做合并, 纯前端派生数据
 *
 * 必要条件 (前置门槛): 两段几何上相交或相切 —— 折线最近距离 ≤ 最大合并距离
 * (默认 10mm; 真实相交/穿越自然满足)。不满足则直接不合, 不再有任何间隙桥接。
 * 两段必须具有相同的有效焊接位置；缺失位置不参与自动合并。所有拓扑/投影特例均受此约束。
 *
 * 规则 A (平行, 夹角<1°):
 *  关联实体完全相同 (无序对 {main,sub}):
 *   - 任一焊缝由副板板厚形成且按板厚阈值作为独立焊缝 → 转规则 B
 *   - 否则看相邻端端部特征 (原焊缝端继承原特征; 打断切断端视为 平角):
 *      平角/直角/锐角 → 合
 *      D圆弧/优角/凸圆弧 (任一端) → 不合
 *      钝角/凹圆弧/长圆弧 → 合
 *  关联实体不同:
 *   - 共线 (夹角<1° 且侧向偏移<1mm) → 合
 *   - 不共线 → 不合
 * 规则 B (不平行, 或被转交): 夹角∈[夹角下限,夹角上限] 且 两长度∈[长度下限,长度上限]
 *  且 焊脚差 <0.1 且 相邻端部特征尺寸可穿过:
 *   直角/锐角/平角 → 长/高按 0 处理 (永不阻断);
 *   其他角 (钝角等) → 长 ≤ 最长通过距离 且 高 ≤ 最小通过高度;
 *   圆 → L1 ≤ 最长通过距离 且 L2 ≤ 最小通过高度
 *
 * 同一原焊缝的子段之间绝不合并: 判定阶段直接跳过, 成组阶段 (并查集 union) 若会把
 * 同源单元并入同一组也阻断 (传递并入视为「合并回原焊缝」), 阻断记录进 同源阻断。
 * 重合区禁止合并 (几何兜底, 与血缘阻断并存): 两段折线近距 ≤2mm 且切向近平行/反平行
 * (≤10°) 的区间沿路径方向投影重叠 >1mm → 重合区 (合并会重复焊接), 判定阶段记
 * 「不合|重合区」, 成组阶段对候选单元 × 目标组全部成员复查 (传递阻断记 重合阻断);
 * 端点相交/相切是点接触 (投影重叠≈0), 不受影响。
 * 成组: 并查集收集几何关联; 每条可演示链只接有「合并」判定且实际自由端距离
 * ≤最大合并距离的相邻对。内点交叉、分叉不能硬串到链尾; 剩余成员继续成链或独立保留。
 */

export interface MergeParams {
  最小通过高度: number // 默认 25
  最长通过距离: number // 默认 45
  夹角阈值下限: number // 默认 60
  夹角阈值上限: number // 默认 120
  长度阈值下限: number // 默认 0
  长度阈值上限: number // 默认 99999
  /** 相交/相切容差: 两段折线最近距离 ≤ 该值才可合并 (默认 10) */
  最大合并距离: number
}

export const DEFAULT_MERGE_PARAMS: MergeParams = {
  最小通过高度: 25,
  最长通过距离: 45,
  夹角阈值下限: 60,
  夹角阈值上限: 120,
  长度阈值下限: 0,
  长度阈值上限: 99999,
  最大合并距离: 10,
}

export interface MergeUnit {
  compositeShellRing?: CompositeShellRing
  key: string // `${weldId}|${subIndex}`
  weldId: string
  subIndex: number
  id: string // 子焊缝 id, 如 W027-1
  points: number[][]
  length: number
  start: THREE.Vector3
  end: THREE.Vector3
  chord: THREE.Vector3 // 单位弦方向
  mainPartId: string
  subPartId: string
  jointType: string
  /** 有效工艺位置；未知为 null，不能据此把两个未知位置自动合并。 */
  weldingPosition?: string | null
  板厚形成: boolean
  /** Independent planning decision; never replaces the source physical flag. */
  板厚独立?: boolean
  焊脚: number
  startFeature: string
  endFeature: string
  /** 相邻端特征原始属性 (规则 B 特征尺寸比较用); 打断端为平角 */
  startFeatureProp: FeatureProp | undefined
  endFeatureProp: FeatureProp | undefined
  /** 数据级血缘: 闭合圆合并自哪些原焊缝 (properties.合并自焊缝); 普通焊缝为空数组 */
  mergedFrom: string[]
  /** 有限CAD配合/投影区间不可借合并距离跨越未验证空白。 */
  finiteInterval?: boolean
  /** 投影轮廓只能在同一补板/母板及同一对投影主面内续接。 */
  projectedContourKey?: string
  /** 原CAD面法向得到的端部切向，均从该端点朝单元内部。 */
  startNativeTangent?: THREE.Vector3 | null
  endNativeTangent?: THREE.Vector3 | null
  /** 仅原始OuterWire边顶点有效；母板裁剪点/第三件打断点不构成拓扑邻接。 */
  startNativeVertex?: ProjectedNativeVertex | null
  endNativeVertex?: ProjectedNativeVertex | null
}

interface ProjectedNativeVertex {
  edgeIndex: number
  sourcePoint: THREE.Vector3
  projectedPoint: THREE.Vector3
}

export interface PairDecision {
  a: string
  b: string
  实体相同: boolean
  夹角: number
  平行: boolean
  共线: boolean | null
  相邻端: [string, string]
  /** 相邻端端点间距 (展示用) */
  间隙: number
  /** 两折线最近距离 (相交/相切判定值) */
  最近距离: number
  /** 近距平行重叠投影长度 (mm; 未做重合检测为 null —— 仅相交/相切的对计算) */
  重叠长度: number | null
  端特征: [string, string] | null
  板厚形成转B: boolean
  分支: string
  焊脚: [number, number]
  结果: '合并' | '不合'
  原因: string
}

export interface MergeConnection {
  from: string
  to: string
  规则: 'A' | 'B'
  分支: string
  /** 合并判定中的相邻端间隙 (展示用) */
  间隙: number
  /** 两段的折线最近距离 (相交/相切实测值) */
  最近距离: number
  夹角: number
  焊脚: [number, number]
  /** 连接点 (两相邻端中点), 3D 连接标记用 */
  位置: number[]
}

export interface MergeGroup {
  /** A geometry-only T-side connector proved against the current source CAD ring. */
  geometryBoundary?: GeometryWrapBoundaryProof
  /** An actual T-side full wrap may also use an existing finite end-weld chain. */
  geometryFullWrap?: boolean
  manualFullWrap?: boolean
  id: string // M001…
  members: MergeUnit[] // 链序; 各成员几何、切向与端点特征均已对齐链前进方向
  totalLength: number
  start: number[]
  end: number[]
  /** 合成折线 (成员折线按连续链序拼接; 仅展示/几何参考用) */
  points: number[][]
  /** 链两端是否闭合 (起点≈终点) */
  closed: boolean
  connections: MergeConnection[]
  /** 组内成员两两近距平行重叠长度最大值 (mm; 重合区规则走查/诊断用, ≤1 才合法) */
  组内最大重叠: number
  geometryProperties?: Record<string, unknown>
  geometryOriginalMemberKeys?: string[]
  geometryOriginalPoints?: number[][]
  geometryEdited?: boolean
  geometryEndpoints?: { start?: import('./baojiao').BaojiaoEndpoint; end?: import('./baojiao').BaojiaoEndpoint }
}

export interface MergeResult {
  groups: MergeGroup[]
  decisions: PairDecision[]
  /** 参与判定的全部单元 (已剔除被删除段) */
  units: MergeUnit[]
  /** 已入组单元的 key 集合 */
  mergedUnitKeys: Set<string>
  /** 因「同源段禁止合并回一条」在成组阶段被阻断的合并对 */
  同源阻断: { a: string; b: string; 同源焊缝: string[] }[]
  /** 因「闭合圆与其合并自焊缝不得同组」(几何重叠防重复段) 在成组阶段被阻断的合并对 */
  血缘阻断: { a: string; b: string; 涉及焊缝: string[] }[]
  /** 因「重合区禁止合并」(候选单元与目标组成员存在近距平行重叠) 在成组阶段被阻断的合并对 */
  重合阻断: { a: string; b: string; 重叠对: { a: string; b: string; 长度: number }[] }[]
  /** 单元总数 / 合并后条数 (组数 + 未合并单元数) */
  单元总数: number
  合并后总数: number
}

/** App 侧 <50mm 组过滤后的结果 (组重编号, 被删组成员剔除) */
export interface MergeResultFiltered extends MergeResult {
  删除组数: number
  删除组成员数: number
  /** 被删除合并组的成员单元 key */
  deletedGroupUnitKeys: Set<string>
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

/** Compare effective process values, never use a generic dash as a shared unknown. */
export function automaticMergePosition(properties: Record<string, unknown>): string | null {
  const value = properties['焊接位置']
  const position = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const code = typeof position.代号 === 'string' ? position.代号.trim().toUpperCase() : ''
  if (/^P[A-G]$/.test(code)) return code
  const label = typeof position.位置 === 'string' ? position.位置.trim()
    : typeof value === 'string' ? value.trim() : ''
  if (/^P[A-G]$/i.test(label)) return label.toUpperCase()
  // “—” represents inclined welding only when it is explicitly identified as such.
  // Invalid nonempty codes must not become valid because an old label was retained.
  if (code && code !== '—') return null
  return Object.entries(WELD_POSITION_NAMES).find(([, name]) => name === label)?.[0] ?? null
}

/** A chain may reverse a member; vertical up/down must still agree after joining. */
export function automaticMergeTravelPosition(unit: MergeUnit, reversed = false): string | null {
  const code = unit.weldingPosition ?? null
  if (code !== 'PF' && code !== 'PG') return code
  let up = false, down = false
  for (let i = 1; i < unit.points.length; i++) {
    const delta = unit.points[i].map((value, axis) => value - unit.points[i - 1][axis])
    const length = Math.hypot(...delta)
    if (length <= 1e-12 || Math.abs(delta[2]) / length < Math.SQRT1_2 - 1e-12) continue
    if ((reversed ? -delta[2] : delta[2]) > 0) up = true
    else down = true
  }
  if (up && down) return null
  if (up || down) return up ? 'PF' : 'PG'
  return reversed ? code === 'PF' ? 'PG' : 'PF' : code
}
// Derived split coordinates are rounded to 0.01 mm; this only accommodates
// that rounding, never the ordinary 10 mm proximity used for other welds.
export const FINITE_INTERVAL_JOIN_TOLERANCE = .02

function joinLimit(a: MergeUnit, b: MergeUnit, params: MergeParams): number {
  return a.finiteInterval || b.finiteInterval
    ? Math.min(FINITE_INTERVAL_JOIN_TOLERANCE, params.最大合并距离) : params.最大合并距离
}

function nativeProjectedTangent(props: Record<string, unknown>, point: THREE.Vector3,
  inside: THREE.Vector3): THREE.Vector3 | null {
  const points = props.projectedPoints, normals = props.sourceNormals, host = props.hostNormal
  if (!Array.isArray(points) || !Array.isArray(normals) || !Array.isArray(host)
    || points.length !== normals.length || host.length !== 3) return null
  const isVector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component))
  if (!isVector(host)) return null
  let closest = -1, distance = FINITE_INTERVAL_JOIN_TOLERANCE
  points.forEach((candidate, index) => {
    if (!isVector(candidate) || !isVector(normals[index])) return
    const gap = point.distanceTo(new THREE.Vector3().fromArray(candidate))
    if (gap <= distance) { closest = index; distance = gap }
  })
  if (closest < 0) return null
  const tangent = new THREE.Vector3().fromArray(host).cross(new THREE.Vector3().fromArray(normals[closest]))
  if (tangent.lengthSq() < 1e-12 || inside.lengthSq() < 1e-12) return null
  tangent.normalize()
  if (tangent.dot(inside) < 0) tangent.negate()
  return tangent
}

function nativeProjectedVertex(props: Record<string, unknown>, point: THREE.Vector3): ProjectedNativeVertex | null {
  const sourceParameters = props.sourceCurveParameters
  const clip = props.finiteClip as { probes?: unknown[] } | undefined
  const edgeIndex = props.sourceEdgeIndex
  if (!Number.isInteger(edgeIndex) || (edgeIndex as number) < 0 || !Array.isArray(sourceParameters)
    || sourceParameters.length !== 2 || !sourceParameters.every((p) => typeof p === 'number' && Number.isFinite(p))
    || !Array.isArray(clip?.probes)) return null
  const isVector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3
    && value.every((component) => typeof component === 'number' && Number.isFinite(component))
  for (const probe of clip.probes) {
    if (!probe || typeof probe !== 'object') continue
    const p = probe as Record<string, unknown>
    if ((p.fraction !== 0 && p.fraction !== 1) || typeof p.parameter !== 'number'
      || !sourceParameters.some((parameter) => Math.abs(parameter - (p.parameter as number)) <= 1e-8)
      || !isVector(p.sourcePoint) || !isVector(p.projectedPoint)) continue
    const projectedPoint = new THREE.Vector3().fromArray(p.projectedPoint)
    if (projectedPoint.distanceTo(point) <= FINITE_INTERVAL_JOIN_TOLERANCE) return {
      edgeIndex: edgeIndex as number, sourcePoint: new THREE.Vector3().fromArray(p.sourcePoint), projectedPoint,
    }
  }
  return null
}

/** Keep member endpoints/features aligned with the same oriented polyline used by the group. */
function orientedMember(unit: MergeUnit, reversed: boolean): MergeUnit {
  if (!reversed) return unit
  return {
    ...unit, points: [...unit.points].reverse(),
    start: unit.end, end: unit.start, chord: unit.chord.clone().negate(),
    startFeature: unit.endFeature, endFeature: unit.startFeature,
    startFeatureProp: unit.endFeatureProp, endFeatureProp: unit.startFeatureProp,
    startNativeTangent: unit.endNativeTangent, endNativeTangent: unit.startNativeTangent,
    startNativeVertex: unit.endNativeVertex, endNativeVertex: unit.startNativeVertex,
  }
}

// ---------------------------------------------------------------- 特征/焊脚

interface FeatureProp {
  特征类型?: string
  尺寸待确认?: boolean
  角类型?: string | null
  圆类型?: string | null
  长?: number | null
  高?: number | null
  L1?: number | null
  L2?: number | null
}

/** 打断切断端的虚拟特征: 平角 (长0高0) */
const FLAT_FEATURE: FeatureProp = { 特征类型: '平角', 角类型: null, 长: 0, 高: 0 }

function featureLabel(f: FeatureProp | undefined): string {
  if (!f) return '直角'
  if (f.特征类型 === '未识别' || f.特征类型 === '普通端点') return '未识别'
  if (f.特征类型 === '平角') return '平角'
  if (f.特征类型 === '角' && f.角类型) return f.角类型
  if (f.特征类型 === '圆' && f.圆类型) return f.圆类型
  return '直角'
}

function weldLeg(weldProps: Record<string, unknown>, partsData: PartsData,
  mainPartId: string, subPartId: string): number {
  const hj = weldProps['焊脚']
  if (typeof hj === 'number' && Number.isFinite(hj)) return hj
  // 兼容: 焊脚缺失时 2/3 × min(主板厚, 副板厚) 现算, 1 位小数
  let tMain = NaN
  let tSub = NaN
  const th = weldProps['厚度']
  if (th && typeof th === 'object') {
    const o = th as Record<string, unknown>
    if (typeof o['主板厚度'] === 'number') tMain = o['主板厚度'] as number
    if (typeof o['副板厚度'] === 'number') tSub = o['副板厚度'] as number
  } else if (typeof th === 'number') {
    tMain = tSub = th
  }
  if (!Number.isFinite(tMain)) {
    tMain = partsData.parts.find((p) => p.id === mainPartId)?.thickness ?? NaN
  }
  if (!Number.isFinite(tSub)) {
    tSub = partsData.parts.find((p) => p.id === subPartId)?.thickness ?? NaN
  }
  if (!Number.isFinite(tMain) || !Number.isFinite(tSub)) return NaN
  return r1((2 / 3) * Math.min(tMain, tSub))
}

// ---------------------------------------------------------------- 单元构建

function buildUnits(
  splits: Map<string, WeldSplit>, weldsData: WeldsData, partsData: PartsData,
  skipUnits?: Set<string>,
): MergeUnit[] {
  const units: MergeUnit[] = []
  for (const weld of weldsData.welds) {
    const sp = splits.get(weld.id)
    if (!sp) continue
    const sourceProps = weld.properties as Record<string, unknown>
    const shellRing = compositeShellRing(weld)
    const projection = sourceProps['投影搭接'] && typeof sourceProps['投影搭接'] === 'object'
      ? sourceProps['投影搭接'] as Record<string, unknown> : null
    const projectedContourKey = projection ? JSON.stringify([
      projection.sourcePartId, projection.hostPartId, projection.sourceFaceIndex, projection.hostFaceIndex,
    ]) : undefined
    // Reversing travel renumbers sub-welds; preserve CAD order for graph tie-breaking.
    // Otherwise competing neighbours can join different groups solely due to direction.
    const orderedSubs = sp.subWelds.map((sub, subIndex) => ({ sub, subIndex }))
    if (weld.sourceTraversalReversed) orderedSubs.reverse()
    orderedSubs.forEach(({ sub, subIndex }) => {
      if (skipUnits && skipUnits.has(`${weld.id}|${subIndex}`)) return // 已删除 (<50mm)
      if (sub.points.length < 2) return
      const props = sub.geometryProperties ?? sourceProps
      const startFeature = (sp.startFeature ?? props['起点特征']) as FeatureProp | undefined
      const endFeature = (sp.endFeature ?? props['终点特征']) as FeatureProp | undefined
      const jt = (props['接头形式'] ?? {}) as Record<string, unknown>
      const sourceJoint = (sourceProps['接头形式'] ?? {}) as Record<string, unknown>
      const thicknessFormed = (jt['是否由副板板厚形成'] ?? jt['板厚是否形成单独焊缝']) === true
      const explicitIndependent = jt['板厚形成独立焊缝'] ?? sourceJoint['板厚形成独立焊缝']
      const thicknessIndependent = thicknessFormed && (typeof explicitIndependent === 'boolean' ? explicitIndependent
        : thicknessWeldDecision({ ...weld, properties: props }, partsData, sourceJoint['板厚形成焊缝阈值mm']).independent ?? true)
      const leg = weldLeg(props, partsData, weld.mainPartId, weld.subPartId)
      const movedEndpoint = (which: 'start' | 'end') => {
        const original = which === 'start' ? sub.geometryOriginalStart : sub.geometryOriginalEnd
        return !!(sub.geometryEdited && original && original.some((n, axis) => Math.abs(n - sub[which][axis]) > 1e-6))
      }
      const startIsCut = sub.起点来源.类型 === '打断点' || movedEndpoint('start')
      const endIsCut = sub.终点来源.类型 === '打断点' || movedEndpoint('end')
      const start = new THREE.Vector3(...(sub.start as [number, number, number]))
      const end = new THREE.Vector3(...(sub.end as [number, number, number]))
      const chord = new THREE.Vector3().subVectors(end, start)
      if (chord.lengthSq() < 1e-12) {
        // 弦退化 (start≈end): 整圈闭合圆, 或闭合圆仅 1 个打断点时切出的整圈单段
        // → 用折线首段方向作方向参考 (夹角/平行判定用)
        if (sub.points.length >= 2) {
          chord.set(
            sub.points[1][0] - sub.points[0][0],
            sub.points[1][1] - sub.points[0][1],
            sub.points[1][2] - sub.points[0][2])
        }
        if (chord.lengthSq() < 1e-12) return
      }
      chord.normalize()
      // 数据级血缘: 闭合圆由哪些半圆焊缝合并而来 (不再与它们重复合并)
      const mergedFrom = Array.isArray(props['合并自焊缝'])
        ? (props['合并自焊缝'] as unknown[]).filter((x): x is string => typeof x === 'string')
        : []
      units.push({
        key: `${weld.id}|${subIndex}`,
        weldId: weld.id,
        subIndex,
        id: sub.id,
        points: sub.points,
        length: sub.length,
        start, end, chord,
        mainPartId: weld.mainPartId,
        subPartId: weld.subPartId,
        jointType: sub.geometryProperties && typeof jt.类型 === 'string' ? jt.类型 : weld.jointType,
        weldingPosition: automaticMergePosition(props),
        板厚形成: thicknessFormed,
        板厚独立: thicknessIndependent,
        焊脚: leg,
        startFeature: startIsCut
          ? '平角' : featureLabel(startFeature),
        endFeature: endIsCut
          ? '平角' : featureLabel(endFeature),
        startFeatureProp: startIsCut
          ? FLAT_FEATURE : startFeature,
        endFeatureProp: endIsCut
          ? FLAT_FEATURE : endFeature,
        mergedFrom,
        compositeShellRing: shellRing,
        finiteInterval: !!(shellRing || props['装配间隙'] || projection || props['补板侧焊缝'] || props['间断焊']),
        projectedContourKey,
        startNativeTangent: projection ? nativeProjectedTangent(projection, start,
          new THREE.Vector3().fromArray(sub.points[1]).sub(start)) : null,
        endNativeTangent: projection ? nativeProjectedTangent(projection, end,
          new THREE.Vector3().fromArray(sub.points[sub.points.length - 2]).sub(end)) : null,
        startNativeVertex: projection ? nativeProjectedVertex(projection, start) : null,
        endNativeVertex: projection ? nativeProjectedVertex(projection, end) : null,
      })
    })
  }
  return units
}

// ---------------------------------------------------------------- 并查集

class DSU {
  parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    let r = x
    while (this.parent[r] !== r) r = this.parent[r]
    while (this.parent[x] !== r) { const p = this.parent[x]; this.parent[x] = r; x = p }
    return r
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b)
  }
}

// ---------------------------------------------------------------- 折线最近距离 (相交/相切判定)

/** 段-段最近距离 (3D) */
function segSegDist(
  p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3,
): number {
  const d1 = new THREE.Vector3().subVectors(q1, p1)
  const d2 = new THREE.Vector3().subVectors(q2, p2)
  const r = new THREE.Vector3().subVectors(p1, p2)
  const a = d1.dot(d1)
  const e = d2.dot(d2)
  const f = d2.dot(r)
  const EPS0 = 1e-12
  let s: number
  let t: number
  if (a <= EPS0 && e <= EPS0) return p1.distanceTo(p2)
  if (a <= EPS0) {
    s = 0
    t = Math.max(0, Math.min(1, f / e))
  } else {
    const c = d1.dot(r)
    if (e <= EPS0) {
      t = 0
      s = Math.max(0, Math.min(1, -c / a))
    } else {
      const b = d1.dot(d2)
      const denom = a * e - b * b
      s = denom > EPS0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = Math.max(0, Math.min(1, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.max(0, Math.min(1, (b - c) / a))
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s)
  const c2 = p2.clone().addScaledVector(d2, t)
  return c1.distanceTo(c2)
}

/** 两条折线的最近距离 (逐段精确; 调用方已做 bbox 预过滤) */
export function polylineMinDist(aPts: number[][], bPts: number[][]): number {
  let best = Infinity
  const va = aPts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  const vb = bPts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  for (let i = 0; i < va.length - 1; i++) {
    for (let j = 0; j < vb.length - 1; j++) {
      const d = segSegDist(va[i], va[i + 1], vb[j], vb[j + 1])
      if (d < best) best = d
      if (best < 1e-9) return best
    }
  }
  return best
}

// ---------------------------------------------------------------- 重合区检测 (几何兜底)

/** 重合区阈值: 两段折线近距 ≤2mm 且切向近平行/反平行 (夹角 ≤10°) 时,
 *  沿路径方向的投影重叠长度 > 1mm → 重合区 (合并会重复焊接, 禁止)。
 *  端点相交/相切 (点接触): 投影重叠 ≈ 0, 不受影响。 */
export const OVERLAP_DIST = 2
export const OVERLAP_PAR_DEG = 10
export const OVERLAP_LEN = 1

interface PSeg {
  p0: THREE.Vector3
  dir: THREE.Vector3 // 单位切向
  len: number
  s0: number // 段起点在折线上的累计弧长
}

function polylineSegs(pts: number[][]): PSeg[] {
  const out: PSeg[] = []
  let s0 = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2])
    const p1 = new THREE.Vector3(pts[i + 1][0], pts[i + 1][1], pts[i + 1][2])
    const d = p1.clone().sub(p0)
    const len = d.length()
    if (len < 1e-9) continue
    out.push({ p0, dir: d.divideScalar(len), len, s0 })
    s0 += len
  }
  return out
}

/** 点到线段距离 */
function ptSegDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a)
  const len2 = ab.lengthSq()
  const t = len2 < 1e-12 ? 0
    : Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / len2))
  return p.distanceTo(a.clone().addScaledVector(ab, t))
}

/**
 * 两条折线的近距平行重叠长度: 对每对切向近平行的线段, 把 B 段投影到 A 段
 * 方向上取投影重叠区间, 区间内 (端点+中点采样) 到 B 段距离均 ≤2mm 才算重叠;
 * 区间落到 A 的弧长轴上合并后求总长。>OVERLAP_LEN 即重合区。
 */
export function polylineOverlapLen(aPts: number[][], bPts: number[][]): number {
  const A = polylineSegs(aPts)
  const B = polylineSegs(bPts)
  const cosTh = Math.cos((OVERLAP_PAR_DEG * Math.PI) / 180)
  const ivs: [number, number][] = []
  for (const sa of A) {
    for (const sb of B) {
      if (Math.abs(sa.dir.dot(sb.dir)) < cosTh) continue
      const sbEnd = sb.p0.clone().addScaledVector(sb.dir, sb.len)
      const t0 = sb.p0.clone().sub(sa.p0).dot(sa.dir)
      const t1 = sbEnd.clone().sub(sa.p0).dot(sa.dir)
      const lo = Math.max(0, Math.min(t0, t1))
      const hi = Math.min(sa.len, Math.max(t0, t1))
      if (hi - lo <= 0) continue
      let ok = true
      for (const t of [lo, (lo + hi) / 2, hi]) {
        const p = sa.p0.clone().addScaledVector(sa.dir, t)
        if (ptSegDist(p, sb.p0, sbEnd) > OVERLAP_DIST) { ok = false; break }
      }
      if (ok) ivs.push([sa.s0 + lo, sa.s0 + hi])
    }
  }
  if (ivs.length === 0) return 0
  ivs.sort((x, y) => x[0] - y[0])
  let total = 0
  let cs = ivs[0][0]
  let ce = ivs[0][1]
  for (let i = 1; i < ivs.length; i++) {
    const [s, e] = ivs[i]
    if (s <= ce + 1e-9) ce = Math.max(ce, e)
    else { total += ce - cs; cs = s; ce = e }
  }
  return total + (ce - cs)
}

// ---------------------------------------------------------------- 判定

const END_LABEL = ['起点', '终点'] as const
const NO_MERGE_FEATURES = new Set(['D圆弧', '优角', '凸圆弧'])
const SIMPLE_FEATURES = new Set(['直角', '锐角', '平角'])

function endOf(u: MergeUnit, which: 0 | 1): {
  p: THREE.Vector3; feature: string; label: string; fp: FeatureProp | undefined
} {
  return which === 0
    ? { p: u.start, feature: u.startFeature, label: '起点', fp: u.startFeatureProp }
    : { p: u.end, feature: u.endFeature, label: '终点', fp: u.endFeatureProp }
}

/** 规则 B 特征尺寸检查: 直角/锐角/平角长高按 0 (永不阻断);
 * 其他角 长≤最长通过距离 且 高≤最小通过高度; 圆 L1≤最长通过距离 且 L2≤最小通过高度。
 * 返回阻断原因, 通过返回 null */
function featureDimBlock(
  endLabel: string, f: FeatureProp | undefined, params: MergeParams,
): string | null {
  const label = featureLabel(f)
  if (SIMPLE_FEATURES.has(label) || !f) return null // 直角/锐角/平角: 长高按 0
  if (f.尺寸待确认) return `${endLabel}特征${label}尺寸尚未确认`
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (f.特征类型 === '角') {
    const len = num(f.长)
    const hgt = num(f.高)
    if (len > params.最长通过距离) {
      return `${endLabel}特征${label} 长${len}>最长通过距离${params.最长通过距离}`
    }
    if (hgt > params.最小通过高度) {
      return `${endLabel}特征${label} 高${hgt}>最小通过高度${params.最小通过高度}`
    }
  } else if (f.特征类型 === '圆') {
    const l1 = num(f.L1)
    const l2 = num(f.L2)
    if (l1 > params.最长通过距离) {
      return `${endLabel}特征${label} L1=${l1}>最长通过距离${params.最长通过距离}`
    }
    if (l2 > params.最小通过高度) {
      return `${endLabel}特征${label} L2=${l2}>最小通过高度${params.最小通过高度}`
    }
  }
  return null
}

function decide(
  a: MergeUnit, b: MergeUnit, params: MergeParams, touchDist: number,
): PairDecision {
  const touch = touchDist <= params.最大合并距离
  const dot = Math.abs(a.chord.dot(b.chord))
  const angle = r1((Math.acos(Math.min(1, dot)) * 180) / Math.PI)
  const parallel = angle < 1
  const sameEntity = (a.mainPartId === b.mainPartId && a.subPartId === b.subPartId)
    || (a.mainPartId === b.subPartId && a.subPartId === b.mainPartId)

  // 相邻端: 4 种端点组合中距离最近的一对
  let bestGap = Infinity
  let bestI: 0 | 1 = 0
  let bestJ: 0 | 1 = 0
  for (const i of [0, 1] as const) {
    for (const j of [0, 1] as const) {
      const g = endOf(a, i).p.distanceTo(endOf(b, j).p)
      if (g < bestGap) { bestGap = g; bestI = i; bestJ = j }
    }
  }
  const ea = endOf(a, bestI)
  const eb = endOf(b, bestJ)
  const gap = r2(bestGap)

  const base = {
    a: a.id, b: b.id, 实体相同: sameEntity, 夹角: angle, 平行: parallel,
    相邻端: [`a${ea.label}` as string, `b${eb.label}` as string] as [string, string],
    间隙: gap, 最近距离: r2(touchDist), 重叠长度: null as number | null,
    焊脚: [a.焊脚, b.焊脚] as [number, number],
  }
  const no = (分支: string, 原因: string, extra: Partial<PairDecision> = {}): PairDecision => ({
    ...base, 共线: null, 端特征: null, 板厚形成转B: false, 分支, 结果: '不合', 原因, ...extra,
  })

  // 必要条件: 相交/相切 (折线最近距离 ≤ 最大合并距离)
  if (!touch) {
    return no('未相交/相切',
      `两段最近距离${r2(touchDist)} > 最大合并距离${params.最大合并距离} → 不合`)
  }

  if ((a.finiteInterval || b.finiteInterval) && bestGap > joinLimit(a, b, params)) {
    return no('有限区间端点不连续', `有限配合/投影端点间距${gap}mm超过${joinLimit(a, b, params)}mm，禁止跨空白串接`)
  }
  if ((a.projectedContourKey || b.projectedContourKey) && a.projectedContourKey !== b.projectedContourKey) {
    return no('不同投影轮廓', '投影区间只沿同一补板/母板及同一对投影面连续连接')
  }
  if ((a.compositeShellRing || b.compositeShellRing) && a.compositeShellRing?.key !== b.compositeShellRing?.key) {
    return no('不同组合壳体外环', '组合壳体只连接同一主板面和同一截面的外侧圆弧，不跨主板或高度合并')
  }

  // This gate precedes all successful branches, including native CAD adjacency.
  // Manual merging uses its own explicit operation and does not call this predicate.
  if (!a.weldingPosition || !b.weldingPosition) {
    return no('焊接位置未确定', '自动合并要求两条焊缝都有明确且相同的焊接位置；未确定位置保持独立')
  }
  if (a.weldingPosition !== b.weldingPosition) {
    return no('焊接位置不同', `焊接位置 ${a.weldingPosition} / ${b.weldingPosition} 不同，禁止自动合并`)
  }
  const travelA = automaticMergeTravelPosition(a, bestI === 0)
  const travelB = automaticMergeTravelPosition(b, bestJ === 1)
  if (!travelA || !travelB || travelA !== travelB) {
    return no('行进焊接位置不同', '首尾拼接后的实际立向上/立向下焊接位置不一致，禁止自动反转串接')
  }

  // 数据级血缘: 闭合圆与其分量半圆几何重叠, 数据层面已是合并产物, 不再重复合并
  if (a.mergedFrom.includes(b.weldId) || b.mergedFrom.includes(a.weldId)) {
    const circ = a.mergedFrom.length > 0 ? a : b
    return no('数据级血缘',
      `${circ.id} 为闭合圆 (合并自 ${circ.mergedFrom.join('/')}), 与其分量重叠, 不再重复合并 → 不合`)
  }

  // 重合区 (几何兜底): 近距(≤2mm)平行(≤10°)区间投影重叠 >1mm → 合并会重复焊接, 禁止。
  // 端点相交/相切是点接触 (投影重叠≈0), 不受影响
  const ovl = r2(polylineOverlapLen(a.points, b.points))
  if (ovl > OVERLAP_LEN) {
    return no('重合区',
      `不合|重合区: 近距平行重叠投影长${ovl}mm > ${OVERLAP_LEN}mm, 合并将重复焊接 → 禁止`,
      { 重叠长度: ovl })
  }

  if (a.compositeShellRing && b.compositeShellRing) {
    const inside = (unit: MergeUnit, endpoint: 0 | 1) => endpoint === 0
      ? new THREE.Vector3().fromArray(unit.points[1]).sub(unit.start)
      : new THREE.Vector3().fromArray(unit.points[unit.points.length - 2]).sub(unit.end)
    const tangentA = compositeShellTangent(a.compositeShellRing, endOf(a, bestI).p, inside(a, bestI))
    const tangentB = compositeShellTangent(b.compositeShellRing, endOf(b, bestJ).p, inside(b, bestJ))
    if (bestGap <= FINITE_INTERVAL_JOIN_TOLERANCE && tangentA && tangentB && tangentA.dot(tangentB) <= -Math.cos(Math.PI / 180)
      && Math.abs(a.焊脚 - b.焊脚) < .1) return {
      ...base, 共线: null, 端特征: [ea.feature, eb.feature], 板厚形成转B: false,
      分支: 'A组合壳体外环连续', 结果: '合并',
      原因: '完整双层圆柱壳体的同一主板截面外环首尾相切，保留原板件及面归属',
    }
    return no('组合壳体外环未连续', '仅连接同一外环上真实首尾相切且工艺一致的圆弧')
  }

  if (a.projectedContourKey && a.projectedContourKey === b.projectedContourKey) {
    const tangentA = bestI === 0 ? a.startNativeTangent : a.endNativeTangent
    const tangentB = bestJ === 0 ? b.startNativeTangent : b.endNativeTangent
    const validLengths = [a.length, b.length].every((length) => length >= params.长度阈值下限 && length <= params.长度阈值上限)
    const validProcess = validLengths && Math.abs(a.焊脚 - b.焊脚) < .1
    // These are native side-wall/host intersection tangents, not a curve's
    // endpoint chord. Each points into its member, so a smooth join opposes them.
    if (tangentA && tangentB && tangentA.dot(tangentB) <= -Math.cos(Math.PI / 180)) {
      if (validProcess) return {
        ...base, 共线: null, 端特征: [ea.feature, eb.feature], 板厚形成转B: false,
        分支: 'A投影原生轮廓连续', 结果: '合并',
        原因: '同源投影轮廓自由端一致，原CAD侧壁与母板法向证明端部相切；保留全部解析曲线点',
      }
    }
    const vertexA = bestI === 0 ? a.startNativeVertex : a.endNativeVertex
    const vertexB = bestJ === 0 ? b.startNativeVertex : b.endNativeVertex
    // The extractor exports only the source face's OuterWire. Distinct native
    // edges sharing both original and projected vertices prove adjacency even
    // where the CAD contour has a real corner. Edge numbers alone prove nothing.
    if (validProcess && vertexA && vertexB && vertexA.edgeIndex !== vertexB.edgeIndex
      && vertexA.sourcePoint.distanceTo(vertexB.sourcePoint) <= 2e-6
      && vertexA.projectedPoint.distanceTo(vertexB.projectedPoint) <= 2e-6) return {
      ...base, 共线: null, 端特征: [ea.feature, eb.feature], 板厚形成转B: false,
      分支: 'A投影原生边邻接', 结果: '合并',
      原因: '同一投影外轮廓的不同原边共享源顶点及投影顶点；连续保留实际折角和全部曲线点',
    }
  }

  // 规则 B
  const ruleB = (分支前缀: string, viaThickness: boolean): PairDecision => {
    const fails: string[] = []
    if (angle < params.夹角阈值下限 || angle > params.夹角阈值上限) {
      fails.push(`夹角${angle}°∉[${params.夹角阈值下限},${params.夹角阈值上限}]`)
    }
    if (a.length < params.长度阈值下限 || a.length > params.长度阈值上限) {
      fails.push(`${a.id}长度${a.length}∉[${params.长度阈值下限},${params.长度阈值上限}]`)
    }
    if (b.length < params.长度阈值下限 || b.length > params.长度阈值上限) {
      fails.push(`${b.id}长度${b.length}∉[${params.长度阈值下限},${params.长度阈值上限}]`)
    }
    if (!(Math.abs(a.焊脚 - b.焊脚) < 0.1)) fails.push(`焊脚不同 ${a.焊脚} vs ${b.焊脚}`)
    // 相邻端部特征尺寸参与比较 (直角/锐角/平角永不阻断)
    const ba = featureDimBlock(`a${ea.label}`, ea.fp, params)
    if (ba) fails.push(ba)
    const bb = featureDimBlock(`b${eb.label}`, eb.fp, params)
    if (bb) fails.push(bb)
    const merged = fails.length === 0
    return {
      ...base, 共线: null, 端特征: null, 板厚形成转B: viaThickness,
      分支: 分支前缀, 结果: merged ? '合并' : '不合',
      原因: merged
        ? `相交/相切(最近距离${r2(touchDist)}≤${params.最大合并距离}), 夹角${angle}°∈阈值, 长度均在阈值内, 焊脚相同${a.焊脚}`
        : fails.join('; '),
    }
  }

  if (parallel && sameEntity) {
    if ((a.板厚独立 ?? a.板厚形成) || (b.板厚独立 ?? b.板厚形成)) {
      return ruleB('B(板厚形成单独焊缝转交)', true)
    }
    const feats: [string, string] = [ea.feature, eb.feature]
    if (NO_MERGE_FEATURES.has(ea.feature) || NO_MERGE_FEATURES.has(eb.feature)) {
      return no('A同实体-端部特征', `端部特征 ${ea.feature}/${eb.feature} 含 D圆弧/优角/凸圆弧 → 不合`,
        { 端特征: feats })
    }
    // 平角/直角/锐角 与 钝角/凹圆弧/长圆弧: 相交/相切即可合
    return {
      ...base, 共线: null, 端特征: feats, 板厚形成转B: false,
      分支: 'A同实体-端部特征', 结果: '合并',
      原因: `端部特征 ${ea.feature}/${eb.feature}, 相交/相切(最近距离${r2(touchDist)}≤${params.最大合并距离}) → 合并`,
    }
  }

  if (parallel && !sameEntity) {
    // 共线: 侧向偏移 (相邻端 delta 垂直于方向的分量) < 1mm
    const dir = a.chord.clone().add(b.chord).lengthSq() > 1e-12
      ? a.chord.clone().add(b.chord).normalize() : a.chord.clone()
    const delta = new THREE.Vector3().subVectors(eb.p, ea.p)
    const lateral = delta.clone().addScaledVector(dir, -delta.dot(dir)).length()
    const collinear = lateral < 1
    if (!collinear) {
      return no('A异实体-不共线', `平行但侧向偏移${r2(lateral)}≥1mm → 不合`, { 共线: false })
    }
    return {
      ...base, 共线: true, 端特征: null, 板厚形成转B: false,
      分支: 'A异实体-共线', 结果: '合并',
      原因: `共线(侧向偏移${r2(lateral)}<1mm), 相交/相切(最近距离${r2(touchDist)}≤${params.最大合并距离}) → 合并`,
    }
  }

  // 不平行 → B
  return ruleB('B(不平行)', false)
}

// ---------------------------------------------------------------- 主入口

export function computeMerges(
  splits: Map<string, WeldSplit>,
  weldsData: WeldsData,
  partsData: PartsData,
  params: MergeParams,
  /** 已删除 (<50mm) 的单元 key 集合: 不参与合并判定 */
  skipUnits?: Set<string>,
): MergeResult {
  const units = buildUnits(splits, weldsData, partsData, skipUnits)
  const dsu = new DSU(units.length)
  const decisions: PairDecision[] = []
  const decisionMap = new Map<string, PairDecision>()
  // 并查集根 → 组内原焊缝 id 集合 (同源阻断用)
  const rootWeldIds = new Map<number, Set<string>>()
  units.forEach((u, i) => rootWeldIds.set(i, new Set([u.weldId])))
  // 并查集根 → 血缘集合 (组内焊缝 id ∪ 闭合圆合并自焊缝 id; 圆与分量半圆不得同组)
  const rootBlood = new Map<number, Set<string>>()
  units.forEach((u, i) => rootBlood.set(i, new Set([u.weldId, ...u.mergedFrom])))
  // 并查集根 → 组成员下标 (重合区传递检查用)
  const rootMembers = new Map<number, number[]>()
  units.forEach((_, i) => rootMembers.set(i, [i]))
  const 同源阻断: { a: string; b: string; 同源焊缝: string[] }[] = []
  const 血缘阻断: { a: string; b: string; 涉及焊缝: string[] }[] = []
  const 重合阻断: { a: string; b: string; 重叠对: { a: string; b: string; 长度: number }[] }[] = []
  // 重叠长度缓存 (成组阶段跨成员复查复用判定阶段结果)
  const ovlCache = new Map<string, number>()
  const overlapOf = (x: number, y: number): number => {
    const k = `${units[x].key}|${units[y].key}`
    const hit = ovlCache.get(k)
    if (hit !== undefined) return hit
    const v = polylineOverlapLen(units[x].points, units[y].points)
    ovlCache.set(k, v)
    ovlCache.set(`${units[y].key}|${units[x].key}`, v)
    return v
  }

  // 候选对预过滤: 单元 bbox 膨胀 最大合并距离 后相交 (相交/相切的必要条件)
  const eps = Math.max(params.最大合并距离, 1)
  const boxes = units.map((u) => {
    const box = new THREE.Box3()
    for (const p of u.points) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]))
    return box.expandByScalar(eps)
  })

  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]
      const b = units[j]
      if (a.weldId === b.weldId) continue // 同一原焊缝绝不合并 (最先排除)
      if (!boxes[i].intersectsBox(boxes[j])) continue
      const touchDist = polylineMinDist(a.points, b.points)
      if (touchDist > params.最大合并距离) {
        // 不相交/不相切: 仅当端点曾相近时才记录判定 (保持 decisions 可读, 不刷屏)
        let minG = Infinity
        for (const x of [0, 1] as const) {
          for (const y of [0, 1] as const) {
            minG = Math.min(minG, endOf(a, x).p.distanceTo(endOf(b, y).p))
          }
        }
        if (minG <= params.最大合并距离 * 2) {
          decisions.push(decide(a, b, params, touchDist))
        }
        continue
      }
      const d = decide(a, b, params, touchDist)
      decisions.push(d)
      decisionMap.set(`${a.key}|${b.key}`, d)
      decisionMap.set(`${b.key}|${a.key}`, d)
      if (d.结果 === '合并') {
        // 同源阻断: 并入后组内会出现同一原焊缝的多段 → 视为合并回原焊缝, 禁止
        const ri = dsu.find(i)
        const rj = dsu.find(j)
        const si = rootWeldIds.get(ri)!
        const sj = rootWeldIds.get(rj)!
        const shared = [...si].filter((w) => sj.has(w))
        // 血缘阻断: 闭合圆与其合并自焊缝 (几何完全重叠) 不得同组 —— 含传递路径
        const bi = rootBlood.get(ri)!
        const bj = rootBlood.get(rj)!
        const bloodHit = [...bi].filter((w) => sj.has(w))
          .concat([...bj].filter((w) => si.has(w)))
        // 重合区传递检查: 候选单元与目标组内所有成员之间不得有近距平行重叠
        // (判定阶段只查了当前对; 传递并入可能把与组内其他成员重叠的单元带进来)
        const ovlHits: { a: string; b: string; 长度: number }[] = []
        for (const x of rootMembers.get(ri)!) {
          for (const y of rootMembers.get(rj)!) {
            const l = overlapOf(x, y)
            if (l > OVERLAP_LEN) {
              ovlHits.push({ a: units[x].id, b: units[y].id, 长度: r2(l) })
            }
          }
        }
        if (shared.length > 0) {
          同源阻断.push({ a: a.id, b: b.id, 同源焊缝: shared })
        } else if (bloodHit.length > 0) {
          血缘阻断.push({ a: a.id, b: b.id, 涉及焊缝: [...new Set(bloodHit)] })
        } else if (ovlHits.length > 0) {
          重合阻断.push({ a: a.id, b: b.id, 重叠对: ovlHits })
        } else {
          dsu.union(i, j)
          const r = dsu.find(i)
          rootWeldIds.set(r, new Set([...si, ...sj]))
          rootBlood.set(r, new Set([...bi, ...bj]))
          rootMembers.set(r, [...rootMembers.get(ri)!, ...rootMembers.get(rj)!])
        }
      }
    }
  }

  // 分组
  const byRoot = new Map<number, number[]>()
  units.forEach((_, i) => {
    const r = dsu.find(i)
    const arr = byRoot.get(r) ?? []
    arr.push(i)
    byRoot.set(r, arr)
  })

  const rawGroups = [...byRoot.values()].filter((m) => m.length >= 2)
  // 组排序: 按成员最小焊缝 id (数字部分)
  const weldNum = (id: string) => parseInt(id.replace(/\D/g, ''), 10) || 0
  rawGroups.sort((g1, g2) => {
    const m1 = Math.min(...g1.map((i) => weldNum(units[i].weldId)))
    const m2 = Math.min(...g2.map((i) => weldNum(units[i].weldId)))
    return m1 - m2
  })

  // 不变量: 成员 key 全局唯一 (一个单元只属于一个组 —— 并查集保证, 显式断言)
  const seenKeys = new Set<string>()
  for (const g of rawGroups) {
    for (const i of g) {
      const k = units[i].key
      if (seenKeys.has(k)) console.error('[merge] 重复段: 单元多次入组', k)
      seenKeys.add(k)
    }
  }

  const mergedUnitKeys = new Set<string>()
  const groups: MergeGroup[] = []
  for (const memberIdx of rawGroups) {
    const members = memberIdx.map((i) => units[i])

    const mergeDec = (u1: MergeUnit, u2: MergeUnit): PairDecision | null => {
      const d = decisionMap.get(`${u1.key}|${u2.key}`)
      return d && d.结果 === '合并' ? d : null
    }

    // A connected graph is not necessarily one continuous traversal: an interior
    // intersection or three branches at the same end requires separate chains.
    const remaining = new Map(members.map((m) => [m.key, m]))
    while (remaining.size > 0) {
      const first = remaining.values().next().value!
      remaining.delete(first.key)
      // 链: 有序 (单元, 是否反向) —— 反向表示折线从 end 走到 start
      const chain: { u: MergeUnit; rev: boolean }[] = [{ u: first, rev: false }]
      const connections: MergeConnection[] = []
      while (remaining.size > 0) {
        const headC = chain[0]
        const tailC = chain[chain.length - 1]
        const headFree = headC.rev ? headC.u.end : headC.u.start // 链头自由端
        const tailFree = tailC.rev ? tailC.u.start : tailC.u.end // 链尾自由端
        let best: {
          m: MergeUnit; gap: number; attach: 'head' | 'tail'; rev: boolean
          jointA: THREE.Vector3; jointB: THREE.Vector3; dec: PairDecision; via: MergeUnit
        } | null = null
        for (const m of remaining.values()) {
          const dh = mergeDec(m, headC.u)
          const dt = mergeDec(m, tailC.u)
          const combos: {
            gap: number; attach: 'head' | 'tail'; rev: boolean
            jointA: THREE.Vector3; jointB: THREE.Vector3; dec: PairDecision; via: MergeUnit
          }[] = []
          if (dh) {
            combos.push(
              { gap: m.end.distanceTo(headFree), attach: 'head', rev: false, jointA: m.end, jointB: headFree, dec: dh, via: headC.u },
              { gap: m.start.distanceTo(headFree), attach: 'head', rev: true, jointA: m.start, jointB: headFree, dec: dh, via: headC.u },
            )
          }
          if (dt) {
            combos.push(
              { gap: m.start.distanceTo(tailFree), attach: 'tail', rev: false, jointA: tailFree, jointB: m.start, dec: dt, via: tailC.u },
              { gap: m.end.distanceTo(tailFree), attach: 'tail', rev: true, jointA: tailFree, jointB: m.end, dec: dt, via: tailC.u },
            )
          }
          for (const c of combos) {
            if (c.gap > joinLimit(m, c.via, params)) continue
            // A pair decision can be consumed at another end during chain growth.
            // Recheck the final traversal so an all-PF source set cannot become PF+PG.
            const travelPosition = automaticMergeTravelPosition(m, c.rev)
            if (!travelPosition || chain.some(({ u, rev }) => automaticMergeTravelPosition(u, rev) !== travelPosition)) continue
            if (m.finiteInterval || c.via.finiteInterval) {
              // The accepted pair may touch at an already consumed end. Do not
              // reuse that decision to attach a different free end of a curve.
              const expectedM = c.dec.相邻端[c.dec.a === m.id ? 0 : 1].endsWith('起点') ? m.start : m.end
              const expectedVia = c.dec.相邻端[c.dec.a === c.via.id ? 0 : 1].endsWith('起点') ? c.via.start : c.via.end
              const actualM = c.attach === 'head' ? c.jointA : c.jointB
              const actualVia = c.attach === 'head' ? c.jointB : c.jointA
              if (actualM.distanceToSquared(expectedM) > 1e-12 || actualVia.distanceToSquared(expectedVia) > 1e-12) continue
            }
            if (!best || c.gap < best.gap) best = { m, ...c }
          }
        }
        if (!best) break
        remaining.delete(best.m.key)
        const mid = best.jointA.clone().add(best.jointB).multiplyScalar(0.5)
        connections.push({
          from: best.attach === 'head' ? best.m.id : best.via.id,
          to: best.attach === 'head' ? best.via.id : best.m.id,
          规则: best.dec.分支.startsWith('B') ? 'B' : 'A',
          分支: best.dec.分支,
          间隙: best.dec.间隙,
          最近距离: best.dec.最近距离,
          夹角: best.dec.夹角,
          焊脚: best.dec.焊脚,
          位置: [r2(mid.x), r2(mid.y), r2(mid.z)],
        })
        if (best.attach === 'head') chain.unshift({ u: best.m, rev: best.rev })
        else chain.push({ u: best.m, rev: best.rev })
      }

      // A singleton stays available as its original segment, rather than disappearing
      // into a group whose actual traversal does not contain it.
      if (chain.length < 2) continue
      chain.forEach(({ u }) => mergedUnitKeys.add(u.key))

      // ---------------- 合成折线 (成员折线按连续链序拼接)
      const pts: THREE.Vector3[] = []
      const pushPt = (p: THREE.Vector3) => {
        if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(p) > 1e-12) pts.push(p)
      }
      for (const { u, rev } of chain) {
        const up = u.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
        if (rev) up.reverse()
        for (const p of up) pushPt(p)
      }
      const memberLen = chain.reduce((s, { u }) => s + u.length, 0)
      const startV = pts[0]
      const endV = pts[pts.length - 1]
      // 重合区规则走查: 组内成员两两重叠长度最大值 (成组已被规则保证 ≤1mm, 此处实测记录)
      let 组内最大重叠 = 0
      const chainIdx = chain.map(({ u }) => memberIdx.find((i) => units[i].key === u.key)!)
      for (let x = 0; x < chainIdx.length; x++) {
        for (let y = x + 1; y < chainIdx.length; y++) {
          const l = overlapOf(chainIdx[x], chainIdx[y])
          if (l > 组内最大重叠) 组内最大重叠 = l
        }
      }

      groups.push({
        id: `M${String(groups.length + 1).padStart(3, '0')}`,
        members: chain.map((c) => orientedMember(c.u, c.rev)),
        totalLength: r1(memberLen),
        start: [r2(startV.x), r2(startV.y), r2(startV.z)],
        end: [r2(endV.x), r2(endV.y), r2(endV.z)],
        points: pts.map((p) => [r2(p.x), r2(p.y), r2(p.z)]),
        closed: startV.distanceTo(endV) < (chain.some(({ u }) => u.finiteInterval) ? FINITE_INTERVAL_JOIN_TOLERANCE : 1),
        connections: connections.sort((a, b) =>
          chain.findIndex(({ u }) => u.id === a.from) - chain.findIndex(({ u }) => u.id === b.from)),
        组内最大重叠: r2(组内最大重叠),
      })
    }
  }

  return {
    groups,
    decisions,
    units,
    mergedUnitKeys,
    同源阻断,
    血缘阻断,
    重合阻断,
    单元总数: units.length,
    合并后总数: groups.length + (units.length - mergedUnitKeys.size),
  }
}

export const END_LABELS = END_LABEL
