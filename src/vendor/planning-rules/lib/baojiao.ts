// 包角工艺判定；实际三点动作由 baojiaoMotion 按此处标签生成。
//
// 决策树 (来自工艺规划流程图):
//   闭合焊缝无端点 → 无 (无包角概念)
//   实际端点 extend < 当前阈值，且喷嘴/枪颈任一碰撞 → 先变姿态，使用内角方案
//   独立按特征生成包角，使用外角距离；同时调姿时全程保持变后姿态并以该姿态检测
//   按端点特征分类 (每端点独立判定):
//     直角/锐角/凹圆弧/长圆弧 → 碰撞检测: 碰撞 → 半包; 不碰撞 → 全包
//     D圆弧 → 半包 (仍做碰撞检测记录状态, 类型固定)
//     平角/优角(钝角)/凸圆弧 → 不包角
//
// 先检测原始焊接端点的实际工具姿态，再检测两个包角预检姿态。
// 同端还需变姿态时，原位、板厚偏移及实际包角距离段都使用内角准备终态，
// 不附加下述预检旋转或外角方案的姿态旋转。
// 原始端点不因特征未识别或无需包角而跳过碰撞检测。
// 包角预检位姿 (每端点 2 个, 均先绕板厚轴旋转再检测):
//   旋转: 标准端点位姿 (角平分线 + 枪颈竖直优先) 绕
//         【板厚轴 = 端部特征实际关联板件的面外法向】旋转 collAngleDeg
//         (默认 30°), 模型空间左乘; 符号取使枪身方向 (-喷嘴轴) 向端点外侧
//         绕出的一侧 (起点外侧=-切向, 终点外侧=+切向)。
//         用户姿态偏移最后整体施加, 位置回解保证焊丝尖端钉在目标点上。
//   原位: 焊丝尖端钉在端点;
//   板厚偏移位姿: 焊丝尖端钉在 端点 + (-所选板法向)×所选板厚度 (穿过板厚指向板体
//         另一侧, 近似"绕出板边"后的落位)。
//   各位姿的喷嘴/枪颈碰撞状态都记录; 分类用调姿后的三位姿并集 (任一位姿喷嘴或
//   枪颈碰撞 → 半包, 否则全包)。
//
// 半包子类型: 板厚偏移姿态碰撞时改为原地包角（姿态不变、无包角路径）；
// 其余情况按枪颈绕行转角 θ 估算 (阈值 30°):
//   θ 取自端点特征几何: 直角/锐角 = 角度字段 (直角=90°);
//   D圆弧 = 180° (半圆棱); 凹圆弧/长圆弧 = 弧切线转角 ≈ L1/R1 (rad→度,
//   R1>0 时); 无法估算 → 待定。
//   θ < 1° → 不变姿态包角; θ ≤ 30° → 原地包角; θ > 30° → 变姿态包角。

import * as THREE from 'three'
import type { EdgesData, PartsData, Weld } from '@/types/weld'
import type { WeldSplit } from '@/lib/weldSplit'
import {
  buildDemoPath, computeTorchPose, endpointSample, resolveTorchOffset, sampleAt, stdAnglesQuat, weldWithExtensions, torchPoseContext,
  type NozzleAnalysis, type PathSample, type TorchCollision, type TorchModel, type TorchOffset,
} from './torch'
import { defaultCornerDistances, endpointVariantKey, matchEndpointScheme, weldLegValue, type CornerScheme, type CornerVariant, type CornerVariantKey } from './cornerSchemes'
import { endpointWrapDirections, endpointWrapSide, type BaojiaoWrapSide } from './baojiaoFrame'
import { computeAxialDetection } from './gapDetection'
import { splitEndpointAxialClearance } from './splitEndpointClearance'

// ---------------------------------------------------------------- 参数

export interface BaojiaoParams {
  /** 包角距离: 板厚比例 (实际距离 = 比例 × 板厚) */
  distRatio: number
  /** 兼容旧存储字段；变姿态半包由几何与三点方案计算，不再读取固定俯仰角。 */
  halfPoseDeg: number
  /** 碰撞检测姿态角度: 检测位姿绕板厚轴旋转的度数 (朝板厚侧) */
  collAngleDeg: number
}

export const DEFAULT_BAOJIAO_PARAMS: BaojiaoParams = {
  distRatio: 2 / 3, halfPoseDeg: 15, collAngleDeg: 30,
}

/** 包角距离比例选项 (界面三选一) */
export const DIST_RATIO_OPTIONS: { label: string; value: number }[] = [
  { label: '1/2 板厚', value: 0.5 },
  { label: '2/3 板厚', value: 2 / 3 },
  { label: '1 板厚', value: 1 },
]

// ---------------------------------------------------------------- 类型

export type BaojiaoType = '全包' | '半包' | '变姿态' | '不包角' | '无' | '待定'
export type BaojiaoSubtype = '不变姿态包角' | '原地包角' | '变姿态包角' | '待定'

export interface BaojiaoColl {
  /** 碰撞板件 id 列表 (空 = 无碰撞) */
  neck: string[]
  nozzle: string[]
}

/** 检测位姿记录 (模型坐标; 回显/调试用) */
export interface BaojiaoPoseData {
  pos: number[]
  quat: number[] // [x,y,z,w]
}

/** 回显请求 (PropertyPanel → App → Viewer3D): 虚影机头 + 命中部件 */
export interface TorchEchoPose {
  /** 唯一键 `${weldId}|${start|end}` (切换/清除用) */
  key: string
  pos: number[]
  quat: number[]
  neck: string[]
  nozzle: string[]
}

export interface BaojiaoEndpoint {
  /** Retain explicit wrap-template authorization when an edited source endpoint becomes a merge endpoint. */
  geometryWrapTemplateId?: string
  /** Geometry-only measurements; feature labels remain source references. */
  unifiedInfo?: import('./endpointClearance').UnifiedEndpointInfo
  processDecision?: import('./endpointProcessDecision').EndpointProcessDecision & {
    config: import('./endpointProcessDecision').EndpointProcessConfig
    manuallyOverridden?: boolean
  }
  /** Geometry-only explicit matching, including an intentional empty choice. */
  geometryManualScheme?: boolean
  /** 动作演示模式：碰撞仅用于实际端点的内角变姿态识别，不约束包角动作。 */
  motionOnly?: boolean
  /** 先执行的独立内角变姿态阶段；顶层仍描述随后的外角包角，不互相覆盖。 */
  poseChange?: BaojiaoEndpoint
  /** 端点实际轴向余量；null 表示没有有效边界证据，不当成零距离。 */
  extendDistance?: number | null
  extendThreshold?: number | null
  /** TCP轴向余量未知，但机头已碰当前打断关联障碍时的独立实际净空。 */
  actualObstacleClearance?: number
  actualObstaclePart?: string
  /** 当前动作所用情形：端点变姿态为内角，包角为外角。无方案时同样给出。 */
  variantKey?: CornerVariantKey
  /** 端部特征实际关联板件，决定板厚、绕行方向与检测旋转轴。 */
  wrapSide?: BaojiaoWrapSide
  /** 端点特征标签 (直角/锐角/平角/优角/D圆弧/凹圆弧/凸圆弧/长圆弧) */
  feature: string
  type: BaojiaoType
  /** 半包子类型 (仅 type=半包 时有值) */
  subtype: BaojiaoSubtype | null
  /** 判定依据链 (端点特征 → 规则路径) */
  rule: string
  /** 估算绕行转角 θ (度); null = 不可估算 */
  wrapAngle: number | null
  /** 原始焊接端点的实际工具姿态碰撞；独立于包角特征及绕板厚轴的预检。 */
  actualColl?: BaojiaoColl
  /** 原始端点实际姿态（包含全局工具参数，未施加包角预检旋转）。 */
  actualPose?: BaojiaoPoseData
  /** 组合动作的内角准备完成姿态及真实碰撞，供后续包角能力判定。 */
  preparedPose?: BaojiaoPoseData
  preparedColl?: BaojiaoColl
  /** 组合动作按变后姿态沿实际包角距离段（外点至c偏移转角点）的采样汇总。 */
  wrapPathColl?: BaojiaoColl
  /** 包角距离段首次命中的检测位姿，便于回显。 */
  wrapPathPose?: BaojiaoPoseData
  /** 当前板厚比例与外角方案a/b共同限幅后的包角距离。 */
  wrapPathDistance?: number
  /** 异常参数或采样预算不足，不能把未验证的包角距离段视为无碰撞。 */
  wrapPathUnverified?: boolean
  /** 碰撞状态: 原位 + 板厚偏移位姿 (做了碰撞检测的分支才有值) */
  coll: { orig: BaojiaoColl; offset: BaojiaoColl } | null
  /** 检测位姿记录 (含旋转; 板厚偏移位姿含平移) —— 回显用 */
  poses: { orig: BaojiaoPoseData; offset: BaojiaoPoseData } | null
  /** 所选板件负法向（精确单位向量）与厚度，均在当前模型坐标中。 */
  offsetDir: number[] | null
  offsetDist: number | null
  /** 碰撞检测应用的绕板厚轴旋转角 (°, 带符号; 未检测为 null) */
  rotDeg: number | null
  /** 命中的转角方案 (工艺路径库; 包角复用其 a/c 与三点姿态) */
  scheme: { id: string; name: string; variant: string; a: number; c: number } | null
  /** 旧数据兼容字段。真实动作统一由 prepareWeldMotionPath 生成，此处始终为null。 */
  movePose: ({ deg: number; axis: number[] } & BaojiaoPoseData) | null
}

export interface WeldBaojiao {
  closed: boolean
  起点: BaojiaoEndpoint
  终点: BaojiaoEndpoint
  /** 内部打断端点单独预检，不能借用源端点的碰撞与余量。 */
  bySubWeld?: Record<number, { 起点: BaojiaoEndpoint; 终点: BaojiaoEndpoint }>
}

export interface EndpointDetectionOptions {
  extendThreshold: number | null
  edgesData?: EdgesData | null
  /** 与实际动作使用相同的板厚比例，缺省为默认2/3。 */
  wrapDistanceRatio?: number
  /** 只识别并生成动作：保留初始端点碰撞触发内角，不做包角能力/距离扫掠约束。 */
  motionOnly?: boolean
}

/** 与间隙检测共用轴向边界，保留零间隙并排除缺失/无效距离。 */
export function endpointExtendDistances(
  weld: Weld, edgesData?: EdgesData | null, split?: WeldSplit,
): Record<'start' | 'end', number | null> {
  const axial = edgesData ? computeAxialDetection(weld, edgesData) : null
  const gap = weld.properties.间隙检测 as Record<string, unknown> | undefined
  const groups = axial ?? gap?.extend ?? gap?.沿轴线方向
  const result: Record<'start' | 'end', number | null> = { start: null, end: null }
  for (const group of Object.values(groups && typeof groups === 'object' ? groups : {})) {
    if (!group || typeof group !== 'object') continue
    for (const [which, label] of [['start', '起点'], ['end', '终点']] as const) {
      for (const [key, value] of Object.entries(group)) {
        if (!key.startsWith(label) || !key.includes('距离') || typeof value !== 'number'
          || !Number.isFinite(value) || value < 0) continue
        result[which] = Math.min(result[which] ?? Infinity, value)
      }
    }
  }
  // extend小于阈值已经确认轴向落在本接头的真实边界；显示/打断端点保留0.01mm，
  // 可能比CAD射线0.002mm容差更粗，不能因量化越过边界而把余量重新判成null/远处边界。
  // 只在当前端点仍与该延伸记录一致时恢复零余量，不扩大原始CAD检测容差；
  // extend接触副板指向第三零件，并不保证落在本接头边界，不能按此规则归零。
  if (!weld.closed && split?.weldId === weld.id) {
    for (const which of ['start', 'end'] as const) {
      const extension = which === 'start' ? split.startExtension : split.endExtension
      const position = weld[which]
      if (extension?.规则 === 'extend小于阈值' && extension.延伸到.length === 3
        && extension.延伸到.every((value, axis) => Number.isFinite(value)
          && Math.abs(value - position[axis]) <= 1e-9)) result[which] = 0
    }
  }
  return result
}

export interface BaojiaoResult {
  byWeld: Map<string, WeldBaojiao>
  焊缝数: number
  耗时ms: number
  统计: Record<BaojiaoType, number>
  /** Current derived merge endpoints after geometry-only property edits. */
  geometryMergeEndpoints?: Record<string, { 起点: BaojiaoEndpoint; 终点: BaojiaoEndpoint }>
}

// ---------------------------------------------------------------- 特征

interface FeatureProp {
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

/** 特征标签 (与 weldMerge 的 featureLabel 口径一致; 缺失按直角) */
function featureLabel(f: FeatureProp | undefined): string {
  if (!f) return '直角'
  if (f.特征类型 === '未识别') return '未识别'
  if (f.特征类型 === '普通端点') return '普通端点'
  if (f.特征类型 === '平角') return '平角'
  if (f.特征类型 === '角' && f.角类型) return f.角类型
  if (f.特征类型 === '圆' && f.圆类型) return f.圆类型
  return '直角'
}

/** 估算绕行转角 θ (度); 不可估算返回 null */
function wrapAngleOf(label: string, f: FeatureProp | undefined): number | null {
  if (typeof f?.包角转角 === 'number' && Number.isFinite(f.包角转角)) return f.包角转角
  if (label === '直角' || label === '锐角' || label === '优角') {
    const a = f?.角度
    if (typeof a === 'number' && Number.isFinite(a)) return a
    return label === '直角' ? 90 : null
  }
  if (label === 'D圆弧') return 180 // 半圆棱 (R ≈ 板厚, D 形截面)
  if (label === '凹圆弧' || label === '长圆弧' || label === '凸圆弧') {
    const r1 = f?.R1; const l1 = f?.L1
    if (typeof r1 === 'number' && r1 > 1e-9 && typeof l1 === 'number' && l1 >= 0) {
      return (l1 / r1) * 180 / Math.PI // 弧切线转角 ≈ 弧长/半径
    }
    return null
  }
  return null
}

function subtypeOf(theta: number | null): BaojiaoSubtype {
  if (theta === null) return '待定'
  if (theta < 1) return '不变姿态包角'
  if (theta <= 30) return '原地包角'
  return '变姿态包角'
}

// ---------------------------------------------------------------- 碰撞预检

/** 端部关联板厚 (properties.厚度 → 对应真实零件厚度兜底) */
function wrapThickness(weld: Weld, partsData: PartsData, side: BaojiaoWrapSide): number | null {
  const th = (weld.properties as Record<string, unknown>)['厚度']
  if (th && typeof th === 'object') {
    const t = (th as Record<string, unknown>)[side === 'main' ? '主板厚度' : '副板厚度']
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) return t
  } else if (side === 'sub' && typeof th === 'number' && Number.isFinite(th) && th > 0) {
    return th
  }
  const t = partsData.parts.find((p) => p.id === (side === 'main' ? weld.mainPartId : weld.subPartId))?.thickness
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null
}

/**
 * 绕板厚轴的旋转四元数: 轴 = 所选板件面外法向单位向量,
 * 角度 ±collAngleDeg, 使枪身方向 (-nozzleAxis) 向端点外切向绕出。
 * 绕轴旋转不会改变与轴的点积, 因此不能用该点积选旋转符号。
 * 所有输入为 rot 所在层的几何方向 (默认姿态, 尚未施加最外层用户偏移)。
 * 若枪轴/外切向平行旋转轴, 或两候选等分, 几何无法判方向, 稳定取正角。
 * 返回旋转四元数与带符号角度 (模型空间左乘, 不改变板厚轴定义)。
 */
export function wrapRotQuat(
  nSub: THREE.Vector3, nozzleAxis: THREE.Vector3,
  outwardTangent: THREE.Vector3, angleDeg: number,
): { q: THREE.Quaternion; deg: number } {
  const axis = nSub.clone().normalize()
  const magnitude = Math.abs(angleDeg)
  const rad = magnitude * Math.PI / 180
  const qPos = new THREE.Quaternion().setFromAxisAngle(axis, rad)
  const qNeg = new THREE.Quaternion().setFromAxisAngle(axis, -rad)
  const body = nozzleAxis.clone().normalize().negate()
  const target = outwardTangent.clone().normalize()
  const dPos = body.clone().applyQuaternion(qPos).dot(target)
  const dNeg = body.clone().applyQuaternion(qNeg).dot(target)
  return dNeg > dPos + 1e-10
    ? { q: qNeg, deg: -magnitude }
    : { q: qPos, deg: magnitude }
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1)

/**
 * 单个检测位姿：方案采用绝对工具角；无方案时采用全局焊枪参数。
 * 两者择一应用于包角检测基础姿态，避免重复叠加。
 * 位置由"焊丝尖端钉在 tipTarget"回解 (旋转/偏移下尖端零漂移)。
 */
function collAt(
  torch: TorchModel, collision: TorchCollision,
  pose: { quaternion: THREE.Quaternion },
  rotQ: THREE.Quaternion, offsetQuat: TorchOffset, tipTarget: THREE.Vector3,
  preQuat?: THREE.Quaternion, sample?: PathSample,
): { coll: BaojiaoColl; data: BaojiaoPoseData } {
  const q = rotQ.clone().multiply(pose.quaternion)
  q.premultiply(preQuat ?? resolveTorchOffset(offsetQuat, q, sample ? torchPoseContext(sample, torch.analysis) : undefined))
  const pos = tipTarget.clone().sub(torch.analysis.wireTip.clone().applyQuaternion(q))
  const m = new THREE.Matrix4().compose(pos, q, UNIT_SCALE)
  const wireTip = torch.analysis.wireTip.clone().applyMatrix4(m)
  const tipAxisW = torch.analysis.tipAxis.clone().transformDirection(m)
  const c = collision.check(m, torch.neckVerts, torch.nozzleVerts, wireTip, tipAxisW.negate())
  return {
    coll: { neck: c.neck, nozzle: c.nozzle },
    data: { pos: pos.toArray(), quat: q.toArray() },
  }
}

const anyHit = (c: BaojiaoColl) => c.neck.length > 0 || c.nozzle.length > 0
const r1 = (v: number) => Math.round(v * 10) / 10

/** 包角距离段保持同一实际工具姿态；有界采样，超预算明确保留未验证状态。 */
function checkPreparedWrapSegment(torch: TorchModel, collision: TorchCollision, q: THREE.Quaternion,
  from: THREE.Vector3, to: THREE.Vector3): { coll: BaojiaoColl; pose?: BaojiaoPoseData; unverified: boolean } {
  const coll: BaojiaoColl = { neck: [], nozzle: [] }
  const length = from.distanceTo(to)
  const steps = Math.max(1, Math.ceil(length / 2)), budget = 128
  if (!Number.isFinite(length) || !from.toArray().every(Number.isFinite) || !to.toArray().every(Number.isFinite)) {
    return { coll, unverified: true }
  }
  let pose: BaojiaoPoseData | undefined
  for (let i = 0; i <= steps && i < budget; i++) {
    const checked = collAt(torch, collision, { quaternion: q }, new THREE.Quaternion(), new THREE.Quaternion(),
      from.clone().lerp(to, i / steps))
    for (const comp of ['neck', 'nozzle'] as const) {
      for (const part of checked.coll[comp]) if (!coll[comp].includes(part)) coll[comp].push(part)
    }
    if (!pose && anyHit(checked.coll)) pose = checked.data
  }
  return { coll, ...(pose ? { pose } : {}), unverified: steps + 1 > budget }
}

/** 内角准备的终态，判定与动作生成共享，避免以原始枪姿判断变后包角。 */
export function endpointPoseChangeQuaternion(sample: PathSample, nominal: THREE.Quaternion, analysis: NozzleAnalysis,
  offset: TorchOffset, angle: number, which: 'start' | 'end', variant?: CornerVariant): THREE.Quaternion {
  if (variant) return stdAnglesQuat(variant[which === 'start' ? '入角点' : '出角点'], nominal, torchPoseContext(sample, analysis)).multiply(nominal)
  const back = analysis.axis.clone().applyQuaternion(nominal).normalize().negate()
  const inward = sample.tangent.clone().multiplyScalar(which === 'start' ? 1 : -1)
  inward.addScaledVector(back, -inward.dot(back)).normalize()
  const tilt = Math.max(5, Math.min(60, Math.abs(angle) / 2)) * Math.PI / 180
  const direction = back.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(inward, Math.sin(tilt)).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(back, direction).multiply(nominal)
  return resolveTorchOffset(offset, q, torchPoseContext(sample, analysis)).multiply(q)
}

// ---------------------------------------------------------------- 判定

/** 单端点判定 (闭合焊缝不要调 —— 两端都给「无」) */
function endpointBaojiao(
  weld: Weld, which: 'start' | 'end',
  partsData: PartsData, mesh: Float32Array,
  torch: TorchModel, collision: TorchCollision, offsetQuat: TorchOffset,
  collAngleDeg: number,
  /** 旧参数占位，不参与检测或实际动作。 */
  _halfPoseDeg: number,
  /** 工艺路径库: 命中时包角复用方案 a/c 与三点姿态偏移 */
  schemes: CornerScheme[] = [],
  extendDistance: number | null = null,
  extendThreshold: number | null = null,
  sampleOverride?: PathSample,
  contactExtension?: WeldSplit['startExtension'],
  splitObstacle?: { partId: string; point: number[] },
  wrapDistanceRatio = DEFAULT_BAOJIAO_PARAMS.distRatio,
  motionOnly = false,
): BaojiaoEndpoint {
  const props = weld.properties as Record<string, unknown>
  const fp = props[which === 'start' ? '起点特征' : '终点特征'] as FeatureProp | undefined
  const detectedFeature = featureLabel(fp)
  const feature = weld.parameterAudit && detectedFeature === '未识别' ? '普通端点' : detectedFeature
  const theta = wrapAngleOf(feature, fp)
  const wrapSide = endpointWrapSide(weld, which)
  const sample = sampleOverride ?? endpointSample(weld, partsData, mesh, which)
  const pose = sample ? computeTorchPose(sample, torch.analysis) : null
  const actual = sample && pose
    ? collAt(torch, collision, pose, new THREE.Quaternion(), offsetQuat, sample.pos, undefined, sample) : null
  // 延伸射线已命中接触副板的真实零件，而且当前实际姿态仍碰该同一零件：
  // 新端点到该障碍的剩余距离为0。不能把原主副板的下一处远边界当作净空。
  // 只有坐标和当前碰撞均验证的命中记录才生效，旧记录/其他零件碰撞不参与。
  if (sample && actual && contactExtension?.规则 === 'extend接触副板'
    && contactExtension.关联零件 && contactExtension.延伸到.length === 3
    && contactExtension.延伸到.every((value, axis) => Number.isFinite(value)
      && Math.abs(value - sample.pos.getComponent(axis)) <= 1e-9)
    && [...actual.coll.neck, ...actual.coll.nozzle].includes(contactExtension.关联零件)) extendDistance = 0
  const actualObstacleClearance = extendDistance === null && sample && actual && splitObstacle
    && splitObstacle.point.length === 3 && splitObstacle.point.every((value, axis) => Number.isFinite(value)
      && Math.abs(value - sample.pos.getComponent(axis)) < 1e-7)
    && [...actual.coll.neck, ...actual.coll.nozzle].includes(splitObstacle.partId) ? 0 : undefined
  const base = {
    ...(motionOnly ? { motionOnly: true } : {}),
    feature, subtype: null, wrapAngle: theta, wrapSide, extendDistance, extendThreshold,
    ...(actualObstacleClearance === 0 ? { actualObstacleClearance, actualObstaclePart: splitObstacle!.partId } : {}),
    ...(sample ? { variantKey: endpointVariantKey(sample, which, wrapSide, 'wrap') } : {}),
    coll: null, poses: null, offsetDir: null, offsetDist: null, rotDeg: null,
    scheme: null, movePose: null,
    ...(actual ? { actualColl: actual.coll, actualPose: actual.data } : {}),
  }
  const done = (type: BaojiaoType, rule: string, extra: Partial<BaojiaoEndpoint> = {}): BaojiaoEndpoint => ({
    ...base, type, rule, ...extra,
  })
  const needsPoseChange = (collisions: BaojiaoColl[]) => extendThreshold !== null
    && Number.isFinite(extendThreshold) && (extendDistance ?? actualObstacleClearance) !== undefined
    && (extendDistance ?? actualObstacleClearance)! < extendThreshold && collisions.some(anyHit)
  const poseChange = (extra: Partial<BaojiaoEndpoint> = {}): BaojiaoEndpoint => {
    const angle = theta !== null && theta > 0 ? theta : 90
    const hit = sample ? matchEndpointScheme(weld, feature, angle, sample, schemes, which, wrapSide, 'pose-change') : null
    const variant = hit?.scheme.variants[hit.variantKey]
    const trigger = actualObstacleClearance === 0
      ? `TCP轴向余量未确认；机头已碰当前打断关联零件 ${splitObstacle!.partId}，机头实际净空0mm < 阈值 ${extendThreshold}mm`
      : `extend ${r1(extendDistance!)}mm < 阈值 ${extendThreshold}mm，喷嘴或枪颈碰撞`
    return done('变姿态', `${trigger} → 端点变姿态（内角参数和路径）`, {
      ...extra, subtype: null, wrapAngle: angle,
      offsetDist: wrapThickness(weld, partsData, wrapSide),
      variantKey: sample ? endpointVariantKey(sample, which, wrapSide, 'pose-change') : undefined,
      scheme: hit && variant ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c } : null,
    })
  }
  // 变姿态与包角独立：实际端点受限时先记录内角阶段，继续判断外角包角。
  const innerAction = actual && needsPoseChange([actual.coll]) ? poseChange() : null

  if (feature === '普通端点' || fp?.默认动作 === '不包角' || (weld.parameterAudit && fp?.包角待确认)) {
    if (innerAction) return innerAction
    return done('不包角', `${feature} → 默认不包角 (已检测实际焊接端点姿态)`)
  }
  if (feature === '未识别') {
    if (innerAction) return innerAction
    return done('待定', '端点几何特征尚未识别，确认后再生成包角动作', { subtype: '待定' })
  }
  if (fp?.包角待确认) {
    if (innerAction) return innerAction
    return done('待定', `${feature}已识别，局部包角范围尚待确认`, { subtype: '待定' })
  }

  // 不包角特征仍报告实际焊接端点碰撞，不再生成包角预检。
  if (feature === '平角' || feature === '优角' || feature === '凸圆弧') {
    if (innerAction) return innerAction
    return done('不包角', `${feature} → 不包角 (已检测实际焊接端点姿态)`)
  }

  // 需碰撞检测的分支: 直角/锐角/凹圆弧/长圆弧/D圆弧
  if (!sample || !pose) {
    if (innerAction) return innerAction
    return done('半包', `${feature} → 端点采样失败, 保守判半包`, { subtype: '待定' })
  }
  // 单独包角沿用其预检姿态；组合动作直接保持内角准备后的实际姿态。
  const { normal, outward, wrapDir: dir, incoming, outgoing } = endpointWrapDirections(sample, which, wrapSide)
  const innerHit = innerAction ? matchEndpointScheme(weld, innerAction.feature, innerAction.wrapAngle,
    sample, schemes, which, wrapSide, 'pose-change') : null
  const changed = innerAction ? endpointPoseChangeQuaternion(sample, pose.quaternion, torch.analysis, offsetQuat,
    innerAction.wrapAngle ?? 90, which, innerHit?.scheme.variants[innerHit.variantKey]) : null
  const rot = changed ? { q: new THREE.Quaternion(), deg: 0 }
    : wrapRotQuat(normal, pose.axisWorld, outward, collAngleDeg)
  const thickness = wrapThickness(weld, partsData, wrapSide)
  // 命中方案时采用三点绝对工具角，不再叠加全局面板；检测偏移仍使用真实板厚。
  const hit = schemes.length > 0
    ? matchEndpointScheme(weld, feature, theta, sample, schemes, which, wrapSide) : null
  const variant = hit ? hit.scheme.variants[hit.variantKey] : null
  if (motionOnly) {
    // Only the original endpoint check above can identify an inner preparation.
    // Do not run rotated, plate-thickness or distance sweeps: those checks used
    // to downgrade full wrap and collapse its a/b/c movement to a stationary end.
    if (innerAction && changed) innerAction.preparedPose = {
      pos: sample.pos.clone().sub(torch.analysis.wireTip.clone().applyQuaternion(changed)).toArray(),
      quat: changed.toArray(),
    }
    const explicitSubtype = fp?.默认动作 === '原地包角' || fp?.默认动作 === '不变姿态包角'
      || fp?.默认动作 === '变姿态包角' ? fp.默认动作 : null
    const half = feature === 'D圆弧' || fp?.默认动作 === '半包' || explicitSubtype !== null
    const subtype = half ? explicitSubtype ?? subtypeOf(theta) : null
    const schemeInfo = hit && variant
      ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c } : null
    const schemeDesc = schemeInfo ? `；转角方案「${schemeInfo.name}」·${schemeInfo.variant} (a=${r1(schemeInfo.a)}mm, 转角偏移 c=${r1(schemeInfo.c)}mm)` : ''
    return done(half ? '半包' : '全包',
      `${feature} → ${explicitSubtype ?? (half ? '几何半包' : '几何全包')}（动作演示）${schemeDesc}`
        + (innerAction ? `；先${innerAction.rule}，包角保持变姿态后的姿态` : ''), {
      subtype, ...(innerAction ? { poseChange: innerAction } : {}),
      offsetDir: dir.toArray(), offsetDist: thickness ?? 0, scheme: schemeInfo,
    })
  }
  const detectionBase = rot.q.clone().multiply(pose.quaternion)
  const frame = torchPoseContext(sample, torch.analysis)
  const preOrig = variant ? stdAnglesQuat(variant.入角点, detectionBase, frame) : undefined
  const preOffset = variant ? stdAnglesQuat(variant.转角点, detectionBase, frame) : undefined
  // c 是转角点偏移，不是板厚。碰撞探测始终覆盖真实板厚，避免 c=0 漏检。
  const offsetDist = thickness ?? 0
  let orig: ReturnType<typeof collAt>, offset: ReturnType<typeof collAt>
  if (innerAction && changed) {
    const fixed = collAt(torch, collision, { quaternion: changed }, new THREE.Quaternion(), new THREE.Quaternion(), sample.pos)
    innerAction.preparedPose = fixed.data; innerAction.preparedColl = fixed.coll
    // 外角方案只贡献位置。检测矩阵必须与实际包角统一，不能叠加预检角、
    // 外角三点转姿或全局偏移，否则会把同一路径判成另一套姿态的碰撞。
    orig = fixed
    offset = collAt(torch, collision, { quaternion: changed }, new THREE.Quaternion(), new THREE.Quaternion(),
      offsetDist ? sample.pos.clone().addScaledVector(dir, offsetDist) : sample.pos)
  } else {
    orig = collAt(torch, collision, pose, rot.q, offsetQuat, sample.pos, preOrig, sample)
    offset = collAt(torch, collision, pose, rot.q, offsetQuat,
      offsetDist ? sample.pos.clone().addScaledVector(dir, offsetDist) : sample.pos, preOffset, sample)
  }
  const coll = { orig: orig.coll, offset: offset.coll }
  const poses = { orig: orig.data, offset: offset.data }
  let pathEvidence: Pick<BaojiaoEndpoint, 'wrapPathColl' | 'wrapPathPose' | 'wrapPathDistance' | 'wrapPathUnverified'> = {}
  if (changed) {
    // 与 motionPlan 使用同一外角距离计算。半包无自定义方案时取半绕行角；
    // 已受阻而采用原地动作时仍保留被拒绝的候选距离证据。
    const candidateHalf = feature === 'D圆弧' || anyHit(orig.coll) || anyHit(offset.coll)
    const changingHalf = candidateHalf && subtypeOf(theta) === '变姿态包角'
    const requested = variant ?? defaultCornerDistances({ turnAngle: changingHalf ? (theta ?? 90) / 2 : theta ?? 90,
      leg: weldLegValue(weld), thicknessIn: thickness ?? undefined, thicknessOut: thickness ?? undefined })
    const requestedWrap = which === 'start' ? requested.a : requested.b
    const valid = typeof thickness === 'number' && Number.isFinite(thickness) && thickness > 0
      && Number.isFinite(wrapDistanceRatio) && wrapDistanceRatio > 0
      && Number.isFinite(requestedWrap) && requestedWrap >= 0.1 && Number.isFinite(requested.c)
    if (valid) {
      const distance = Math.min(thickness * wrapDistanceRatio, requestedWrap)
      const outer = sample.pos.clone().addScaledVector(dir, distance)
      const apex = sample.pos.clone().addScaledVector(incoming.clone().add(outgoing).normalize(), requested.c)
      const checked = checkPreparedWrapSegment(torch, collision, changed, outer, apex)
      pathEvidence = { wrapPathColl: checked.coll, wrapPathDistance: distance,
        wrapPathUnverified: checked.unverified, ...(checked.pose ? { wrapPathPose: checked.pose } : {}) }
    } else {
      pathEvidence = { wrapPathColl: { neck: [], nozzle: [] }, wrapPathDistance: 0, wrapPathUnverified: true }
    }
  }
  const schemeInfo = hit && variant
    ? { id: hit.scheme.id, name: hit.scheme.name, variant: hit.variantKey, a: variant.a, c: variant.c }
    : null
  const schemeDesc = schemeInfo
    ? `；转角方案「${schemeInfo.name}」·${schemeInfo.variant} (a=${r1(schemeInfo.a)}mm, 转角偏移 c=${r1(schemeInfo.c)}mm)`
    : ''
  const collExtra = {
    ...(innerAction ? { poseChange: innerAction } : {}),
    ...pathEvidence,
    coll, poses, movePose: null,
    offsetDir: dir.toArray(),
    offsetDist,
    rotDeg: r1(rot.deg),
    scheme: schemeInfo,
  }
  const collDesc = (c: BaojiaoColl) =>
    `喷嘴${c.nozzle.length ? c.nozzle.join('/') : '无'}·枪颈${c.neck.length ? c.neck.join('/') : '无'}`
  const rotDesc = changed ? '使用内角变姿态终态，保持姿态' : `绕板厚轴旋${r1(rot.deg)}°`
  const actualDesc = actual ? `实际端点 ${collDesc(actual.coll)} / ` : ''
  const innerDesc = innerAction ? `；先${innerAction.rule}，再执行包角` : ''
  const postPreparation = innerAction?.preparedColl ?? actual?.coll
  const pathBlocked = pathEvidence.wrapPathColl !== undefined && anyHit(pathEvidence.wrapPathColl)
  const hit2 = (postPreparation !== undefined && anyHit(postPreparation)) || anyHit(coll.orig) || anyHit(coll.offset)
    || pathBlocked || pathEvidence.wrapPathUnverified === true
  // 位移被障碍挡住时，增大/改变姿态不能授权 TCP 继续穿过板厚方向。
  // 原地包角保持实际焊缝端点及姿态；预检角只是证据，不生成旋转动作。
  // 端点和原焊接路径仍由真实碰撞检测检查，不因原地包角跳过。
  const translationBlocked = anyHit(coll.offset) || pathBlocked || pathEvidence.wrapPathUnverified === true
  const halfSubtype = translationBlocked ? '原地包角' : subtypeOf(theta)
  const blockedReason = anyHit(coll.offset) ? '板厚偏移喷嘴或枪颈碰撞'
    : pathBlocked ? '包角距离段喷嘴或枪颈碰撞' : '包角距离段未完整验证'
  const blockedDesc = translationBlocked ? `；${blockedReason} → 原地包角，姿态不变、不走包角路径，包角距离与c偏移均为0mm` : ''
  const pathDesc = pathEvidence.wrapPathColl ? `；变后姿态包角距离段 ${r1(pathEvidence.wrapPathDistance ?? 0)}mm：${collDesc(pathEvidence.wrapPathColl)}` : ''
  // 绕行/板厚偏移预检只判包角能力，不能冒充实际焊接端点受阻。
  // 端点变姿态已在上方用实际端点枪颈/喷嘴碰撞单独判定。

  if (feature === 'D圆弧') {
    return done('半包',
      `D圆弧 → 固定半包 (碰撞仍记录[${rotDesc}]: ${actualDesc}预检原位 ${collDesc(coll.orig)} / 板厚偏移 ${collDesc(coll.offset)})${schemeDesc}${pathDesc}${blockedDesc}${innerDesc}`,
      { subtype: halfSubtype, ...collExtra })
  }
  // 直角/锐角/凹圆弧/长圆弧: 碰撞 → 半包, 不碰撞 → 全包
  return done(hit2 ? '半包' : '全包',
    `${feature} → 碰撞检测[${rotDesc}] (${actualDesc}预检原位 ${collDesc(coll.orig)} / 板厚偏移 ${collDesc(coll.offset)})`
    + ` → ${hit2 ? '碰撞 → 半包' : '不碰撞 → 全包'}${schemeDesc}${pathDesc}${blockedDesc}${innerDesc}`,
    { subtype: hit2 ? halfSubtype : null, ...collExtra })
}

/** 闭合焊缝的端点结果: 无包角概念 */
function closedEndpoint(): BaojiaoEndpoint {
  return {
    feature: '—', type: '无', subtype: null,
    rule: '闭合焊缝无端点 → 无包角概念',
    wrapAngle: null, coll: null, poses: null,
    offsetDir: null, offsetDist: null, rotDeg: null, scheme: null, movePose: null,
  }
}

/** 单条焊缝的包角判定 (两端点) */
export function computeWeldBaojiao(
  weld: Weld, partsData: PartsData, mesh: Float32Array,
  torch: TorchModel, collision: TorchCollision, offsetQuat: TorchOffset,
  collAngleDeg: number,
  /** 半包姿态度数 (变姿态包角运动位姿工作角; 不参与碰撞检测) */
  halfPoseDeg: number,
  /** 工艺路径库转角方案 (可选; 命中时包角复用方案参数) */
  schemes: CornerScheme[] = [],
  /** 当前打断/延伸结果: 原端点判定与检测回显都落在实际延伸后的端点。 */
  split?: WeldSplit,
  /** 调用方必须传入当前启用阈值；缺省不假定界面设置。 */
  options: EndpointDetectionOptions = { extendThreshold: null },
): WeldBaojiao {
  if (weld.closed && !split?.subWelds.some((sub) => !sub.closed)) {
    return { closed: true, 起点: closedEndpoint(), 终点: closedEndpoint() }
  }
  const currentWeld = weldWithExtensions(weld, split)
  const distances = endpointExtendDistances(currentWeld, options.edgesData, split)
  const result: WeldBaojiao = {
    closed: weld.closed,
    起点: weld.closed ? closedEndpoint() : endpointBaojiao(currentWeld, 'start', partsData, mesh, torch, collision, offsetQuat, collAngleDeg, halfPoseDeg, schemes, distances.start, options.extendThreshold, undefined, split?.weldId === weld.id ? split.startExtension : undefined, undefined, options.wrapDistanceRatio, options.motionOnly),
    终点: weld.closed ? closedEndpoint() : endpointBaojiao(currentWeld, 'end', partsData, mesh, torch, collision, offsetQuat, collAngleDeg, halfPoseDeg, schemes, distances.end, options.extendThreshold, undefined, split?.weldId === weld.id ? split.endExtension : undefined, undefined, options.wrapDistanceRatio, options.motionOnly),
  }
  if (split && split.weldId === weld.id && split.subWelds.some((sub) => sub.起点来源.类型 === '打断点' || sub.终点来源.类型 === '打断点')) {
    result.bySubWeld = {}
    for (const [index, sub] of split.subWelds.entries()) {
      const path = buildDemoPath({ kind: 'subweld', weldId: weld.id, subIndex: index },
        { welds: [weld] }, partsData, mesh, new Map([[weld.id, split]]), null)
      const localWeld: Weld = { ...currentWeld, closed: sub.closed, start: sub.start, end: sub.end, length: sub.length,
        segments: [{ ...weld.segments[0], start: sub.start, end: sub.end, points: sub.points, length: sub.length }],
        properties: { ...currentWeld.properties, 间隙检测: {},
          起点特征: { 特征类型: '平角' }, 终点特征: { 特征类型: '平角' } } }
      const localDistances = endpointExtendDistances(localWeld, options.edgesData)
      const at = (which: 'start' | 'end') => {
        const label = which === 'start' ? '起点' : '终点'
        const source = sub[which === 'start' ? '起点来源' : '终点来源']
        if (source.类型 !== '打断点') return result[label]
        const endpoint = path ? sampleAt(path, which === 'start' ? 0 : path.total) : undefined
        // 旧边界文件没有轴向证据时，只从打断关联板的真实有限网格补充净空。
        // offset触发数值本身不代表extend；未命中仍为null，不制造零余量。
        const actualDistance = localDistances[which] ?? (endpoint && source.触发?.关联零件
          ? splitEndpointAxialClearance(endpoint, which, partsData, mesh, [source.触发.关联零件]) : null)
        return endpointBaojiao(localWeld, which, partsData, mesh, torch, collision, offsetQuat,
          collAngleDeg, halfPoseDeg, schemes, actualDistance, options.extendThreshold, endpoint, undefined,
          source.触发?.关联零件 ? { partId: source.触发.关联零件, point: which === 'start' ? sub.start : sub.end } : undefined,
          options.wrapDistanceRatio, options.motionOnly)
      }
      result.bySubWeld[index] = { 起点: at('start'), 终点: at('end') }
    }
  }
  return result
}

/** 汇总当前子段端点，未打断的焊缝按源两端统计，不重复计入被替代的源端点。 */
export function summarizeBaojiao(byWeld: Map<string, WeldBaojiao>): Record<BaojiaoType, number> {
  const 统计: Record<BaojiaoType, number> = { 全包: 0, 半包: 0, 变姿态: 0, 不包角: 0, 无: 0, 待定: 0 }
  for (const wb of byWeld.values()) {
    const subEndpoints = Object.values(wb.bySubWeld ?? {})
    for (const endpoints of subEndpoints.length ? subEndpoints : [wb]) {
      统计[endpoints.起点.type]++
      统计[endpoints.终点.type]++
      for (const endpoint of [endpoints.起点, endpoints.终点]) {
        if (endpoint.type !== '变姿态' && endpoint.poseChange) 统计.变姿态++
      }
    }
  }
  return 统计
}

/**
 * 优先读取当前子段的独立预检；旧结果缺少快照时仍按源端血缘兼容。
 */
export function subweldBaojiao(
  res: BaojiaoResult, splits: Map<string, WeldSplit> | null,
  weldId: string, subIndex: number,
): { 起点: BaojiaoEndpoint; 终点: BaojiaoEndpoint } | null {
  const wb = res.byWeld.get(weldId)
  if (!wb) return null
  if (wb.bySubWeld?.[subIndex]) return wb.bySubWeld[subIndex]
  if (wb.closed) return { 起点: wb.起点, 终点: wb.终点 }
  const sub = splits?.get(weldId)?.subWelds[subIndex]
  const flat = (): BaojiaoEndpoint => ({
    feature: '平角', type: '不包角', subtype: null,
    rule: '打断内部端点 → 平角 → 不包角 (继承规则)',
    wrapAngle: null, coll: null, poses: null,
    offsetDir: null, offsetDist: null, rotDeg: null, scheme: null, movePose: null,
  })
  return {
    起点: sub?.起点来源.类型 === '打断点' ? flat() : wb.起点,
    终点: sub?.终点来源.类型 === '打断点' ? flat() : wb.终点,
  }
}
