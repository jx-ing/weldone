/**
 * 工艺路径库 —— 转角方案 (corner schemes)
 *
 * 数据结构: 转角方案 = { id, name, match, variants }
 *   match: 焊接位置 (位置1→位置2, 代号) + 焊脚多选 + 接头形式单选 + 夹角范围 + 坡口多选
 *   variants: 四种转角情形 (外角-左转/外角-右转/内角-左转/内角-右转),
 *     每种 = { a, b, c, 入角点/转角点/出角点: {工作角,前进角,旋转角} }
 *     a=入角段距离 (转角点沿入射段回退), b=出角段距离 (沿出射段前进),
 *     c=沿对角线方向 (出入射方向角平分线) 的偏移;
 *     三点姿态 = 工作角/前进角/旋转角及可选焊缝架 TCP rx/ry/rz；
 *     工艺默认 (45,0,0)，所有旋转保持 URDF TCP 不动。
 *
 * 转角实例来源: 合并组相邻成员段之间夹角 ≥1° 的连接 (规则 B 类连接与传递链转向点)。
 *
 * 左/右转判据 (沿焊接方向看): up = 转角处两板法向角平分线 (指向角外侧/机头侧),
 *   左转 ⟺ (up × d1)·d2 > 0 (d1=入射方向, d2=出射方向)。
 * 外/内角判据: 曲率方向 k = d2−d1，枪侧方向 g = normalize(bis1)+normalize(bis2)。
 *   k·g < 0 → 弯向材料侧、绕凸棱 → 外角；k·g > 0 → 弯向枪侧、进入凹角 → 内角。
 *   反向遍历保持内/外角，只交换左/右转；几何退化时明确标记兜底依据。
 *   (UI 可手动改判)
 *
 * 持久化: localStorage weldViewer.cornerSchemes.v3 (全局参数性质)。
 *   旧焊缝架角度不能等价改名；保留匹配与几何，标记三点待按模型/模板重算。
 */
import * as THREE from 'three'
import type { PartsData, Weld, WeldsData } from '@/types/weld'
import { normalizeWeldGrooveType, WELD_GROOVE_TYPES } from './weldParameters'
import type { MergeResult } from './weldMerge'
import type { WeldSplit } from './weldSplit'
import { createPoseCurve, poseCurveQuaternionAt } from './poseCurve'
import { endpointWrapDirections, endpointWrapSide, type BaojiaoWrapSide } from './baojiaoFrame'
import {
  buildDemoPath, computePathPoses, computeTorchPose, pathPoseAt, resolveTorchOffset,
  stdAnglesQuat, stdAnglesFromQuat, DEFAULT_STD_ANGLES, weldNormalsAt, sampleAt, torchPoseContext,
  type DemoPath, type DemoTarget, type NozzleAnalysis, type TorchOffset,
  type TorchPose, type WeldStdAngles, type TorchPoseContext, type PathSample,
} from './torch'

// ---------------------------------------------------------------- 类型

/** 工艺三角与焊缝架 TCP 增量；不同于基座固定轴的 rx/ry/rz。 */
export type CornerPoseOffset = WeldStdAngles

export interface CornerVariant {
  /** 入角段距离 mm (转角点沿入射段回退) */
  a: number
  /** 出角段距离 mm (转角点沿出射段前进) */
  b: number
  /** 对角线偏移 mm (转角点沿出入射角平分线方向) */
  c: number
  入角点: CornerPoseOffset
  转角点: CornerPoseOffset
  出角点: CornerPoseOffset
}

export const CORNER_VARIANT_KEYS = ['外角-左转', '外角-右转', '内角-左转', '内角-右转'] as const
export type CornerVariantKey = (typeof CORNER_VARIANT_KEYS)[number]

export interface SchemeEndpointSource {
  weldId: string
  which: 'start' | 'end'
  target: DemoTarget
  /** 同一端点可先内角变姿态，再执行外角包角；分别编辑与回显。 */
  action?: 'pose-change' | 'wrap'
}

export interface CornerMatchRule {
  /** 焊接位置代号 (PA/PB/…/'—'=倾斜无代号): 转角前段 → 转角后段 */
  位置1: string
  位置2: string
  /** 焊脚多选 (两段都须命中) */
  焊脚: number[]
  /** 接头形式单选 (两段都须等于) */
  接头形式: string
  夹角min: number
  夹角max: number
  /** 坡口类型多选 (两段都须命中) */
  坡口: string[]
}

export interface CornerScheme {
  id: string
  name: string
  match: CornerMatchRule
  variants: Record<CornerVariantKey, CornerVariant>
  /** 旧焊缝架角度不能等价改名，待用当前模型/几何模板重算默认工具角。 */
  needsPoseDefaults?: boolean
  /** 每模型/焊接位置独立的兜底；始终让显式匹配的用户方案优先。 */
  positionDefault?: {
    modelKey: string
    position: string
    basis: string
    sources: Record<CornerVariantKey, 'model' | 'template'>
  }
}

/** 下拉/多选选项 */
export const POSITION_CODES = ['PA', 'PB', 'PC', 'PD', 'PE', 'PF', 'PG', '—']
export const GROOVE_TYPES = [...WELD_GROOVE_TYPES]
export const CORNER_JOINT_TYPES = ['T接', '对接', '角接', '搭接']
export const LEG_OPTIONS = [7, 8, 9, 10, 11, 13]

const DEFAULT_POSE: CornerPoseOffset = { ...DEFAULT_STD_ANGLES }

export function emptyVariant(): CornerVariant {
  return {
    a: 10, b: 10, c: 0,
    入角点: { ...DEFAULT_POSE }, 转角点: { ...DEFAULT_POSE }, 出角点: { ...DEFAULT_POSE },
  }
}

/** 几何默认切入/切出距离：给定转弯角和局部尺寸，保留转角TCP (c=0)。
 *  长度由等效转弯半径 r 的切线长 r·tan(theta/2) 计算，短段预留60%直焊空间。
 *  这是可编辑的几何初值，不代替实际机头碰撞校验。 */
export function defaultCornerDistances(input: {
  turnAngle: number; leg: number; thicknessIn?: number; thicknessOut?: number
  availableIn?: number; availableOut?: number
}): Pick<CornerVariant, 'a' | 'b' | 'c'> {
  const angle = Number.isFinite(input.turnAngle) ? Math.max(5, Math.min(150, input.turnAngle)) : 90
  const leg = Number.isFinite(input.leg) && input.leg > 0 ? input.leg : 8
  const tangent = Math.tan(angle * Math.PI / 360)
  const length = (thickness?: number, available?: number) => {
    const radius = Math.max(leg, Number.isFinite(thickness) && thickness! > 0 ? thickness! / 2 : 0)
    const cap = Number.isFinite(available) && available! > 0 ? available! * 0.4 : Infinity
    return Math.max(0.1, Math.min(radius * tangent, cap))
  }
  return { a: length(input.thicknessIn, input.availableIn), b: length(input.thicknessOut, input.availableOut), c: 0 }
}

let schemeSeq = 1
/** 「以当前信息新建方案」的预填参数 */
export type SchemePrefill = Partial<CornerMatchRule> & {
  name?: string; instanceId?: string; variantKey?: CornerVariantKey
  endpoint?: SchemeEndpointSource
}
export function emptyScheme(partial?: SchemePrefill): CornerScheme {
  return {
    id: `CS${Date.now().toString(36)}${(schemeSeq++).toString(36)}`,
    name: partial?.name ?? '新转角方案',
    match: {
      位置1: partial?.位置1 ?? 'PB',
      位置2: partial?.位置2 ?? 'PB',
      焊脚: partial?.焊脚 ?? [8],
      接头形式: partial?.接头形式 ?? 'T接',
      夹角min: partial?.夹角min ?? 60,
      夹角max: partial?.夹角max ?? 120,
      坡口: partial?.坡口 ?? ['无坡口'],
    },
    variants: {
      '外角-左转': emptyVariant(), '外角-右转': emptyVariant(),
      '内角-左转': emptyVariant(), '内角-右转': emptyVariant(),
    },
  }
}

/** 保留旧方案匹配条件与三点几何；旧坐标角度标记为待重算，不冒充等价工具角。 */
export function sanitizeSchemes(raw: unknown): CornerScheme[] {
  if (!Array.isArray(raw)) return []
  const pose = (p: unknown): CornerPoseOffset => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
    if (!('前进角' in o)) return { ...DEFAULT_POSE }
    const num = (k: '工作角' | '前进角' | '旋转角') =>
      (typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] as number : DEFAULT_POSE[k])
    const tcp = o.tcpRotation as Record<string, unknown> | undefined
    return { 工作角: num('工作角'), 前进角: num('前进角'), 旋转角: num('旋转角'),
      ...(tcp && ['rx', 'ry', 'rz'].every((k) => typeof tcp[k] === 'number' && Number.isFinite(tcp[k]))
        ? { tcpRotation: { rx: tcp.rx as number, ry: tcp.ry as number, rz: tcp.rz as number } } : {}) }
  }
  const out: CornerScheme[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const base = emptyScheme()
    const m = { ...base.match, ...(s.match ?? {}) }
    if (!Array.isArray(m.焊脚)) m.焊脚 = base.match.焊脚
    if (!Array.isArray(m.坡口)) m.坡口 = base.match.坡口
    const variants = { ...base.variants }
    let needsPoseDefaults = s.needsPoseDefaults === true
    for (const k of CORNER_VARIANT_KEYS) {
      const v = s.variants?.[k]
      if (v && ['入角点', '转角点', '出角点'].some((pt) => !v[pt]
        || typeof v[pt] !== 'object' || !('前进角' in v[pt]))) {
        needsPoseDefaults = true
      }
      if (v) variants[k] = {
        ...emptyVariant(), ...v,
        入角点: pose(v.入角点), 转角点: pose(v.转角点), 出角点: pose(v.出角点),
      }
    }
    out.push({
      id: typeof s.id === 'string' ? s.id : base.id,
      name: typeof s.name === 'string' ? s.name : base.name,
      match: m, variants, needsPoseDefaults,
      ...(typeof s.positionDefault?.modelKey === 'string' && typeof s.positionDefault?.position === 'string'
        ? { positionDefault: { modelKey: s.positionDefault.modelKey, position: s.positionDefault.position,
          basis: typeof s.positionDefault.basis === 'string' ? s.positionDefault.basis : '按该焊接位置几何计算',
          sources: Object.fromEntries(CORNER_VARIANT_KEYS.map((k) => [k, s.positionDefault.sources?.[k] === 'model' ? 'model' : 'template'])) as Record<CornerVariantKey, 'model' | 'template'> } } : {}),
    })
  }
  return out
}

// ---------------------------------------------------------------- 焊缝特征提取

/** 焊接位置代号 (properties.焊接位置.代号; '—' = 倾斜焊等无代号) */
export function weldPositionCode(weld: Weld): string {
  const p = (weld.properties as Record<string, unknown>)['焊接位置'] as Record<string, unknown> | undefined
  const code = p?.['代号']
  return typeof code === 'string' && code ? code : '—'
}

/** 坡口类型 (properties.坡口.类型) */
export function weldGroove(weld: Weld): string {
  const p = (weld.properties as Record<string, unknown>)['坡口'] as Record<string, unknown> | undefined
  const t = p?.['类型']
  return normalizeWeldGrooveType(t) ?? '无坡口'
}

/** 焊脚 (properties.焊脚) */
export function weldLegValue(weld: Weld): number {
  const v = (weld.properties as Record<string, unknown>)['焊脚']
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN
}

// ---------------------------------------------------------------- 转角实例

/** 匹配用的转角特征向量 */
export interface CornerFeature {
  位置1: string
  位置2: string
  焊脚: [number, number]
  接头形式: [string, string]
  夹角: number
  坡口: [string, string]
}

/** 转角实例 (合并组相邻成员段之间的转向点) */
export interface CornerInstance {
  /** `${groupId}#${memberIndex}` */
  id: string
  groupId: string
  /** 转角前成员在 group.members 链序中的下标 */
  memberIndex: number
  fromId: string
  toId: string
  /** 转角点坐标 (两接头端中点) */
  pos: number[]
  /** 入射/出射单位方向 */
  d1: number[]
  d2: number[]
  /** 转角处平均法向 (入/出段主板、副板法向分别平均) */
  nMain: number[]
  nSub: number[]
  feature: CornerFeature
  /** 判定结果与依据 */
  variantKey: CornerVariantKey
  判定依据: string
  /** 是否手动改判 (UI 覆盖) */
  overridden: boolean
  match: { id: string; name: string } | null
  未匹配原因: string | null
  /** 套入几何 (匹配成功时) */
  applied: {
    a: number; b: number; c: number
    入角点: number[]
    转角点: number[]
    出角点: number[]
  } | null
}

const r1c = (v: number) => Math.round(v * 10) / 10
const r2c = (v: number) => Math.round(v * 100) / 100
const v3 = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2])
const arr = (v: THREE.Vector3) => [r2c(v.x), r2c(v.y), r2c(v.z)]

/** 折线端部切向: which='end' 到达方向, 'start' 离去方向 */
function endDir(pts: number[][], which: 'start' | 'end'): THREE.Vector3 | null {
  const n = pts.length
  if (n < 2) return null
  if (which === 'end') {
    for (let i = n - 2; i >= 0; i--) {
      const d = v3(pts[n - 1]).sub(v3(pts[i]))
      if (d.lengthSq() > 1e-12) return d.normalize()
    }
  } else {
    for (let i = 1; i < n; i++) {
      const d = v3(pts[i]).sub(v3(pts[0]))
      if (d.lengthSq() > 1e-12) return d.normalize()
    }
  }
  return null
}

/**
 * 内角是枪侧空间中的凹角，外角是绕材料凸棱的转角。
 * 曲率 d2−d1 指向转弯内侧；与枪侧平均法向同向为内角，反向为外角。
 * 不使用 (d1×d2)·(bis1×bis2)：两侧法向同时反号时它不变，不能区分凸凹。
 * 左右转沿枪侧观察；枪侧恰在转弯平面内时，取转弯平面的固定正轴侧观察。
 */
export function classifyCorner(
  d1: THREE.Vector3, d2: THREE.Vector3,
  bis1: THREE.Vector3, bis2: THREE.Vector3,
): { key: CornerVariantKey; 依据: string } {
  const inDir = d1.clone().normalize()
  const outDir = d2.clone().normalize()
  const gunSide = bis1.clone().normalize().add(bis2.clone().normalize())
  const curvature = outDir.clone().sub(inDir)
  const curvatureToGun = curvature.dot(gunSide)
  const tolerance = 1e-6 * Math.max(1, curvature.length() * gunSide.length())
  const outer = curvatureToGun <= tolerance
  const basis = Math.abs(curvatureToGun) <= tolerance
    ? '曲率与枪侧方向退化，暂按外角（可手动改判）'
    : outer ? '曲率背离枪侧、弯向材料侧 → 凸棱外角' : '曲率朝向枪侧 → 凹角内角'
  const turnAxis = new THREE.Vector3().crossVectors(inDir, outDir)
  let signedTurn = turnAxis.dot(gunSide)
  let view = '枪侧'
  if (Math.abs(signedTurn) < 1e-6) {
    // 仅选择观察侧，不随路径方向翻转；反向遍历时 signedTurn 因而反号。
    const components = [turnAxis.x, turnAxis.y, turnAxis.z]
    const axis = components.reduce((best, value, i) => Math.abs(value) > Math.abs(components[best]) ? i : best, 0)
    signedTurn = components[axis]
    view = `转弯平面 +${['X', 'Y', 'Z'][axis]} 侧`
  }
  const left = signedTurn > 0
  return {
    key: `${outer ? '外' : '内'}角-${left ? '左' : '右'}转`,
    依据: `${view}观察为${left ? '左' : '右'}转；${basis}`,
  }
}

/** 方案匹配: 返回 null = 命中, 否则未匹配原因 */
export function matchReason(rule: CornerMatchRule, f: CornerFeature): string | null {
  if (rule.位置1 !== f.位置1 || rule.位置2 !== f.位置2) {
    return `焊接位置 ${f.位置1}→${f.位置2} ≠ 方案 ${rule.位置1}→${rule.位置2}`
  }
  if (!rule.焊脚.includes(f.焊脚[0]) || !rule.焊脚.includes(f.焊脚[1])) {
    return `焊脚 ${f.焊脚[0]}/${f.焊脚[1]} 不在方案 [${rule.焊脚.join('/')}]`
  }
  if (f.接头形式[0] !== rule.接头形式 || f.接头形式[1] !== rule.接头形式) {
    return `接头形式 ${f.接头形式[0]}/${f.接头形式[1]} ≠ 方案 ${rule.接头形式}`
  }
  if (f.夹角 < rule.夹角min || f.夹角 > rule.夹角max) {
    return `夹角 ${f.夹角}° ∉ [${rule.夹角min}, ${rule.夹角max}]`
  }
  if (!rule.坡口.some(type => normalizeWeldGrooveType(type) === normalizeWeldGrooveType(f.坡口[0]))
    || !rule.坡口.some(type => normalizeWeldGrooveType(type) === normalizeWeldGrooveType(f.坡口[1]))) {
    return `坡口 ${f.坡口[0]}/${f.坡口[1]} 不在方案 [${rule.坡口.join('/')}]`
  }
  return null
}

/** 默认方案覆盖该位置的所有焊脚/接头/夹角/坡口；常规方案仍严格匹配。 */
export function schemeMatchReason(scheme: CornerScheme, f: CornerFeature): string | null {
  const fallback = scheme.positionDefault
  if (!fallback) return matchReason(scheme.match, f)
  return f.位置1 === fallback.position ? null
    : `入射焊接位置 ${f.位置1} ≠ 默认方案 ${fallback.position}`
}

export function defaultSchemeUsage(scheme: CornerScheme | null, feature: CornerFeature): string | null {
  if (!scheme?.positionDefault) return null
  return feature.位置1 === feature.位置2 ? `无用户方案匹配，采用 ${feature.位置1} 位置默认`
    : `人工跨位置 ${feature.位置1}→${feature.位置2}：无用户方案匹配，采用入射位置 ${feature.位置1} 默认`
}

/** 显式用户方案优先；无匹配时使用该焊接位置的默认方案，与数组顺序无关。 */
export function matchScheme(
  schemes: CornerScheme[], f: CornerFeature,
): { scheme: CornerScheme; reason: null } | { scheme: null; reason: string } {
  let firstReason = '库为空'
  for (const s of schemes.filter((scheme) => !scheme.positionDefault)) {
    const r = matchReason(s.match, f)
    if (r === null) return { scheme: s, reason: null }
    if (firstReason === '库为空') firstReason = r
  }
  const fallback = schemes.find((scheme) => scheme.positionDefault && schemeMatchReason(scheme, f) === null)
  if (fallback) return { scheme: fallback, reason: null }
  return { scheme: null, reason: schemes.length === 0 ? '库为空, 无方案' : `最近方案不匹配: ${firstReason}` }
}

/** 三点几何: 入角点 = 转角点−d1·a; 出角点 = 转角点+d2·b; 转角点 = 转角点+diag·c */
export function cornerPoints(
  pos: THREE.Vector3, d1: THREE.Vector3, d2: THREE.Vector3,
  a: number, b: number, c: number,
): { 入角点: number[]; 转角点: number[]; 出角点: number[] } {
  const diag = d1.clone().add(d2)
  if (diag.lengthSq() < 1e-6) diag.copy(d1)
  diag.normalize()
  return {
    入角点: arr(pos.clone().addScaledVector(d1, -a)),
    转角点: arr(pos.clone().addScaledVector(diag, c)),
    出角点: arr(pos.clone().addScaledVector(d2, b)),
  }
}

/** 从合并结果提取全部转角实例 (夹角 ≥1° 的相邻成员连接), 并匹配方案 */
export function computeCornerInstances(
  merges: MergeResult | null,
  weldsData: WeldsData,
  partsData: PartsData,
  mesh: Float32Array,
  schemes: CornerScheme[],
  /** 手动改判: 实例 id → variantKey */
  overrides?: Record<string, CornerVariantKey>,
  /** Extract real geometry without querying or applying the retained library. */
  options?: { schemesEnabled?: boolean },
): CornerInstance[] {
  if (!merges) return []
  const weldById = new Map(weldsData.welds.map((w) => [w.id, w]))
  const out: CornerInstance[] = []
  for (const g of merges.groups) {
    for (let k = 0; k + 1 < g.members.length; k++) {
      const m1 = g.members[k]
      const m2 = g.members[k + 1]
      // 成员已沿合并链定向；重新选最近端可能把等距/短曲线转角放到另一端。
      const p1 = m1.end
      const p2 = m2.start
      const pos = p1.clone().add(p2).multiplyScalar(0.5)
      // d1 = 到达接头的方向 (沿焊接方向), d2 = 离开接头的方向
      // 投影轮廓带原 CAD 端部切向；采样弦会把圆弧与直线的 G1 相切误报成小转角。
      // Native 切向朝成员内部，链反向已交换首尾，因此到达端取负、离开端保持。
      const d1 = m1.endNativeTangent?.clone().negate().normalize() ?? endDir(m1.points, 'end')
      const d2 = m2.startNativeTangent?.clone().normalize() ?? endDir(m2.points, 'start')
      if (!d1 || !d2) continue
      const 夹角 = r1c(Math.acos(Math.max(-1, Math.min(1, d1.dot(d2)))) * 180 / Math.PI)
      if (夹角 < 1) continue // 直线延续不是转角
      const w1 = weldById.get(m1.weldId)
      const w2 = weldById.get(m2.weldId)
      if (!w1 || !w2) continue
      const pa: [number, number, number] = [pos.x, pos.y, pos.z]
      const n1 = weldNormalsAt(w1, partsData, mesh, pa)
      const n2 = weldNormalsAt(w2, partsData, mesh, pa)
      const bis1 = n1.nMain.clone().add(n1.nSub)
      const bis2 = n2.nMain.clone().add(n2.nSub)
      const nMainAvg = n1.nMain.clone().add(n2.nMain)
      const nSubAvg = n1.nSub.clone().add(n2.nSub)
      const id = `${g.id}#${k}`
      const ovr = options?.schemesEnabled === false ? undefined : overrides?.[id]
      const cls = classifyCorner(d1, d2, bis1, bis2)
      const variantKey = ovr ?? cls.key
      const feature: CornerFeature = {
        位置1: weldPositionCode(w1), 位置2: weldPositionCode(w2),
        焊脚: [weldLegValue(w1), weldLegValue(w2)],
        接头形式: [w1.jointType, w2.jointType],
        夹角,
        坡口: [weldGroove(w1), weldGroove(w2)],
      }
      const mm = options?.schemesEnabled === false ? { scheme: null, reason: null } : matchScheme(schemes, feature)
      let applied: CornerInstance['applied'] = null
      if (mm.scheme) {
        const v = mm.scheme.variants[variantKey]
        applied = { a: v.a, b: v.b, c: v.c, ...cornerPoints(pos, d1, d2, v.a, v.b, v.c) }
      }
      out.push({
        id, groupId: g.id, memberIndex: k,
        fromId: m1.id, toId: m2.id,
        pos: arr(pos), d1: arr(d1), d2: arr(d2),
        nMain: arr(nMainAvg.lengthSq() > 1e-9 ? nMainAvg.normalize() : n1.nMain),
        nSub: arr(nSubAvg.lengthSq() > 1e-9 ? nSubAvg.normalize() : n1.nSub),
        feature, variantKey,
        判定依据: `${ovr ? `手动改判为 ${ovr} (自动: ${cls.key})` : cls.依据}${mm.scheme?.positionDefault ? `；${defaultSchemeUsage(mm.scheme, feature)}` : ''}`,
        overridden: !!ovr,
        match: mm.scheme ? { id: mm.scheme.id, name: mm.scheme.name } : null,
        未匹配原因: mm.scheme ? null : mm.reason,
        applied,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------- 演示路径姿态叠加

/** 单个转角的姿态叠加计划 (三点锚坐标 + 三点标准角) */
export interface CornerPosePlan {
  inPos: number[]
  apexPos: number[]
  outPos: number[]
  sIn?: number
  sApex?: number
  sOut?: number
  aIn: WeldStdAngles
  aApex: WeldStdAngles
  aOut: WeldStdAngles
}

export function posePlanOf(variant: CornerVariant, applied: NonNullable<CornerInstance['applied']>): CornerPosePlan {
  return {
    inPos: applied.入角点, apexPos: applied.转角点, outPos: applied.出角点,
    aIn: variant.入角点, aApex: variant.转角点, aOut: variant.出角点,
  }
}

function clonePose(p: TorchPose): TorchPose {
  return {
    ...p, position: p.position.clone(), quaternion: p.quaternion.clone(),
    bisector: p.bisector.clone(), wireTipWorld: p.wireTipWorld.clone(),
    axisWorld: p.axisWorld.clone(), yWorld: p.yWorld.clone(), bodyWorld: p.bodyWorld.clone(),
  }
}

function setPoseQuaternion(pose: TorchPose, q: THREE.Quaternion, analysis: NozzleAnalysis): void {
  const delta = q.clone().multiply(pose.quaternion.clone().invert())
  pose.quaternion.copy(q)
  pose.position.copy(pose.wireTipWorld).sub(analysis.wireTip.clone().applyQuaternion(q))
  pose.axisWorld.copy(analysis.axis).applyQuaternion(q)
  pose.yWorld.applyQuaternion(delta)
  pose.bodyWorld.applyQuaternion(delta)
}

/** 普通转角、半包动作和草稿回显共用的三点绝对工具角求解。 */
export function resolveCornerActionQuaternions(
  nominal: THREE.Quaternion[], variant: CornerVariant, contexts?: TorchPoseContext[],
): THREE.Quaternion[] {
  return [variant.入角点, variant.转角点, variant.出角点].map((angles, i) =>
    stdAnglesQuat(angles, nominal[i], contexts?.[i]).multiply(nominal[i]))
}

/** 从未修改的主路径取边界角速度，曲面焊缝也能连续接入/接出。 */
function boundaryAngularVelocity(path: DemoPath, s: number, side: 'before' | 'after', analysis: NozzleAnalysis) {
  const distances = path.samples.map((sample) => side === 'before' ? s - sample.s : sample.s - s)
    .filter((distance) => distance > 1e-9)
  const step = Math.min(0.001, distances.length ? Math.min(...distances) / 2 : 0)
  const a = side === 'before' ? Math.max(0, s - step) : s
  const b = side === 'after' ? Math.min(path.total, s + step) : s
  if (b - a < 1e-9) return new THREE.Vector3()
  const q = pathPoseAt(path, b, analysis).quaternion
    .multiply(pathPoseAt(path, a, analysis).quaternion.invert()).normalize()
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
  const axis = new THREE.Vector3(q.x, q.y, q.z)
  const length = axis.length()
  return length < 1e-12 ? axis : axis.multiplyScalar(2 * Math.atan2(length, q.w) / (length * (b - a)))
}

/** 三点绝对工具角由同一连续姿态曲线求值；入口出口在明确长度内衔接主路径。 */
export function applyCornerPoseOffsets(
  path: DemoPath, plans: CornerPosePlan[], analysis: NozzleAnalysis, nominalPath?: DemoPath,
): void {
  if (!path.poses || path.poses.length === 0) return
  const baseline = { ...path, samples: path.samples.slice(), poses: path.poses.map(clonePose), poseCurves: path.poseCurves?.slice() }
  const nominal = nominalPath ?? baseline
  const samples = path.samples
  const nearestS = (p: number[]): number => {
    let bi = 0
    let bd = Infinity
    for (let i = 0; i < samples.length; i++) {
      const d = (samples[i].pos.x - p[0]) ** 2 + (samples[i].pos.y - p[1]) ** 2
        + (samples[i].pos.z - p[2]) ** 2
      if (d < bd) { bd = d; bi = i }
    }
    return samples[bi].s
  }
  const spans = plans.map((plan) => ({ ...plan,
    sIn: plan.sIn ?? nearestS(plan.inPos), sApex: plan.sApex ?? nearestS(plan.apexPos),
    sOut: plan.sOut ?? nearestS(plan.outPos),
  })).filter((plan) => plan.sIn < plan.sApex && plan.sApex < plan.sOut).sort((a, b) => a.sIn - b.sIn)
  const windows = spans.map((plan, index) => ({
    start: plan.sIn - Math.min(Math.max(5, plan.sApex - plan.sIn),
      Math.max(0, plan.sIn - (spans[index - 1]?.sOut ?? 0)) / 2),
    end: plan.sOut + Math.min(Math.max(5, plan.sOut - plan.sApex),
      Math.max(0, (spans[index + 1]?.sIn ?? path.total) - plan.sOut) / 2),
  }))
  const velocityAt = (s: number, side: 'before' | 'after', shared: boolean) => {
    const velocity = boundaryAngularVelocity(baseline, s, side, analysis)
    return shared ? velocity.add(boundaryAngularVelocity(baseline, s, side === 'before' ? 'after' : 'before', analysis)).multiplyScalar(0.5)
      : velocity
  }
  path.poseCurves = path.poseCurves?.slice() ?? []
  for (let index = 0; index < spans.length; index++) {
    const plan = spans[index]
    const { sIn, sApex, sOut } = plan
    const nominalQuats = [sIn, sApex, sOut].map((s) => pathPoseAt(nominal, s, analysis).quaternion)
    const quats = resolveCornerActionQuaternions(nominalQuats, {
      a: sApex - sIn, b: sOut - sApex, c: 0,
      入角点: plan.aIn, 转角点: plan.aApex, 出角点: plan.aOut,
    }, [sIn, sApex, sOut].map((s) => torchPoseContext(sampleAt(nominal, s), analysis)))
    // 邻近动作各使用间隙的一半；不会把自定义角挤到任意5mm采样格点处骤变。
    const { start, end } = windows[index]
    const keys = [sIn, sApex, sOut].map((s, i) => ({ s, quaternion: quats[i] }))
    if (start < sIn - 1e-9) keys.unshift({ s: start, quaternion: pathPoseAt(baseline, start, analysis).quaternion })
    if (end > sOut + 1e-9) keys.push({ s: end, quaternion: pathPoseAt(baseline, end, analysis).quaternion })
    const curve = createPoseCurve(keys, {
      startAngularVelocity: velocityAt(start, 'before', Math.abs((windows[index - 1]?.end ?? -Infinity) - start) < 1e-9),
      endAngularVelocity: velocityAt(end, 'after', Math.abs((windows[index + 1]?.start ?? Infinity) - end) < 1e-9),
    })
    // 精确插入曲线边界，避免边界外的普通slerp借用区间内部已改写的姿态。
    for (const s of [start, end]) {
      if (samples.some((sample) => Math.abs(sample.s - s) < 1e-9)) continue
      const i = samples.findIndex((sample) => sample.s > s)
      const at = i < 0 ? samples.length : i
      samples.splice(at, 0, sampleAt(baseline, s))
      path.poses.splice(at, 0, pathPoseAt(baseline, s, analysis))
    }
    path.poseCurves.push(curve)
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i].s
      if (s < start - 1e-9 || s > end + 1e-9) continue
      setPoseQuaternion(path.poses[i], poseCurveQuaternionAt(curve, s), analysis)
    }
  }
}

export interface CornerPathContext {
  weldsData: WeldsData
  partsData: PartsData
  mesh: Float32Array
  splits: Map<string, WeldSplit> | null
  merges: MergeResult | null
  instances: CornerInstance[]
  schemes: CornerScheme[]
  analysis: NozzleAnalysis
  offset: TorchOffset
}

export interface PreparedCornerPath {
  /** 最终可直接播放/碰撞扫描的姿态，已包含面板与方案控制。 */
  path: DemoPath
  /** 相同几何上的默认姿态，供工具角反解与创建方案使用。 */
  nominalPath: DemoPath
  unmatchedCorners: number
}

/** 演示、草稿回显与默认参数计算共用真实路径注入及姿态解算。 */
export function prepareCornerPath(
  target: DemoTarget, context: CornerPathContext,
  override?: { instanceId: string; variant: CornerVariant }, applySchemes = true,
): PreparedCornerPath | null {
  const instances = target.kind === 'merge'
    ? context.instances.filter((c) => c.groupId === target.mergeId) : []
  const selected = instances.flatMap((instance) => {
    // 草稿/保存库变化时不读取旧实例缓存，执行与界面统计共用第一匹配规则。
    const scheme = matchScheme(context.schemes, instance.feature).scheme
    let variant = override?.instanceId === instance.id ? override.variant
      : scheme?.variants[instance.variantKey]
    const automatic = !variant
    if (automatic) {
      const members = context.merges?.groups.find((g) => g.id === instance.groupId)?.members
      const incoming = members?.[instance.memberIndex], outgoing = members?.[instance.memberIndex + 1]
      const thickness = (id?: string) => context.partsData.parts.find((p) => p.id === id)?.thickness
      variant = { ...emptyVariant(), ...defaultCornerDistances({
        turnAngle: instance.feature.夹角, leg: Math.max(...instance.feature.焊脚),
        thicknessIn: thickness(incoming?.subPartId), thicknessOut: thickness(outgoing?.subPartId),
        availableIn: incoming?.length, availableOut: outgoing?.length,
      }) }
    }
    return variant && Number.isFinite(variant.a) && Number.isFinite(variant.b)
      && Number.isFinite(variant.c) && variant.a >= 0.1 && variant.b >= 0.1
      ? [{ instance, variant, automatic }] : []
  })
  const path = buildDemoPath(target, context.weldsData, context.partsData, context.mesh,
    context.splits, context.merges, selected.map(({ instance, variant }) => ({
      memberIndex: instance.memberIndex, a: variant.a, b: variant.b, c: variant.c,
      nMain: instance.nMain as [number, number, number],
      nSub: instance.nSub as [number, number, number],
    })))
  if (!path) return null
  computePathPoses(path, context.analysis)
  const nominalPath = { ...path, samples: path.samples.slice(), poses: path.poses!.map(clonePose) }
  for (const [index, pose] of path.poses!.entries()) {
    const q = resolveTorchOffset(context.offset, pose.quaternion,
      torchPoseContext(path.samples[index], context.analysis)).multiply(pose.quaternion)
    setPoseQuaternion(pose, q, context.analysis)
  }
  const plans = selected.flatMap(({ instance, variant, automatic }) => {
    const anchor = path.cornerAnchors?.find((a) => a.memberIndex === instance.memberIndex)
    if (!anchor || !(anchor.sIn < anchor.sApex && anchor.sApex < anchor.sOut)) return []
    if (!automatic) return [{ ...anchor, aIn: variant.入角点, aApex: variant.转角点, aOut: variant.出角点 }]
    const distances = [anchor.sIn, anchor.sApex, anchor.sOut]
    const nominal = distances.map((s) => pathPoseAt(nominalPath, s, context.analysis).quaternion)
    const start = pathPoseAt(path, anchor.sIn, context.analysis).quaternion
    const end = pathPoseAt(path, anchor.sOut, context.analysis).quaternion
    const progress = (anchor.sApex - anchor.sIn) / (anchor.sOut - anchor.sIn)
    const frames = distances.map((s) => torchPoseContext(sampleAt(nominalPath, s), context.analysis))
    return [{ ...anchor, aIn: stdAnglesFromQuat(start, nominal[0], frames[0]),
      aApex: stdAnglesFromQuat(start.clone().slerp(end, progress), nominal[1], frames[1]),
      aOut: stdAnglesFromQuat(end, nominal[2], frames[2]) }]
  })
  if (applySchemes) applyCornerPoseOffsets(path, plans, context.analysis, nominalPath)
  return { path, nominalPath, unmatchedCorners: instances.length - selected.filter((item) => !item.automatic).length }
}

// ---------------------------------------------------------------- 方案三点回显

/** 编辑器「回显」请求 (编辑器 → App): 草稿当前值随请求携带, 未保存也能回显 */
export interface SchemeEchoRequest {
  schemeId: string
  variantKey: CornerVariantKey
  point: '入角点' | '转角点' | '出角点'
  variant: CornerVariant
  match: CornerMatchRule
  endpoint?: SchemeEndpointSource
  /** 完整草稿快照，保证同一路径上的其他匹配动作也使用编辑器当前值。 */
  scheme?: CornerScheme
}

/** 交给 3D 的草稿请求；点位与姿态必须从 prepareCornerPath 的真实锚点获取。 */
export interface CornerEchoPoseReq {
  key: string
  instId: string
  groupId: string
  pointName: SchemeEchoRequest['point']
  variant: CornerVariant
  endpoint?: SchemeEndpointSource
  variantKey?: CornerVariantKey
  match?: CornerMatchRule
  scheme?: CornerScheme
}

/**
 * 回显目标解算: 在转角实例中找「匹配该方案」的第 n 个 (n 循环取模),
 * 当前情形与草稿匹配规则必须同时满足；已保存方案 ID 不覆盖草稿修改。
 * 此处只定位实例，实际三点及姿态由 prepareCornerEcho 统一解算。
 */
export function schemeEchoTarget(
  req: SchemeEchoRequest & { n?: number }, instances: CornerInstance[],
): (CornerEchoPoseReq & { instId: string; n: number; reqN: number; count: number }) | null {
  if (req.endpoint) return {
    key: JSON.stringify(['endpoint-scheme', req.endpoint, req.variantKey, req.point, req.variant, req.match, req.scheme]),
    groupId: '', instId: `${req.endpoint.weldId}@${req.endpoint.which}`,
    pointName: req.point, variant: req.variant, variantKey: req.variantKey, match: req.match,
    endpoint: req.endpoint, scheme: req.scheme, n: 0, reqN: 0, count: 1,
  }
  const cands = instances.filter((c) => c.variantKey === req.variantKey
    && (req.scheme ? schemeMatchReason(req.scheme, c.feature) : matchReason(req.match, c.feature)) === null)
  if (cands.length === 0) return null
  const n = ((req.n ?? 0) % cands.length + cands.length) % cands.length
  const inst = cands[n]
  return {
    key: JSON.stringify(['scheme', req.schemeId, req.variantKey, req.point, inst.id,
      req.variant, req.match, req.scheme, inst.pos, inst.d1, inst.d2]),
    groupId: inst.groupId, pointName: req.point, variant: req.variant, variantKey: req.variantKey,
    instId: inst.id, n, reqN: req.n ?? 0, count: cands.length, scheme: req.scheme,
  }
}

export interface CornerEchoGeometry {
  points: { name: SchemeEchoRequest['point']; pos: number[] }[]
  polyline: number[][]
  reference: number[]
  requested: Pick<CornerVariant, 'a' | 'b' | 'c'>
  actual: Pick<CornerVariant, 'a' | 'b' | 'c'>
  note: string
}

export interface PreparedCornerEcho {
  pose: TorchPose
  nominalPose: TorchPose
  point: number[]
  path: DemoPath
  sample: PathSample
  geometry: CornerEchoGeometry
}

/** 锚点可能落在圆弧折线上，a/b 应量原成员弧长，不能用到端点的直线距离代替。 */
function memberAnchorDistance(points: number[][], point: number[], fromEnd: boolean): number {
  const target = v3(point)
  let total = 0, at = 0, best = Infinity
  for (let i = 1; i < points.length; i++) {
    const start = v3(points[i - 1]), direction = v3(points[i]).sub(start)
    const length = direction.length()
    if (length < 1e-9) continue
    direction.divideScalar(length)
    const along = Math.max(0, Math.min(length, target.clone().sub(start).dot(direction)))
    const distance = start.addScaledVector(direction, along).distanceToSquared(target)
    if (distance < best) { best = distance; at = total + along }
    total += length
  }
  return fromEnd ? total - at : at
}

export function prepareCornerEcho(req: CornerEchoPoseReq, context: CornerPathContext): PreparedCornerEcho | null {
  const instance = context.instances.find((c) => c.id === req.instId)
  if (!instance || instance.groupId !== req.groupId) return null
  const preview = req.scheme ? { ...context, schemes: [req.scheme, ...context.schemes.filter((scheme) => scheme.id !== req.scheme!.id)] } : context
  const prepared = prepareCornerPath({ kind: 'merge', mergeId: req.groupId }, preview,
    { instanceId: req.instId, variant: req.variant })
  const anchor = prepared?.path.cornerAnchors?.find((a) => a.memberIndex === instance.memberIndex)
  if (!prepared || !anchor || !(anchor.sIn < anchor.sApex && anchor.sApex < anchor.sOut)) return null
  const s = req.pointName === '入角点' ? anchor.sIn
    : req.pointName === '出角点' ? anchor.sOut : anchor.sApex
  const pose = pathPoseAt(prepared.path, s, context.analysis)
  const nominalPose = pathPoseAt(prepared.nominalPath, s, context.analysis)
  const members = context.merges?.groups.find((group) => group.id === req.groupId)?.members
  const incoming = members?.[instance.memberIndex], outgoing = members?.[instance.memberIndex + 1]
  const reference = incoming?.points.at(-1)?.slice() ?? instance.pos.slice()
  const actual = {
    a: incoming ? memberAnchorDistance(incoming.points, anchor.inPos, true) : req.variant.a,
    b: outgoing ? memberAnchorDistance(outgoing.points, anchor.outPos, false) : req.variant.b,
    c: v3(anchor.apexPos).distanceTo(v3(reference)) * Math.sign(req.variant.c),
  }
  const requested = { a: req.variant.a, b: req.variant.b, c: req.variant.c }
  const limited = (['a', 'b', 'c'] as const).some((key) => Math.abs(actual[key] - requested[key]) > 1e-6)
  const geometry: CornerEchoGeometry = {
    points: [{ name: '入角点', pos: anchor.inPos.slice() }, { name: '转角点', pos: anchor.apexPos.slice() },
      { name: '出角点', pos: anchor.outPos.slice() }],
    polyline: [anchor.inPos.slice(), anchor.apexPos.slice(), anchor.outPos.slice()], reference, requested, actual,
    note: limited ? '按当前连接转角的实际三点回显；a/b受可用焊缝长度限制，不叠加避障。'
      : '按当前连接转角的方案三点回显，不叠加避障。',
  }
  return { pose, nominalPose, point: pose.wireTipWorld.toArray(), path: prepared.path,
    sample: sampleAt(prepared.path, s), geometry }
}

/** 无实际匹配时使用对应内/外角、左右转的三点几何模板计算，不伪称实际回显。 */
function templateDefaultPath(key: CornerVariantKey, variant: CornerVariant, angle: number,
  analysis: NozzleAnalysis, reference?: TorchPoseContext): { path: DemoPath; sIn: number; sApex: number; sOut: number } {
  const turn = key.endsWith('左转') ? 1 : -1
  const theta = Math.max(5, Math.min(175, angle)) * Math.PI / 180
  const d1 = new THREE.Vector3(1, 0, 0)
  const d2 = new THREE.Vector3(Math.cos(theta), turn * Math.sin(theta), 0)
  const points = cornerPoints(new THREE.Vector3(), d1, d2, Math.max(1, variant.a), Math.max(1, variant.b), variant.c)
  const positions = [v3(points.入角点), v3(points.转角点), v3(points.出角点)]
  const nMain = new THREE.Vector3(0, 0, 1)
  const tangent = [positions[1].clone().sub(positions[0]).normalize(),
    d1.clone().add(d2).normalize(), positions[2].clone().sub(positions[1]).normalize()]
  // 左转时曲率在路径左侧：内角枪侧在左，外角枪侧在右；右转相反。
  const sign = (key.startsWith('内角') ? 1 : -1) * turn
  const nSubIn = new THREE.Vector3().crossVectors(nMain, d1).multiplyScalar(sign)
  const nSubOut = new THREE.Vector3().crossVectors(nMain, d2).multiplyScalar(sign)
  const nSub = [nSubIn, nSubIn.clone().add(nSubOut).normalize(), nSubOut]
  const distances = [0, positions[0].distanceTo(positions[1])]
  distances.push(distances[1] + positions[1].distanceTo(positions[2]))
  const path: DemoPath = {
    samples: positions.map((pos, i) => ({ s: distances[i], pos, tangent: tangent[i],
      nMain: nMain.clone(), nSub: nSub[i].clone(), weldingPosition: reference?.weldingPosition })),
    total: distances[2], closed: false, targetDesc: `模板 ${key}`,
  }
  if (reference) {
    // 模板随该模型真实焊缝的切向和主支撑面放置；立焊/仰焊/倾斜焊不能共用世界水平模板。
    const x = reference.tangent.clone().normalize()
    const z = (reference.nMain ?? new THREE.Vector3(0, 0, 1)).clone().addScaledVector(x, -(reference.nMain?.dot(x) ?? x.z))
    if (z.lengthSq() < 1e-10) { z.copy(reference.nSub ?? new THREE.Vector3(0, 1, 0)); z.addScaledVector(x, -z.dot(x)) }
    if (z.lengthSq() < 1e-10) { z.set(Math.abs(x.z) < .9 ? 0 : 1, 0, Math.abs(x.z) < .9 ? 1 : 0); z.addScaledVector(x, -z.dot(x)) }
    z.normalize()
    const y = new THREE.Vector3().crossVectors(z, x).normalize()
    z.crossVectors(x, y).normalize()
    const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
    for (const sample of path.samples) {
      sample.pos.applyQuaternion(rotation); sample.tangent.applyQuaternion(rotation)
      sample.nMain.applyQuaternion(rotation); sample.nSub.applyQuaternion(rotation)
    }
  }
  computePathPoses(path, analysis)
  return { path, sIn: distances[0], sApex: distances[1], sOut: distances[2] }
}

/** 四类分别由匹配实例/模板计算距离；三点工具角由实际几何姿态反解。 */
export function computeSchemeDefaults(
  scheme: CornerScheme, context: CornerPathContext, preferredInstanceId?: string,
): { scheme: CornerScheme; sources: Record<CornerVariantKey, 'model' | 'template'> } {
  const variants = { ...scheme.variants }
  const sources = {} as Record<CornerVariantKey, 'model' | 'template'>
  for (const key of CORNER_VARIANT_KEYS) {
    const candidates = context.instances.filter((c) => c.variantKey === key
      && schemeMatchReason(scheme, c.feature) === null)
    const instance = candidates.find((c) => c.id === preferredInstanceId) ?? candidates[0]
    const group = instance ? context.merges?.groups.find((g) => g.id === instance.groupId) : undefined
    const memberIn = group?.members[instance!.memberIndex]
    const memberOut = group?.members[instance!.memberIndex + 1]
    const weldFor = (code: string, weldId?: string) => context.weldsData.welds.find((w) => weldId ? w.id === weldId
      : weldPositionCode(w) === code && (scheme.positionDefault || scheme.match.焊脚.includes(weldLegValue(w))
        && w.jointType === scheme.match.接头形式 && scheme.match.坡口.some(type => normalizeWeldGrooveType(type) === weldGroove(w))))
    const from = weldFor(scheme.match.位置1, memberIn?.weldId)
    const to = weldFor(scheme.match.位置2, memberOut?.weldId)
    const thicknessOf = (w?: Weld) => context.partsData.parts.find((p) => p.id === w?.subPartId)?.thickness
    const angle = instance?.feature.夹角 ?? (scheme.match.夹角min + scheme.match.夹角max) / 2
    const legs = (instance?.feature.焊脚 ?? scheme.match.焊脚).filter((v) => Number.isFinite(v) && v > 0)
    const variant = { ...scheme.variants[key], ...defaultCornerDistances({
      turnAngle: angle, leg: legs.length ? Math.max(...legs) : 8,
      thicknessIn: thicknessOf(from), thicknessOut: thicknessOf(to),
      availableIn: memberIn?.length, availableOut: memberOut?.length,
    }) }
    const prepared = instance ? prepareCornerPath({ kind: 'merge', mergeId: instance.groupId }, context,
      { instanceId: instance.id, variant }, false) : null
    const anchor = prepared?.path.cornerAnchors?.find((a) => a.memberIndex === instance?.memberIndex)
    const referencePath = !anchor && from ? buildDemoPath({ kind: 'weld', weldId: from.id, source: true },
      context.weldsData, context.partsData, context.mesh, null, null) : null
    const reference = referencePath?.samples.length ? torchPoseContext(sampleAt(referencePath, referencePath.total / 2), context.analysis) : undefined
    const template = !anchor ? templateDefaultPath(key, variant,
      (scheme.match.夹角min + scheme.match.夹角max) / 2, context.analysis, reference) : null
    const nominal = anchor && prepared ? prepared.nominalPath : template!.path
    const at = anchor ?? template!
    const nominalIn = pathPoseAt(nominal, at.sIn, context.analysis).quaternion
    const nominalApex = pathPoseAt(nominal, at.sApex, context.analysis).quaternion
    const nominalOut = pathPoseAt(nominal, at.sOut, context.analysis).quaternion
    const frames = [at.sIn, at.sApex, at.sOut].map((s) => torchPoseContext(sampleAt(nominal, s), context.analysis))
    const inQ = resolveTorchOffset(context.offset, nominalIn, frames[0]).multiply(nominalIn)
    const outQ = resolveTorchOffset(context.offset, nominalOut, frames[2]).multiply(nominalOut)
    if (scheme.positionDefault && key.startsWith('内角') && referencePath && reference) {
      // 默认内角必须有明确的端部避让姿态。入角端向行进方向倾，出角端反向倾，
      // 起点取入角点、终点取出角点，二者都朝焊道内部，不会因默认匹配消掉变姿态。
      const tilt = Math.max(5, Math.min(60, Math.abs(angle) / 2)) * Math.PI / 180
      const inwardPose = (q: THREE.Quaternion, frame: TorchPoseContext, sign: number) => {
        const back = context.analysis.axis.clone().applyQuaternion(q).normalize().negate()
        const inward = frame.tangent.clone().multiplyScalar(sign)
        inward.addScaledVector(back, -inward.dot(back)).normalize()
        const desired = back.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(inward, Math.sin(tilt)).normalize()
        return new THREE.Quaternion().setFromUnitVectors(back, desired).multiply(q)
      }
      // 端点三点都以同一主焊缝姿态为基准；折角模板两臂法向不同，不能把
      // 第二臂的角度直接移到直焊缝终点，否则有机会把向内倾斜反成向外。
      const referenceSample = sampleAt(referencePath, referencePath.total / 2)
      const referenceQ = computeTorchPose(referenceSample, context.analysis).quaternion
      const offsetQ = resolveTorchOffset(context.offset, referenceQ, reference).multiply(referenceQ)
      variants[key] = { ...variant,
        入角点: stdAnglesFromQuat(inwardPose(offsetQ, reference, 1), referenceQ, reference),
        转角点: stdAnglesFromQuat(offsetQ, referenceQ, reference),
        出角点: stdAnglesFromQuat(inwardPose(offsetQ, reference, -1), referenceQ, reference) }
      sources[key] = 'template'
      continue
    }
    const progress = (at.sApex - at.sIn) / (at.sOut - at.sIn)
    const apexQ = inQ.clone().slerp(outQ, progress)
    variants[key] = { ...variant,
      入角点: stdAnglesFromQuat(inQ, nominalIn, frames[0]),
      转角点: stdAnglesFromQuat(apexQ, nominalApex, frames[1]),
      出角点: stdAnglesFromQuat(outQ, nominalOut, frames[2]),
    }
    sources[key] = anchor ? 'model' : 'template'
  }
  return { scheme: { ...scheme, variants, needsPoseDefaults: false }, sources }
}

/** 从模型已存在的位置生成独立、可编辑的四类默认方案。保存后的同 id 覆盖由调用方合并。 */
export function createPositionDefaultSchemes(modelKey: string, context: CornerPathContext): CornerScheme[] {
  const positions = [...new Set(context.weldsData.welds.map(weldPositionCode))]
    .sort((a, b) => POSITION_CODES.indexOf(a) - POSITION_CODES.indexOf(b))
  const median = (values: number[], fallback: number) => {
    const sorted = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    const i = Math.floor(sorted.length / 2)
    return !sorted.length ? fallback : sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
  }
  return positions.map((position) => {
    const welds = context.weldsData.welds.filter((w) => weldPositionCode(w) === position)
    const leg = median(welds.map(weldLegValue), 8)
    const thicknessOf = (w: Weld) => context.partsData.parts.find((p) => p.id === w.subPartId)?.thickness ?? 0
    const thickness = median(welds.map(thicknessOf), 0)
    const representative = welds.slice().sort((a, b) =>
      (Math.abs(weldLegValue(a) - leg) || 0) + Math.abs(thicknessOf(a) - thickness)
      - ((Math.abs(weldLegValue(b) - leg) || 0) + Math.abs(thicknessOf(b) - thickness)))[0]
    const scheme = emptyScheme({ name: `${position === '—' ? '倾斜焊' : position} · 默认转角方案`,
      位置1: position, 位置2: position, 焊脚: [leg], 接头形式: representative.jointType,
      夹角min: 0, 夹角max: 180, 坡口: [...new Set(welds.map(weldGroove))] })
    scheme.id = `CD:${modelKey}:${position}`
    scheme.positionDefault = { modelKey, position,
      basis: `代表焊缝 ${representative.id}；焊脚中位数 ${r2c(leg)}mm；板厚中位数 ${r2c(thickness)}mm；90°模板或实际转角，距离 r×tan(θ/2)，c=0；三点姿态按URDF TCP和实际板面反解`,
      sources: Object.fromEntries(CORNER_VARIANT_KEYS.map((key) => [key, 'template'])) as Record<CornerVariantKey, 'model' | 'template'> }
    const computed = computeSchemeDefaults(scheme, { ...context,
      weldsData: { ...context.weldsData, welds: [representative, ...context.weldsData.welds.filter((w) => w !== representative)] } })
    computed.scheme.positionDefault = { ...scheme.positionDefault, sources: computed.sources }
    return computed.scheme
  })
}

// ---------------------------------------------------------------- 端点动作方案匹配

/** 包角绕板厚外侧；受限端点在原焊道内变姿态，两类动作分别使用外角/内角方案。 */
export type EndpointAction = 'wrap' | 'pose-change'

/**
 * 端点动作的内外角由动作类别决定；圆弧的凹凸是板边特征，不能替代动作类别。
 * 左右转沿实际焊接方向和所选板件的绕行方向计算，与观察视角和特征标签无关。
 */
export function endpointVariantKey(
  sample: { tangent: THREE.Vector3; nMain: THREE.Vector3; nSub: THREE.Vector3 },
  which: 'start' | 'end', wrapSide: BaojiaoWrapSide,
  action: EndpointAction = 'wrap',
): CornerVariantKey {
  const { incoming, outgoing } = endpointWrapDirections(sample, which, wrapSide)
  // 与普通转角共用观察侧和退化容差；两支撑面平行/反向时从转弯平面固定正轴观察，
  // 避免把约为零的浮点点积当成真实左右转，反向焊接仍须交换左右。
  const left = classifyCorner(incoming, outgoing, sample.nMain, sample.nSub).key.endsWith('左转')
  return `${action === 'pose-change' ? '内' : '外'}角-${left ? '左' : '右'}转`
}

/**
 * 端点动作的方案匹配: 端点视作只有一侧的转角。
 * 特征: 位置1=位置2=该焊缝代号, 夹角=估算绕行转角 θ, 其余取该焊缝。
 * 包角使用外角方案；extend受限且端点碰撞时的变姿态使用内角方案。
 * 绕端部特征所选板件的板厚方向；终点 tangent→wrapDir，起点 -wrapDir→tangent。
 * 左右转按这两种实际行进方向判定，反向焊接时由调用方提供反向切线与端点。
 */
export function matchEndpointScheme(
  weld: Weld, _featureLabel: string, theta: number | null,
  sample: { tangent: THREE.Vector3; nMain: THREE.Vector3; nSub: THREE.Vector3 },
  schemes: CornerScheme[],
  which: 'start' | 'end' = 'end',
  wrapSide: BaojiaoWrapSide = endpointWrapSide(weld, which),
  action: EndpointAction = 'wrap',
): { scheme: CornerScheme; variantKey: CornerVariantKey } | null {
  if (theta === null || !Number.isFinite(theta)) return null
  const f = endpointCornerFeature(weld, theta)
  const mm = matchScheme(schemes, f)
  if (!mm.scheme) return null
  return {
    scheme: mm.scheme,
    variantKey: endpointVariantKey(sample, which, wrapSide, action),
  }
}

/** 端点匹配、库统计及回显共用同一特征口径。 */
export function endpointCornerFeature(weld: Weld, theta: number): CornerFeature {
  const code = weldPositionCode(weld), leg = weldLegValue(weld), groove = weldGroove(weld)
  return {
    位置1: code, 位置2: code,
    焊脚: [leg, leg],
    接头形式: [weld.jointType, weld.jointType],
    夹角: r1c(theta),
    坡口: [groove, groove],
  }
}
