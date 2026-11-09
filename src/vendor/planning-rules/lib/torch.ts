/**
 * 焊枪机头: STL 加载/喷嘴几何分析/焊缝路径姿态采样/标准姿态解算/碰撞检测
 *
 * 坐标约定: 全部在数据坐标系 (Z-up) 内计算; Viewer3D 把机头组挂在 modelGroup
 * (rotation.x=-90°) 下, 与板件网格同一空间, 无需额外变换。
 *
 * 喷嘴轴线/TCP: 以机器人焊接仿真规范文档给定值为权威 (DOC_C0_S 喷嘴出口中心 /
 *   DOC_D_S 枪轴 / DOC_TCP_S = C0+20×d̂, 见下方常量区); analyzeNozzle 的 STL 拟合
 *   结果仅作对照快照 (analysis.fitted), 不再驱动任何消费方。
 * 焊丝: 从 C0_S 沿 d_S 伸出 20mm × Ø1.2mm; 焊丝尖端 (TCP) 落在焊缝点上。
 */
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { MeshBVH } from 'three-mesh-bvh'
import type { PartsData, WeldsData, Weld } from '@/types/weld'
import type { WeldSplit } from '@/lib/weldSplit'
import type { MergeResult } from '@/lib/weldMerge'
import { poseCurveQuaternionAt, poseCurveRotationBound, type PoseCurve } from './poseCurve'
import { RAFFLES_MODEL_NAME, RAFFLES_STL_URL, RAFFLES_SOURCE_CALIBRATION, prepareRafflesTorchGeometry } from './rafflesTorchGeometry'
import { projectedLapNormalsAt } from './projectedLap'
import { robotBaseQuaternion } from './robotParameters'

export const WIRE_LEN = 20
export const WIRE_DIA = 1.2

// ---------------------------------------------------------------- 权威 TCP/枪轴 (规范文档)
/**
 * 机器人焊接仿真规范文档给定的权威值 (STL 原始坐标系 S, 单位 mm) —— 禁止擅改
 * (文档明确禁止修改 TCP、20mm 伸出量、枪轴符号)。
 *
 * 与 STL 拟合值冲突, 2026-04 起采用文档值为权威:
 *   旧拟合 (analyzeNozzle): 枪尖 tip≈(-34.7, 0.6, 573.5), 枪轴 axis≈(-0.1, 0, 1)
 *   文档权威: C0_S=(-43.044734745, -0.068801898, 570.231875200)  (喷嘴出口中心)
 *             d_S =(-0.374776987, 0.000001131, 0.927114993)      (枪轴, 喷嘴→焊丝尖端)
 *   冲突量级: TCP 差 ~22mm, 枪轴夹角 ~20° (冲突来源: 规范文档 vs STL 网格拟合)。
 *
 * 焊丝: 从 C0_S 沿 d_S 伸出 WIRE_LEN(20)mm 到 TCP (Ø1.2)。
 * 文档第 4 步: T_B_S = T_B_T_desired × inverse(T_S_T) —— 绕 TCP 变姿态,
 * 与本项目「一切姿态旋转绕焊丝尖端 (TCP) 枢转」的枢轴体系一致 (位置一律由
 * 最终四元数回解: position = 目标点 − q·wireTip)。
 */

/** 喷嘴出口中心 C0 (S 系, mm) —— 文档权威值 */
export const DOC_C0_S = new THREE.Vector3(-43.044734745, -0.068801898, 570.231875200)
/** 枪轴方向 d_S (S 系单位向量, 从喷嘴朝焊丝尖端) —— 文档权威值 */
export const DOC_D_S = new THREE.Vector3(-0.374776987, 0.000001131, 0.927114993).normalize()
/** TCP (S 系, mm) = C0_S + 20 × d̂_S ≈ (-50.540274475, -0.068779280, 588.774175061) */
export const DOC_TCP_S = DOC_C0_S.clone().addScaledVector(DOC_D_S, WIRE_LEN)

/**
 * 工具坐标系 T 相对 S 的旋转矩阵 R_S_T = [x_T y_T z_T] (列向量, 文档定义):
 *   z_T = d̂_S;  x_T = normalize([1,0,0] − ([1,0,0]·z_T)·z_T);  y_T = z_T × x_T
 */
export const DOC_R_S_T = (() => {
  const zT = DOC_D_S.clone()
  const ex = new THREE.Vector3(1, 0, 0)
  const xT = ex.addScaledVector(zT, -ex.dot(zT)).normalize()
  const yT = new THREE.Vector3().crossVectors(zT, xT).normalize()
  return new THREE.Matrix4().makeBasis(xT, yT, zT)
})()

/** 保留两位小数 (诊断用) */
const r2 = (v: number) => Math.round(v * 100) / 100

// ---------------------------------------------------------------- 焊枪姿态偏移参数

/** 机器人基座固定轴旋转增量（度）；工艺角独立存储，不与 rx/ry/rz 混用。 */
export interface TorchAngleOffset {
  rx: number
  ry: number
  rz: number
  process?: WeldStdAngles
}

export const DEFAULT_TORCH_OFFSET: TorchAngleOffset = {
  rx: 0, ry: 0, rz: 0, process: { 工作角: 45, 前进角: 0, 旋转角: 0 },
}
export const TOOL_ANGLE_LABELS = { rx: '基座 X 轴', ry: '基座 Y 轴', rz: '基座 Z 轴' } as const

const DEG = Math.PI / 180

function eulerQuat(p: TorchAngleOffset): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(p.rx * DEG, p.ry * DEG, p.rz * DEG, 'XYZ'))
}
export { eulerQuat }

/** 固定轴增量，依次绕 X、Y、Z，合成为 Rz·Ry·Rx。 */
function torchPanelQuat(p: TorchAngleOffset): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(p.rx * DEG, p.ry * DEG, p.rz * DEG, 'ZYX'))
}
export { torchPanelQuat }

/** 基准只记录机器人基座旋转，不把焊缝工艺角固化到某条路径。 */
export interface TorchReference {
  /** 基准面板三元组，出厂 (0,0,0)。 */
  angles: TorchAngleOffset
  /** 机器人基座中的旋转 q_ref = [x,y,z,w]。 */
  q: [number, number, number, number]
}

export function factoryTorchReference(): TorchReference {
  return { angles: { ...DEFAULT_TORCH_OFFSET }, q: [0, 0, 0, 1] }
}

export function isFactoryReference(ref: TorchReference): boolean {
  const f = DEFAULT_TORCH_OFFSET
  return Math.abs(ref.angles.rx - f.rx) < 1e-9
    && Math.abs(ref.angles.ry - f.ry) < 1e-9
    && Math.abs(ref.angles.rz - f.rz) < 1e-9
    && Math.abs(ref.q[0]) < 1e-9 && Math.abs(ref.q[1]) < 1e-9
    && Math.abs(ref.q[2]) < 1e-9 && Math.abs(Math.abs(ref.q[3]) - 1) < 1e-9
}

/** 固定基座轴增量左乘已捕获的旋转。 */
function torchControlQuat(p: TorchAngleOffset, ref?: TorchReference): THREE.Quaternion {
  const a = ref?.angles ?? DEFAULT_TORCH_OFFSET
  const qRef = ref ? new THREE.Quaternion(...ref.q).normalize() : new THREE.Quaternion()
  return torchPanelQuat({ rx: p.rx - a.rx, ry: p.ry - a.ry, rz: p.rz - a.rz }).multiply(qRef)
}

/** 抬枪轴：水平且垂直于枪轴的水平投影；正角让枪身更直立。 */
export function torchPitchAxis(base: THREE.Quaternion): THREE.Vector3 {
  const gun = DOC_D_S.clone().applyQuaternion(base)
  const axis = new THREE.Vector3(0, 0, 1).cross(gun)
  if (axis.lengthSq() < 1e-12) {
    // 枪轴竖直时没有水平朝向，用工具横轴提供确定的俯仰平面。
    axis.set(0, 1, 0).applyMatrix4(DOC_R_S_T).applyQuaternion(base)
    axis.z = 0
    if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0)
  }
  return axis.normalize()
}

function controlToWorldOffset(local: THREE.Quaternion): THREE.Quaternion {
  const frame = robotBaseQuaternion()
  return frame.clone().multiply(local).multiply(frame.invert()).normalize()
}

/** 基座固定轴旋转增量；旋转枢轴仍是 TCP，不能直接旋转机头 position。 */
export function toolAnglesQuat(p: TorchAngleOffset, _base?: THREE.Quaternion): THREE.Quaternion {
  return controlToWorldOffset(torchControlQuat(p))
}

/** 实际姿态相对基准的基座轴旋转增量；并非工艺角反解。 */
export function toolAnglesFromQuat(actual: THREE.Quaternion, base: THREE.Quaternion): TorchAngleOffset {
  const frame = robotBaseQuaternion()
  const local = frame.clone().invert().multiply(actual).multiply(base.clone().invert()).multiply(frame)
  return panelAnglesFromQuat(local.normalize())
}

/** 工艺姿态先应用，基座轴增量后应用。两套参数和参考坐标明确分离。 */
export function torchOffsetQuat(
  p: TorchAngleOffset, ref: TorchReference | undefined, base: THREE.Quaternion,
  context?: TorchPoseContext,
): THREE.Quaternion {
  const process = p.process ? stdAnglesQuat(p.process, base, context) : new THREE.Quaternion()
  return controlToWorldOffset(torchControlQuat(p, ref)).multiply(process).normalize()
}

/** 偏移可随姿态变化；固定四元数仍供显式世界旋转和诊断使用。 */
export type TorchOffset = THREE.Quaternion | ((base: THREE.Quaternion, context?: TorchPoseContext) => THREE.Quaternion)

export function resolveTorchOffset(offset: TorchOffset, base: THREE.Quaternion, context?: TorchPoseContext): THREE.Quaternion {
  return typeof offset === 'function' ? offset(base, context) : offset.clone()
}

/** 保存参数快照，供演示、异步碰撞扫描与端点回显共用。 */
export function createTorchOffset(panel: TorchAngleOffset, ref: TorchReference): TorchOffset {
  const p = { ...panel, process: panel.process ? cloneStdAngles(panel.process) : undefined }
  const reference = { angles: { ...ref.angles }, q: [...ref.q] as TorchReference['q'] }
  return (base, context) => torchOffsetQuat(p, reference, base, context)
}

/** 捕获基座旋转；后续增量仍绕固定基座轴，工艺参数保持独立。 */
export function captureReference(panel: TorchAngleOffset, ref?: TorchReference): TorchReference {
  return {
    angles: { ...panel },
    q: torchControlQuat(panel, ref).toArray() as [number, number, number, number],
  }
}

// ---------------------------------------------------------------- 喷嘴几何分析

export interface NozzleAnalysis {
  /** 喷嘴尖端面中心 (沿瞄准轴投影最高 1mm 顶点带的质心) */
  tip: THREE.Vector3
  /** 喷嘴轴线单位向量 (朝尖端方向; 尖端侧 30% 切片拟合 —— 姿态瞄准轴 b3, 口径不变) */
  axis: THREE.Vector3
  /** 尖端局部轴 = 尖端面法向 (喷嘴带弯角时与 axis 有小偏差) —— 焊丝方向 */
  tipAxis: THREE.Vector3
  /** 焊丝尖端 (局部坐标 = tip + tipAxis*WIRE_LEN) */
  wireTip: THREE.Vector3
  /** 拟合用的切片质心数 (调试) */
  slices: number
  /** 机身主轴 (枪颈直段方向, 指向法兰/机身侧, 即"上") — loadTorch 时由枪颈 STL 拟合 */
  bodyAxis?: THREE.Vector3
  /**
   * STL 拟合原始值 (loadTorch 覆盖为文档权威值前的快照, 仅对照/调试)。
   * 冲突来源: 规范文档 (DOC_C0_S/DOC_D_S/DOC_TCP_S) vs STL 网格拟合,
   * TCP 差 ~22mm、枪轴夹角 ~20° —— 权威以文档为准, 禁止擅改。
   */
  fitted?: { tip: THREE.Vector3; axis: THREE.Vector3; tipAxis: THREE.Vector3; wireTip: THREE.Vector3 }
}

export function analyzeNozzle(geom: THREE.BufferGeometry): NozzleAnalysis {
  const pos = geom.getAttribute('position')
  geom.computeBoundingBox()
  const bb = geom.boundingBox!
  const z0 = bb.min.z
  const z1 = bb.max.z
  // 2mm 薄切片质心
  const buckets = new Map<number, { sx: number; sy: number; sz: number; n: number }>()
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    const k = Math.floor((z - z0) / 2)
    const b = buckets.get(k) ?? { sx: 0, sy: 0, sz: 0, n: 0 }
    b.sx += pos.getX(i); b.sy += pos.getY(i); b.sz += z; b.n++
    buckets.set(k, b)
  }
  const cens = [...buckets.values()]
    .filter((b) => b.n >= 6)
    .map((b) => ({ x: b.sx / b.n, y: b.sy / b.n, z: b.sz / b.n }))
    .sort((a, b) => a.z - b.z)
  // 最小二乘拟合 x(z), y(z) → 轴方向 (ax, ay, 1) 与 z=z1 处截面中心
  const fitAxis = (cs: { x: number; y: number; z: number }[]) => {
    const n = cs.length
    let sz = 0; let szz = 0; let sx = 0; let sxz = 0; let sy = 0; let syz = 0
    for (const c of cs) {
      sz += c.z; szz += c.z * c.z; sx += c.x; sxz += c.x * c.z; sy += c.y; syz += c.y * c.z
    }
    const det = szz * n - sz * sz
    const ax = det > 1e-9 ? (sxz * n - sx * sz) / det : 0
    const ay = det > 1e-9 ? (syz * n - sy * sz) / det : 0
    const bx = det > 1e-9 ? (sx * szz - sxz * sz) / det : (sx / Math.max(n, 1))
    const by = det > 1e-9 ? (sy * szz - syz * sz) / det : (sy / Math.max(n, 1))
    return {
      dir: new THREE.Vector3(ax, ay, 1).normalize(),
      centerAtZ1: new THREE.Vector3(ax * z1 + bx, ay * z1 + by, z1),
      n,
    }
  }
  // 瞄准轴: 尖端侧 30% 切片 (至少 5 片) —— 姿态管线 b3, 保持原口径
  const cut30 = z1 - 0.3 * (z1 - z0)
  let tipCens = cens.filter((c) => c.z >= cut30)
  if (tipCens.length < 5) tipCens = cens.slice(-Math.min(5, cens.length))
  const aim = fitAxis(tipCens)
  // 焊丝方向: 喷嘴尖端面法向 —— 沿瞄准轴投影最高的 1mm 顶点带即尖端面(口部圆环),
  // 取面内两主方向叉积得法向。为什么不用尖端切片质心拟合: 喷嘴带大弯角且 STL 网格
  // 粗 (300 顶点) 时, z 向薄片在弯头处被斜切, 质心线系统性失真 (实测拟合偏差 73°),
  // 尖端面法向才是可靠的尖端局部轴 (实测与瞄准轴偏差仅 ~4.5°, 即真实弯头残差)。
  const aimDir = aim.dir
  let tipAxis = aimDir.clone()
  let tip = aim.centerAtZ1.clone()
  {
    const projs = new Float32Array(pos.count)
    let pmax = -Infinity
    for (let i = 0; i < pos.count; i++) {
      const p = pos.getX(i) * aimDir.x + pos.getY(i) * aimDir.y + pos.getZ(i) * aimDir.z
      projs[i] = p
      if (p > pmax) pmax = p
    }
    const band: THREE.Vector3[] = []
    for (let i = 0; i < pos.count; i++) {
      if (projs[i] >= pmax - 1) {
        band.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)))
      }
    }
    if (band.length >= 4) {
      const c = band.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(band.length)
      // 面内主方向 d1: 距质心最远点 a1 → 距 a1 最远点 a2
      const farthest = (from: THREE.Vector3) =>
        band.reduce((b, v) => (v.distanceToSquared(from) > b.distanceToSquared(from) ? v : b))
      const a1 = farthest(c)
      const a2 = farthest(a1)
      const d1 = a2.clone().sub(a1)
      if (d1.lengthSq() > 1e-8) {
        d1.normalize()
        // 面内第二方向 d2: ⊥d1 分量最长的顶点
        let d2: THREE.Vector3 | null = null
        let bestLen = 1e-4 // 至少 0.01mm, 防退化
        for (const vtx of band) {
          const perp = vtx.clone().sub(c).addScaledVector(d1, -vtx.clone().sub(c).dot(d1))
          if (perp.lengthSq() > bestLen * bestLen) { bestLen = perp.length(); d2 = perp }
        }
        if (d2) {
          const n = new THREE.Vector3().crossVectors(d1, d2).normalize()
          if (n.dot(aimDir) < 0) n.negate()
          tipAxis = n
          tip = c
        }
      }
    }
  }
  const axis = aim.dir
  return {
    tip, axis, tipAxis,
    wireTip: tip.clone().addScaledVector(tipAxis, WIRE_LEN),
    slices: aim.n,
  }
}

/**
 * 机身主轴: 枪颈直段 (远离喷嘴弯头的低 z 侧 60% 切片) 质心线拟合,
 * 返回单位向量, 指向法兰/机身侧 (-z 方向, 即演示时应尽量朝世界 +Z 的方向)。
 */
export function analyzeNeckAxis(geom: THREE.BufferGeometry): THREE.Vector3 {
  const pos = geom.getAttribute('position')
  geom.computeBoundingBox()
  const bb = geom.boundingBox!
  const z0 = bb.min.z
  const z1 = bb.max.z
  const buckets = new Map<number, { sx: number; sy: number; sz: number; n: number }>()
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    const k = Math.floor((z - z0) / 2)
    const b = buckets.get(k) ?? { sx: 0, sy: 0, sz: 0, n: 0 }
    b.sx += pos.getX(i); b.sy += pos.getY(i); b.sz += z; b.n++
    buckets.set(k, b)
  }
  const cut = z0 + 0.6 * (z1 - z0)
  let cens = [...buckets.values()]
    .filter((b) => b.n >= 6 && b.sz / b.n <= cut)
    .map((b) => ({ x: b.sx / b.n, y: b.sy / b.n, z: b.sz / b.n }))
  if (cens.length < 5) cens = [...buckets.values()]
    .filter((b) => b.n >= 6)
    .map((b) => ({ x: b.sx / b.n, y: b.sy / b.n, z: b.sz / b.n }))
    .slice(0, 5)
  const n = cens.length
  let sz = 0; let szz = 0; let sx = 0; let sxz = 0; let sy = 0; let syz = 0
  for (const c of cens) {
    sz += c.z; szz += c.z * c.z; sx += c.x; sxz += c.x * c.z; sy += c.y; syz += c.y * c.z
  }
  const det = szz * n - sz * sz
  const ax = det > 1e-9 ? (sxz * n - sx * sz) / det : 0
  const ay = det > 1e-9 ? (syz * n - sy * sz) / det : 0
  // (ax,ay,1) 朝喷嘴侧; 取反 → 朝法兰/机身侧
  return new THREE.Vector3(-ax, -ay, -1).normalize()
}

// ---------------------------------------------------------------- 焊丝-网格几何关系 (数值验证)

export interface WireFitInfo {
  /** C0_S 到喷嘴网格的最短距离 (mm; 到表面, 不区分内外) */
  c0ToNozzle: number
  /** 焊丝线段 [C0_S, TCP_S] 到喷嘴网格的最短距离 (mm); 相交则 dist≈0 且 intersects=true */
  wireToNozzle: { dist: number; intersects: boolean }
  /** 焊丝线段 [C0_S, TCP_S] 到枪颈网格的最短距离 (mm) 与是否相交 */
  wireToNeck: { dist: number; intersects: boolean }
  /** C0_S 到旧 STL 拟合尖端面中心的距离 (mm, 对照用) */
  c0ToFittedTip: number
}

/**
 * 文档权威 TCP/枪轴与机头网格的几何关系 (S 系, 静态计算一次):
 * 量化焊丝圆柱轴线段 [C0_S, TCP_S] 与喷嘴/枪颈网格之间的缝隙或穿插,
 * 用于权威值切换后的视觉/碰撞合理性数值验证 (three-mesh-bvh 最近点查询)。
 */
export function computeWireFit(
  nozzleGeom: THREE.BufferGeometry, neckGeom: THREE.BufferGeometry,
  fittedTip: THREE.Vector3,
): WireFitInfo {
  const seg = new THREE.Line3(DOC_C0_S.clone(), DOC_TCP_S.clone())
  // 线段→网格最短距离: shapecast 逐三角形 ExtendedTriangle.closestPointToSegment。
  // 不做包围盒剪枝 (喷嘴/枪颈三角形数量小; 且 AABB-线段最近距离无现成安全下界,
  // 用 Ray.intersectBox 在射线起点位于膨胀盒内时返回出点, 距离>段长会误剪 —— 实测
  // 曾把 0.015mm 误剪成 106mm), 仅在命中 0 (相交) 时提前终止。
  const segDist = (geom: THREE.BufferGeometry): { dist: number; intersects: boolean } => {
    const bvh = new MeshBVH(geom)
    let minDist = Infinity
    const v1 = new THREE.Vector3()
    const v2 = new THREE.Vector3()
    bvh.shapecast({
      intersectsBounds: () => true,
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(seg, v1, v2)
        if (d < minDist) minDist = d
        return minDist < 1e-9 // 相交 → 终止遍历
      },
    })
    return { dist: minDist, intersects: minDist < 1e-6 }
  }
  const nozzleBvh = new MeshBVH(nozzleGeom)
  const c0Target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const c0Nozzle = nozzleBvh.closestPointToPoint(DOC_C0_S, c0Target)
  return {
    c0ToNozzle: c0Nozzle ? c0Nozzle.distance : NaN,
    wireToNozzle: segDist(nozzleGeom),
    wireToNeck: segDist(neckGeom),
    c0ToFittedTip: DOC_C0_S.distanceTo(fittedTip),
  }
}

// ---------------------------------------------------------------- 机头模型

export interface TorchModel {
  /** 当前机头来源，显示与所有检测共用该模型。 */
  modelName: string
  group: THREE.Group
  neckMesh: THREE.Mesh
  nozzleMesh: THREE.Mesh
  wireMesh: THREE.Mesh
  analysis: NozzleAnalysis
  /** 焊丝轴线段与喷嘴/枪颈网格的几何关系 (S 系, 文档权威 TCP 数值验证) */
  wireFit: WireFitInfo
  /** 完整非索引三角形 (每9个float为一面)，碰撞检测不能丢弃边/面拓扑。 */
  neckVerts: Float32Array
  nozzleVerts: Float32Array
}

let torchCache: TorchModel | null = null
let torchPending: Promise<TorchModel> | null = null

/** 渲染与检测使用相同三角网格，兼容被 BVH 建索引/重排过的几何。 */
export function collisionTrianglesOf(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const count = index?.count ?? position.count
  const triangles = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const vertex = index ? index.getX(i) : i
    triangles[i * 3] = position.getX(vertex)
    triangles[i * 3 + 1] = position.getY(vertex)
    triangles[i * 3 + 2] = position.getZ(vertex)
  }
  return triangles
}

export function loadTorch(): Promise<TorchModel> {
  if (torchCache) return Promise.resolve(torchCache)
  if (!torchPending) {
    torchPending = createTorch().finally(() => { torchPending = null })
  }
  return torchPending
}

async function createTorch(): Promise<TorchModel> {
  const loader = new STLLoader()
  const source = await loader.loadAsync(RAFFLES_STL_URL)
  try {
    torchCache = createTorchFromRafflesGeometry(source)
    return torchCache
  } finally {
    source.dispose()
  }
}

/** 整套机头刚体对齐到既有工具系；渲染、回显和碰撞共享对齐后的完整网格。 */
export function createTorchFromRafflesGeometry(source: THREE.BufferGeometry): TorchModel {
  const { neckGeom, nozzleGeom, bodyAxis } = prepareRafflesTorchGeometry(source, DOC_C0_S, DOC_D_S)
  const analysis = analyzeNozzle(nozzleGeom)
  analysis.bodyAxis = bodyAxis
  // 权威值覆盖 (规范文档, S 系): 喷嘴出口中心 C0 / 枪轴 d_S / TCP。
  // STL 拟合值快照进 analysis.fitted 供对照; 此后全部消费方 (焊丝生成/姿态解算/
  // 碰撞检测/回显/调试钩子) 统一使用文档值, 一切旋转仍绕 TCP (wireTip) 枢转。
  analysis.fitted = {
    tip: analysis.tip.clone(), axis: analysis.axis.clone(),
    tipAxis: analysis.tipAxis.clone(), wireTip: analysis.wireTip.clone(),
  }
  analysis.tip = DOC_C0_S.clone()       // 喷嘴出口中心 C0_S
  analysis.axis = DOC_D_S.clone()       // 瞄准轴 b3 = 文档枪轴 d_S
  analysis.tipAxis = DOC_D_S.clone()    // 焊丝方向 = 文档枪轴 d_S
  analysis.wireTip = DOC_TCP_S.clone()  // TCP = C0_S + 20×d̂_S

  const neckMat = new THREE.MeshStandardMaterial({
    color: '#8a8f98', metalness: 0.7, roughness: 0.35 })
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: '#b87333', metalness: 0.75, roughness: 0.3 })
  const neckMesh = new THREE.Mesh(neckGeom, neckMat)
  const nozzleMesh = new THREE.Mesh(nozzleGeom, nozzleMat)
  neckMesh.name = 'torch_neck'
  nozzleMesh.name = 'torch_nozzle'

  // 焊丝: Ø1.2 × 20mm 圆柱, 从喷嘴尖端面中心沿尖端局部轴 (tipAxis) 伸出
  const wireGeom = new THREE.CylinderGeometry(WIRE_DIA / 2, WIRE_DIA / 2, WIRE_LEN, 12)
  const wireMesh = new THREE.Mesh(wireGeom, new THREE.MeshStandardMaterial({
    color: '#d4d4d4', metalness: 0.85, roughness: 0.25 }))
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), analysis.tipAxis)
  wireMesh.quaternion.copy(quat)
  wireMesh.position.copy(analysis.tip).addScaledVector(analysis.tipAxis, WIRE_LEN / 2)
  wireMesh.name = 'torch_wire'

  const group = new THREE.Group()
  group.add(neckMesh, nozzleMesh, wireMesh)
  group.name = 'torch'
  group.visible = false

  return {
    modelName: RAFFLES_MODEL_NAME, group, neckMesh, nozzleMesh, wireMesh, analysis,
    wireFit: computeWireFit(nozzleGeom, neckGeom, analysis.fitted!.tip),
    neckVerts: collisionTrianglesOf(neckGeom), nozzleVerts: collisionTrianglesOf(nozzleGeom),
  }
}

// ---------------------------------------------------------------- 板件三角形 (法向采样 + 碰撞)

interface PartGeom {
  partId: string
  /** 非索引三角形顶点 (9 float/三角形), 数据坐标 */
  positions: Float32Array
  /** 与 positions 对应的顶点法向 (mesh.bin 自带, 建模朝向一致朝外) */
  normals: Float32Array
  /** 加载时重建的平滑顶点法向 (同位置顶点焊接 + 折痕聚类, 见 computeSmoothNormals);
   *  mesh.bin 原始法向是平直着色 (逐面复制), 曲面插值必须用本字段 */
  smoothNormals: Float32Array
  bbox: THREE.Box3
  bvh?: MeshBVH
}

/** 锐边/折痕判定阈值 (°): 插值法向与面法向夹角超过此值视为锐边 (保留面法向);
 *  平滑重建时同位置顶点处面法向夹角超过此值的三角形不互相平滑 (棱边保持锐利) */
const SHARP_EDGE_DEG = 60
const SHARP_EDGE_COS = Math.cos(SHARP_EDGE_DEG * Math.PI / 180)
/** 折痕角余弦: 与 SHARP_EDGE_DEG 同值 —— 圆柱壁等曲面的小台阶 (<60°) 被平滑, 设计棱边 (≥60°) 保留 */
const CREASE_COS = SHARP_EDGE_COS

/**
 * 由三角形几何重建平滑顶点法向:
 *  1. 面法向取未归一化叉积 (= 面积加权);
 *  2. 顶点按位置焊接 (1e-3 mm 量化分组, 非索引网格中同位置的复制顶点合并);
 *  3. 组内按折痕角贪心聚类: 面法向与簇加权和的夹角 <60° 才并入, 否则另立簇;
 *  4. 每个顶点取其所属簇的归一化加权和。
 * 圆柱壁等曲面的相邻小面片 (法向差几度) 聚成一簇 → 顶点法向 = 光滑径向;
 * 90° 棱边两侧面片分簇 → 各自保留面法向, 折痕不被抹平。
 */
function computeSmoothNormals(positions: Float32Array): Float32Array {
  const nV = positions.length / 3
  const out = new Float32Array(positions.length)
  // 面积加权面法向 (每三角形 3 float)
  const fn = new Float32Array(positions.length / 3)
  for (let t = 0, o = 0; t < fn.length; t += 3, o += 9) {
    const abx = positions[o + 3] - positions[o]; const aby = positions[o + 4] - positions[o + 1]
    const abz = positions[o + 5] - positions[o + 2]
    const acx = positions[o + 6] - positions[o]; const acy = positions[o + 7] - positions[o + 1]
    const acz = positions[o + 8] - positions[o + 2]
    fn[t] = aby * acz - abz * acy; fn[t + 1] = abz * acx - abx * acz; fn[t + 2] = abx * acy - aby * acx
  }
  // 同位置顶点分组
  const groups = new Map<string, number[]>()
  for (let v = 0; v < nV; v++) {
    const key = `${Math.round(positions[v * 3] * 1e3)},${Math.round(positions[v * 3 + 1] * 1e3)},${Math.round(positions[v * 3 + 2] * 1e3)}`
    const g = groups.get(key)
    if (g) g.push(v); else groups.set(key, [v])
  }
  // 组内折痕聚类
  interface Cluster { sx: number; sy: number; sz: number; mem: number[] }
  for (const g of groups.values()) {
    const clusters: Cluster[] = []
    for (const v of g) {
      const t = Math.floor(v / 3) * 3
      const fx = fn[t]; const fy = fn[t + 1]; const fz = fn[t + 2]
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz)
      if (fl < 1e-12) continue // 退化三角形不参与 (顶点保持零法向, 插值侧回退面法向)
      let bestC = -1; let bestDot = CREASE_COS
      for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci]
        const cl = Math.sqrt(c.sx * c.sx + c.sy * c.sy + c.sz * c.sz)
        if (cl < 1e-12) continue
        const d = (fx * c.sx + fy * c.sy + fz * c.sz) / (fl * cl)
        if (d >= bestDot) { bestDot = d; bestC = ci }
      }
      if (bestC >= 0) {
        const c = clusters[bestC]; c.sx += fx; c.sy += fy; c.sz += fz; c.mem.push(v)
      } else {
        clusters.push({ sx: fx, sy: fy, sz: fz, mem: [v] })
      }
    }
    for (const c of clusters) {
      const l = Math.sqrt(c.sx * c.sx + c.sy * c.sy + c.sz * c.sz) || 1
      for (const v of c.mem) {
        out[v * 3] = c.sx / l; out[v * 3 + 1] = c.sy / l; out[v * 3 + 2] = c.sz / l
      }
    }
  }
  return out
}

const partGeomCache = new WeakMap<Float32Array, WeakMap<PartsData, PartGeom[]>>()

function partGeoms(partsData: PartsData, mesh: Float32Array): PartGeom[] {
  let byParts = partGeomCache.get(mesh)
  if (!byParts) {
    byParts = new WeakMap()
    partGeomCache.set(mesh, byParts)
  }
  const cached = byParts.get(partsData)
  if (cached) return cached
  const geometries = partsData.parts.map((p) => {
    const slice = mesh.slice(p.vertexOffset * 6, (p.vertexOffset + p.vertexCount) * 6)
    const positions = new Float32Array(p.vertexCount * 3)
    const normals = new Float32Array(p.vertexCount * 3)
    for (let v = 0; v < p.vertexCount; v++) {
      positions[v * 3] = slice[v * 6]
      positions[v * 3 + 1] = slice[v * 6 + 1]
      positions[v * 3 + 2] = slice[v * 6 + 2]
      normals[v * 3] = slice[v * 6 + 3]
      normals[v * 3 + 1] = slice[v * 6 + 4]
      normals[v * 3 + 2] = slice[v * 6 + 5]
    }
    return {
      partId: p.id,
      positions,
      normals,
      smoothNormals: computeSmoothNormals(positions),
      bbox: new THREE.Box3(
        new THREE.Vector3(...(p.bbox.min as [number, number, number])),
        new THREE.Vector3(...(p.bbox.max as [number, number, number]))),
    }
  })
  byParts.set(partsData, geometries)
  return geometries
}

// ---------------------------------------------------------------- 面法向采样

interface FaceDesc {
  类型?: string
  法向?: number[] | null
}

/** 点到三角形最近距离平方 (纯数组) */
function ptTriDist2(p: [number, number, number], t: Float32Array, o: number): number {
  const ax = t[o]; const ay = t[o + 1]; const az = t[o + 2]
  const bx = t[o + 3]; const by = t[o + 4]; const bz = t[o + 5]
  const cx = t[o + 6]; const cy = t[o + 7]; const cz = t[o + 8]
  // 标准点-三角形最近点 (Ericson)
  const abx = bx - ax; const aby = by - ay; const abz = bz - az
  const acx = cx - ax; const acy = cy - ay; const acz = cz - az
  const apx = p[0] - ax; const apy = p[1] - ay; const apz = p[2] - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz
  const bpx = p[0] - bx; const bpy = p[1] - by; const bpz = p[2] - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    const qx = ax + abx * v - p[0]; const qy = ay + aby * v - p[1]; const qz = az + abz * v - p[2]
    return qx * qx + qy * qy + qz * qz
  }
  const cpx = p[0] - cx; const cpy = p[1] - cy; const cpz = p[2] - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    const qx = ax + acx * w - p[0]; const qy = ay + acy * w - p[1]; const qz = az + acz * w - p[2]
    return qx * qx + qy * qy + qz * qz
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    const qx = bx + (cx - bx) * w - p[0]; const qy = by + (cy - by) * w - p[1]
    const qz = bz + (cz - bz) * w - p[2]
    return qx * qx + qy * qy + qz * qz
  }
  // 面内部: 到平面距离
  const nx = aby * acz - abz * acy; const ny = abz * acx - abx * acz; const nz = abx * acy - aby * acx
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  const dist = (apx * nx + apy * ny + apz * nz) / nl
  return dist * dist
}

/**
 * 板件上最近点的法向: 取重建平滑顶点法向 (computeSmoothNormals, mesh.bin 原始法向为
 * 平直着色不可用) 按最近点重心坐标插值 —— 曲面上法向随位置平滑变化, 闭合圆首尾采样点
 * 落在同一光滑面上时法向连续, 消除面法向的三角形阶梯跳变; 插值结果与叉积面法向夹角
 * >60° 判定为锐边 (顶点法向被邻面平均污染), 保留面法向; 顶点法向缺失/退化时回退面法向,
 * 三角形退化时返回 null (旧行为)。
 */
function nearestTriNormal(pg: PartGeom, p: [number, number, number]): THREE.Vector3 | null {
  let best = Infinity; let bo = -1
  for (let o = 0; o < pg.positions.length; o += 9) {
    const d2 = ptTriDist2(p, pg.positions, o)
    if (d2 < best) { best = d2; bo = o }
  }
  if (bo < 0) return null
  const t = pg.positions
  const a = new THREE.Vector3(t[bo], t[bo + 1], t[bo + 2])
  const b = new THREE.Vector3(t[bo + 3], t[bo + 4], t[bo + 5])
  const c = new THREE.Vector3(t[bo + 6], t[bo + 7], t[bo + 8])
  const faceN = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
  if (faceN.lengthSq() < 1e-12) return null // 退化三角形: 与旧行为一致
  faceN.normalize()
  let interpN: THREE.Vector3 | null = null
  if (pg.smoothNormals.length >= bo + 9) {
    const tri = new THREE.Triangle(a, b, c)
    const cp = new THREE.Vector3()
    tri.closestPointToPoint(new THREE.Vector3(...p), cp)
    const bary = new THREE.Vector3() // x/y/z 分别对应顶点 a/b/c
    tri.getBarycoord(cp, bary)
    const n = pg.smoothNormals
    interpN = new THREE.Vector3(
      n[bo] * bary.x + n[bo + 3] * bary.y + n[bo + 6] * bary.z,
      n[bo + 1] * bary.x + n[bo + 4] * bary.y + n[bo + 7] * bary.z,
      n[bo + 2] * bary.x + n[bo + 5] * bary.y + n[bo + 8] * bary.z)
    if (interpN.lengthSq() < 1e-12) interpN = null // 插值退化 (顶点法向相互抵消) → 面法向
    else interpN.normalize()
  }
  // 锐边: 顶点法向是邻面平均, 与真实面法向偏差大, 不可信 → 保留面法向
  if (interpN && interpN.dot(faceN) < SHARP_EDGE_COS) return faceN
  return interpN ?? faceN
}

/** 单点面法向: 平面用段数据常量, 曲面用 mesh 最近三角形 */
function faceNormalAt(
  face: FaceDesc | null | undefined, pg: PartGeom | undefined, p: [number, number, number],
  fallback: THREE.Vector3,
): THREE.Vector3 {
  if (face && face.类型 === '平面' && Array.isArray(face.法向)) {
    return new THREE.Vector3(...(face.法向 as [number, number, number])).normalize()
  }
  if (pg) {
    const n = nearestTriNormal(pg, p)
    if (n) return n
  }
  return fallback.clone()
}

// ---------------------------------------------------------------- 路径采样

export interface PathSample {
  /** 弧长 (mm, 沿演示路径) */
  s: number
  pos: THREE.Vector3
  tangent: THREE.Vector3
  nMain: THREE.Vector3
  nSub: THREE.Vector3
  /** Effective process position of the source member at this point. */
  weldingPosition?: string
}

function sampleWeldingPosition(weld: Weld, tangent: THREE.Vector3): string | undefined {
  const position = weld.properties.焊接位置 as { 代号?: unknown } | undefined
  const code = typeof position?.代号 === 'string' ? position.代号 : undefined
  if ((code === 'PF' || code === 'PG') && Math.abs(tangent.z) > 1e-8) return tangent.z < 0 ? 'PG' : 'PF'
  return code
}

/** 转角注入经过实际回退、前进及长度钳制后的三锚点，弧长位于最终演示路径上。 */
export interface CornerAnchor {
  memberIndex: number
  inPos: number[]
  apexPos: number[]
  outPos: number[]
  sIn: number
  sApex: number
  sOut: number
}

export interface DemoPath {
  samples: PathSample[]
  total: number
  closed: boolean
  /** 目标描述 (调试用) */
  targetDesc: string
  /** 逐样本预计算姿态 (computePathPoses 填充, 带连续性) */
  poses?: TorchPose[]
  /** 精确姿态曲线优先于样本间 slerp；几何/TCP 仍由 samples 决定。 */
  poseCurves?: PoseCurve[]
  cornerAnchors?: CornerAnchor[]
  /** 精确有界工艺姿态或裁剪片段的求值器，不重新拟合原姿态曲线。 */
  poseResolver?: (s: number, analysis: NozzleAnalysis) => TorchPose
  /** 与poseResolver对应的连续旋转弧长上界，不能仅用两端姿态差代替。 */
  poseRotationBound?: (a: number, b: number, analysis: NozzleAnalysis) => number
  /** 精确姿态函数的分段边界，必须加入扫掠采样。 */
  poseSampleDistances?: number[]
}

/** 碰撞区间记录 (按 部件×零件 合并, 间隙 <2mm 并为一段) */
export interface CollInterval {
  comp: 'neck' | 'nozzle'
  part: string
  a: number
  b: number
}

const SAMPLE_STEP = 5 // mm

/** 点到段折线最近距离 (纯数组) */
function distToPolyline(pt: [number, number, number], pts: number[][]): number {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]; const b = pts[i + 1]
    const abx = b[0] - a[0]; const aby = b[1] - a[1]; const abz = b[2] - a[2]
    const len2 = abx * abx + aby * aby + abz * abz
    let t = 0
    if (len2 > 1e-12) {
      t = Math.max(0, Math.min(1,
        ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby + (pt[2] - a[2]) * abz) / len2))
    }
    const dx = pt[0] - (a[0] + abx * t); const dy = pt[1] - (a[1] + aby * t)
    const dz = pt[2] - (a[2] + abz * t)
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d < best) best = d
  }
  return best
}

interface WeldSegProp {
  index?: number
  主板面?: FaceDesc | null
  副板面?: FaceDesc | null
}

/** 采样点归属的原始段面数据 (最近距离 <0.5mm), 以及曲面端点的单侧法向查询点。 */
function segFaceAt(weld: Weld, pt: [number, number, number]): {
  main?: FaceDesc | null; sub?: FaceDesc | null
  normalPoint?: [number, number, number]
} {
  const segProps = ((weld.properties['焊缝段'] ?? []) as WeldSegProp[])
  let bestSeg: number | null = null
  let best = Infinity
  weld.segments.forEach((seg, i) => {
    if (!seg.points || seg.points.length < 2) return
    const d = distToPolyline(pt, seg.points as number[][])
    if (d < best) { best = d; bestSeg = i }
  })
  if (bestSeg === null || best > 0.5) return {}
  const seg = weld.segments[bestSeg]
  const sp = segProps.find((s) => s.index === seg.index) ?? segProps[seg.index - 1] ?? null
  let normalPoint: [number, number, number] | undefined
  if (sp?.主板面?.类型 === '曲面' || sp?.副板面?.类型 === '曲面') {
    // 曲面终止棱上多个面等距, 全零件最近三角形可能抓到截断平面。
    // 仅在本源段端点附近沿本段内侧取单侧极限, 不跨段平均或改变 TCP 位置。
    // 0.02mm 覆盖子段坐标的 0.01mm 量化误差; 查询内移最多 0.05mm。
    const points = seg.points
    for (const end of [0, points.length - 1]) {
      const p = points[end]
      if (Math.hypot(pt[0] - p[0], pt[1] - p[1], pt[2] - p[2]) > 0.02) continue
      const step = end === 0 ? 1 : -1
      for (let j = end + step; j >= 0 && j < points.length; j += step) {
        const d = new THREE.Vector3(points[j][0] - p[0], points[j][1] - p[1], points[j][2] - p[2])
        const length = d.length()
        if (length < 1e-9) continue
        d.multiplyScalar(Math.min(0.05, length * 0.1) / length)
        normalPoint = [p[0] + d.x, p[1] + d.y, p[2] + d.z]
        break
      }
      if (normalPoint) break
    }
  }
  return { main: sp?.主板面 ?? null, sub: sp?.副板面 ?? null, normalPoint }
}

/** 折线拼接 (段间接缝去重) */
export function concatPolyline(weld: Weld): number[][] {
  const pts: number[][] = []
  for (const seg of weld.segments) {
    for (const p of seg.points) {
      const last = pts[pts.length - 1]
      if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6
        && Math.abs(last[2] - p[2]) < 1e-6) continue
      pts.push(p as number[])
    }
  }
  return pts
}

interface CornerEndpointSource {
  weld: Weld
  tangent: THREE.Vector3
}

interface PathPiece {
  points: number[][]
  weld: Weld
  /** Explicit manual wrap frames retain the real two plate-side normals. */
  preserveNormals?: boolean
  normalAt?: (point: THREE.Vector3) => { nMain: THREE.Vector3; nSub: THREE.Vector3 }
  /** 转角注入段: 固定法向 (转角点偏离原焊缝段, segFaceAt 会落空); 采样时优先使用 */
  normals?: { nMain: [number, number, number]; nSub: [number, number, number] }
  /** 三点注入 piece 的源成员索引；最终拼接后才计算锚点弧长，避免倒序 splice 改变下标。 */
  cornerMemberIndex?: number
  /** 入/出锚点继承各自相邻焊缝；bridge 内部才使用平均法向。 */
  cornerEndpointSources?: [CornerEndpointSource, CornerEndpointSource]
}

/** 转角路径注入 (工艺路径库): 在链序第 memberIndex 个成员之后的转角处,
 *  路径改为 入角点(回退a) → 转角点(沿对角线偏移c) → 出角点(前进b) */
export interface CornerInjection {
  memberIndex: number
  a: number
  b: number
  c: number
  /** 转角处平均法向 (注入段采样用) */
  nMain: [number, number, number]
  nSub: [number, number, number]
}

/** 逐段采样: 保留真实折线顶点，并按 SAMPLE_STEP mm 弧长网格补姿态样本。 */
function samplePieces(
  pieces: PathPiece[], partsData: PartsData, mesh: Float32Array, closed: boolean,
): DemoPath | null {
  const pgs = partGeoms(partsData, mesh)
  const pgOf = (id: string) => pgs.find((p) => p.partId === id)
  // 1. 拼接成单折线，来源绑定到边 pts[i]→pts[i+1]，而不是共享顶点。
  // 接缝去重只能去掉坐标；接缝后的边必须使用后一个 piece 的面和注入法向。
  const pts: THREE.Vector3[] = []
  const sourceAt: PathPiece[] = []
  const anchorIndices: {
    memberIndex: number; indices: number[]; sources?: PathPiece['cornerEndpointSources']
  }[] = []
  let previousPiece: PathPiece | undefined
  for (const piece of pieces) {
    const indices: number[] = []
    for (let i = 0; i < piece.points.length; i++) {
      const p = piece.points[i]
      const v = new THREE.Vector3(p[0], p[1], p[2])
      const last = pts[pts.length - 1]
      if (last && i === 0 && last.distanceToSquared(v) < 1e-12) {
        indices.push(pts.length - 1)
        continue
      }
      // 非重合接缝的连接边保持原有前段来源；piece 内的边总归当前 piece。
      if (last) sourceAt.push(i === 0 ? previousPiece ?? piece : piece)
      pts.push(v)
      indices.push(pts.length - 1)
    }
    if (piece.cornerMemberIndex !== undefined && indices.length === 3) {
      anchorIndices.push({ memberIndex: piece.cornerMemberIndex, indices, sources: piece.cornerEndpointSources })
    }
    if (piece.points.length > 0) previousPiece = piece
  }
  if (pts.length < 2) return null
  // 2. 弧长累计
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
  const total = cum[cum.length - 1]
  if (total < 1e-9) return null
  const cornerAnchors = anchorIndices.map(({ memberIndex, indices: [i, a, o] }): CornerAnchor => ({
    memberIndex,
    inPos: pts[i].toArray(), apexPos: pts[a].toArray(), outPos: pts[o].toArray(),
    sIn: cum[i], sApex: cum[a], sOut: cum[o],
  }))
  const cornerEndpointAt = new Map<number, CornerEndpointSource>()
  for (const { indices: [i, , o], sources } of anchorIndices) {
    if (!sources) continue
    cornerEndpointAt.set(cum[i], sources[0])
    cornerEndpointAt.set(cum[o], sources[1])
  }
  // 3. 弧长网格采样
  const up = new THREE.Vector3(0, 0, 1)
  const samples: PathSample[] = []
  const trustedNormals = new WeakSet<PathSample>()
  let seg = 0
  const sampleCount = Math.ceil(total / SAMPLE_STEP)
  // sampleAt/pathPoseAt interpolate these samples as the TCP geometry itself.
  // A 5mm grid alone replaces short arcs and off-grid corners with chords.
  // Keep every source vertex, including the join between an arc and its straight extension.
  const sampleDistances: number[] = [...cum]
  let vertexIndex = 0
  for (let i = 0; i <= sampleCount; i++) {
    // 最后一段不足 SAMPLE_STEP 时也必须采到精确终点, 避免 sampleAt(total) 外推。
    const s = Math.min(i * SAMPLE_STEP, total)
    while (vertexIndex < cum.length - 1 && cum[vertexIndex] < s - 1e-9) vertexIndex++
    // Prefer the exact geometric vertex over a numerically coincident grid point.
    if (Math.abs(cum[vertexIndex] - s) > 1e-9) sampleDistances.push(s)
  }
  // 回显与三点姿态必须落在真实锚点，不能依赖相邻5mm网格的折线/姿态插值。
  for (const a of cornerAnchors) sampleDistances.push(a.sIn, a.sApex, a.sOut)
  const uniqueDistances = [...new Set(sampleDistances)].sort((a, b) => a - b)
  for (const ss of uniqueDistances) {
    while (seg < pts.length - 2 && cum[seg + 1] < ss - 1e-9) seg++
    const span = cum[seg + 1] - cum[seg]
    const t = span > 1e-12 ? Math.min((ss - cum[seg]) / span, 1) : 0
    const pos = pts[seg].clone().lerp(pts[seg + 1], t)
    // 三点区间的两端应接续入/出焊缝的自然姿态，而不是把出口留在bridge平均面上。
    // 仅改变姿态的来源，精确点位/弧长不变；曲面仍经 segFaceAt 的单侧端点查询。
    const cornerEndpoint = cornerEndpointAt.get(ss)
    // 拆分坐标量化可能产生重复顶点。保留点位及转角锚点索引，方向与面来源取
    // 最近的有效边：起点优先出边，末尾重复点退回入边，不能生成零切向。
    let directionSeg = seg
    const edgeIsZero = (index: number) => pts[index].distanceToSquared(pts[index + 1]) < 1e-24
    while (directionSeg < pts.length - 2 && edgeIsZero(directionSeg)) directionSeg++
    while (directionSeg > 0 && edgeIsZero(directionSeg)) directionSeg--
    const tangent = cornerEndpoint?.tangent.clone().normalize()
      ?? pts[directionSeg + 1].clone().sub(pts[directionSeg]).normalize()
    const w = cornerEndpoint?.weld ?? sourceAt[directionSeg].weld
    const piece = sourceAt[directionSeg]
    const manualNormals = cornerEndpoint ? undefined : piece.normalAt?.(pos)
    const no = manualNormals ? { nMain: manualNormals.nMain.toArray() as [number, number, number], nSub: manualNormals.nSub.toArray() as [number, number, number] }
      : cornerEndpoint ? undefined : piece.normals
    const p: [number, number, number] = [pos.x, pos.y, pos.z]
    const face = no ? null : segFaceAt(w, p)
    const normalPoint = face?.normalPoint ?? p
    const projectedNormals = no ? null : projectedLapNormalsAt(w, p)
    const sample: PathSample = {
      s: ss, pos, tangent,
      weldingPosition: sampleWeldingPosition(w, tangent),
      nMain: no ? new THREE.Vector3(...no.nMain).normalize()
        : projectedNormals?.nMain ?? faceNormalAt(face?.main, pgOf(w.mainPartId), normalPoint, up),
      nSub: no ? new THREE.Vector3(...no.nSub).normalize()
        : projectedNormals?.nSub ?? faceNormalAt(face?.sub, pgOf(w.subPartId), normalPoint, up),
    }
    samples.push(sample)
    if (piece.preserveNormals || manualNormals || projectedNormals || (no && w.properties['投影搭接'])) trustedNormals.add(sample)
    if (ss >= total) break
  }
  // 4. 法向符号校正: 网格最近三角形法向在板边/背面采样时可能整段取反
  //    (如 W069-1 起点 6mm 抓到主板背面 (0,0,-1)), 按序列主方向统一符号,
  //    再做相邻连续性兜底, 保证角平分线不跳变
  for (const key of ['nMain', 'nSub'] as const) {
    const mean = new THREE.Vector3()
    for (const sm of samples) mean.add(sm[key])
    if (mean.length() > 0.3 * samples.length) {
      mean.normalize()
      for (const sm of samples) if (!trustedNormals.has(sm) && sm[key].dot(mean) < 0) sm[key].negate()
    }
    for (let i = 1; i < samples.length; i++) {
      // Native projected side-wall normals are signed CAD evidence. A contour
      // can naturally turn beyond a hemisphere; mesh-sign repair must not flip it.
      if (!trustedNormals.has(samples[i]) && samples[i][key].dot(samples[i - 1][key]) < 0) samples[i][key].negate()
    }
  }
  if (closed) {
    // 同一个闭合接缝只保留一套局部架: 末点不应由最后一条弦独立定向。
    const first = samples[0]
    const last = samples[samples.length - 1]
    last.pos.copy(first.pos)
    last.tangent.copy(first.tangent)
    last.nMain.copy(first.nMain)
    last.nSub.copy(first.nSub)
    last.weldingPosition = first.weldingPosition
  }
  return { samples, total, closed, targetDesc: '', ...(cornerAnchors.length > 0 ? { cornerAnchors } : {}) }
}

/** 插值取弧长 s 处样本 (法向/切线 lerp+normalize; 闭合路径不 wrap —— 演示到 L 结束) */
export function sampleAt(path: DemoPath, s: number): PathSample {
  const ss = Math.max(0, Math.min(s, path.total))
  const arr = path.samples
  let lo = 0; let hi = arr.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].s <= ss) lo = mid; else hi = mid
  }
  const a = arr[lo]; const b = arr[Math.min(lo + 1, arr.length - 1)]
  const span = b.s - a.s
  const t = span > 1e-9 ? (ss - a.s) / span : 0
  const lerpV = (u: THREE.Vector3, v: THREE.Vector3) =>
    u.clone().lerp(v, t).normalize()
  return {
    s: ss,
    pos: a.pos.clone().lerp(b.pos, t),
    tangent: lerpV(a.tangent, b.tangent),
    nMain: lerpV(a.nMain, b.nMain),
    nSub: lerpV(a.nSub, b.nSub),
    weldingPosition: t >= 1 - 1e-10 ? b.weldingPosition ?? a.weldingPosition : a.weldingPosition ?? b.weldingPosition,
  }
}

// ---------------------------------------------------------------- 演示路径构建

/** 折线总长 */
function polyLen(pts: number[][]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])
  }
  return s
}
/** 折线首/末段单位切向 (首段=前进方向, 末段=到达方向) */
function dirAtStart(pts: number[][]): THREE.Vector3 | null {
  for (let i = 1; i < pts.length; i++) {
    const d = new THREE.Vector3(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1], pts[i][2] - pts[0][2])
    if (d.lengthSq() > 1e-12) return d.normalize()
  }
  return null
}
function dirAtEnd(pts: number[][]): THREE.Vector3 | null {
  const n = pts.length
  for (let i = n - 2; i >= 0; i--) {
    const d = new THREE.Vector3(
      pts[n - 1][0] - pts[i][0], pts[n - 1][1] - pts[i][1], pts[n - 1][2] - pts[i][2])
    if (d.lengthSq() > 1e-12) return d.normalize()
  }
  return null
}
/** 从折线末端回退 d mm: 返回截断点列 (≥2 点) 与回退点坐标 */
function walkBackPts(pts: number[][], d: number): { pts: number[][]; at: number[] } {
  let remain = d
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i - 1]; const b = pts[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (remain <= len && len > 1e-9) {
      const t = remain / len
      const p = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t]
      const out = [...pts.slice(0, i), p]
      if (out.length < 2) out.unshift([p[0], p[1], p[2]])
      return { pts: out, at: p }
    }
    remain -= len
  }
  return { pts: [pts[0].slice(), pts[0].slice()], at: pts[0].slice() }
}
/** 从折线首端前进 d mm: 返回截头点列 (≥2 点) 与前进点坐标 */
function walkForwardPts(pts: number[][], d: number): { pts: number[][]; at: number[] } {
  let remain = d
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (remain <= len && len > 1e-9) {
      const t = remain / len
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
      const out = [p, ...pts.slice(i)]
      if (out.length < 2) out.push([p[0], p[1], p[2]])
      return { pts: out, at: p }
    }
    remain -= len
  }
  const n = pts.length
  return { pts: [pts[n - 1].slice(), pts[n - 1].slice()], at: pts[n - 1].slice() }
}

/**
 * 转角三点注入: 链序第 memberIndex 个成员之后的转角处, 把
 * 「…→转角点(原接头)→…」改为 「…→入角点(回退a)→转角点(沿 d1+d2 对角线偏移c)→出角点(前进b)→…」。
 * 倒序处理保证下标不受 splice 影响。
 */
function applyCornerInjections(
  pieces: PathPiece[], memberPieceIdx: number[], injections: CornerInjection[],
): void {
  const sorted = [...injections].sort((x, y) => y.memberIndex - x.memberIndex)
  for (const inj of sorted) {
    const pi = memberPieceIdx[inj.memberIndex]
    const pj = memberPieceIdx[inj.memberIndex + 1]
    if (pi === undefined || pj === undefined || pi < 0 || pj !== pi + 1) continue
    const A = pieces[pi]
    const B = pieces[pi + 1]
    const lenA = polyLen(A.points)
    const lenB = polyLen(B.points)
    if (lenA < 2 || lenB < 2) continue
    const d1 = dirAtEnd(A.points)
    const d2 = dirAtStart(B.points)
    if (!d1 || !d2) continue
    const a = Math.max(0, Math.min(inj.a, lenA - 1))
    const b = Math.max(0, Math.min(inj.b, lenB - 1))
    const wA = walkBackPts(A.points, a)
    const wB = walkForwardPts(B.points, b)
    const corner = new THREE.Vector3(...(A.points[A.points.length - 1] as [number, number, number]))
    const diag = d1.clone().add(d2)
    // 对角线方向 = 出入射方向的角平分线; 退化 (近 180° 折返) 时退回入射方向
    if (diag.lengthSq() < 1e-6) diag.copy(d1)
    diag.normalize()
    const apex = corner.clone().addScaledVector(diag, inj.c)
    pieces.splice(pi, 2,
      { ...A, points: wA.pts },
      {
        points: [wA.at, apex.toArray() as number[], wB.at], weld: A.weld,
        normals: { nMain: inj.nMain, nSub: inj.nSub },
        cornerMemberIndex: inj.memberIndex,
        cornerEndpointSources: [
          { weld: A.weld, tangent: dirAtEnd(wA.pts) ?? d1 },
          { weld: B.weld, tangent: dirAtStart(wB.pts) ?? d2 },
        ],
      },
      { ...B, points: wB.pts })
  }
}

/**
 * 端点姿态样本 (包角预检用): pos=端点, 切向=端点所在折线段的切向,
 * 法向=端点处主板/副板面法向 (端点在板边/棱上易抓到相邻面/背面, 内部做符号校正)。
 */
export function endpointSample(
  weld: Weld, partsData: PartsData, mesh: Float32Array, which: 'start' | 'end',
): PathSample | null {
  const pts = concatPolyline(weld)
  if (pts.length < 2) return null
  const pgs = partGeoms(partsData, mesh)
  const pgOf = (id: string) => pgs.find((p) => p.partId === id)
  const up = new THREE.Vector3(0, 0, 1)
  const n = pts.length
  const at = (i: number) => new THREE.Vector3(...(pts[i] as [number, number, number]))
  const pos = which === 'start' ? at(0) : at(n - 1)
  const tangent = which === 'start'
    ? at(1).sub(at(0))
    : at(n - 1).sub(at(n - 2))
  if (tangent.lengthSq() < 1e-12) return null
  tangent.normalize()

  const normalsAt = (p: THREE.Vector3): { nMain: THREE.Vector3; nSub: THREE.Vector3 } => {
    const pa: [number, number, number] = [p.x, p.y, p.z]
    const projected = projectedLapNormalsAt(weld, pa)
    if (projected) return projected
    const face = segFaceAt(weld, pa)
    const normalPoint = face.normalPoint ?? pa
    return {
      nMain: faceNormalAt(face.main, pgOf(weld.mainPartId), normalPoint, up),
      nSub: faceNormalAt(face.sub, pgOf(weld.subPartId), normalPoint, up),
    }
  }
  // 折线总长与"距端点 d 处"的内侧点
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + at(i).distanceTo(at(i - 1)))
  const total = cum[n - 1]
  const atDist = (d: number): THREE.Vector3 => {
    const dd = Math.max(0, Math.min(d, total))
    let i = 1
    while (i < n - 1 && cum[i] < dd) i++
    const span = cum[i] - cum[i - 1]
    const t = span > 1e-12 ? (dd - cum[i - 1]) / span : 0
    return at(i - 1).lerp(at(i), t)
  }
  const endN = normalsAt(pos)
  // 端点恰在板边/棱上, 最近三角形可能抓到相邻面/背面 → 与两个内侧参考点
  // (~L/4, ~L/2, 封顶 30mm) 的法向比较, 均反向才翻转 (单票不翻, 防参考点局部异常)
  const flip = { nMain: 0, nSub: 0 }
  for (const frac of [0.25, 0.5]) {
    const d1 = Math.min(total * frac, 30)
    if (d1 < 1e-6) continue
    const ref = normalsAt(which === 'start' ? atDist(d1) : atDist(total - d1))
    for (const key of ['nMain', 'nSub'] as const) {
      if (endN[key].dot(ref[key]) < 0) flip[key]++
    }
  }
  for (const key of ['nMain', 'nSub'] as const) {
    if (flip[key] >= 2) endN[key].negate()
  }
  return { s: 0, pos, tangent, nMain: endN.nMain, nSub: endN.nSub,
    weldingPosition: sampleWeldingPosition(weld, tangent) }
}

/** 焊缝在任意点的主板/副板面法向 (工艺路径库转角判定复用) */
export function weldNormalsAt(
  weld: Weld, partsData: PartsData, mesh: Float32Array, p: [number, number, number],
): { nMain: THREE.Vector3; nSub: THREE.Vector3 } {
  const projected = projectedLapNormalsAt(weld, p)
  if (projected) return projected
  const pgs = partGeoms(partsData, mesh)
  const up = new THREE.Vector3(0, 0, 1)
  const face = segFaceAt(weld, p)
  const normalPoint = face.normalPoint ?? p
  return {
    nMain: faceNormalAt(face.main, pgs.find((x) => x.partId === weld.mainPartId), normalPoint, up),
    nSub: faceNormalAt(face.sub, pgs.find((x) => x.partId === weld.subPartId), normalPoint, up),
  }
}



export interface DemoTarget {
  kind: 'weld' | 'subweld' | 'merge'
  /** Explicit inspection of the extracted source, before trimming and extension. */
  source?: boolean
  weldId?: string
  subIndex?: number
  mergeId?: string
}

/** 把已确认的端点延伸应用到几何副本, 保留原段编号/面属性供法向采样使用。 */
export function weldWithExtensions(weld: Weld, split?: WeldSplit): Weld {
  if (weld.closed || !split || split.weldId !== weld.id
    || (!split.startExtension && !split.endExtension)) return weld
  const first = weld.segments.findIndex((seg) => seg.points.length >= 2)
  let last = weld.segments.length - 1
  while (last >= 0 && weld.segments[last].points.length < 2) last--
  if (first < 0 || last < 0) return weld
  // SubWeld 坐标已经量化到显示/演示使用的精度; 端点预检也必须钉在同一坐标。
  const extendedStart = split.startExtension
    ? split.subWelds.find((sub) => sub.起点来源.类型 === '原焊缝起点')?.start
      ?? split.startExtension.延伸到
    : undefined
  const extendedEnd = split.endExtension
    ? split.subWelds.find((sub) => sub.终点来源.类型 === '原焊缝终点')?.end
      ?? split.endExtension.延伸到
    : undefined
  let addedLength = 0
  const segments = weld.segments.map((seg, i) => {
    const start = i === first ? extendedStart : undefined
    const end = i === last ? extendedEnd : undefined
    if (!start && !end) return seg
    const points = [...seg.points]
    let extra = 0
    if (start) {
      extra += new THREE.Vector3(...(start as [number, number, number]))
        .distanceTo(new THREE.Vector3(...(points[0] as [number, number, number])))
      points.unshift(start)
    }
    if (end) {
      extra += new THREE.Vector3(...(end as [number, number, number]))
        .distanceTo(new THREE.Vector3(...(points[points.length - 1] as [number, number, number])))
      points.push(end)
    }
    addedLength += extra
    return { ...seg, start: start ?? seg.start, end: end ?? seg.end, points, length: seg.length + extra }
  })
  return {
    ...weld, segments, length: weld.length + addedLength,
    start: extendedStart ?? weld.start,
    end: extendedEnd ?? weld.end,
    properties: { ...weld.properties,
      ...(split.startFeature ? { 起点特征: split.startFeature } : {}),
      ...(split.endFeature ? { 终点特征: split.endFeature } : {}) },
  }
}

/** A permitted member gap has no source face of its own. Carry the real adjacent
 * face frames across it; querying the whole plate in the gap can pick its back. */
function bindMemberConnectionNormals(
  path: DemoPath, pieces: PathPiece[], partsData: PartsData, mesh: Float32Array,
): void {
  let distance = 0
  let previous: PathPiece | undefined
  const unitBetween = (a: THREE.Vector3, b: THREE.Vector3, t: number, travel: THREE.Vector3) => {
    const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1)
    const axis = new THREE.Vector3().crossVectors(a, b)
    if (axis.lengthSq() < 1e-20) {
      if (dot >= 0) return a.clone()
      // Antipodal end frames need a definite rotation plane, rather than a zero lerp.
      axis.crossVectors(a, travel)
      if (axis.lengthSq() < 1e-20) axis.crossVectors(a, Math.abs(a.x) < .9
        ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
    }
    return a.clone().applyAxisAngle(axis.normalize(), Math.acos(dot) * t).normalize()
  }
  for (const piece of pieces) {
    if (piece.points.length === 0) continue
    if (previous) {
      const from = previous.points[previous.points.length - 1] as [number, number, number]
      const to = piece.points[0] as [number, number, number]
      const travel = new THREE.Vector3(...to).sub(new THREE.Vector3(...from))
      const gap = travel.length()
      if (gap > 1e-9) {
        const start = distance, end = start + gap
        travel.divideScalar(gap)
        const incoming = weldNormalsAt(previous.weld, partsData, mesh, from)
        const outgoing = weldNormalsAt(piece.weld, partsData, mesh, to)
        // Sampling has already resolved mesh winding against the natural member
        // sequence. Preserve those signs when querying the source end frames.
        // The gap's own end key still carries the previous piece, so use the
        // nearest key strictly inside the outgoing member as its sign reference.
        const incomingReference = sampleAt(path, start)
        const pieceEnd = end + polyLen(piece.points)
        const outgoingReference = path.samples.find((sample) => sample.s > end + 1e-9
          && sample.s <= pieceEnd + 1e-9)
        for (const key of ['nMain', 'nSub'] as const) {
          if (incoming[key].dot(incomingReference[key]) < 0) incoming[key].negate()
          if (outgoingReference && outgoing[key].dot(outgoingReference[key]) < 0) outgoing[key].negate()
        }
        const angle = Math.max(incoming.nMain.angleTo(outgoing.nMain), incoming.nSub.angleTo(outgoing.nSub))
        // Keep neighbouring frame keys below 60 degrees, including antipodal
        // frames on a sub-grid gap. These keys lie on the same straight TCP edge.
        const steps = Math.max(1, Math.ceil(angle / (Math.PI / 3)))
        for (let i = 1; i < steps; i++) {
          const s = start + gap * i / steps
          if (path.samples.some((sample) => Math.abs(sample.s - s) < 1e-9)) continue
          const sample = sampleAt(path, s)
          const index = path.samples.findIndex((at) => at.s > s)
          path.samples.splice(index < 0 ? path.samples.length : index, 0, sample)
        }
        for (const sample of path.samples) {
          if (sample.s < start - 1e-9 || sample.s > end + 1e-9) continue
          const t = THREE.MathUtils.clamp((sample.s - start) / gap, 0, 1)
          sample.nMain.copy(unitBetween(incoming.nMain, outgoing.nMain, t, travel))
          sample.nSub.copy(unitBetween(incoming.nSub, outgoing.nSub, t, travel))
        }
        distance = end
      }
    }
    distance += polyLen(piece.points)
    previous = piece
  }
}

/** Rotate the physical face frame continuously around an explicit outside cap.
 * Opposing side normals must go through the exposed end, not through the plate. */
function manualBridgeNormalSampler(
  points: number[][],
  from: { nMain: THREE.Vector3; nSub: THREE.Vector3 },
  to: { nMain: THREE.Vector3; nSub: THREE.Vector3 },
): NonNullable<PathPiece['normalAt']> {
  const vertices = points.map((p) => new THREE.Vector3().fromArray(p))
  const cum = [0]
  for (let i = 1; i < vertices.length; i++) cum.push(cum[i - 1] + vertices[i].distanceTo(vertices[i - 1]))
  const center = vertices[0].clone().add(vertices.at(-1)!).multiplyScalar(.5)
  const outward = vertices[Math.floor(vertices.length / 2)].clone().sub(center).normalize()
  const rotate = (a: THREE.Vector3, b: THREE.Vector3, t: number) => {
    const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1)
    if (dot > 1 - 1e-10) return a.clone()
    const axis = a.clone().cross(b)
    if (axis.lengthSq() < 1e-10) axis.crossVectors(a, outward)
    if (axis.lengthSq() < 1e-10) axis.crossVectors(a, Math.abs(a.x) < .9
      ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
    return a.clone().applyAxisAngle(axis.normalize(), Math.acos(dot) * t).normalize()
  }
  return (point) => {
    let best = Infinity, distance = 0
    for (let i = 1; i < vertices.length; i++) {
      const edge = vertices[i].clone().sub(vertices[i - 1]), lengthSq = edge.lengthSq()
      const t = lengthSq > 1e-20 ? THREE.MathUtils.clamp(point.clone().sub(vertices[i - 1]).dot(edge) / lengthSq, 0, 1) : 0
      const error = vertices[i - 1].clone().addScaledVector(edge, t).distanceToSquared(point)
      if (error < best) { best = error; distance = cum[i - 1] + Math.sqrt(lengthSq) * t }
    }
    const t = cum.at(-1)! > 1e-9 ? distance / cum.at(-1)! : 0
    return { nMain: rotate(from.nMain, to.nMain, t), nSub: rotate(from.nSub, to.nSub, t) }
  }
}

export function buildDemoPath(
  target: DemoTarget,
  weldsData: WeldsData,
  partsData: PartsData,
  mesh: Float32Array,
  splits: Map<string, WeldSplit> | null,
  merges: MergeResult | null,
  /** 工艺路径库转角注入 (匹配合并组转角方案时由调用方给出) */
  injections?: CornerInjection[],
): DemoPath | null {
  const pieces: PathPiece[] = []
  let closed = false
  let desc = ''
  if (target.kind === 'weld' && target.weldId) {
    const w = weldsData.welds.find((x) => x.id === target.weldId)
    if (!w) return null
    // 处理后整焊缝也必须使用延伸后的外端；多子段不能退回源端点。
    // 唯一子段采用其量化坐标，与子段演示一致；原始查看始终使用源几何。
    const split = target.source ? undefined : splits?.get(w.id)
    const onlySub = split?.subWelds.length === 1 ? split.subWelds[0] : null
    const extended = !!(split?.startExtension || split?.endExtension)
    const effectiveWeld = extended ? weldWithExtensions(w, split) : w
    pieces.push({
      points: extended && onlySub ? onlySub.points : concatPolyline(effectiveWeld),
      weld: effectiveWeld,
    })
    closed = extended && onlySub ? onlySub.closed : w.closed
    desc = w.id
  } else if (target.kind === 'subweld' && target.weldId !== undefined && target.subIndex !== undefined) {
    const w = weldsData.welds.find((x) => x.id === target.weldId)
    const sub = splits?.get(target.weldId)?.subWelds[target.subIndex]
    if (!w || !sub) return null
    pieces.push({ points: sub.points, weld: weldWithExtensions(w, splits?.get(w.id)) })
    closed = sub.closed
    desc = sub.id
  } else if (target.kind === 'merge' && target.mergeId && merges) {
    const g = merges.groups.find((x) => x.id === target.mergeId)
    if (!g) return null
    // computeMerges already aligns each member's geometry and endpoint features.
    // Preserve that direction; a second nearest-end guess can reverse a short arc.
    const memberPieceIdx: number[] = []
    const fullManual = 'manualFullWrap' in g && g.manualFullWrap === true
    for (const [memberIndex, m] of g.members.entries()) {
      const w = weldsData.welds.find((x) => x.id === m.weldId)
      if (!w || m.points.length < 2) { memberPieceIdx.push(-1); continue }
      memberPieceIdx.push(pieces.length)
      const effectiveWeld = weldWithExtensions(w, splits?.get(w.id))
      const sourceRef = (m as typeof m & { manualSourceRef?: { end: number[] } }).manualSourceRef
      const following = g.members[memberIndex + 1]
      const nextWeld = following && weldsData.welds.find((x) => x.id === following.weldId)
      const bridgeStart = fullManual && sourceRef && nextWeld
        ? m.points.findIndex((p) => Math.hypot(...p.map((value, i) => value - sourceRef.end[i])) < 1e-5) : -1
      if (bridgeStart >= 1 && bridgeStart < m.points.length - 1 && nextWeld) {
        const bridge = m.points.slice(bridgeStart)
        const incoming = weldNormalsAt(effectiveWeld, partsData, mesh, bridge[0] as [number, number, number])
        const outgoingSource = weldNormalsAt(nextWeld, partsData, mesh, bridge.at(-1)! as [number, number, number])
        // The CAD main/sub ordering can differ between the two sides.
        const outgoing = nextWeld.mainPartId === effectiveWeld.subPartId
          && nextWeld.subPartId === effectiveWeld.mainPartId
          ? { nMain: outgoingSource.nSub, nSub: outgoingSource.nMain } : outgoingSource
        pieces.push({ points: m.points.slice(0, bridgeStart + 1), weld: effectiveWeld, preserveNormals: true })
        pieces.push({ points: bridge, weld: effectiveWeld, preserveNormals: true,
          normalAt: manualBridgeNormalSampler(bridge, incoming, outgoing) })
      } else pieces.push({ points: m.points, weld: effectiveWeld, preserveNormals: fullManual })
    }
    // 工艺路径库: 转角三点注入 (入角点→转角点(对角线偏移c)→出角点)
    if (injections && injections.length > 0) {
      applyCornerInjections(pieces, memberPieceIdx, injections)
    }
    closed = g.closed
    desc = g.id
  }
  if (pieces.length === 0) return null
  // 闭合圆: 去掉首尾重复点, 采样时走整圈
  if (closed) {
    const pts = pieces[0].points
    if (pts.length >= 2) {
      const h = pts[0]; const t = pts[pts.length - 1]
      if (Math.hypot(h[0] - t[0], h[1] - t[1], h[2] - t[2]) < 1e-6) {
        pieces[0] = { ...pieces[0], points: pts.slice(0, -1) }
      }
    }
    // 闭合: 补一条回起点的边 —— 通过在最后追加起点坐标实现
    const p0 = pieces[0].points[0]
    const lastPiece = pieces[pieces.length - 1]
    lastPiece.points = [...lastPiece.points, p0]
  }
  const path = samplePieces(pieces, partsData, mesh, closed)
  if (path) {
    if (target.kind === 'merge') bindMemberConnectionNormals(path, pieces, partsData, mesh)
    path.targetDesc = desc
  }
  return path
}

// ---------------------------------------------------------------- 标准姿态

export interface TorchPose {
  /** 机头组位置 (数据坐标) */
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  /** 调试: 角平分线方向 / 焊丝尖端落点 / 喷嘴轴向(世界) */
  bisector: THREE.Vector3
  wireTipWorld: THREE.Vector3
  axisWorld: THREE.Vector3
  /** 机头局部 Y (弯曲面法向) 的世界方向 */
  yWorld: THREE.Vector3
  /** 机身主轴的世界方向 (应尽量朝 +Z) */
  bodyWorld: THREE.Vector3
  /** 本样本 roll 规则: up=枪颈竖直优先, tangent=退化回退(弯曲面⊥切线) */
  rollMode: 'up' | 'tangent'
}

export interface PoseOpts {
  /** 上一点姿态 (连续性参考): roll/横向出现 >90° 跳变时取连续分支 */
  prev?: TorchPose | null
  /** 旧版 roll 规则 (弯曲面⊥切线, 无竖直优先), 用于修复前后对照 */
  legacyRoll?: boolean
}

/**
 * 标准姿态: 喷嘴轴在主板面/副板面法向的角平分线上 (指向焊缝, 枪身留角外侧),
 * 焊丝尖端落在焊缝点。
 * roll (绕喷嘴轴): 默认"枪颈竖直" —— 机身主轴在 ⊥喷嘴轴平面内的投影对齐
 * 世界 +Z 在该平面的投影 (机身尽量竖直); 喷嘴轴近竖直 (+Z 投影≈0) 时退化回
 * 旧规则: 枪颈弯曲面 ⊥ 焊缝切线。
 * prev 存在时比较 roll 分支: 跳变 >90° 时仅采用确实更接近前姿态的翻转候选。
 */
export function computeTorchPose(
  sample: PathSample, analysis: NozzleAnalysis, opts?: PoseOpts,
): TorchPose {
  // 角平分线 (两法向和外插, 指向角外侧空旷区); 退化 (反向/同向) 时兜底
  let bis = sample.nMain.clone().add(sample.nSub)
  if (bis.lengthSq() < 0.04) bis = sample.nMain.clone()
  bis.normalize()

  // 机头局部正交基 (STL 空间): b3=喷嘴轴
  const b3 = analysis.axis
  // 目标 z': 喷嘴轴 (枪颈→尖端, 即焊接方向) 指向焊缝 = 角平分线反向
  const zp = bis.clone().negate()

  // ---- roll: 决定目标 y' 与局部基 (b1,b2)
  let yp: THREE.Vector3
  let b1: THREE.Vector3
  let b2: THREE.Vector3
  let rollMode: 'up' | 'tangent' = 'tangent'
  const zup = new THREE.Vector3(0, 0, 1)
  const upProj = zup.clone().addScaledVector(zp, -zup.dot(zp))
  const ba = analysis.bodyAxis
  const baProj = ba ? ba.clone().addScaledVector(b3, -ba.dot(b3)) : null
  if (!opts?.legacyRoll && baProj && upProj.lengthSq() > 1e-4 && baProj.lengthSq() > 1e-4) {
    // 枪颈竖直优先: y' = +Z 在 ⊥zp 平面的投影; 局部取机身主轴投影为 b2
    yp = upProj.normalize()
    b2 = baProj.normalize()
    b1 = new THREE.Vector3().crossVectors(b2, b3) // x = y×z → 右手系
    rollMode = 'up'
  } else {
    // 退化/旧规则: y' = 切线垂直于 z' 的分量 (弯曲面⊥切线)
    b1 = new THREE.Vector3(1, 0, 0).addScaledVector(b3, -b3.x).normalize()
    b2 = new THREE.Vector3().crossVectors(b3, b1)
    yp = sample.tangent.clone().addScaledVector(zp, -sample.tangent.dot(zp))
    if (yp.lengthSq() < 1e-6) {
      // 切线与角平分线平行 (退化): 取任一垂直方向
      yp = Math.abs(zp.z) < 0.9
        ? new THREE.Vector3(0, 0, 1).cross(zp) : new THREE.Vector3(1, 0, 0).cross(zp)
    }
    yp.normalize()
  }
  let xp = new THREE.Vector3().crossVectors(yp, zp)

  const build = (): { q: THREE.Quaternion; m: THREE.Matrix4 } => {
    const mTarget = new THREE.Matrix4().makeBasis(xp, yp, zp)
    const mLocal = new THREE.Matrix4().makeBasis(b1, b2, b3)
    const m = mTarget.multiply(mLocal.invert())
    return { q: new THREE.Quaternion().setFromRotationMatrix(m), m }
  }
  let { q: quaternion } = build()

  // ---- 连续性: 超过 90° 时比较两个 roll 候选，不因真实转角或浮点误差盲目翻枪。
  if (opts?.prev) {
    const d = Math.abs(quaternion.dot(opts.prev.quaternion))
    const ang = 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI
    if (ang > 90) {
      xp = xp.negate()
      yp = yp.negate()
      const alternative = build().q
      if (Math.abs(alternative.dot(opts.prev.quaternion)) > d + 1e-10) {
        quaternion = alternative
      } else {
        xp.negate()
        yp.negate()
      }
    }
    // 四元数符号统一 (q 与 -q 同旋转; 保证相邻点积 >0 便于插值/断言)
    if (quaternion.dot(opts.prev.quaternion) < 0) {
      quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w)
    }
  }

  // 焊丝尖端 (局部) 落在焊缝点: pos = p - R·wireTip
  const wireTipWorld = analysis.wireTip.clone().applyQuaternion(quaternion)
  const position = sample.pos.clone().sub(wireTipWorld)
  return {
    position, quaternion, bisector: bis.clone(),
    wireTipWorld: sample.pos.clone(),
    axisWorld: analysis.axis.clone().applyQuaternion(quaternion),
    yWorld: b2.clone().applyQuaternion(quaternion),
    bodyWorld: (ba ?? b2).clone().applyQuaternion(quaternion),
    rollMode,
  }
}

/** 沿路径逐样本预计算姿态 (带连续性), 结果挂在 path.poses */
export function computePathPoses(path: DemoPath, analysis: NozzleAnalysis): void {
  let prev: TorchPose | null = null
  path.poses = path.samples.map((sm) => {
    const p = computeTorchPose(sm, analysis, { prev })
    prev = p
    return p
  })
}

/** 取弧长 s 处姿态: 优先精确姿态曲线，否则预计算序列 slerp 或单点解算。
 *  位置不插值 —— 一律由最终四元数回解 (position = 路径点 − q·wireTip),
 *  保证任意消费方拿到的姿态都绕焊丝尖端枢转、枪尖精确钉在路径点上;
 *  (lerp 两个分别回解的端点位置, 在中间弧长处枪尖会偏离路径点) */
export function pathPoseAt(path: DemoPath, s: number, analysis: NozzleAnalysis): TorchPose {
  if (path.poseResolver) return path.poseResolver(Math.max(0, Math.min(path.total, s)), analysis)
  const sample = sampleAt(path, s)
  const curve = path.poseCurves?.find((candidate) => sample.s >= candidate.start && sample.s <= candidate.end)
  const curveQuaternion = curve ? poseCurveQuaternionAt(curve, sample.s) : null
  if (!path.poses || path.poses.length === 0) {
    const pose = computeTorchPose(sample, analysis)
    if (curveQuaternion) {
      const delta = curveQuaternion.clone().multiply(pose.quaternion.clone().invert())
      pose.quaternion.copy(curveQuaternion)
      pose.position.copy(sample.pos).sub(analysis.wireTip.clone().applyQuaternion(curveQuaternion))
      pose.axisWorld.copy(analysis.axis).applyQuaternion(curveQuaternion)
      pose.yWorld.applyQuaternion(delta)
      pose.bodyWorld.applyQuaternion(delta)
    }
    return pose
  }
  const arr = path.samples
  let lo = 0; let hi = arr.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].s <= sample.s) lo = mid; else hi = mid
  }
  const i0 = lo
  const i1 = Math.min(lo + 1, arr.length - 1)
  const span = arr[i1].s - arr[i0].s
  const t = span > 1e-9 ? (sample.s - arr[i0].s) / span : 0
  const a = path.poses[i0]; const b = path.poses[i1]
  const quaternion = curveQuaternion ?? a.quaternion.clone().slerp(b.quaternion, t)
  const curveDelta = curveQuaternion ? quaternion.clone().multiply(a.quaternion.clone().invert()) : null
  const position = sample.pos.clone()
    .sub(analysis.wireTip.clone().applyQuaternion(quaternion))
  return {
    position, quaternion,
    bisector: a.bisector.clone().lerp(b.bisector, t).normalize(),
    wireTipWorld: sample.pos.clone(),
    axisWorld: analysis.axis.clone().applyQuaternion(quaternion),
    yWorld: curveDelta ? a.yWorld.clone().applyQuaternion(curveDelta) : a.yWorld.clone().lerp(b.yWorld, t).normalize(),
    bodyWorld: analysis.bodyAxis
      ? analysis.bodyAxis.clone().applyQuaternion(quaternion)
      : curveDelta ? a.bodyWorld.clone().applyQuaternion(curveDelta) : a.bodyWorld.clone().lerp(b.bodyWorld, t).normalize(),
    rollMode: t < 0.5 ? a.rollMode : b.rollMode,
  }
}

// ---------------------------------------------------------------- 焊缝坐标系与标准角


/**
 * 焊缝坐标系 (每个路径点自己的正交架):
 *   T = 切向 (行进方向)
 *   B = 角平分线反向 (指向坡口内, 即名义焊丝轴线方向, = 默认姿态的喷嘴轴指向)
 *   N = T×B (横向, 位于截面内)
 *
 * 本架用于几何分析；工艺控制使用下方 weldTcpFrame 的切向/水平横向架。
 * 注意本架字母不取 Frenet 习惯 (T-N-B: N=主法向/B=副法向) —— 本架 B 是枪轴、
 * N 是横向, 与 Frenet 字母相反; 一切以本注释的物理语义为准。
 */
export interface WeldFrame {
  T: THREE.Vector3
  B: THREE.Vector3
  N: THREE.Vector3
}

/** 从路径样本构造焊缝坐标系 (B 相对 T 正交化; 退化时取任一垂直兜底) */
export function weldFrameOf(sample: PathSample): WeldFrame {
  const T = sample.tangent.clone()
  if (T.lengthSq() < 1e-12) T.set(1, 0, 0)
  T.normalize()
  let bis = sample.nMain.clone().add(sample.nSub)
  if (bis.lengthSq() < 0.04) bis = sample.nMain.clone()
  if (bis.lengthSq() < 1e-12) bis.set(0, 0, 1)
  // B = 角平分线反向 (指向坡口内), 并对 T 正交化
  const B = bis.normalize().negate()
  B.addScaledVector(T, -B.dot(T))
  if (B.lengthSq() < 1e-6) {
    // 角平分线 ∥ 切向 (退化): 取任一 ⊥T 方向
    B.set(0, 0, 1)
    if (Math.abs(T.z) > 0.9) B.set(0, 1, 0)
    B.addScaledVector(T, -B.dot(T))
  }
  B.normalize()
  const N = new THREE.Vector3().crossVectors(T, B)
  return { T, B, N }
}

/** 工艺角与机器人基座 rx/ry/rz 是独立参数，所有旋转均以实际焊丝 TCP 为枢轴。 */
export interface WeldStdAngles {
  工作角: number
  前进角: number
  旋转角: number
  /** 转角方案专用：焊缝固定坐标架中的 TCP 姿态增量，度。 */
  tcpRotation?: { rx: number; ry: number; rz: number }
}

export const DEFAULT_STD_ANGLES: WeldStdAngles = { 工作角: 45, 前进角: 0, 旋转角: 0 }

export function cloneStdAngles(a: WeldStdAngles): WeldStdAngles {
  return { ...a, ...(a.tcpRotation ? { tcpRotation: { ...a.tcpRotation } } : {}) }
}

/** 明确传入路径切向，禁止从机头四元数猜测焊缝方向。 */
export interface TorchPoseContext {
  tangent: THREE.Vector3
  nMain?: THREE.Vector3
  nSub?: THREE.Vector3
  /** 与机头数据同一坐标系的最长枪颈圆柱轴线，指向法兰。 */
  bodyAxis?: THREE.Vector3
  weldingPosition?: string
}

export function torchPoseContext<T extends Pick<PathSample, 'tangent' | 'nMain' | 'nSub'> & { weldingPosition?: string }>(sample: T,
  analysis: Pick<NozzleAnalysis, 'bodyAxis'>): TorchPoseContext {
  return { tangent: sample.tangent, nMain: sample.nMain, nSub: sample.nSub, bodyAxis: analysis.bodyAxis,
    weldingPosition: sample.weldingPosition }
}

/** Raffles 最长直枪颈的实测轴，转换至目前机头数据坐标。 */
export const DEFAULT_TORCH_BODY_AXIS = new THREE.Vector3(...RAFFLES_SOURCE_CALIBRATION.bodyAxis)
  .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(...RAFFLES_SOURCE_CALIBRATION.axis).normalize(), DOC_D_S)).normalize()

/** X=焊缝切向，Y=垂直焊缝的水平轴，Z=X×Y。竖直焊缝以主板水平法向确定 Y。 */
export function weldTcpFrame(context: TorchPoseContext): {
  x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3; quaternion: THREE.Quaternion
} {
  const x = context.tangent.clone()
  if (!x.toArray().every(Number.isFinite) || x.lengthSq() < 1e-12) throw new Error('焊缝姿态需要有效的行进方向')
  x.normalize()
  const y = new THREE.Vector3(0, 0, 1).cross(x)
  if (y.lengthSq() < 1e-10) {
    y.copy(context.nMain ?? context.nSub ?? new THREE.Vector3(1, 0, 0))
    y.z = 0
    if (y.lengthSq() < 1e-10 && context.nSub) { y.copy(context.nSub); y.z = 0 }
    if (y.lengthSq() < 1e-10) y.set(1, 0, 0)
    y.addScaledVector(x, -y.dot(x))
  }
  y.normalize()
  const z = new THREE.Vector3().crossVectors(x, y).normalize()
  return { x, y, z, quaternion: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) }
}

function requiredPoseContext(context?: TorchPoseContext): TorchPoseContext {
  if (!context) throw new Error('工艺姿态需要当前焊缝切向及枪颈轴上下文')
  return context
}

/** 仅做数据封装，基座角置零；旧版三角映射不再成立。 */
export function stdAnglesToPanel(a: WeldStdAngles): TorchAngleOffset {
  return { rx: 0, ry: 0, rz: 0, process: cloneStdAngles(a) }
}

export function stdAnglesFromPanel(p: TorchAngleOffset): WeldStdAngles {
  return cloneStdAngles(p.process ?? DEFAULT_STD_ANGLES)
}

/**
 * 工艺角：工作角绕切向，旋转角绕水平横向；最后前进角绕变换后的最长枪颈轴。
 * 前进角改变喷嘴朝向，但严格保持长枪颈与焊道夹角。45/0/0 为几何名义姿态。
 * 转角方案可再叠加焊缝固定坐标架中的 TCP rx/ry/rz。
 */
export function stdAnglesQuat(a: WeldStdAngles, base: THREE.Quaternion, context?: TorchPoseContext): THREE.Quaternion {
  if (isDefaultStdAngles(a)) return new THREE.Quaternion()
  const ctx = requiredPoseContext(context)
  const frame = weldTcpFrame(ctx)
  const work = new THREE.Quaternion().setFromAxisAngle(frame.x, (a.工作角 - 45) * DEG)
  const rotation = new THREE.Quaternion().setFromAxisAngle(frame.y, a.旋转角 * DEG)
  const process = rotation.multiply(work)
  const body = (ctx.bodyAxis ?? DEFAULT_TORCH_BODY_AXIS).clone().normalize().applyQuaternion(base).applyQuaternion(process)
  process.premultiply(new THREE.Quaternion().setFromAxisAngle(body, a.前进角 * DEG))
  if (a.tcpRotation) {
    const tcp = frame.quaternion.clone().multiply(torchPanelQuat(a.tcpRotation)).multiply(frame.quaternion.clone().invert())
    process.premultiply(tcp)
  }
  return process.normalize()
}

/** 标准角线性插值 (转角三点过渡) */
export function lerpStdAngles(a: WeldStdAngles, b: WeldStdAngles, t: number): WeldStdAngles {
  return {
    工作角: a.工作角 + (b.工作角 - a.工作角) * t,
    前进角: a.前进角 + (b.前进角 - a.前进角) * t,
    旋转角: a.旋转角 + (b.旋转角 - a.旋转角) * t,
    ...(a.tcpRotation || b.tcpRotation ? { tcpRotation: {
      rx: (a.tcpRotation?.rx ?? 0) + ((b.tcpRotation?.rx ?? 0) - (a.tcpRotation?.rx ?? 0)) * t,
      ry: (a.tcpRotation?.ry ?? 0) + ((b.tcpRotation?.ry ?? 0) - (a.tcpRotation?.ry ?? 0)) * t,
      rz: (a.tcpRotation?.rz ?? 0) + ((b.tcpRotation?.rz ?? 0) - (a.tcpRotation?.rz ?? 0)) * t,
    } } : {}),
  }
}

/** 绝对工艺角为名义值时无需附加旋转。 */
export function isDefaultStdAngles(a: WeldStdAngles): boolean {
  return a.工作角 === 45 && a.前进角 === 0 && a.旋转角 === 0
    && (!a.tcpRotation || (a.tcpRotation.rx === 0 && a.tcpRotation.ry === 0 && a.tcpRotation.rz === 0))
}

/**
 * 精确反解。先用枪颈方向解析工作/旋转角，剩余旋转即前进角，并回代验证。
 * 工艺三轴非正交，部分姿态无法单凭三工艺角表示；此时保留最近可表达的
 * 工艺角及明确的焊缝架 TCP 残差，整体精确回代。多支按参考角保持连续。
 */
export function stdAnglesFromQuat(actual: THREE.Quaternion, base: THREE.Quaternion,
  context?: TorchPoseContext, preferred?: WeldStdAngles): WeldStdAngles {
  const delta = actual.clone().multiply(base.clone().invert()).normalize()
  if (!preferred && delta.angleTo(new THREE.Quaternion()) < 1e-8) return { ...DEFAULT_STD_ANGLES }
  // A user-authored equivalent representation is authoritative. In particular,
  // do not turn 181 degrees into -179 or silently switch a valid Euler branch.
  if (preferred && stdAnglesQuat(preferred, base, context).multiply(base).angleTo(actual) < 1e-7) return cloneStdAngles(preferred)
  const ctx = requiredPoseContext(context)
  const frame = weldTcpFrame(ctx), inverseFrame = frame.quaternion.clone().invert()
  const body = (ctx.bodyAxis ?? DEFAULT_TORCH_BODY_AXIS).clone().normalize()
  const before = body.clone().applyQuaternion(base).applyQuaternion(inverseFrame)
  const after = body.clone().applyQuaternion(actual).applyQuaternion(inverseFrame)
  const radius = Math.hypot(before.y, before.z)
  const candidates: { angles: WeldStdAngles; error: number; quaternion: THREE.Quaternion }[] = []
  const wrap = (radians: number) => Math.atan2(Math.sin(radians), Math.cos(radians))
  const near = (degrees: number, reference: number) => degrees + 360 * Math.round((reference - degrees) / 360)
  const hint = preferred ?? DEFAULT_STD_ANGLES
  const distance = (a: WeldStdAngles) => preferred
    ? (a.工作角-hint.工作角)**2+(a.前进角-hint.前进角)**2+(a.旋转角-hint.旋转角)**2
    : Math.abs(a.工作角-45)+Math.abs(a.前进角)+Math.abs(a.旋转角)
  // Clamping produces the nearest reachable neck direction if the selected
  // absolute TCP lies outside this non-orthogonal three-angle chart. A residual
  // is retained below; we never present this nearest orientation as the target.
  const phase = Math.atan2(before.z, before.y)
  const angle = radius > 1e-9 ? Math.acos(THREE.MathUtils.clamp(after.y / radius, -1, 1)) : 0
  const works = radius > 1e-9 ? [-angle-phase, angle-phase] : [(hint.工作角-45)*DEG]
  for (const rawWork of works) {
    const w=wrap(rawWork)
    const z=before.y*Math.sin(w)+before.z*Math.cos(w)
    const r = Math.hypot(after.x,after.z)>1e-9 && Math.hypot(before.x,z)>1e-9
      ? wrap(Math.atan2(z,before.x)-Math.atan2(after.z,after.x)) : hint.旋转角*DEG
    const noAdvance = new THREE.Quaternion().setFromAxisAngle(frame.y,r)
      .multiply(new THREE.Quaternion().setFromAxisAngle(frame.x,w)).multiply(base)
    const remaining=noAdvance.clone().invert().multiply(actual).normalize()
    const twistDot=remaining.x*body.x+remaining.y*body.y+remaining.z*body.z
    const advance=Math.hypot(twistDot,remaining.w)>1e-12?wrap(2*Math.atan2(twistDot,remaining.w)):hint.前进角*DEG
    const angles:WeldStdAngles={工作角:near(45+w/DEG,hint.工作角),前进角:near(advance/DEG,hint.前进角),旋转角:near(r/DEG,hint.旋转角)}
    const quaternion=stdAnglesQuat(angles,base,ctx).multiply(base)
    candidates.push({angles,error:quaternion.angleTo(actual),quaternion})
  }
  const exact=candidates.filter(candidate=>candidate.error<1e-6).sort((a,b)=>distance(a.angles)-distance(b.angles))
  if(exact.length)return exact[0].angles
  // Geometry-generated schemes without an editing reference retain their
  // established representation. Only hinted editing selects a nearby chart.
  if(!preferred){
    const local=inverseFrame.multiply(delta).multiply(frame.quaternion).normalize()
    return {...DEFAULT_STD_ANGLES,tcpRotation:panelAnglesFromQuat(local)}
  }
  candidates.sort((a,b)=>Math.abs(a.error-b.error)>1e-7?a.error-b.error:distance(a.angles)-distance(b.angles))
  const nearest=candidates[0]
  const residual=actual.clone().multiply(nearest.quaternion.clone().invert()).normalize()
  const local=inverseFrame.multiply(residual).multiply(frame.quaternion).normalize()
  return {...nearest.angles,tcpRotation:panelAnglesFromQuat(local,preferred?.tcpRotation)}
}

/**
 * torchPanelQuat 的逆：当前明确坐标架内的旋转 → 固定轴 RzRyRx 欧拉角 (度)。
 * 这是低层分解，不包含基座/焊缝架换基或名义工作角。
 * 万向锁 |ry|≈90° 时 rx 置 0、滚转并入 rz (与 toolFrameEulerZYX 同一约定)。
 */
export function panelAnglesFromQuat(offsetQ: THREE.Quaternion, preferred?: Pick<TorchAngleOffset,'rx'|'ry'|'rz'>): TorchAngleOffset {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(offsetQ.clone().normalize()).elements
  const RAD = 180 / Math.PI
  const ry = Math.atan2(-e[2],Math.hypot(e[0],e[1]))
  const near=(degrees:number,reference:number)=>degrees+360*Math.round((reference-degrees)/360)
  if (Math.hypot(e[0], e[1]) > 1e-9) {
    const ordinary={rx:Math.atan2(e[6],e[10])*RAD,ry:ry*RAD,rz:Math.atan2(e[1],e[0])*RAD}
    if(!preferred)return ordinary
    const branches=[ordinary,{rx:ordinary.rx+180,ry:180-ordinary.ry,rz:ordinary.rz+180}]
      .map(candidate=>({rx:near(candidate.rx,preferred.rx),ry:near(candidate.ry,preferred.ry),rz:near(candidate.rz,preferred.rz)}))
    branches.sort((a,b)=>(a.rx-preferred.rx)**2+(a.ry-preferred.ry)**2+(a.rz-preferred.rz)**2
      -(b.rx-preferred.rx)**2-(b.ry-preferred.ry)**2-(b.rz-preferred.rz)**2)
    return branches[0]
  }
  const rz=Math.atan2(-e[4],e[5])*RAD
  if(!preferred)return {rx:0,ry:ry*RAD,rz}
  // At +90 only rz-rx is observable, at -90 only rz+rx. Keep
  // the closest equivalent pair instead of throwing one edited angle away.
  const sign=ry>=0?1:-1
  const combined=near(rz,preferred.rz-sign*preferred.rx)
  const rx=(preferred.rx+sign*(preferred.rz-combined))/2
  return {rx,ry:near(ry*RAD,preferred.ry),rz:combined+sign*rx}
}

/**
 * 工具系三轴在工件坐标系中的向量: 当前实际四元数 q (含偏移, 与屏幕机头一致)
 * × DOC_R_S_T 的三列。z_T = 枪轴 (与位姿面板「枪轴」行同源), x_T/y_T 为文档
 * 工具系横轴 (位姿面板「绝对姿态」区块用)。
 */
export function toolFrameAxesWorld(q: THREE.Quaternion): {
  xT: THREE.Vector3; yT: THREE.Vector3; zT: THREE.Vector3
} {
  const e = DOC_R_S_T.elements // 列主序: 列 c = e[c*4 .. c*4+2]
  return {
    xT: new THREE.Vector3(e[0], e[1], e[2]).applyQuaternion(q),
    yT: new THREE.Vector3(e[4], e[5], e[6]).applyQuaternion(q),
    zT: new THREE.Vector3(e[8], e[9], e[10]).applyQuaternion(q),
  }
}

/**
 * 当前工具系在工件坐标系下的旋转 R_W_T = q × R_S_T 的等效欧拉角,
 * 约定 ZYX 内旋 (R = Rz(rz)·Ry(ry)·Rx(rx): rz=绕工件 Z 偏航, ry=俯仰, rx=滚转, 度)。
 * 闭式分解: ry = asin(−R[2][0]); 常态 rz = atan2(R[1][0], R[0][0]),
 * rx = atan2(R[2][1], R[2][2]); 万向锁 |ry|≈90° (cos ry≈0) 时 rx 置 0、
 * 滚转并入 rz = atan2(−R[0][1], R[1][1]) (locked=true)。
 */
export function toolFrameEulerZYX(q: THREE.Quaternion): {
  rz: number; ry: number; rx: number; locked: boolean
} {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q).multiply(DOC_R_S_T)
  const e = m.elements // 列主序: R[row][col] = e[col*4+row]
  const RAD = 180 / Math.PI
  const ry = Math.asin(Math.max(-1, Math.min(1, -e[2])))
  if (Math.cos(ry) > 1e-9) {
    return {
      rz: Math.atan2(e[1], e[0]) * RAD, ry: ry * RAD,
      rx: Math.atan2(e[6], e[10]) * RAD, locked: false,
    }
  }
  return { rz: Math.atan2(-e[4], e[5]) * RAD, ry: ry * RAD, rx: 0, locked: true }
}

// ---------------------------------------------------------------- 碰撞检测

export interface CollisionState {
  /** 碰撞的板件 id 列表 */
  neck: string[]
  nozzle: string[]
  /** 焊丝接触 (不计碰撞, 单独报告; 距尖端 2mm 以内的根部接触忽略) */
  wire: string[]
}

/** 完整三角网格相交/面距检测，顶点背面判定只补充完全包含的情况。 */
export class TorchCollision {
  private pgs: PartGeom[]
  private tmpV = new THREE.Vector3()
  private tmpN = new THREE.Vector3()
  private componentGeometries = new WeakMap<Float32Array, THREE.BufferGeometry>()
  private solidTopology = new WeakMap<Float32Array, { closed: boolean; representatives: number[] }>()
  /** 诊断: 最近一次 check 的表面或顶点命中证据 */
  lastHits: { part: string; comp: string; v: number[]; dist: number; backside: boolean }[] = []

  constructor(partsData: PartsData, mesh: Float32Array) {
    this.pgs = partGeoms(partsData, mesh)
  }

  private bvhOf(pg: PartGeom): MeshBVH {
    if (!pg.bvh) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pg.positions, 3))
      // closestPointToPoint.faceIndex 必须保持原始三角序号，才能索引 pg.normals。
      pg.bvh = new MeshBVH(geo, { indirect: true })
    }
    return pg.bvh
  }

  private geometryOf(verts: Float32Array): THREE.BufferGeometry | null {
    if (verts.length < 9 || verts.length % 9 !== 0) return null
    let geometry = this.componentGeometries.get(verts)
    if (!geometry) {
      geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3))
      geometry.computeBoundingBox()
      geometry.boundsTree = new MeshBVH(geometry, { indirect: true })
      this.componentGeometries.set(verts, geometry)
    }
    return geometry
  }

  /** Only watertight triangle components support an inside/outside conclusion. */
  private topologyOf(verts: Float32Array): { closed: boolean; representatives: number[] } {
    const cached = this.solidTopology.get(verts)
    if (cached) return cached
    const vertices = new Map<string, number>(), parents: number[] = [], edges = new Map<string, number>()
    const triangles: { id: number; offset: number }[] = []
    const root = (id: number): number => {
      while (parents[id] !== id) { parents[id] = parents[parents[id]]; id = parents[id] }
      return id
    }
    const vertex = (offset: number): number => {
      // Exact Float32 positions preserve real openings rather than closing gaps
      // by a generous quantization tolerance. Duplicate STL/CAD vertices match.
      const key = `${verts[offset]},${verts[offset + 1]},${verts[offset + 2]}`
      const old = vertices.get(key)
      if (old !== undefined) return old
      const id = parents.length
      vertices.set(key, id); parents.push(id)
      return id
    }
    let valid = verts.length >= 4 * 9 && verts.length % 9 === 0
    for (let offset = 0; offset + 8 < verts.length; offset += 9) {
      const ids = [vertex(offset), vertex(offset + 3), vertex(offset + 6)]
      // Even a degenerate point/line triangle has a connected component that
      // may lie inside a closed workpiece. Retain its representative, while
      // never using the degenerate mesh to establish a closed solid.
      triangles.push({ id: ids[0], offset })
      const abx = verts[offset + 3] - verts[offset], aby = verts[offset + 4] - verts[offset + 1], abz = verts[offset + 5] - verts[offset + 2]
      const acx = verts[offset + 6] - verts[offset], acy = verts[offset + 7] - verts[offset + 1], acz = verts[offset + 8] - verts[offset + 2]
      const degenerate = (aby * acz - abz * acy) === 0 && (abz * acx - abx * acz) === 0 && (abx * acy - aby * acx) === 0
      if (new Set(ids).size !== 3 || degenerate) {
        valid = false
        for (const id of ids) parents[root(id)] = root(ids[0])
        continue
      }
      for (let j = 0; j < 3; j++) {
        const a = ids[j], b = ids[(j + 1) % 3]
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
        parents[root(a)] = root(b)
      }
    }
    const seen = new Set<number>(), representatives: number[] = []
    for (const triangle of triangles) {
      const id = root(triangle.id)
      if (!seen.has(id)) { seen.add(id); representatives.push(triangle.offset) }
    }
    const result = { closed: valid && edges.size > 0 && [...edges.values()].every((count) => count === 2), representatives }
    this.solidTopology.set(verts, result)
    return result
  }

  /** Majority parity with three oblique rays avoids double-counting shared edges. */
  private insideClosedMesh(bvh: MeshBVH, point: THREE.Vector3): boolean {
    let inside = 0
    for (const direction of [new THREE.Vector3(1, 0.371, 0.529), new THREE.Vector3(0.217, 1, 0.613), new THREE.Vector3(0.433, 0.293, 1)]) {
      const distances = bvh.raycast(new THREE.Ray(point, direction.normalize()), THREE.DoubleSide, 1e-7)
        .map((hit) => hit.distance).sort((a, b) => a - b)
      let count = 0, previous = -Infinity
      for (const distance of distances) {
        if (distance - previous > 1e-5) { count++; previous = distance }
      }
      if (count % 2 === 1) inside++
    }
    return inside >= 2
  }

  /** Surface separation is not proof of safety when either solid encloses the other. */
  private containedPoint(
    pg: PartGeom, geometry: THREE.BufferGeometry, verts: Float32Array, matrix: THREE.Matrix4,
  ): THREE.Vector3 | null {
    const point = new THREE.Vector3()
    const component = this.topologyOf(verts), workpiece = this.topologyOf(pg.positions)
    if (workpiece.closed) {
      // One vertex per connected component suffices after the complete surface
      // query has excluded crossings. This also covers open neck STL surfaces.
      for (const offset of component.representatives) {
        point.fromArray(verts, offset).applyMatrix4(matrix)
        if (pg.bbox.containsPoint(point) && this.insideClosedMesh(this.bvhOf(pg), point)) return point.clone()
      }
    }
    if (component.closed) {
      const inverse = matrix.clone().invert()
      for (const offset of workpiece.representatives) {
        point.fromArray(pg.positions, offset).applyMatrix4(inverse)
        if (geometry.boundingBox!.containsPoint(point) && this.insideClosedMesh(geometry.boundsTree as MeshBVH, point)) {
          return point.applyMatrix4(matrix)
        }
      }
    }
    return null
  }

  /** 顶点与板件: 接近 (<tol)，或位于经拓扑验证的闭合工件内。 */
  private vertHitsPart(v: THREE.Vector3, pg: PartGeom, tol: number, comp: string): boolean {
    const bvh = this.bvhOf(pg)
    const target = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 }
    bvh.closestPointToPoint(v, target)
    if (target.distance < tol) {
      if (this.lastHits.length < 8) {
        this.lastHits.push({ part: pg.partId, comp, v: [r2(v.x), r2(v.y), r2(v.z)], dist: r2(target.distance), backside: false })
      }
      return true
    }
    const bs = pg.bbox.containsPoint(v) && this.topologyOf(pg.positions).closed && this.insideClosedMesh(bvh, v)
    if (bs && this.lastHits.length < 8) {
      this.lastHits.push({ part: pg.partId, comp, v: [r2(v.x), r2(v.y), r2(v.z)], dist: r2(target.distance), backside: true })
    }
    return bs
  }

  /** 诊断: 采样顶点到各零件最近距离分布 (minDist<40 的零件才列出) */
  probe(matrix: THREE.Matrix4, verts: Float32Array, stride: number):
    Record<string, { minDist: number; at: number[]; backside: boolean }> {
    const out: Record<string, { minDist: number; at: number[]; backside: boolean }> = {}
    const vv = new THREE.Vector3()
    for (const pg of this.pgs) {
      const bvh = this.bvhOf(pg)
      let min = Infinity
      const at = new THREE.Vector3()
      let backside = false
      for (let i = 0; i < verts.length; i += 3 * stride) {
        vv.set(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(matrix)
        if (pg.bbox.distanceToPoint(vv) > 40) continue
        const target = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 }
        bvh.closestPointToPoint(vv, target)
        if (target.distance < min) {
          min = target.distance
          at.copy(vv)
          const o = target.faceIndex * 9
          const n = this.tmpN.set(
            pg.normals[o] + pg.normals[o + 3] + pg.normals[o + 6],
            pg.normals[o + 1] + pg.normals[o + 4] + pg.normals[o + 7],
            pg.normals[o + 2] + pg.normals[o + 5] + pg.normals[o + 8])
          backside = n.lengthSq() > 1e-6 &&
            vv.clone().sub(target.point).dot(n.normalize()) < 0
        }
      }
      if (min < 40) {
        out[pg.partId] = {
          minDist: Math.round(min * 100) / 100,
          at: [Math.round(at.x), Math.round(at.y), Math.round(at.z)],
          backside,
        }
      }
    }
    return out
  }

  /** 完整机头表面到工件的最小距离 mm。顶点距离会高估面内净空，不能证明扫掠安全。 */
  clearance(matrix: THREE.Matrix4, neckVerts: Float32Array, nozzleVerts: Float32Array): number {
    let min = Infinity
    const scan = (verts: Float32Array) => {
      const geometry = this.geometryOf(verts)
      if (geometry) {
        const box = geometry.boundingBox!.clone().applyMatrix4(matrix)
        // 先求近处板件的精确距离，再用其剪掉远处板件；不按零件编号从远处开始搜索。
        const candidates = this.pgs.map((pg) => ({ pg,
          gap: Math.hypot(...(['x', 'y', 'z'] as const).map((axis) =>
            Math.max(0, pg.bbox.min[axis] - box.max[axis], box.min[axis] - pg.bbox.max[axis]))),
        })).sort((a, b) => a.gap - b.gap)
        for (const { pg, gap } of candidates) {
          if (gap >= min) break
          const closest = this.bvhOf(pg).closestPointToGeometry(geometry, matrix, undefined, undefined, 0, min)
          if (closest) min = Math.min(min, closest.distance)
          if (min > 1e-9 && this.containedPoint(pg, geometry, verts, matrix)) min = 0
          if (min < 1e-9) return
        }
        return
      }
      // 兼容诊断使用的单点集；生产颈/嘴始终提供完整三角形。
      for (let i = 0; i < verts.length; i += 3) {
        const v = this.tmpV.set(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(matrix)
        for (const pg of this.pgs) {
          if (pg.bbox.distanceToPoint(v) > min) continue // 该零件不可能更近
          const bvh = this.bvhOf(pg)
          const target = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 }
          bvh.closestPointToPoint(v, target)
          if (target.distance < min) min = target.distance
        }
      }
    }
    // 喷嘴通常最接近工件，先得到小净空能减少较远枪颈的查询。
    scan(nozzleVerts)
    if (min > 1e-9) scan(neckVerts)
    return min
  }

  check(
    matrix: THREE.Matrix4,
    neckVerts: Float32Array, nozzleVerts: Float32Array,
    wireBase: THREE.Vector3, wireAxis: THREE.Vector3,
  ): CollisionState {
    this.lastHits.length = 0
    const test = (verts: Float32Array, comp: string): string[] => {
      const hits = new Set<string>()
      const geometry = this.geometryOf(verts)
      if (geometry) {
        const box = geometry.boundingBox!.clone().applyMatrix4(matrix).expandByScalar(0.4)
        for (const pg of this.pgs) {
          if (!box.intersectsBox(pg.bbox)) continue
          // 面内交叉即便所有喷嘴顶点都在板外，也必须命中；同时覆盖边/面接近容差。
          const closest = this.bvhOf(pg).closestPointToGeometry(geometry, matrix, undefined, undefined, 0.4, 0.4)
          const contained = (!closest || closest.distance >= 0.4) ? this.containedPoint(pg, geometry, verts, matrix) : null
          if ((!closest || closest.distance >= 0.4) && !contained) continue
          hits.add(pg.partId)
          if (this.lastHits.length < 8) this.lastHits.push({
            part: pg.partId, comp, v: (contained ?? closest!.point).toArray().map(r2),
            dist: contained ? 0 : r2(closest!.distance), backside: contained !== null,
          })
        }
      } else {
        // 诊断点集没有完整三角面，才需要逐顶点查询。生产网格的完整
        // 面距查询已覆盖所有顶点近距，连通分量代表点已覆盖实体包含。
        for (let i = 0; i < verts.length; i += 3) {
          const v = this.tmpV.set(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(matrix)
          for (const pg of this.pgs) {
            if (hits.has(pg.partId)) continue
            if (pg.bbox.distanceToPoint(v) > 1) continue
            if (this.vertHitsPart(v, pg, 0.4, comp)) hits.add(pg.partId)
          }
        }
      }
      return [...hits]
    }
    const neck = test(neckVerts, 'neck')
    const nozzle = test(nozzleVerts, 'nozzle')
    // 焊丝: 杆身 4 点 (距尖端 ≥2mm), 接触仅报告
    const wireHits = new Set<string>()
    for (const f of [0.15, 0.4, 0.65, 0.9]) {
      const v = this.tmpV.copy(wireBase).addScaledVector(wireAxis, WIRE_LEN * f)
      for (const pg of this.pgs) {
        if (pg.bbox.distanceToPoint(v) > 1) continue
        if (this.vertHitsPart(v, pg, 0.3, 'wire')) wireHits.add(pg.partId)
      }
    }
    return { neck, nozzle, wire: [...wireHits] }
  }
}

// ---------------------------------------------------------------- 碰撞扫描 (规范文档第 9 步)

/**
 * 自适应细分碰撞扫描 —— 文档第 9 步:「使用离散检测时, 根据净空、几何尺寸、运动幅度和
 * 旋转幅度自适应细分, 报告分辨率和遗漏风险; 无法证明区间安全时标记未验证, 不能仅凭
 * 有限采样声称绝对无碰撞」。
 *
 * 细分判据 (扫掠当量): 相邻两检测点之间, 机头任意点扫掠位移的上界估计
 *   sweep = |ΔTCP| + R × Δθ   (Δθ = 姿态四元数夹角 rad, R = 机头相对 TCP 最大半径)
 * 由三角不等式, 机头上距 TCP 为 r 的点的位移 ≤ |ΔTCP| + r×Δθ ≤ sweep。
 * sweep ≤ SWEEP_TOL 时达到指定离散分辨率，不等于连续扫掠证明。
 * 所有路径/姿态锚点强制作为分段边界，避免仅比较两端而跨过中间转姿。
 * sweep > SWEEP_TOL → 二分细分复测中点, 递归; 达 MAX_DEPTH 仍超阈 → 标记「未验证区间」。
 */

/** 细分阈值 mm：控制离散扫掠分辨率，不承诺任意薄障碍物绝不遗漏。 */
export const SWEEP_TOL_MM = 0.5
/** 细分深度上限: 基准 1mm 步长二分 8 层 → 最细 1/256 mm ≈ 0.004mm */
export const SWEEP_MAX_DEPTH = 8

/** 机头相对 TCP (wireTip) 的最大半径 mm (颈/嘴采样顶点 + 焊丝根部, 细分当量用) */
export function torchMaxRadius(
  analysis: NozzleAnalysis, neckVerts: Float32Array, nozzleVerts: Float32Array,
): number {
  let r2max = 0
  const w = analysis.wireTip
  const scan = (verts: Float32Array) => {
    for (let i = 0; i < verts.length; i += 3) {
      const dx = verts[i] - w.x; const dy = verts[i + 1] - w.y; const dz = verts[i + 2] - w.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > r2max) r2max = d2
    }
  }
  scan(neckVerts); scan(nozzleVerts)
  return Math.sqrt(r2max)
}

/** 扫描结果 (路径扫描与滚转扫掠共用字段) */
export interface CollisionScanResult {
  /** 基准步长 (路径 mm / 滚转 °) */
  step: number
  sweepTol: number
  maxDepth: number
  /** 机头最大半径 mm */
  R: number
  /** 基准采样点数 (含两端) */
  baseSamples: number
  /** 细分增补采样点数 */
  refinedSamples: number
  /** 实际达到的最大细分深度 */
  maxDepthHit: number
  /** 总碰撞检测次数 */
  totalChecks: number
  /** 碰撞区间 (按 部件×零件 聚合, 邻近合并) */
  intervals: CollInterval[]
  /** 无法证明安全的未验证区间 */
  unverified: { a: number; b: number; reason: string }[]
}

interface ScanNode {
  s: number
  /** TCP (焊丝尖端) 世界坐标 */
  tip: THREE.Vector3
  q: THREE.Quaternion
  /** 命中键列表 'comp|part' (仅 neck/nozzle; wire 接触不算碰撞) */
  hits: string[]
  /** 需要净空证明时才计算完整机头表面到工件的最小距离；已碰撞时为0。 */
  readonly minClr: number
}

/** 碰撞接近容差 mm (与 TorchCollision.check 的 neck/nozzle tol 一致; 净空判据用) */
const HIT_TOL_MM = 0.4

/** 细分扫描核心: 给定取点函数 (s → 位姿+碰撞+净空), 对 [s0, s1] 区间基准等分 + 自适应二分。
 *  区间 [a,b] 判「已验证」的两个充分条件 (满足其一即不再细分):
 *   1. 分辨率充分: 位移上界 u = Δs + R×旋转弧长上界 ≤ sweepTol；
 *      普通slerp段取两端夹角，非线性曲线必须由rotationBound提供导数上界。
 *   2. 净空充分: 两端净空 minClr > u + HIT_TOL —— 途中机头任意点位移 <u, 距工件恒 >HIT_TOL,
 *      既不触发接近容差也不可能越面穿透 (连续运动越面必经零距离, 被位移上界排除)。
 *  两者都不满足 → 二分; 达深度上限 → 未验证区间 (相邻碎区间按 ≤2×基准步长聚合)。 */
function sweepScan(
  nodeAt: (s: number) => ScanNode,
  s0: number, s1: number, step: number,
  sweepTol: number, maxDepth: number, R: number,
  mandatorySamples: number[] = [],
  rotationBound?: (a: ScanNode, b: ScanNode) => number,
  sharedCache?: Map<number, ScanNode>,
): Omit<CollisionScanResult, 'step' | 'sweepTol' | 'maxDepth' | 'R'> {
  const cache = sharedCache ?? new Map<number, ScanNode>()
  let totalChecks = 0
  let refinedSamples = 0
  let maxDepthHit = 0
  const get = (s: number): ScanNode => {
    const key = Math.round(s * 1e6)
    let n = cache.get(key)
    if (!n) { n = nodeAt(s); totalChecks++; cache.set(key, n) }
    return n
  }
  const qAngleRad = (a: THREE.Quaternion, b: THREE.Quaternion) =>
    2 * Math.acos(Math.min(1, Math.abs(a.dot(b))))
  /** 机头任意点在区间内的位移上界: 弧长 (TCP 行程上界) + 最大半径 × 姿态转角 */
  const sweepOf = (a: ScanNode, b: ScanNode) =>
    Math.abs(b.s - a.s) + (R > 0 ? R * (rotationBound?.(a, b) ?? qAngleRad(a.q, b.q)) : 0)
  const verified = (a: ScanNode, b: ScanNode): boolean => {
    const u = sweepOf(a, b)
    if (u <= sweepTol) return true // 分辨率充分
    return a.minClr > u + HIT_TOL_MM && b.minClr > u + HIT_TOL_MM // 净空充分
  }
  const unverifiedRaw: { a: number; b: number; reason: string }[] = []
  const hitsAll: { s: number; key: string }[] = []

  const nBase = Math.max(1, Math.ceil((s1 - s0) / step))
  const refine = (a: ScanNode, b: ScanNode, depth: number): void => {
    if (verified(a, b)) return
    if (depth >= maxDepth) {
      const u = sweepOf(a, b)
      unverifiedRaw.push({
        a: Math.round(a.s * 1000) / 1000, b: Math.round(b.s * 1000) / 1000,
        reason: `细分达上限 ${maxDepth} 层, 位移上界 ${u.toFixed(3)} > 阈值 ${sweepTol} 且净空不足`,
      })
      return
    }
    maxDepthHit = Math.max(maxDepthHit, depth + 1)
    const mid = get((a.s + b.s) / 2)
    refinedSamples++
    if (mid.hits.length > 0) for (const k of mid.hits) hitsAll.push({ s: mid.s, key: k })
    refine(a, mid, depth + 1)
    refine(mid, b, depth + 1)
  }

  const baseDistances = [...new Set([
    s0, ...Array.from({ length: nBase }, (_, i) => Math.min(s0 + (i + 1) * step, s1)),
    ...mandatorySamples.filter((s) => s > s0 && s < s1),
  ])].sort((a, b) => a - b)
  let prev = get(s0)
  if (prev.hits.length > 0) for (const k of prev.hits) hitsAll.push({ s: prev.s, key: k })
  for (let i = 1; i < baseDistances.length; i++) {
    const s = baseDistances[i]
    const cur = get(s)
    if (cur.hits.length > 0) for (const k of cur.hits) hitsAll.push({ s: cur.s, key: k })
    refine(prev, cur, 0)
    prev = cur
  }

  // 命中点 → 按 部件×零件 聚合连续区间 (间隙 ≤2×基准步长 合并, 与演示原区间口径同量级)
  const byKey = new Map<string, number[]>()
  for (const h of hitsAll) {
    const arr = byKey.get(h.key)
    if (arr) arr.push(h.s); else byKey.set(h.key, [h.s])
  }
  const intervals: CollInterval[] = []
  const mergeGap = 2 * step
  for (const [key, ss] of byKey) {
    ss.sort((x, y) => x - y)
    const [comp, part] = key.split('|') as ['neck' | 'nozzle', string]
    let a = ss[0], b = ss[0]
    for (let i = 1; i < ss.length; i++) {
      if (ss[i] <= b + mergeGap + 1e-9) { b = ss[i]; continue }
      intervals.push({ comp, part, a, b })
      a = ss[i]; b = ss[i]
    }
    intervals.push({ comp, part, a, b })
  }
  intervals.sort((x, y) => x.a - y.a)
  // 未验证碎区间聚合 (同一间断点二分产生的相邻叶区间, 间隙 ≤2×基准步长 并为一段)
  const unverified: { a: number; b: number; reason: string }[] = []
  for (const u of unverifiedRaw.sort((x, y) => x.a - y.a)) {
    const last = unverified[unverified.length - 1]
    if (last && u.a <= last.b + mergeGap + 1e-9) last.b = Math.max(last.b, u.b)
    else unverified.push({ ...u })
  }
  return {
    baseSamples: baseDistances.length, refinedSamples, maxDepthHit, totalChecks, intervals, unverified,
  }
}

/** 位姿 → 机头碰撞检测节点 (矩阵合成 + TorchCollision.check, 焊丝接触不计入 hits) */
function collisionNodeOf(
  collision: TorchCollision, analysis: NozzleAnalysis,
  neckVerts: Float32Array, nozzleVerts: Float32Array,
  q: THREE.Quaternion, tip: THREE.Vector3,
): ScanNode {
  const pos = tip.clone().sub(analysis.wireTip.clone().applyQuaternion(q))
  const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1))
  const wireAxis = analysis.tipAxis.clone().applyQuaternion(q).negate() // 尖端→喷嘴根部
  const coll = collision.check(m, neckVerts, nozzleVerts, tip, wireAxis)
  const hits: string[] = []
  for (const p of coll.neck) hits.push(`neck|${p}`)
  for (const p of coll.nozzle) hits.push(`nozzle|${p}`)
  let minClr: number | undefined = hits.length > 0 ? 0 : undefined
  return {
    s: 0, tip: tip.clone(), q: q.clone(), hits,
    get minClr() {
      // Resolution alone already verifies fine sweep leaves. Compute exact
      // clearance only if a larger interval needs the clearance proof, once
      // for each node even when it is shared by neighbouring intervals/chunks.
      return minClr ??= collision.clearance(m, neckVerts, nozzleVerts)
    },
  }
}

export interface PathCollisionScanOptions {
  step?: number
  sweepTol?: number
  maxDepth?: number
  offsetQuat?: TorchOffset
}

export interface PathCollisionScanSession {
  /** Keep the path, tool geometry and offset fixed for this session. */
  scanRange: (range?: [number, number]) => CollisionScanResult
}

/** 连续姿态的旋转上界；精确求值器必须同时给出上界，否则保守未验证。 */
export function pathRotationBound(path: DemoPath, a: number, b: number, analysis: NozzleAnalysis): number {
  if (path.poseResolver) return path.poseRotationBound?.(a, b, analysis) ?? Infinity
  const curve = path.poseCurves?.find((candidate) => a >= candidate.start && b <= candidate.end)
  const angle = pathPoseAt(path, a, analysis).quaternion.angleTo(pathPoseAt(path, b, analysis).quaternion)
  return curve ? Math.max(angle, poseCurveRotationBound(curve, a, b)) : angle
}

/** Prepare one path scan and reuse its endpoint across successive UI chunks. */
export function createPathCollisionScanSession(
  collision: TorchCollision, path: DemoPath, analysis: NozzleAnalysis,
  neckVerts: Float32Array, nozzleVerts: Float32Array,
  options: PathCollisionScanOptions = {},
): PathCollisionScanSession {
  // A session belongs to exactly one path/candidate and offset. The bounded
  // cache never escapes it, so changing a candidate cannot reuse an old pose.
  const opts = { ...options }
  const step = opts.step ?? 1
  const sweepTol = opts.sweepTol ?? SWEEP_TOL_MM
  const maxDepth = opts.maxDepth ?? SWEEP_MAX_DEPTH
  const R = torchMaxRadius(analysis, neckVerts, nozzleVerts)
  const cache = new Map<number, ScanNode>()
  const nodeAt = (s: number): ScanNode => {
    const pose = pathPoseAt(path, Math.min(Math.max(s, 0), path.total), analysis)
    const q = pose.quaternion.clone()
    if (opts.offsetQuat) q.premultiply(resolveTorchOffset(opts.offsetQuat, q,
      torchPoseContext(sampleAt(path, Math.min(Math.max(s, 0), path.total)), analysis)))
    const n = collisionNodeOf(collision, analysis, neckVerts, nozzleVerts, q, pose.wireTipWorld)
    n.s = s
    return n
  }
  const curves = path.poseCurves ?? []
  const mandatorySamples = [...new Set([
    ...path.samples.map((sample) => sample.s),
    ...curves.flatMap((curve) => curve.keys.map((key) => key.s)),
    ...(path.poseSampleDistances ?? []),
  ])].sort((a, b) => a - b)
  const rotationBound = (a: ScanNode, b: ScanNode) => {
    if (path.poseResolver) return opts.offsetQuat ? Infinity : pathRotationBound(path, a.s, b.s, analysis)
    const curve = curves.find((candidate) => a.s >= candidate.start && b.s <= candidate.end)
    const endpointAngle = a.q.angleTo(b.q)
    if (!curve) return endpointAngle
    // An attitude-dependent offset has no derivative bound; preserve the
    // conservative refinement and unresolved-interval report in that case.
    if (opts.offsetQuat) return Infinity
    return Math.max(endpointAngle, poseCurveRotationBound(curve, a.s, b.s))
  }
  return {
    scanRange(range = [0, path.total]) {
      const [s0, s1] = range
      const end = Math.min(s1, path.total)
      const res = sweepScan(nodeAt, s0, end, step, sweepTol, maxDepth, R,
        mandatorySamples, curves.length > 0 || path.poseResolver ? rotationBound : undefined, cache)
      // Only the next chunk's shared endpoint is useful. Retaining it avoids
      // duplicate mesh checks without growing memory along a long weld.
      const endpointKey = Math.round(end * 1e6)
      const endpoint = cache.get(endpointKey)
      cache.clear()
      if (endpoint) cache.set(endpointKey, endpoint)
      return { step, sweepTol, maxDepth, R, ...res }
    },
  }
}

/**
 * 演示路径全路径碰撞预扫描 (提供沿途区间报告，实时显示另按实际位姿检测):
 * 基准 1mm 弧长步长, 相邻点扫掠当量超 SWEEP_TOL 自动二分细分 (上限 SWEEP_MAX_DEPTH 层,
 * 超阈即标记未验证区间)。offsetQuat = 面板姿态偏移 (与屏幕实际位姿一致)。
 */
export function scanPathCollision(
  collision: TorchCollision, path: DemoPath, analysis: NozzleAnalysis,
  neckVerts: Float32Array, nozzleVerts: Float32Array,
  opts?: PathCollisionScanOptions & {
    /** 只扫描弧长区间 [a, b] (UI 分片异步用; 片间结果用 mergeScanResults 合并) */
    range?: [number, number]
  },
): CollisionScanResult {
  return createPathCollisionScanSession(collision, path, analysis, neckVerts, nozzleVerts, opts)
    .scanRange(opts?.range)
}

/** 合并分片扫描结果 (区间按 部件×零件 聚合, 间隙 ≤2×基准步长 合并, 与 sweepScan 口径一致) */
export function mergeScanResults(chunks: CollisionScanResult[]): CollisionScanResult {
  const first = chunks[0]
  const mergeGap = 2 * first.step
  const byKey = new Map<string, CollInterval[]>()
  for (const ch of chunks) {
    for (const iv of ch.intervals) {
      const k = `${iv.comp}|${iv.part}`
      const arr = byKey.get(k)
      if (arr) arr.push(iv); else byKey.set(k, [iv])
    }
  }
  const intervals: CollInterval[] = []
  for (const [k, arr] of byKey) {
    arr.sort((x, y) => x.a - y.a)
    const [comp, part] = k.split('|') as ['neck' | 'nozzle', string]
    let cur = { ...arr[0] }
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].a <= cur.b + mergeGap + 1e-9) { cur.b = Math.max(cur.b, arr[i].b); continue }
      intervals.push({ comp, part, a: cur.a, b: cur.b })
      cur = { ...arr[i] }
    }
    intervals.push({ comp, part, a: cur.a, b: cur.b })
  }
  intervals.sort((x, y) => x.a - y.a)
  const unverified: { a: number; b: number; reason: string }[] = []
  const uvAll = chunks.flatMap((ch) => ch.unverified).sort((x, y) => x.a - y.a)
  for (const u of uvAll) {
    const last = unverified[unverified.length - 1]
    if (last && u.a <= last.b + mergeGap + 1e-9) last.b = Math.max(last.b, u.b)
    else unverified.push({ ...u })
  }
  return {
    step: first.step, sweepTol: first.sweepTol, maxDepth: first.maxDepth, R: first.R,
    // 基准点包含片间共享端点，totalChecks 只累计实际执行的检测次数。
    baseSamples: chunks.reduce((n, ch) => n + ch.baseSamples, 0),
    refinedSamples: chunks.reduce((n, ch) => n + ch.refinedSamples, 0),
    maxDepthHit: Math.max(...chunks.map((ch) => ch.maxDepthHit)),
    totalChecks: chunks.reduce((n, ch) => n + ch.totalChecks, 0),
    intervals, unverified,
  }
}

/** TCP 原地滚转扫掠结果 (角度制) */
export interface RollSweepResult extends Omit<CollisionScanResult, 'step'> {
  stepDeg: number
  collisionFree: boolean
}

/**
 * TCP 原地旋转扫掠检查 (文档第 9 步: TCP 原地旋转时也要检查完整机头扫掠空间):
 * TCP 固定, 机头绕焊丝轴 (z_T = 文档枪轴 d̂_S) 从 0 滚转到 360°, 基准 stepDeg 一步,
 * 相邻步旋转当量 R×Δθ 超 SWEEP_TOL 自动二分细分; 返回碰撞角度区间 (intervals 的
 * a/b 为角度°) 与未验证角度区间。
 */
export function scanRollSweep(
  collision: TorchCollision, basePose: TorchPose, analysis: NozzleAnalysis,
  neckVerts: Float32Array, nozzleVerts: Float32Array,
  opts?: { stepDeg?: number; sweepTol?: number; maxDepth?: number; offsetQuat?: TorchOffset; poseContext?: TorchPoseContext },
): RollSweepResult {
  const stepDeg = opts?.stepDeg ?? 2
  const sweepTol = opts?.sweepTol ?? SWEEP_TOL_MM
  const maxDepth = opts?.maxDepth ?? SWEEP_MAX_DEPTH
  const R = torchMaxRadius(analysis, neckVerts, nozzleVerts)
  const tip = basePose.wireTipWorld.clone()
  const qBase = basePose.quaternion.clone()
  if (opts?.offsetQuat) qBase.premultiply(resolveTorchOffset(opts.offsetQuat, qBase, opts.poseContext))
  const nodeAt = (deg: number): ScanNode => {
    // 绕焊丝轴 (机头局部 analysis.axis) 滚转: 右乘局部旋转, TCP 在轴上不动
    const roll = new THREE.Quaternion().setFromAxisAngle(analysis.axis, (deg * Math.PI) / 180)
    const q = qBase.clone().multiply(roll)
    const n = collisionNodeOf(collision, analysis, neckVerts, nozzleVerts, q, tip)
    n.s = deg
    return n
  }
  const res = sweepScan(nodeAt, 0, 360, stepDeg, sweepTol, maxDepth, R)
  return {
    stepDeg, sweepTol, maxDepth, R, ...res,
    collisionFree: res.intervals.length === 0,
  }
}
