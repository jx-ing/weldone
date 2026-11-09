import * as THREE from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import type { Edge, EdgesData, Part, PartsData, Weld } from '@/types/weld'
import { axialBoundaryHit, boundaryProjectionSpans, mergeBoundarySpans, type BoundaryProjectionSpan } from './boundaryGeometry'
import { weldPartContactSpans, WELD_CONTACT_TOLERANCE } from './weldContactGeometry'
import { collarGapPlanning } from './collarGapPlanning'
import { getPartGeometryIndex } from './partGeometryIndex'
import { nativeArcBoundaryOutsideOffset } from './nativeArcBoundaryDistance'
import { offsetFaceRayLimit } from './finiteOffsetFace'

/**
 * 间隙检测 —— offset 分支 (沿垂直于焊缝轴线方向, 纯前端实时计算)
 *
 * 语义: 在主板面与副板面上, 分别沿两个检测方向做检测 —— 正面 (该面参考法向) 与
 *       上面 (世界 +Z, 模型 Z-up) 在局部焊缝横截面内的分量。检测方向不得进入接头
 *       支撑面的背面。纯轴向方向跳过，
 *       重合方向只检测一次；轴向探测属于端点 extend，不生成当前焊缝的内部打断点。
 *       每组三个子分支:
 *  - 接触: 沿检测方向射线 (0, d], 打除本接头两零件外的全部零件 (bbox 预过滤),
 *          连续命中同一零件合并为接触段；另用连续三角面检测第三零件直接贴着焊缝的跨度
 *  - 面:   偏移 d 后是否仍落在该面所属零件的面上 (射线只打该零件), 仅当面内方向
 *          (与法向近垂直) 时检测; 在 (0,d] 内发生接触的采样被裁剪, 不计入面跨度
 *  - 孔/边缘: 只遍历 (partId, faceIndex) 与该面相同的边, 到焊缝折线距离 ≤ d 的按段报告;
 *    语义边界使用连续线段及近距投影区间, 旧导出保留原有采样点与端点规则。
 */

const FACE_SAMPLE_STEP = 2 // mm
const RAY_LIFT = 2 // mm, 面检测: 沿 +n 抬升后向 -n 投射
const RAY_FAR = 4 // mm, 面检测命中距离上限
const CONTACT_EPS = 0.1 // mm, 接触射线起点偏移 (避免自交)
const CONTACT_LIFT = 0.05 // mm, 接触射线起点沿面法向微抬 (避免沿面平面掠射导致边界命中不稳定)

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const r2vec = (v: THREE.Vector3) => [r2(v.x), r2(v.y), r2(v.z)]

// ---------------------------------------------------------------- 工具函数

/** 焊缝全部段折线合并为一条 (去除接头重复点) */
export function weldPolyline(weld: Weld): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (const seg of weld.segments) {
    for (const p of seg.points) {
      const v = new THREE.Vector3(p[0], p[1], p[2])
      if (pts.length === 0 || pts[pts.length - 1].distanceToSquared(v) > 1e-12) pts.push(v)
    }
  }
  return pts
}

/** Old exports do not identify connected boundaries; keep their established rules. */
export function hasSemanticBoundaries(edgesData: EdgesData): boolean {
  if ('boundaryRecognitionVersion' in edgesData && typeof edgesData.boundaryRecognitionVersion === 'number') {
    return edgesData.boundaryRecognitionVersion >= 1
  }
  return edgesData.edges.some((edge) => typeof edge.boundaryId === 'string' && Number.isInteger(edge.wireIndex))
}

function pointToPolyline(point: THREE.Vector3, poly: THREE.Vector3[]): { dist: number; point: THREE.Vector3; s: number } {
  let dist = Infinity
  let nearest = new THREE.Vector3()
  let s = 0
  let accumulated = 0
  for (let i = 0; i + 1 < poly.length; i++) {
    const delta = poly[i + 1].clone().sub(poly[i])
    const length = delta.length()
    const t = length > 1e-6 ? THREE.MathUtils.clamp(point.clone().sub(poly[i]).dot(delta) / (length * length), 0, 1) : 0
    const candidate = poly[i].clone().addScaledVector(delta, t)
    const distance = candidate.distanceTo(point)
    if (distance < dist) {
      dist = distance
      nearest = candidate
      s = accumulated + t * length
    }
    accumulated += length
  }
  return { dist, point: nearest, s }
}

/** Compatibility for models exported before connected boundary recognition. */
function legacyBoundaryOffsetSpans(weld: Weld, edgesData: EdgesData, distance: number): BoundaryOffsetResult[] {
  const poly = weldPolyline(weld)
  const result: BoundaryOffsetResult[] = []
  const relevant = new Set([...faceEdges(edgesData, weld.mainPartId, weld.mainFaceIndex),
    ...faceEdges(edgesData, weld.subPartId, weld.subFaceIndex)])
  for (const edge of relevant) {
    if (!edge.points || edge.points.length < 2) continue
    let minDistance = Infinity
    const planned = boundaryPoints(edge, weld)
    for (const point of planned) minDistance = Math.min(minDistance, pointToPolyline(point, poly).dist)
    if (minDistance > distance + 1e-9) continue
    const startBoundaryPoint = planned[0]
    const endBoundaryPoint = planned.at(-1)!
    const start = pointToPolyline(startBoundaryPoint, poly)
    const end = pointToPolyline(endBoundaryPoint, poly)
    const span = { startS: start.s, endS: end.s, startPoint: start.point, endPoint: end.point,
      startBoundaryPoint, endBoundaryPoint, startDistance: start.dist, endDistance: end.dist, minDistance }
    if (boundarySpanInOffsetDirection(weld, edge, span)) result.push({ edge, spans: [span] })
  }
  return result
}

const edgesByFaceCache = new WeakMap<EdgesData, Map<string, Edge[]>>()

function faceEdges(edgesData: EdgesData, partId: string, faceIndex: number): Edge[] {
  let indexed = edgesByFaceCache.get(edgesData)
  if (!indexed) {
    indexed = new Map()
    for (const edge of edgesData.edges) {
      const key = `${edge.partId}|${edge.faceIndex}`
      const group = indexed.get(key) ?? []
      group.push(edge)
      indexed.set(key, group)
    }
    edgesByFaceCache.set(edgesData, indexed)
  }
  return indexed.get(`${partId}|${faceIndex}`) ?? []
}

function boundaryPoints(edge: Edge, weld: Weld): THREE.Vector3[] {
  const points = (edge.points?.length >= 2 ? edge.points : [edge.start, edge.end])
    .filter(isVec3).map((p) => new THREE.Vector3().fromArray(p))
  if ((edge.closed || edge.type === '圆') && points.length > 2
    && points[0].distanceToSquared(points[points.length - 1]) > 1e-12) points.push(points[0].clone())
  const policy = collarGapPlanning(weld)
  // The known source-to-host projection applies only to the queried support
  // boundary. This never moves a part mesh or a third-part collision query.
  const evidence = weld.properties['投影搭接'] as { projectionVector?: number[] } | undefined
  if (policy?.source === '投影搭接' && edge.partId === policy.sourcePartId && isVec3(evidence?.projectionVector)) {
    const delta = new THREE.Vector3().fromArray(evidence.projectionVector)
    for (const point of points) point.add(delta)
  }
  return points
}

export interface BoundaryOffsetResult {
  edge: Edge
  spans: BoundaryProjectionSpan[]
}

/** A face boundary must lie in an actual offset inspection direction. A hole
 * beside a horizontal root is not reached by its +Z offset and must not split
 * that root merely because its Euclidean distance happens to be small. Keep
 * zero-distance crossings and exports without usable face normals. */
function boundarySpanInOffsetDirection(weld: Weld, edge: Edge, span: BoundaryProjectionSpan): boolean {
  if (span.minDistance <= 0.02) return true
  const mid = span.startPoint.clone().add(span.endPoint).multiplyScalar(.5)
  let nearest = Infinity, segmentIndex = -1, tangent = new THREE.Vector3()
  for (const [index, segment] of weld.segments.entries()) for (let i = 1; i < segment.points.length; i++) {
    const a = new THREE.Vector3().fromArray(segment.points[i - 1]), b = new THREE.Vector3().fromArray(segment.points[i])
    const line = new THREE.Line3(a, b), at = line.closestPointToPoint(mid, true, new THREE.Vector3()), distance = at.distanceToSquared(mid)
    if (distance < nearest) { nearest = distance; segmentIndex = index; tangent = b.sub(a).normalize() }
  }
  const props = (weld.properties.焊缝段 ?? []) as SegProp[]
  const segment = weld.segments[segmentIndex], prop = props.find(value => value.index === segment?.index) ?? props[segmentIndex]
  const face = edge.partId === weld.mainPartId ? prop?.主板面 : prop?.副板面
  if (face?.类型 !== '平面' || !isVec3(face.法向)) return true
  const normal = new THREE.Vector3().fromArray(face.法向).normalize()
  const frontNormals = [prop?.主板面, prop?.副板面]
    .filter((value): value is FaceProp => value?.类型 === '平面' && isVec3(value.法向))
    .map(value => new THREE.Vector3().fromArray(value.法向 as number[]).normalize())
  const inspection = offsetInspectionDirections(normal, tangent, frontNormals)
  const directions = [inspection.front, inspection.up].filter((value): value is THREE.Vector3 => !!value)
  return [[span.startPoint, span.startBoundaryPoint], [span.endPoint, span.endBoundaryPoint]].some(([origin, boundary]) => {
    const delta = boundary.clone().sub(origin), length = delta.length()
    return length <= .02 || directions.some(direction => delta.dot(direction) >= -.02
      && delta.clone().cross(direction).length() <= Math.max(.02, length * .001))
  })
}

const boundarySpanCache = new WeakMap<EdgesData, WeakMap<Weld, Map<number, BoundaryOffsetResult[]>>>()
const axialCache = new WeakMap<EdgesData, WeakMap<Weld, AxialResult>>()

// The loaded CAD records are immutable. Retain a bounded number of recently
// used detection distances per weld; model/geometry identities isolate caches.
function rememberDistance<T>(cache: Map<number, T>, distance: number, result: T) {
  if (cache.size >= 8 && !cache.has(distance)) cache.delete(cache.keys().next().value!)
  cache.set(distance, result)
}

/** Shared continuous boundary calculation for offset display and threshold splits. */
export function computeBoundaryOffsetSpans(weld: Weld, edgesData: EdgesData, distance: number): BoundaryOffsetResult[] {
  let byWeld = boundarySpanCache.get(edgesData)
  if (!byWeld) { byWeld = new WeakMap(); boundarySpanCache.set(edgesData, byWeld) }
  let byDistance = byWeld.get(weld)
  if (!byDistance) { byDistance = new Map(); byWeld.set(weld, byDistance) }
  const cached = byDistance.get(distance)
  if (cached) return cached
  const poly = weldPolyline(weld)
  const groups = new Map<string, BoundaryOffsetResult>()
  const relevant = new Set([...faceEdges(edgesData, weld.mainPartId, weld.mainFaceIndex),
    ...faceEdges(edgesData, weld.subPartId, weld.subFaceIndex)])
  for (const edge of relevant) {
    const key = `${edge.partId}|${edge.faceIndex}|${edge.wire === 'inner' && edge.wireId ? edge.wireId : edge.boundaryId ?? `edge:${edge.edgeIndex}`}`
    const plannedBoundary = boundaryPoints(edge, weld)
    if (nativeArcBoundaryOutsideOffset(weld, edge, plannedBoundary, distance)) continue
    const spans = boundaryProjectionSpans(poly, plannedBoundary, distance)
      .filter(span => boundarySpanInOffsetDirection(weld, edge, span))
    if (!spans.length) continue
    const group = groups.get(key)
    if (group) group.spans.push(...spans)
    else groups.set(key, { edge, spans })
  }
  const result = [...groups.values()].map((group) => ({ ...group, spans: mergeBoundarySpans(group.spans) }))
  rememberDistance(byDistance, distance, result)
  return result
}

export interface AxialFaceResult {
  起点距离: number | null
  终点距离: number | null
  起点投影点: number[]
  终点投影点: number[]
  起点关联点: number[] | null
  终点关联点: number[] | null
  起点边界: Record<string, unknown> | null
  终点边界: Record<string, unknown> | null
}

export type AxialResult = Record<string, AxialFaceResult>

/** Endpoints extend only along their outward tangent to an actual boundary hit. */
export function computeAxialDetection(weld: Weld, edgesData: EdgesData): AxialResult | null {
  if (!hasSemanticBoundaries(edgesData)) return null
  let byWeld = axialCache.get(edgesData)
  if (!byWeld) { byWeld = new WeakMap(); axialCache.set(edgesData, byWeld) }
  const cached = byWeld.get(weld)
  if (cached) return cached
  const poly = weldPolyline(weld)
  const empty = (): AxialFaceResult => ({ 起点距离: null, 终点距离: null,
    起点投影点: poly[0]?.toArray() ?? weld.start, 终点投影点: poly.at(-1)?.toArray() ?? weld.end,
    起点关联点: null, 终点关联点: null, 起点边界: null, 终点边界: null })
  const result: AxialResult = { 主板面: empty(), 副板面: empty() }
  if (weld.closed || poly.length < 2 || poly[0].distanceToSquared(poly[poly.length - 1]) < 1e-12) {
    byWeld.set(weld, result)
    return result
  }
  const endpoints = [
    { key: '起点' as const, origin: poly[0], direction: poly[0].clone().sub(poly[1]).normalize() },
    { key: '终点' as const, origin: poly[poly.length - 1], direction: poly[poly.length - 1].clone().sub(poly[poly.length - 2]).normalize() },
  ]
  for (const [name, partId, faceIndex] of [
    ['主板面', weld.mainPartId, weld.mainFaceIndex], ['副板面', weld.subPartId, weld.subFaceIndex],
  ] as const) {
    const edges = faceEdges(edgesData, partId, faceIndex)
    for (const endpoint of endpoints) {
      for (const edge of edges) {
        const hit = axialBoundaryHit(endpoint.origin, endpoint.direction, boundaryPoints(edge, weld))
        const current = result[name][`${endpoint.key}距离`]
        if (!hit || (current !== null && current <= hit.distance)) continue
        result[name][`${endpoint.key}距离`] = hit.distance
        result[name][`${endpoint.key}关联点`] = hit.point.toArray()
        result[name][`${endpoint.key}边界`] = { 所属零件: partId, 面序号: faceIndex,
          '孔/边缘': edge.wire === 'inner' ? '孔' : '边缘', 类型: edge.type,
          边界标识: edge.boundaryId ?? edge.edgeIndex,
          ...(collarGapPlanning(weld)?.source === '投影搭接' && partId === collarGapPlanning(weld)?.sourcePartId
            ? { 检测依据: '已核验补板有限投影连接的规划边界；原零件位置保留' } : {}) }
      }
    }
  }
  byWeld.set(weld, result)
  return result
}

// ------------------------------------------------- 零件 mesh 缓存 (射线检测用)
const meshCache = new WeakMap<Float32Array, WeakMap<Part, THREE.Mesh>>()

/** BVH traversal visits triangles in spatial order. Preserve the original
 * triangle order for equal-distance hits so contact ownership cannot change. */
function indexedRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, intersections: THREE.Intersection[]) {
  const hits: THREE.Intersection[] = []
  acceleratedRaycast.call(this, raycaster, hits)
  hits.sort((a, b) => a.distance - b.distance || (a.faceIndex ?? 0) - (b.faceIndex ?? 0))
  for (const hit of hits) intersections.push(hit)
}

export function getPartMesh(
  meshData: Float32Array, partsData: PartsData, partId: string,
): THREE.Mesh | null {
  const part = partsData.parts.find((p) => p.id === partId)
  if (!part) return null
  let cache = meshCache.get(meshData)
  if (!cache) {
    cache = new WeakMap()
    meshCache.set(meshData, cache)
  }
  const indexed = getPartGeometryIndex(meshData, part)
  let mesh = cache.get(part)
  if (!mesh || mesh.geometry !== indexed.geometry) {
    // DoubleSide: Mesh.raycast 按 material.side 剔除背面三角形
    mesh = new THREE.Mesh(indexed.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    mesh.raycast = indexedRaycast
    mesh.updateMatrixWorld()
    cache.set(part, mesh)
  }
  return mesh
}

// ------------------------------------------------- 参考法向 / 面内垂直方向

interface FaceProp {
  类型?: unknown
  法向?: unknown
}

interface SegProp {
  index?: number
  起点法向?: unknown
  主板面?: FaceProp | null
  副板面?: FaceProp | null
}

function isVec3(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number')
}

/** Exported 起点法向 is the seam tangent, not a curved supporting-face normal.
 * Read a curved face from its actual mesh; crossing the two tangent vectors can
 * otherwise manufacture +Z and miss all lateral offsets on a circular seam. */
export function referenceNormal(
  faceProp: FaceProp | null | undefined, segProp: SegProp | undefined, tangent: THREE.Vector3,
  point?: THREE.Vector3, meshData?: Float32Array, part?: Part,
): THREE.Vector3 {
  if (faceProp && faceProp.类型 === '平面' && isVec3(faceProp.法向)) {
    return new THREE.Vector3(faceProp.法向[0], faceProp.法向[1], faceProp.法向[2]).normalize()
  }
  if (point && meshData && part) {
    const index = getPartGeometryIndex(meshData, part)
    const nearest = index.tree?.closestPointToPoint(point)
    if (nearest) {
      const normal = index.geometry.getAttribute('normal')
      const at = nearest.faceIndex * 3
      const n = new THREE.Vector3(normal.getX(at), normal.getY(at), normal.getZ(at))
      n.addScaledVector(tangent, -n.dot(tangent))
      if (n.lengthSq() > 1e-8) return n.normalize()
    }
  }
  if (segProp && isVec3(segProp.起点法向)) {
    const n0 = new THREE.Vector3(segProp.起点法向[0], segProp.起点法向[1], segProp.起点法向[2])
    const n = new THREE.Vector3().crossVectors(n0, tangent)
    if (n.lengthSq() > 1e-12) return n.normalize()
  }
  return new THREE.Vector3(0, 0, 1)
}

/** Offset rays occupy the local section perpendicular to the weld. A fixed
 * reference can be axial on vertical/curved seams; do not sweep forward along
 * the seam and turn an endpoint's nearby material into an internal cut. */
export function offsetDirection(reference: THREE.Vector3, tangent: THREE.Vector3): THREE.Vector3 | null {
  const transverse = reference.clone().addScaledVector(tangent, -reference.dot(tangent))
  return transverse.lengthSq() > 1e-12 ? transverse.normalize() : null
}

/** Offset inspection stays in the open side of the joint's supporting faces.
 * World +Z is only a reference: its transverse component can point behind a
 * downward or inclined face. The same restriction applies to the other face's
 * normal ray, so querying the second support cannot reintroduce a back-side hit.
 * Tangential rays are retained; only coincident forward rays are deduplicated. */
export function offsetInspectionDirections(normal: THREE.Vector3, tangent: THREE.Vector3,
  frontNormals: readonly THREE.Vector3[] = [normal]): { front: THREE.Vector3 | null; up: THREE.Vector3 | null } {
  const constraints = frontNormals.map(value => offsetDirection(value, tangent))
    .filter((value): value is THREE.Vector3 => !!value)
  const allowed = (direction: THREE.Vector3 | null) => direction
    && constraints.every(faceNormal => direction.dot(faceNormal) >= -1e-8) ? direction : null
  const up = allowed(offsetDirection(new THREE.Vector3(0, 0, 1), tangent))
  const front = allowed(offsetDirection(normal, tangent))
  return { front: front && up && front.dot(up) > .99 ? null : front, up }
}

// ---------------------------------------------------------------- 主入口

export interface FaceGroupResult {
  接触: Record<string, unknown> | null
  面: Record<string, unknown> | null
  '孔/边缘': Record<string, unknown> | null
}

export interface PerpendicularResult {
  主板面: FaceGroupResult
  副板面: FaceGroupResult
}

interface Sample {
  p: THREE.Vector3
  t: THREE.Vector3
  segIndex: number
  segType: string
  segProp: SegProp | undefined
}

interface Contact {
  partId: string
  dist: number
  point: THREE.Vector3
}

export function computePerpendicularDetection(
  weld: Weld,
  meshData: Float32Array,
  partsData: PartsData,
  edgesData: EdgesData,
  offset: number,
): PerpendicularResult {
  const poly = weldPolyline(weld)
  const segProps = (weld.properties?.焊缝段 ?? []) as SegProp[]
  const partName = (id: string) => partsData.parts.find((p) => p.id === id)?.name ?? id
  const semantic = hasSemanticBoundaries(edgesData)
  const boundaryResults = semantic ? computeBoundaryOffsetSpans(weld, edgesData, offset)
    : legacyBoundaryOffsetSpans(weld, edgesData, offset)

  // 全部采样点 (≤2mm 步长, 跨段连续编号)
  const samples: Sample[] = []
  weld.segments.forEach((seg, segIndex) => {
    if (!seg.points || seg.points.length < 2) return
    const segProp = segProps.find((s) => s.index === seg.index) ?? segProps[seg.index - 1]
    const pts = seg.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const ab = new THREE.Vector3().subVectors(b, a)
      const len = ab.length()
      if (len < 1e-9) continue
      const tangent = ab.clone().normalize()
      const steps = Math.max(1, Math.ceil(len / FACE_SAMPLE_STEP))
      for (let k = 0; k < steps; k++) {
        samples.push({ p: a.clone().addScaledVector(ab, k / steps), t: tangent, segIndex, segType: seg.type, segProp })
      }
      if (i === pts.length - 2) samples.push({ p: b.clone(), t: tangent, segIndex, segType: seg.type, segProp })
    }
  })

  // 接触候选零件: 排除本接头两零件, bbox 各膨胀 d 后相交预过滤
  const weldBox = new THREE.Box3()
  for (const p of poly) weldBox.expandByPoint(p)
  const candidatePadding = Math.max(offset, WELD_CONTACT_TOLERANCE)
  weldBox.expandByScalar(candidatePadding)
  const candidates: { partId: string; mesh: THREE.Mesh }[] = []
  for (const part of partsData.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue
    const pb = new THREE.Box3(
      new THREE.Vector3(...(part.bbox.min as [number, number, number])),
      new THREE.Vector3(...(part.bbox.max as [number, number, number])),
    ).expandByScalar(candidatePadding)
    if (!pb.intersectsBox(weldBox)) continue
    const mesh = getPartMesh(meshData, partsData, part.id)
    if (mesh) candidates.push({ partId: part.id, mesh })
  }
  const candidateMeshes = candidates.map((c) => c.mesh)
  // Direct weld contact survives a grazing ray, a surface hit inside the near
  // cutoff, and a bracket narrower than the ray sampling interval. Compute once
  // and report on the main face; both split rules consume this same evidence.
  const directContacts = candidates.flatMap(({ partId }) => {
    const part = partsData.parts.find((candidate) => candidate.id === partId)!
    return weldPartContactSpans(poly, meshData, part).map((span) => ({ partId, span }))
  })

  /** 对一组面 (主板面/副板面) 独立检测 */
  const detectGroup = (
    faceKey: '主板面' | '副板面',
    partId: string,
    faceIndex: number,
  ): FaceGroupResult => {
    const facePropOf = (segProp: SegProp | undefined): FaceProp | null =>
      (faceKey === '主板面' ? segProp?.主板面 : segProp?.副板面) ?? null

    // ------------------------------------ 孔/边缘: 仅该 (partId, faceIndex) 的边
    const edgeReport: Record<string, unknown> = {}
    let edgeIdx = 0
    for (const { edge, spans } of boundaryResults) {
      if (edge.partId !== partId || edge.faceIndex !== faceIndex) continue
      for (const span of spans) {
        edgeIdx++
        edgeReport[`段${edgeIdx}`] = {
          类型: edge.type,
          所属零件: partName(edge.partId),
          面序号: edge.faceIndex,
          ...(collarGapPlanning(weld)?.source === '投影搭接' && edge.partId === collarGapPlanning(weld)?.sourcePartId
            ? { 检测依据: '已核验补板有限投影连接的规划边界；原零件位置保留' } : {}),
          '孔/边缘': edge.wire === 'inner' ? '孔' : '边缘',
          ...(semantic ? { 边界标识: edge.boundaryId ?? edge.edgeIndex,
            最小边界距离: r1(span.minDistance), 投影跨度: r2(span.endS - span.startS) } : {}),
          起点到焊缝的距离: r1(span.startDistance),
          终点到焊缝的距离: r1(span.endDistance),
          关联点1: r2vec(span.startBoundaryPoint),
          关联点2: r2vec(span.endBoundaryPoint),
          投影点1: r2vec(span.startPoint),
          投影点2: r2vec(span.endPoint),
        }
      }
    }

    // ------------------------------------ 接触 + 面 (两个参考方向在局部横截面内检测)
    const faceMesh = getPartMesh(meshData, partsData, partId)
    const raycaster = new THREE.Raycaster()
    const contactReport: Record<string, unknown> = {}
    const faceReport: Record<string, unknown> = {}
    let contactIdx = 0
    let faceIdx = 0

    // 每个采样点的参考法向 (只算一次)
    const part = partsData.parts.find(candidate => candidate.id === partId)
    const ns: THREE.Vector3[] = samples.map((s) => referenceNormal(facePropOf(s.segProp), s.segProp, s.t, s.p, meshData, part))
    const otherPart = partsData.parts.find(candidate => candidate.id === (faceKey === '主板面' ? weld.subPartId : weld.mainPartId))
    const directions = samples.map((sample, i) => {
      const otherFace = faceKey === '主板面' ? sample.segProp?.副板面 : sample.segProp?.主板面
      const otherNormal = otherFace || otherPart ? referenceNormal(otherFace, sample.segProp,
        sample.t, sample.p, meshData, otherPart) : null
      return offsetInspectionDirections(ns[i], sample.t, otherNormal ? [ns[i], otherNormal] : [ns[i]])
    })
    // A vertical seam has no transverse +Z component. Keep its face-normal
    // query and continuous third-part contact proof, without an axial offset ray.
    // Coincident transverse directions are queried once, as on horizontal faces.
    const DIRS: { name: '正面' | '上面'; vec: (THREE.Vector3 | null)[] }[] = [
      { name: '正面', vec: directions.map(direction => direction.front) },
      { name: '上面', vec: directions.map(direction => direction.up) },
    ]

    for (const dir of DIRS) {
      const contactAt = (point: THREE.Vector3, normal: THREE.Vector3, direction: THREE.Vector3 | null,
        tangent: THREE.Vector3): Contact | null => {
        if (!direction || candidateMeshes.length === 0) return null
        raycaster.set(point.clone().addScaledVector(normal, CONTACT_LIFT), direction)
        raycaster.near = CONTACT_EPS
        raycaster.far = offset
        const h = raycaster.intersectObjects(candidateMeshes, false)[0]
        if (!h) return null
        const faceLimit = offsetFaceRayLimit(weld, raycaster.ray.origin, tangent, direction, edgesData)
        if (faceLimit !== null && h.distance > faceLimit) return null
        const cand = candidates.find(candidate => candidate.mesh === h.object)
        return cand ? { partId: cand.partId, dist: h.distance, point: h.point.clone() } : null
      }
      // 每个采样点的接触判定 (起点沿面法向微抬 CONTACT_LIFT, 避免在面平面内掠射)
      const contacts = samples.map((s, i) => contactAt(s.p, ns[i], dir.vec[i], s.t))
      // Sample spacing discovers contact runs, but is not their physical edge.
      // Resolve each hit/miss transition on its actual local segment so finite
      // root endpoints do not stop up to 2 mm before the measured offset cut.
      const contactBoundary = (inside: number, outside: number, partId: string): { sample: Sample; hit: Contact } | null => {
        const a = samples[inside], b = samples[outside], initial = contacts[inside]
        if (!initial || !dir.vec[inside] || !dir.vec[outside] || a.t.dot(b.t) < .999
          || a.p.distanceTo(b.p) > FACE_SAMPLE_STEP * 1.1) return null
        let lo = 0, hi = 1, point = a.p, hit = initial
        for (let iteration = 0; iteration < 12; iteration++) {
          const t = (lo + hi) / 2, p = a.p.clone().lerp(b.p, t)
          const candidate = contactAt(p, ns[inside].clone().lerp(ns[outside], t).normalize(),
            dir.vec[inside]!.clone().lerp(dir.vec[outside]!, t).normalize(), a.t)
          if (candidate?.partId === partId) { lo = t; point = p; hit = candidate } else hi = t
        }
        return { sample: { ...a, p: point }, hit }
      }

      // 连续命中同一零件 → 接触段
      let cStart: Sample | null = null
      let cStartHit: THREE.Vector3 | null = null
      let cPrev: Sample | null = null
      let cPrevHit: THREE.Vector3 | null = null
      let cPart: string | null = null
      let dMin = Infinity
      let dMax = -Infinity
      const flushContact = () => {
        if (cStart && cPrev && cPart && cStartHit && cPrevHit) {
          contactIdx++
          contactReport[`段${contactIdx}`] = {
            接触零件: cPart,
            接触零件名称: partName(cPart),
            方向: dir.name,
            最小接触距离: r1(dMin),
            最大接触距离: r1(dMax),
            投影点1: r2vec(cStart.p),
            投影点2: r2vec(cPrev.p),
            关联点1: r2vec(cStartHit),
            关联点2: r2vec(cPrevHit),
          }
        }
        cStart = null
        cPart = null
        dMin = Infinity
        dMax = -Infinity
      }
      samples.forEach((s, i) => {
        const c = contacts[i]
        if (c && c.partId === cPart) {
          cPrev = s
          cPrevHit = c.point
          if (c.dist < dMin) dMin = c.dist
          if (c.dist > dMax) dMax = c.dist
        } else {
          if (cPart && i > 0 && contacts[i - 1]?.partId === cPart) {
            const boundary = contactBoundary(i - 1, i, cPart)
            if (boundary) { cPrev = boundary.sample; cPrevHit = boundary.hit.point }
          }
          flushContact()
          if (c) {
            cPart = c.partId
            const boundary = i > 0 ? contactBoundary(i, i - 1, c.partId) : null
            cStart = boundary?.sample ?? s
            cStartHit = boundary?.hit.point ?? c.point
            cPrev = s
            cPrevHit = c.point
            dMin = c.dist
            dMax = c.dist
          }
        }
      })
      flushContact()

      // 面跨度 (按焊缝段, 发生接触的采样被裁剪)
      // 仅当检测方向在面内 (与法向近垂直, |dir·n| ≤ 0.9) 才有意义:
      // 沿法向偏移 d 再投回面上恒真, 是废话 —— 所以「正面」方向不做面分支
      if (faceMesh) {
        const onFace = (s: Sample, i: number) => {
          const d = dir.vec[i]
          if (!d) return false
          const n = ns[i]
          if (Math.abs(d.dot(n)) > 0.9) return false
          const origin = s.p.clone().addScaledVector(d, offset).addScaledVector(n, RAY_LIFT)
          raycaster.set(origin, n.clone().negate())
          raycaster.near = 0
          raycaster.far = RAY_FAR
          return raycaster.intersectObject(faceMesh, false).length > 0
        }
        let spanStart: Sample | null = null
        let spanStartOff: THREE.Vector3 | null = null
        let prev: Sample | null = null
        let prevOff: THREE.Vector3 | null = null
        const flush = () => {
          if (spanStart && prev && spanStartOff && prevOff) {
            faceIdx++
            faceReport[`段${faceIdx}`] = {
              类型: spanStart.segType,
              方向: dir.name,
              起点到焊缝的距离: r1(offset),
              终点到焊缝的距离: r1(offset),
              投影点1: r2vec(spanStart.p),
              投影点2: r2vec(prev.p),
              关联点1: r2vec(spanStartOff),
              关联点2: r2vec(prevOff),
            }
          }
          spanStart = null
          spanStartOff = null
        }
        samples.forEach((s, i) => {
          const contacted = contacts[i] !== null // (0,d] 内有接触 → 裁剪, 不计入面跨度
          if (!contacted && onFace(s, i)) {
            const offPt = s.p.clone().addScaledVector(dir.vec[i]!, offset)
            if (!spanStart || spanStart.segIndex !== s.segIndex) {
              flush()
              spanStart = s
              spanStartOff = offPt
            }
            prev = s
            prevOff = offPt
          } else {
            flush()
          }
        })
        flush()
      }
    }

    if (faceKey === '主板面') for (const { partId: contactPartId, span } of directContacts) {
      contactReport[`段${++contactIdx}`] = {
        接触零件: contactPartId,
        接触零件名称: partName(contactPartId),
        方向: '焊缝贴面',
        最小接触距离: 0,
        最大接触距离: 0,
        投影跨度: r2(span.endS - span.startS),
        投影点1: r2vec(span.start),
        投影点2: r2vec(span.end),
        关联点1: r2vec(span.start),
        关联点2: r2vec(span.end),
      }
    }

    return {
      接触: contactIdx > 0 ? contactReport : null,
      面: faceIdx > 0 ? faceReport : null,
      '孔/边缘': edgeIdx > 0 ? edgeReport : null,
    }
  }

  return {
    主板面: detectGroup('主板面', weld.mainPartId, weld.mainFaceIndex),
    副板面: detectGroup('副板面', weld.subPartId, weld.subFaceIndex),
  }
}
