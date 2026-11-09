/** Unified, measured endpoint space. Semantic arc/corner labels never take
 * part in the measurement. Part positions and the immutable CAD remain intact. */
import * as THREE from 'three'
import type { BoundaryWire, Edge, EdgesData, Part, PartsData, Weld } from '@/types/weld'
import { endpointSample } from './torch'
import { endpointWrapDirections, endpointWrapSide } from './baojiaoFrame'
import { legacyFaceFootprint, type LegacyFaceFootprint } from './legacyFaceBoundary'
import { getPartGeometryIndex } from './partGeometryIndex'
import { computeAxialDetection } from './gapDetection'
import { collarGapPlanning } from './collarGapPlanning'
import { firstSourceMaterialReentry } from './endpointSourceReentry'
import { measureOpeningBoundaryInterference, type OpeningBoundaryInterference } from './endpointBoundaryInterference'

export interface UnifiedEndpointInfo {
  version: 1
  status: 'verified' | 'partial' | 'unknown'
  kind: 'free-edge' | 'opening' | 'interior' | 'unknown'
  geometryConnection: 'continuous' | 'turn' | 'unknown'
  boundaryShape: 'straight' | 'relief' | 'unknown'
  axialClearanceMm: number | null
  openingWidthMm: number | null
  openingHeightMm: number | null
  /** A single adjoining relief boundary is a local passage measurement. */
  openingMeasurementScope?: 'local' | 'complete'
  /** Full measured passage chain, kept for geometry diagnostics. */
  openingBoundaryIds?: string[]
  openingBoundaryPoints?: number[][]
  /** A composite insertion slot may contain a smaller endpoint relief. Keep
   * the full source envelope for diagnostics, outside the process dimensions. */
  sourceOpeningEnvelope?: { widthMm: number; heightMm: number; boundaryIds: string[]; boundaryPoints: number[][] }
  wrapAvailableMm: number | null
  sidesConnected: boolean | null
  turnAngleDeg: number | null
  boundaryTangent: number[] | null
  wrapSide: 'main' | 'sub'
  thicknessMm: number | null
  thirdPartClearance: { partId: string; distance: number } | null
  /** Own joint material which returns after an actual outward void interval.
   * A plate's initial support or its free material exit is not an obstruction. */
  sourceMaterialClearance?: { partId: string; faceIndex: number; distance: number }
  /** Third material beside the whole finite relief, with its actual query
   * point retained. This distance is not endpoint axial clearance or hole size. */
  openingBoundaryClearance?: OpeningBoundaryInterference
  /** null explicitly means the outward interference query was disabled. */
  axialInspectionMm?: number | null
  /** This endpoint was created by a physically verified offset/subplate contact. */
  offsetSubplateContact?: { partId: string | null }
  wrapBlockingPart?: { partId: string; distance: number } | null
  basis: string[]
  sourceBoundaryIds: string[]
  summary: string
}

export interface EndpointClearanceOptions {
  extendThreshold?: number | null
  /** Reuse the already measured extend value when the caller has it. */
  axialClearanceMm?: number | null
}

export interface EndpointSpace {
  endpointType: '自由端' | '干涉端' | null
  /** Internal/G1 contact points are not exposed welding endpoints. */
  isEndpoint: boolean | null
  passHoleSize: { widthMm: number | null; heightMm: number | null; scope: 'local' | 'complete' } | null
  interference: { axial: boolean; wrap: boolean; boundary?: boolean }
  summary: string
}

/** Preserve whether an axial obstruction belongs to a joint plate or a third
 * part. Only real material re-entry qualifies as a source-plate obstruction. */
export function endpointAxialObstacle(info: UnifiedEndpointInfo, extendThreshold?: number | null) {
  const hits = [
    ...(info.thirdPartClearance ? [{ ...info.thirdPartClearance, source: 'third' as const }] : []),
    ...(info.sourceMaterialClearance ? [{ ...info.sourceMaterialClearance, source: 'joint' as const }] : []),
  ].filter(hit => Number.isFinite(hit.distance) && hit.distance >= 0
    && (extendThreshold === undefined || typeof extendThreshold === 'number' && Number.isFinite(extendThreshold)
      && extendThreshold > 0 && hit.distance < extendThreshold))
  return hits.sort((a, b) => a.distance - b.distance)[0] ?? null
}

/** Compact process abstraction. Keep the measured CAD report as a separate
 * diagnostic/safety gate: "free" alone never proves a complete full wrap.
 * A relief/opening is not an obstacle; actual third material is interference.
 * Extent/clearance is deliberately never relabeled as a hole dimension. */
export function abstractEndpointSpace(info: UnifiedEndpointInfo, extendThreshold?: number | null): EndpointSpace {
  const contact = !!info.offsetSubplateContact
  const axial = !!endpointAxialObstacle(info, extendThreshold)
  const wrapHit = info.wrapBlockingPart
  const wrap = !!wrapHit && Number.isFinite(wrapHit.distance) && wrapHit.distance >= 0
  const boundaryHit = info.openingBoundaryClearance
  const boundary = !!boundaryHit && Number.isFinite(boundaryHit.distance) && boundaryHit.distance >= 0
    && (extendThreshold === undefined || typeof extendThreshold === 'number' && Number.isFinite(extendThreshold)
      && extendThreshold > 0 && boundaryHit.distance < extendThreshold)
  const result: EndpointSpace = { endpointType: null, isEndpoint: null, passHoleSize: null,
    interference: { axial, wrap, ...(boundary ? { boundary: true } : {}) }, summary: '端部未确认' }
  if (!contact && (info.kind === 'interior' || info.geometryConnection === 'continuous')) {
    result.isEndpoint = false; result.summary = '接头内部点'
    return result
  }
  if (!contact && (info.status === 'unknown' || info.kind === 'unknown')) {
    if (axial || wrap || boundary) {
      result.endpointType = '干涉端'
      result.summary = `干涉端 · 端部几何未确认 · ${[axial ? '轴向受阻' : '', wrap ? '包角方向受阻' : '', boundary ? '让位边界受阻' : ''].filter(Boolean).join('、')}`
    }
    return result
  }
  result.isEndpoint = true
  const dimension = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  if (info.kind === 'opening') result.passHoleSize = {
    widthMm: dimension(info.openingWidthMm), heightMm: dimension(info.openingHeightMm),
    scope: info.openingMeasurementScope ?? 'local' }
  if (!contact && info.axialInspectionMm === null && !axial && !wrap && !boundary) {
    result.summary = '端部类型未确认（轴向干涉判断未启用）'
    return result
  }
  result.endpointType = contact || axial || wrap || boundary ? '干涉端' : '自由端'
  const mm = (value: number | null) => value === null ? '未确认' : String(Math.round(value * 100) / 100)
  result.summary = `${result.endpointType}${result.passHoleSize
    ? ` · ${result.passHoleSize.scope === 'local' ? '局部' : ''}过焊孔 ${mm(result.passHoleSize.widthMm)} × ${mm(result.passHoleSize.heightMm)}mm`
    : ' · 无过焊孔'}${contact || axial || wrap || boundary ? ` · ${[contact ? 'offset 方向实体与副板直接接触' : '', axial ? '轴向受阻' : '', wrap ? '包角方向受阻' : '', boundary ? '让位边界受阻' : ''].filter(Boolean).join('、')}` : ''}`
  return result
}

const EPS = .05
const vec = (point: number[]) => new THREE.Vector3().fromArray(point)
const finitePoint = (point: unknown): point is number[] => Array.isArray(point)
  && point.length === 3 && point.every((value) => typeof value === 'number' && Number.isFinite(value))
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : {}
const degrees = (a: THREE.Vector3, b: THREE.Vector3) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) * 180 / Math.PI
const idOf = (edge: Edge) => edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}`

interface FaceData { edges: Edge[]; footprint: LegacyFaceFootprint | null; topologyComplete?: boolean; wires?: BoundaryWire[] }
interface BoundaryIndex { faces: Map<string, FaceData>; parts: Map<string, Edge[]> }
const boundaries = new WeakMap<EdgesData, BoundaryIndex>()
function boundaryIndex(data: EdgesData): BoundaryIndex {
  const saved = boundaries.get(data)
  if (saved) return saved
  const index: BoundaryIndex = { faces: new Map(), parts: new Map() }
  for (const edge of data.edges) {
    if (edge.points.length < 2 || !edge.points.every(finitePoint)) continue
    const key = `${edge.partId}|${edge.faceIndex}`
    const face = index.faces.get(key) ?? { edges: [], footprint: null }
    face.edges.push(edge); index.faces.set(key, face)
    const group = index.parts.get(edge.partId) ?? []
    group.push(edge); index.parts.set(edge.partId, group)
  }
  if (data.wires?.length) {
    const wiresByFace = new Map<string, NonNullable<EdgesData['wires']>>()
    for (const wire of data.wires) {
      const key = `${wire.partId}|${wire.faceIndex}`, wires = wiresByFace.get(key) ?? []
      wires.push(wire); wiresByFace.set(key, wires)
    }
    for (const [key, face] of index.faces) {
      const ids = new Set(face.edges.flatMap((edge) => edge.boundaryId ? [edge.boundaryId] : []))
      const wires = wiresByFace.get(key) ?? []
      face.wires = wires
      face.topologyComplete = wires.length > 0 && wires.every((wire) => wire.closed && wire.topologyComplete === true
        && wire.boundaryIds.length > 0 && wire.boundaryIds.every((id) => ids.has(id)))
    }
  }
  boundaries.set(data, index)
  return index
}
const measuredFaces = new WeakSet<FaceData>()
/** Complete modern wires already carry verified CAD adjacency. Build their
 * planar loops in linear time; rerunning the legacy pairwise crossing recovery
 * on large perforated host faces would needlessly slow model preprocessing. */
function modernFootprint(face: FaceData): LegacyFaceFootprint | null {
  if (!face.topologyComplete || !face.wires?.length) return null
  const edges = new Map(face.edges.flatMap((edge) => edge.boundaryId ? [[edge.boundaryId, edge] as const] : []))
  const loops: { hole: boolean; points: THREE.Vector3[] }[] = []
  for (const wire of face.wires) {
    const points: THREE.Vector3[] = []
    for (const id of wire.boundaryIds) {
      const edge = edges.get(id)
      if (!edge) return null
      const samples = edge.points.map(vec)
      if (points.length && points.at(-1)!.distanceTo(samples[0]) > EPS) {
        samples.reverse()
        if (points.at(-1)!.distanceTo(samples[0]) > EPS) return null
      }
      points.push(...(points.length ? samples.slice(1) : samples))
    }
    if (points.length < 4 || points[0].distanceTo(points.at(-1)!) > EPS) return null
    loops.push({ hole: wire.wire === 'inner', points })
  }
  if (!loops.some((loop) => !loop.hole)) return null
  const allPoints = loops.flatMap((loop) => loop.points), origin = allPoints[0]
  let normal = face.wires[0].normal && finitePoint(face.wires[0].normal) ? vec(face.wires[0].normal).normalize() : null
  if (!normal || normal.lengthSq() < .99) {
    const axis = allPoints.reduce((a, b) => a.distanceToSquared(origin) > b.distanceToSquared(origin) ? a : b).clone().sub(origin)
    normal = allPoints.map((point) => axis.clone().cross(point.clone().sub(origin)))
      .reduce((a, b) => a.lengthSq() > b.lengthSq() ? a : b).normalize()
  }
  if (normal.lengthSq() < .99 || allPoints.some((point) => Math.abs(point.clone().sub(origin).dot(normal!)) > EPS)) return null
  const components = normal.toArray().map(Math.abs), drop = components.indexOf(Math.max(...components))
  const axes = [0, 1, 2].filter((axis) => axis !== drop) as [number, number]
  return { origin, normal, axes, loops: loops.map((loop) => ({ hole: loop.hole,
    points: loop.points.map((point) => { const delta = point.clone().sub(origin)
      return new THREE.Vector2(delta.getComponent(axes[0]), delta.getComponent(axes[1])) }) })) }
}
function footprint(face?: FaceData): LegacyFaceFootprint | null {
  if (!face) return null
  if (!measuredFaces.has(face)) {
    face.footprint = face.topologyComplete === false ? null : face.wires ? modernFootprint(face) : legacyFaceFootprint(face.edges)
    measuredFaces.add(face)
  }
  return face.footprint
}

function pointInLoop(point: THREE.Vector2, polygon: THREE.Vector2[]): 'edge' | 'in' | 'out' {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], ab = b.clone().sub(a)
    const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1)
    if (a.clone().addScaledVector(ab, t).distanceTo(point) <= EPS) return 'edge'
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside ? 'in' : 'out'
}
function materialAt(point: THREE.Vector3, face: LegacyFaceFootprint): boolean {
  const delta = point.clone().sub(face.origin)
  if (Math.abs(delta.dot(face.normal)) > EPS) return false
  const flat = new THREE.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]))
  const locations = face.loops.map((loop) => ({ hole: loop.hole, where: pointInLoop(flat, loop.points) }))
  if (locations.some((item) => item.where === 'edge')) return true
  return locations.some((item) => !item.hole && item.where === 'in')
    && !locations.some((item) => item.hole && item.where === 'in')
}

/** Partition at every finite loop crossing. Endpoint probes alone would miss
 * narrow holes between samples and are never proof of a continuous corridor. */
function materialCorridor(from: THREE.Vector3, to: THREE.Vector3, face: LegacyFaceFootprint): { continuous: boolean; available: number } {
  const length = from.distanceTo(to)
  const flatten = (point: THREE.Vector3) => {
    const delta = point.clone().sub(face.origin)
    return new THREE.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]))
  }
  if (!materialAt(from, face)) return { continuous: false, available: 0 }
  if (Math.abs(to.clone().sub(face.origin).dot(face.normal)) > EPS) return { continuous: false, available: 0 }
  const a = flatten(from), b = flatten(to), direction = b.clone().sub(a)
  const cuts = [0, 1], cross = (u: THREE.Vector2, v: THREE.Vector2) => u.x * v.y - u.y * v.x
  for (const loop of face.loops) for (let i = 1; i < loop.points.length; i++) {
    const p = loop.points[i - 1], q = loop.points[i], edge = q.clone().sub(p), delta = p.clone().sub(a)
    const determinant = cross(direction, edge)
    if (Math.abs(determinant) > 1e-10) {
      const t = cross(delta, edge) / determinant, u = cross(delta, direction) / determinant
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t)
    } else if (Math.abs(cross(delta, direction)) < 1e-8) {
      for (const point of [p, q]) {
        const t = point.clone().sub(a).dot(direction) / (direction.lengthSq() || 1)
        if (t > 0 && t < 1) cuts.push(t)
      }
    }
  }
  cuts.sort((x, y) => x - y)
  for (let i = 1; i < cuts.length; i++) {
    if (!materialAt(from.clone().lerp(to, (cuts[i - 1] + cuts[i]) / 2), face))
      return { continuous: false, available: cuts[i - 1] * length }
  }
  return { continuous: materialAt(to, face), available: length }
}

/** The mouth's interior must be a void of the source plate. A rounded solid
 * bulge can also leave and return to a reference plane, but it is not a hole.
 * Partition all finite loop crossings so even a thin material bridge vetoes
 * an allegedly complete passage; boundary endpoints themselves are excluded. */
function voidMouth(from: THREE.Vector3, to: THREE.Vector3, face: LegacyFaceFootprint): boolean {
  const flatten = (point: THREE.Vector3) => { const delta = point.clone().sub(face.origin)
    return new THREE.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1])) }
  if (from.distanceTo(to) <= EPS || [from, to].some((point) => Math.abs(point.clone().sub(face.origin).dot(face.normal)) > EPS)) return false
  const a = flatten(from), b = flatten(to), direction = b.clone().sub(a), cuts = [0, 1]
  const cross = (u: THREE.Vector2, v: THREE.Vector2) => u.x * v.y - u.y * v.x
  for (const loop of face.loops) for (let i = 1; i < loop.points.length; i++) {
    const p = loop.points[i - 1], q = loop.points[i], edge = q.clone().sub(p), delta = p.clone().sub(a)
    const determinant = cross(direction, edge)
    if (Math.abs(determinant) > 1e-10) {
      const t = cross(delta, edge) / determinant, u = cross(delta, direction) / determinant
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t)
    } else if (Math.abs(cross(delta, direction)) < 1e-8) {
      for (const point of [p, q]) {
        const t = point.clone().sub(a).dot(direction) / (direction.lengthSq() || 1)
        if (t > 0 && t < 1) cuts.push(t)
      }
    }
  }
  cuts.sort((x, y) => x - y)
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] > 1e-9 && materialAt(from.clone().lerp(to, (cuts[i - 1] + cuts[i]) / 2), face)) return false
  }
  return true
}

function supported(point: THREE.Vector3, face: FaceData | undefined, part: Part | undefined,
  mesh: Float32Array): boolean | null {
  const polygon = footprint(face)
  if (polygon) return materialAt(point, polygon)
  if (!part || part.vertexCount < 3 || mesh.length < (part.vertexOffset + part.vertexCount) * 6) return null
  const tree = getPartGeometryIndex(mesh, part).tree
  const hit = tree?.closestPointToPoint(point, undefined, 0, EPS)
  return hit ? hit.distance <= EPS : false
}

interface BoundaryArm { edge: Edge; points: THREE.Vector3[]; tangent: THREE.Vector3 }
function armTangent(points: THREE.Vector3[]): THREE.Vector3 {
  const first = points[1].clone().sub(points[0]).normalize()
  if (points.length < 3) return first
  const second = points[2].clone().sub(points[1]).normalize()
  // Extrapolate the first derivative from two chord directions. This preserves
  // the tangent of a faceted relief without fitting or classifying a circle.
  if (first.dot(second) > .8) return first.clone().multiplyScalar(1.5).addScaledVector(second, -.5).normalize()
  return first
}
function armsAt(point: THREE.Vector3, edges: Edge[], translation: THREE.Vector3): BoundaryArm[] {
  const arms: BoundaryArm[] = []
  for (const edge of edges) {
    const points = edge.points.map((raw) => vec(raw).add(translation))
    let best: { distance: number; i: number; point: THREE.Vector3 } | null = null
    for (let i = 1; i < points.length; i++) {
      const nearest = new THREE.Line3(points[i - 1], points[i]).closestPointToPoint(point, true, new THREE.Vector3())
      const distance = nearest.distanceTo(point)
      if (!best || distance < best.distance) best = { distance, i, point: nearest }
    }
    if (!best || best.distance > EPS) continue
    for (const branch of [points.slice(0, best.i).reverse(), points.slice(best.i)]) {
      const samples = [best.point, ...branch.filter((p) => p.distanceTo(best!.point) > .001)]
      if (samples.length < 2) continue
      arms.push({ edge, points: samples, tangent: armTangent(samples) })
    }
  }
  return arms
}
function armChanges(arm: BoundaryArm): number {
  let maximum = 0
  for (let i = 1; i < arm.points.length; i++) {
    const direction = arm.points[i].clone().sub(arm.points[i - 1]).normalize()
    maximum = Math.max(maximum, degrees(arm.tangent, direction))
  }
  const endTangent = armTangent([...arm.points].reverse()).negate()
  maximum = Math.max(maximum, degrees(arm.tangent, endTangent))
  return maximum
}

interface BoundaryNode { point: THREE.Vector3; edges: Edge[] }
interface FaceAdjacency { nodes: BoundaryNode[]; ends: Map<Edge, [BoundaryNode, BoundaryNode]> }
const adjacencyCache = new WeakMap<FaceData, FaceAdjacency>()
function faceAdjacency(face: FaceData): FaceAdjacency {
  const saved = adjacencyCache.get(face)
  if (saved) return saved
  const nodes: BoundaryNode[] = [], ends = new Map<Edge, [BoundaryNode, BoundaryNode]>()
  const cells = new Map<string, BoundaryNode[]>()
  const cell = (point: THREE.Vector3) => point.toArray().map((value) => Math.floor(value / EPS))
  const nodeAt = (point: THREE.Vector3) => {
    const [x, y, z] = cell(point)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const node = cells.get(`${x + dx}|${y + dy}|${z + dz}`)?.find((candidate) => candidate.point.distanceTo(point) <= EPS)
      if (node) return node
    }
    const node: BoundaryNode = { point, edges: [] }, key = `${x}|${y}|${z}`, bucket = cells.get(key) ?? []
    bucket.push(node); cells.set(key, bucket); nodes.push(node)
    return node
  }
  for (const edge of face.edges) {
    const pair = [nodeAt(vec(edge.points[0])), nodeAt(vec(edge.points.at(-1)!))] as [BoundaryNode, BoundaryNode]
    pair.forEach((node) => node.edges.push(edge)); ends.set(edge, pair)
  }
  const result = { nodes, ends }
  adjacencyCache.set(face, result)
  return result
}
interface PassageBoundary { points: THREE.Vector3[]; ids: string[]; complete: boolean;
  completion?: 'corner-relief' | 'chamfer-relief' }

/** A hole can consist of several arcs/lines. Recover the whole uniquely
 * connected inner ring instead of confusing one semantic edge with one hole. */
function innerPassage(face: FaceData, first: Edge, translation: THREE.Vector3): PassageBoundary | null {
  if (first.wire !== 'inner' || !footprint(face)) return null
  const graph = faceAdjacency(face), pair = graph.ends.get(first)
  if (!pair) return null
  const start = pair[0], points = first.points.map((point) => vec(point).add(translation)), ids = [idOf(first)]
  const visited = new Set<Edge>([first])
  let current = first, node = pair[1]
  for (let count = 0; count <= face.edges.length; count++) {
    if (node.edges.filter((edge) => edge.wire === 'inner').length !== 2) return null
    if (node === start) return points.length >= 4 ? { points, ids, complete: true } : null
    const next = node.edges.filter((edge) => edge !== current && edge.wire === 'inner'
      && (!first.wireId || edge.wireId === first.wireId))
    if (next.length !== 1 || visited.has(next[0])) return null
    const edge = next[0], ends = graph.ends.get(edge)!, forward = ends[0] === node
    const samples = edge.points.map((point) => vec(point).add(translation))
    if (!forward) samples.reverse()
    if (points.at(-1)!.distanceTo(samples[0]) > EPS) return null
    points.push(...samples.slice(1)); ids.push(idOf(edge)); visited.add(edge)
    current = edge; node = ends[forward ? 1 : 0]
  }
  return null
}

/** Close an outer notch only where its real source boundary returns to the
 * same reference support plane and continues along it, ahead of the endpoint.
 * This measures the physical opening; finite mate material remains a separate
 * mandatory gate for usable wrap length/full wrap. Walking the entire outer
 * plate perimeter back to the old contact or a rear endpoint is not a hole.
 * Re-entrant openings may bulge behind the first mouth; only the first return
 * to the support plane must form a distinct forward mouth with a void chord.
 * Failed/incomplete traces leave the original local measurement untouched. */
function outerPassage(face: FaceData, arm: BoundaryArm, translation: THREE.Vector3,
  origin: THREE.Vector3, outward: THREE.Vector3, mate: LegacyFaceFootprint | null): PassageBoundary | null {
  const sourceFootprint = footprint(face)
  if (arm.edge.wire !== 'outer' || !sourceFootprint || !mate
    || Math.abs(origin.clone().sub(mate.origin).dot(mate.normal)) > EPS) return null
  const graph = faceAdjacency(face), firstPair = graph.ends.get(arm.edge)
  if (!firstPair) return null
  const originNode = graph.nodes.find((node) => node.point.distanceTo(origin.clone().sub(translation)) <= EPS)
  if (originNode && originNode.edges.filter((edge) => edge.wire === 'outer').length !== 2) return null
  const points = [arm.points[0]], ids = [idOf(arm.edge)], visited = new Set<Edge>([arm.edge])
  let leftSupport = false
  let supportSide: number | null = null, invalidCrossing = false
  const hasSecondMouth = (contact: THREE.Vector3, edge: Edge, incoming: THREE.Vector3) => {
    const onPlane = (point: THREE.Vector3) => Math.abs(point.clone().sub(mate.origin).dot(mate.normal)) <= EPS
    const raw = contact.clone().sub(translation), pair = graph.ends.get(edge)!
    const node = pair.find((candidate) => candidate.point.distanceTo(raw) <= EPS)
    if (node) {
      const next = node.edges.filter((candidate) => candidate !== edge && candidate.wire === 'outer'
        && (!arm.edge.wireId || candidate.wireId === arm.edge.wireId))
      if (next.length !== 1) return false
      const following = next[0], ends = graph.ends.get(following)!, forward = ends[0] === node
      const samples = following.points.map((point) => vec(point).add(translation))
      if (!forward) samples.reverse()
      const probe = samples.find((point) => point.distanceTo(contact) > EPS)
      return !!probe && onPlane(probe)
    }
    // A unified semantic boundary can contain both a curve and its following
    // straight lip. Check the actual forward branch, not its legacy edge type.
    const backward = incoming.clone().negate().normalize()
    return armsAt(contact, [edge], translation).some((branch) => branch.tangent.dot(backward) < .8
      && branch.points.length > 1 && branch.points[1].distanceTo(contact) > EPS && onPlane(branch.points[1]))
  }
  const append = (point: THREE.Vector3, edge: Edge): boolean => {
    const previous = points.at(-1)!, oldHeight = previous.clone().sub(mate.origin).dot(mate.normal)
    const nextHeight = point.clone().sub(mate.origin).dot(mate.normal)
    if (leftSupport && Math.abs(oldHeight) > EPS && (Math.abs(nextHeight) <= EPS || oldHeight * nextHeight < 0)) {
      const t = oldHeight / (oldHeight - nextHeight), contact = previous.clone().lerp(point, THREE.MathUtils.clamp(t, 0, 1))
      if (contact.clone().sub(origin).dot(outward) > EPS
        && hasSecondMouth(contact, edge, contact.clone().sub(previous))
        && voidMouth(origin.clone().sub(translation), contact.clone().sub(translation), sourceFootprint)) {
        points.push(contact); return true
      }
      // Stop at the first return, even when it cannot prove a second mouth.
      // Continuing along the support lip could include unrelated plate edges
      // or another opening. Intermediate backward lobes alone are harmless.
      invalidCrossing = true
      return false
    }
    if (Math.abs(nextHeight) > EPS) {
      const sign = Math.sign(nextHeight)
      if (supportSide !== null && sign !== supportSide) invalidCrossing = true
      supportSide ??= sign; leftSupport = true
    }
    if (point.distanceTo(points.at(-1)!) > .001) points.push(point)
    return false
  }
  for (const point of arm.points.slice(1)) {
    if (append(point, arm.edge)) return { points, ids, complete: true }
    if (invalidCrossing) return null
  }
  const rawEnd = arm.points.at(-1)!.clone().sub(translation)
  const endNode = firstPair.find((candidate) => candidate.point.distanceTo(rawEnd) <= EPS)
  if (!endNode) return null
  let node: BoundaryNode = endNode
  let current = arm.edge
  for (let count = 0; count < face.edges.length; count++) {
    const next: Edge[] = node.edges.filter((edge) => edge !== current && edge.wire === 'outer'
      && (!arm.edge.wireId || edge.wireId === arm.edge.wireId))
    if (next.length !== 1 || visited.has(next[0])) return null
    const edge: Edge = next[0], ends: [BoundaryNode, BoundaryNode] = graph.ends.get(edge)!, forward: boolean = ends[0] === node
    const samples = edge.points.map((point) => vec(point).add(translation))
    if (!forward) samples.reverse()
    if (points.at(-1)!.distanceTo(samples[0]) > EPS) return null
    ids.push(idOf(edge)); visited.add(edge)
    for (const point of samples.slice(1)) {
      if (append(point, edge)) return { points, ids, complete: true }
      if (invalidCrossing) return null
    }
    current = edge; node = ends[forward ? 1 : 0]
  }
  return null
}

/** An exterior corner relief can end on a different lip/support plane. Its
 * complete extent is the uniquely connected curved chain between two
 * perpendicular straight lips, rather than a return around the whole source
 * perimeter. G1 continuity is required within a split curved chain; a concave
 * corner cutout can meet the straight lips at right angles.
 * The lip extensions and the mouth chord must occupy actual void; this rejects
 * a convex solid's rounded corner even though both have perpendicular lips.
 * Only measured polylines and finite material topology are used, never arc
 * labels, radii, semantic features or an assumed neighboring plate. */
function cornerReliefPassage(face: FaceData, arm: BoundaryArm, translation: THREE.Vector3,
  origin: THREE.Vector3, outward: THREE.Vector3): PassageBoundary | null {
  const source = footprint(face)
  if (arm.edge.wire !== 'outer' || !source || arm.points.length < 3) return null
  // armsAt already projected the endpoint onto this finite CAD boundary within
  // EPS. Use that actual mouth in topology/void proofs: serialized weld points
  // can lie a few decimal places inside the support lip, creating a spurious
  // positive material interval before the otherwise complete opening.
  origin = arm.points[0]
  const graph = faceAdjacency(face), rawOrigin = origin.clone().sub(translation)
  const startNode = graph.nodes.find((node) => node.point.distanceTo(rawOrigin) <= EPS)
  const onWire = (edge: Edge) => edge.wire === 'outer' && (!arm.edge.wireId || edge.wireId === arm.edge.wireId)
  const uniquePair = (node: BoundaryNode) => node.edges.filter((edge) => edge.wire === 'outer').length === 2
  if (!startNode || !uniquePair(startNode)) return null
  const oriented = (edge: Edge, node: BoundaryNode) => {
    const pair = graph.ends.get(edge)!, points = edge.points.map((point) => vec(point).add(translation))
    if (pair[0] !== node) points.reverse()
    return points
  }
  const straight = (points: THREE.Vector3[]) => {
    const line = new THREE.Line3(points[0], points.at(-1)!)
    return line.start.distanceTo(line.end) > EPS && points.every((point) =>
      line.closestPointToPoint(point, true, new THREE.Vector3()).distanceTo(point) <= EPS)
  }
  const incoming = startNode.edges.find((edge) => edge !== arm.edge && onWire(edge))
  if (!incoming) return null
  const incomingPoints = oriented(incoming, startNode)
  const incomingDirection = incomingPoints.at(-1)!.clone().sub(origin).normalize()
  const g1 = Math.cos(5 * Math.PI / 180)
  if (!straight(incomingPoints) || incomingDirection.dot(outward) > -g1 || straight(arm.points)) return null
  const points = [...arm.points], ids = [idOf(arm.edge)], visited = new Set<Edge>([incoming, arm.edge])
  let current = arm.edge
  const endNode = graph.ends.get(current)!.find((candidate) => candidate.point.distanceTo(
    points.at(-1)!.clone().sub(translation)) <= EPS)
  if (!endNode) return null
  let node: BoundaryNode = endNode
  for (let count = 0; count < face.edges.length; count++) {
    if (!uniquePair(node)) return null
    const following: Edge[] = node.edges.filter((edge) => edge !== current && onWire(edge))
    if (following.length !== 1 || visited.has(following[0])) return null
    const edge: Edge = following[0], nextPoints = oriented(edge, node)
    const tangent = armTangent(nextPoints)
    // Use the assembled chain's terminal direction, independent of CAD edge
    // orientation; reversing the two last chords preserves faceted G1 tangency.
    const arriving = armTangent([...points].reverse()).negate()
    if (straight(nextPoints)) {
      const end = points.at(-1)!, lipDirection = nextPoints.at(-1)!.clone().sub(end).normalize()
      const firstDirection = incomingDirection.clone().negate()
      // A curved relief can continue through a finite straight bridge before
      // reaching its perpendicular lip. Keep only forward G1 continuation;
      // the final rectangle and void proofs still validate the whole chain.
      if (firstDirection.dot(lipDirection) >= g1 && arriving.dot(tangent) >= g1) {
        points.push(...nextPoints.slice(1)); ids.push(idOf(edge)); visited.add(edge)
        const pair: [BoundaryNode, BoundaryNode] = graph.ends.get(edge)!
        node = pair[0] === node ? pair[1] : pair[0]; current = edge
        continue
      }
      if (Math.abs(firstDirection.dot(lipDirection)) > Math.sin(5 * Math.PI / 180)) return null
      const normal = source.normal
      const denominator = firstDirection.clone().cross(lipDirection).dot(normal)
      if (Math.abs(denominator) < .9) return null
      const delta = end.clone().sub(origin)
      const forward = delta.clone().cross(lipDirection).dot(normal) / denominator
      const backward = delta.clone().cross(firstDirection).dot(normal) / denominator
      const corner = origin.clone().addScaledVector(firstDirection, forward)
      if (forward <= EPS || backward >= -EPS
        || corner.distanceTo(end.clone().addScaledVector(lipDirection, backward)) > EPS) return null
      const transverse = end.clone().sub(corner).normalize(), span = end.distanceTo(corner)
      // A corner relief progresses within its two lips' finite rectangle.
      // A trace with reversals or a larger lobe is a different feature, not a
      // reason to absorb long plate edges into this opening's dimensions.
      let previousU = -EPS, previousV = -EPS
      for (const point of points) {
        const relative = point.clone().sub(origin), u = relative.dot(firstDirection), v = relative.dot(transverse)
        if (u < previousU - EPS || v < previousV - EPS || u < -EPS || v < -EPS
          || u > forward + EPS || v > span + EPS) return null
        previousU = u; previousV = v
      }
      const rawEnd = end.clone().sub(translation), rawCorner = corner.clone().sub(translation)
      if (materialAt(rawCorner, source) || !voidMouth(rawOrigin, rawEnd, source)
        || !voidMouth(rawOrigin, rawCorner, source) || !voidMouth(rawEnd, rawCorner, source)) return null
      return { points, ids, complete: true, completion: 'corner-relief' }
    }
    if (nextPoints.length < 3 || arriving.dot(tangent) < g1) return null
    points.push(...nextPoints.slice(1)); ids.push(idOf(edge)); visited.add(edge)
    const pair: [BoundaryNode, BoundaryNode] = graph.ends.get(edge)!
    node = pair[0] === node ? pair[1] : pair[0]; current = edge
  }
  return null
}

/** A straight clipped corner is also a finite passage. Its two real lips must
 * meet at a missing corner, and the lip extensions plus the entire corner-to-
 * chamfer-midpoint segment must be void. The chamfer itself is material boundary,
 * so testing its endpoint chord as void would incorrectly reject every such cut.
 * Unique complete source topology prevents an arbitrary slanted side or an
 * incomplete/branching boundary from becoming a measured hole. */
function chamferPassage(face: FaceData, arm: BoundaryArm, translation: THREE.Vector3,
  origin: THREE.Vector3, outward: THREE.Vector3): PassageBoundary | null {
  const source = footprint(face)
  if (arm.edge.wire !== 'outer' || !source) return null
  // Align the proof mouth with the finite source edge, not the rounded weld
  // display coordinate. Material and complete-wire checks remain unchanged.
  origin = arm.points[0]
  const graph = faceAdjacency(face), rawOrigin = origin.clone().sub(translation)
  const startNode = graph.nodes.find((node) => node.point.distanceTo(rawOrigin) <= EPS)
  const onWire = (edge: Edge) => edge.wire === 'outer' && (!arm.edge.wireId || edge.wireId === arm.edge.wireId)
  const uniquePair = (node: BoundaryNode) => node.edges.filter((edge) => edge.wire === 'outer').length === 2
  if (!startNode || !uniquePair(startNode)) return null
  const oriented = (edge: Edge, node: BoundaryNode) => {
    const pair = graph.ends.get(edge)!, points = edge.points.map((point) => vec(point).add(translation))
    if (pair[0] !== node) points.reverse()
    return points
  }
  const straight = (points: THREE.Vector3[]) => {
    const line = new THREE.Line3(points[0], points.at(-1)!)
    return line.start.distanceTo(line.end) > EPS && points.every((point) =>
      line.closestPointToPoint(point, true, new THREE.Vector3()).distanceTo(point) <= EPS)
  }
  const incoming = startNode.edges.find((edge) => edge !== arm.edge && onWire(edge))
  if (!incoming || !straight(arm.points)) return null
  const incomingPoints = oriented(incoming, startNode)
  const incomingDirection = incomingPoints.at(-1)!.clone().sub(origin).normalize()
  const g1 = Math.cos(5 * Math.PI / 180)
  if (!straight(incomingPoints) || incomingDirection.dot(outward) > -g1) return null
  const firstDirection = incomingDirection.clone().negate(), points = [...arm.points]
  const ids = [idOf(arm.edge)], visited = new Set<Edge>([incoming, arm.edge])
  let current = arm.edge
  const endNode = graph.ends.get(current)!.find((candidate) => candidate.point.distanceTo(
    points.at(-1)!.clone().sub(translation)) <= EPS)
  if (!endNode) return null
  let node: BoundaryNode = endNode
  for (let count = 0; count < face.edges.length; count++) {
    if (!uniquePair(node)) return null
    const following: Edge[] = node.edges.filter((edge) => edge !== current && onWire(edge))
    if (following.length !== 1 || visited.has(following[0])) return null
    const edge: Edge = following[0], nextPoints = oriented(edge, node)
    if (!straight(nextPoints)) return null
    const end = points.at(-1)!, lipDirection = nextPoints.at(-1)!.clone().sub(end).normalize()
    const chamferDirection = end.clone().sub(origin).normalize()
    // A CAD export may split a straight chamfer into several collinear edges.
    // Follow only that line, ending before the distinct perpendicular lip.
    if (lipDirection.dot(chamferDirection) > g1
      && straight([...points, ...nextPoints.slice(1)])) {
      points.push(...nextPoints.slice(1)); ids.push(idOf(edge)); visited.add(edge)
      const pair: [BoundaryNode, BoundaryNode] = graph.ends.get(edge)!
      node = pair[0] === node ? pair[1] : pair[0]; current = edge
      continue
    }
    if (Math.abs(firstDirection.dot(lipDirection)) > Math.sin(5 * Math.PI / 180)) return null
    const denominator = firstDirection.clone().cross(lipDirection).dot(source.normal)
    if (Math.abs(denominator) < .9) return null
    const delta = end.clone().sub(origin)
    const forward = delta.clone().cross(lipDirection).dot(source.normal) / denominator
    const backward = delta.clone().cross(firstDirection).dot(source.normal) / denominator
    const corner = origin.clone().addScaledVector(firstDirection, forward)
    if (forward <= EPS || backward >= -EPS
      || corner.distanceTo(end.clone().addScaledVector(lipDirection, backward)) > EPS) return null
    const rawCorner = corner.clone().sub(translation), rawEnd = end.clone().sub(translation)
    const rawMidpoint = rawOrigin.clone().lerp(rawEnd, .5)
    if (materialAt(rawCorner, source) || !voidMouth(rawOrigin, rawCorner, source)
      || !voidMouth(rawEnd, rawCorner, source) || !voidMouth(rawCorner, rawMidpoint, source)) return null
    return { points, ids, complete: true, completion: 'chamfer-relief' }
  }
  return null
}
function shortPoints(arm: BoundaryArm, maxDistance: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [], origin = arm.points[0]
  let distance = 0
  for (let i = 1; i < arm.points.length && distance < maxDistance; i++) {
    const length = arm.points[i].distanceTo(arm.points[i - 1])
    if (length < .001) continue
    points.push(arm.points[i - 1].clone().lerp(arm.points[i], Math.min(1, (maxDistance - distance) / length)))
    distance += length
  }
  if (!points.length) points.push(origin)
  return points
}

function thickness(weld: Weld, side: 'main' | 'sub', parts: PartsData): number | null {
  const raw = weld.properties.厚度, values = record(raw)
  const declared = values[side === 'main' ? '主板厚度' : '副板厚度'] ?? (side === 'sub' ? raw : undefined)
  const value = typeof declared === 'number' ? declared
    : parts.parts.find((part) => part.id === (side === 'main' ? weld.mainPartId : weld.subPartId))?.thickness
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
function axialDistance(weld: Weld, which: 'start' | 'end', edges?: EdgesData | null): number | null {
  const gap = record(weld.properties.间隙检测)
  const groups = edges ? computeAxialDetection(weld, edges) : gap.extend ?? gap.沿轴线方向
  const label = which === 'start' ? '起点' : '终点'
  const distances = Object.values(record(groups)).flatMap((group) => Object.entries(record(group))
    .flatMap(([key, value]) => key.startsWith(label) && key.includes('距离') && typeof value === 'number'
      && Number.isFinite(value) && value >= 0 ? [value] : []))
  return distances.length ? Math.min(...distances) : null
}
const boxes = new WeakMap<PartsData, Map<Part, THREE.Box3>>()
function thirdPartBoundary(weld: Weld, point: THREE.Vector3, direction: THREE.Vector3,
  parts: PartsData, mesh: Float32Array, threshold?: number | null) {
  if (threshold === null || threshold === undefined || !Number.isFinite(threshold) || threshold <= 0) return null
  let index = boxes.get(parts)
  if (!index) {
    index = new Map(parts.parts.map((part) => [part, new THREE.Box3(vec(part.bbox.min), vec(part.bbox.max))]))
    boxes.set(parts, index)
  }
  const ray = new THREE.Ray(point, direction), hitAt = new THREE.Vector3()
  let closest: { partId: string; distance: number } | null = null
  let nearestDistance = threshold
  for (const part of parts.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId || part.vertexCount < 3) continue
    const box = index.get(part)!
    if (!ray.intersectBox(box, hitAt) || !box.containsPoint(point)
      && hitAt.distanceTo(point) >= nearestDistance) continue
    const hit = getPartGeometryIndex(mesh, part).tree?.raycastFirst(ray, THREE.DoubleSide, 0, nearestDistance)
    if (hit && hit.distance >= 0 && hit.distance < nearestDistance) {
      nearestDistance = hit.distance
      closest = { partId: part.id, distance: hit.distance }
    }
  }
  return closest
}

function summarize(info: UnifiedEndpointInfo): string {
  const mm = (value: number | null) => value === null ? '未确认' : `${Math.round(value * 100) / 100}mm`
  return `轴向余量 ${mm(info.axialClearanceMm)}；开口宽/高 ${mm(info.openingWidthMm)}/${mm(info.openingHeightMm)}；可绕行 ${mm(info.wrapAvailableMm)}；两侧连通 ${info.sidesConnected === null ? '未确认' : info.sidesConnected ? '是' : '否'}；转角 ${info.turnAngleDeg === null ? '未确认' : `${Math.round(info.turnAngleDeg * 100) / 100}°`}；第三零件 ${info.thirdPartClearance ? `${info.thirdPartClearance.partId} ${mm(info.thirdPartClearance.distance)}` : info.axialInspectionMm === null ? '轴向查询未启用' : '阈值内未发现'}${info.sourceMaterialClearance ? `；接头板 ${info.sourceMaterialClearance.partId} 在空域后 ${mm(info.sourceMaterialClearance.distance)} 回入材料` : ''}${info.wrapBlockingPart ? `；包角方向被 ${info.wrapBlockingPart.partId} 阻断于 ${mm(info.wrapBlockingPart.distance)}` : ''}${info.openingBoundaryClearance ? `；让位边界到 ${info.openingBoundaryClearance.partId} 的外向余量 ${mm(info.openingBoundaryClearance.distance)}` : ''}${info.sourceOpeningEnvelope ? `；源板槽包络 ${mm(info.sourceOpeningEnvelope.widthMm)}/${mm(info.sourceOpeningEnvelope.heightMm)}（不用于过焊孔尺寸）` : ''}`
}

/** All coordinates are measured in the existing planning frame. A verified
 * collar projection is used only for its own source boundary, never for mesh
 * positions, third parts or arbitrary nearby plates. */
function measure(weld: Weld, which: 'start' | 'end', parts: PartsData,
  mesh: Float32Array, edges?: EdgesData | null, options: EndpointClearanceOptions = {}): UnifiedEndpointInfo {
  const side = endpointWrapSide(weld, which), sample = endpointSample(weld, parts, mesh, which)
  const info: UnifiedEndpointInfo = { version: 1, status: 'unknown', kind: 'unknown', geometryConnection: 'unknown',
    boundaryShape: 'unknown', axialClearanceMm: options.axialClearanceMm !== undefined ? options.axialClearanceMm
      : axialDistance(weld, which, edges), openingWidthMm: null, openingHeightMm: null,
    wrapAvailableMm: null, sidesConnected: null, turnAngleDeg: null, boundaryTangent: null,
    wrapSide: side, thicknessMm: thickness(weld, side, parts), thirdPartClearance: null,
    axialInspectionMm: typeof options.extendThreshold === 'number' && Number.isFinite(options.extendThreshold)
      && options.extendThreshold > 0 ? options.extendThreshold : null,
    basis: [], sourceBoundaryIds: [], summary: '' }
  if (!sample) { info.basis.push('焊缝端点缺少有限切向'); info.summary = summarize(info); return info }
  const directions = endpointWrapDirections(sample, which, side), { outward, wrapDir } = directions
  info.thirdPartClearance = thirdPartBoundary(weld, sample.pos, outward, parts, mesh, options.extendThreshold)
  if (!edges?.edges.length) { info.basis.push('缺少 CAD 边界折线，不能证明端部开口及两侧连通'); info.summary = summarize(info); return info }
  const index = boundaryIndex(edges)
  const projection = record(weld.properties['投影搭接']), policy = collarGapPlanning(weld)
  // A finite projected lap follows the source plate's contour, even when the
  // legacy endpoint association names the host face. Only verified planning
  // evidence authorizes this change of boundary frame.
  const projectedContour = policy?.source === '投影搭接' && Number.isInteger(projection.sourceFaceIndex)
    && typeof projection.sourcePartId === 'string' && typeof projection.hostPartId === 'string'
  const selectedId = projectedContour ? String(projection.sourcePartId) : side === 'main' ? weld.mainPartId : weld.subPartId
  const selectedFace = projectedContour ? Number(projection.sourceFaceIndex) : side === 'main' ? weld.mainFaceIndex : weld.subFaceIndex
  const otherId = projectedContour ? String(projection.hostPartId) : side === 'main' ? weld.subPartId : weld.mainPartId
  const otherFace = projectedContour ? Number(projection.hostFaceIndex) : side === 'main' ? weld.subFaceIndex : weld.mainFaceIndex
  const other = index.faces.get(`${otherId}|${otherFace}`), otherPart = parts.parts.find((part) => part.id === otherId)
  const selected = index.faces.get(`${selectedId}|${selectedFace}`)
  const translation = policy?.source === '投影搭接' && selectedId === policy.sourcePartId && finitePoint(projection.projectionVector)
    ? vec(projection.projectionVector) : new THREE.Vector3()
  const arms = armsAt(sample.pos, selected?.edges ?? [], translation)
  const probeDistance = Math.max(1, Math.min(info.thicknessMm ?? 10, 10))
  // G1 continuation must stay on the finite mate support; a relief which lifts
  // away from the host plane is an opening even when its initial tangent is G1.
  const matePolygon = footprint(other)
  const continuous = arms.filter((arm) => {
    if (arm.tangent.dot(outward) < Math.cos(5 * Math.PI / 180)) return false
    const probes = shortPoints(arm, probeDistance)
    if (matePolygon) {
      let previous = sample.pos
      for (const point of probes) {
        if (!materialCorridor(previous, point, matePolygon).continuous) return false
        previous = point
      }
      return true
    }
    // Isolated mesh probes cannot prove continuous contact through an unseen
    // narrow opening. Retain unknown continuity until a finite face loop exists.
    return false
  })
  if (continuous.length === 1) {
    info.status = 'verified'; info.kind = 'interior'; info.geometryConnection = 'continuous'
    info.boundaryShape = armChanges(continuous[0]) > 3 ? 'relief' : 'straight'
    info.turnAngleDeg = 0; info.boundaryTangent = continuous[0].tangent.toArray()
    info.sourceBoundaryIds = [idOf(continuous[0].edge)]
    info.basis.push('实际边界沿焊缝外切向连续，且连续部分仍在另一接头板的有限支撑面上')
    info.summary = summarize(info); return info
  }
  const turning = arms.filter((arm) => arm.tangent.dot(outward) > -.8
    && degrees(arm.tangent, outward) > 5)
    .sort((a, b) => b.tangent.dot(outward) - a.tangent.dot(outward))
  const boundary = turning[0] ?? arms.find((arm) => arm.tangent.dot(outward) > .8)
  if (!boundary) {
    const hostSupport = supported(sample.pos, selected, parts.parts.find((part) => part.id === selectedId), mesh)
    if (hostSupport) { info.status = 'partial'; info.kind = 'interior'; info.basis.push('端点在有限板面内部，没有确认的绕行边界') }
    else info.basis.push('端点不在可核验的有限 CAD 边界上')
    info.summary = summarize(info); return info
  }
  const curvedRelief = armChanges(boundary) > 3 || boundary.edge.wire === 'inner'
  const straightPassage = !curvedRelief && selected
    ? chamferPassage(selected, boundary, translation, sample.pos, outward) : null
  const relief = curvedRelief || !!straightPassage
  info.status = footprint(selected) ? 'verified' : 'partial'
  info.kind = relief ? 'opening' : 'free-edge'; info.geometryConnection = 'turn'
  info.boundaryShape = relief ? 'relief' : 'straight'
  info.boundaryTangent = boundary.tangent.toArray()
  info.turnAngleDeg = Math.min(180, Math.max(degrees(outward, boundary.tangent), relief ? armChanges(boundary) : 0))
  info.sourceBoundaryIds = [idOf(boundary.edge)]
  // Internal/G1 contact points return above; only exposed endpoints need the
  // complete source-material query. This avoids rescanning large host loops at
  // every ordinary path join during geometric preprocessing.
  for (const [partId, faceIndex, face, shift] of [
    [selectedId, selectedFace, selected, translation],
    [otherId, otherFace, other, new THREE.Vector3()],
  ] as const) {
    const polygon = footprint(face)
    if (!polygon) continue
    const distance = firstSourceMaterialReentry(sample.pos.clone().sub(shift), outward, polygon, options.extendThreshold)
    if (distance !== null && (!info.sourceMaterialClearance || distance < info.sourceMaterialClearance.distance))
      info.sourceMaterialClearance = { partId, faceIndex, distance }
  }
  info.basis.push(relief ? '端部真实边界折线转出接触面并发生方向变化，构成让位开口'
    : '端部真实边界为转出焊缝接触方向的直边')
  if (relief) {
    const corner = selected ? cornerReliefPassage(selected, boundary, translation, sample.pos, outward) : null
    const outer = selected ? outerPassage(selected, boundary, translation, sample.pos, outward, matePolygon) : null
    const passage = selected ? innerPassage(selected, boundary.edge, translation) ?? corner ?? straightPassage ?? outer : null
    const measuredBoundary = passage?.points ?? boundary.points
    const height = directions.normal.clone().cross(outward).normalize()
    const widthCoordinates = measuredBoundary.map((point) => point.clone().sub(sample.pos).dot(outward))
    const heightCoordinates = measuredBoundary.map((point) => point.clone().sub(sample.pos).dot(height))
    info.openingWidthMm = Math.max(...widthCoordinates) - Math.min(...widthCoordinates)
    info.openingHeightMm = Math.max(...heightCoordinates) - Math.min(...heightCoordinates)
    info.openingMeasurementScope = passage?.complete ? 'complete' : 'local'
    info.openingBoundaryIds = passage?.ids ?? [idOf(boundary.edge)]
    info.openingBoundaryPoints = measuredBoundary.map((point) => point.toArray())
    const boundaryClearance = measureOpeningBoundaryInterference(weld, measuredBoundary, outward, parts, mesh, options.extendThreshold)
    if (boundaryClearance) {
      info.openingBoundaryClearance = boundaryClearance
      info.basis.push(`按让位边链的完整有限条带检查第三零件，${boundaryClearance.partId} 外向余量 ${Math.round(boundaryClearance.distance * 100) / 100}mm；该余量与过焊孔几何尺寸分别记录`)
    }
    if (outer && passage !== outer && outer.ids.length > (passage?.ids.length ?? 0)) {
      const widths = outer.points.map(point => point.clone().sub(sample.pos).dot(outward))
      const heights = outer.points.map(point => point.clone().sub(sample.pos).dot(height))
      info.sourceOpeningEnvelope = { widthMm: Math.max(...widths) - Math.min(...widths),
        heightMm: Math.max(...heights) - Math.min(...heights), boundaryIds: [...outer.ids],
        boundaryPoints: outer.points.map(point => point.toArray()) }
      info.basis.push('源板复合槽的完整外包络独立保留；工艺孔尺寸采用两条实际直唇之间的有限端部让位区')
    }
    info.sourceBoundaryIds = [...new Set([...info.sourceBoundaryIds, ...info.openingBoundaryIds])]
    if (passage?.complete) {
      info.basis.push(`完整过焊孔由 ${passage.ids.length} 条真实邻接 CAD 边界构成；${boundary.edge.wire === 'inner'
        ? '闭合孔环完整返回起点' : passage.completion === 'corner-relief'
          ? '角部让位曲线在两条相互垂直的实际直边之间完整连接，边延长交点与口部均为真实空域'
          : passage.completion === 'chamfer-relief'
            ? '直线斜切边在两条相互垂直的实际直边之间完整连接，延长交点及三角切口均为真实空域'
          : '另一口部返回同一接头参考平面并沿源板实际边界延续'}；宽高取完整边链的几何投影跨度，有限焊接支撑另行校验`)
    } else info.basis.push('完整口部或闭合孔环未得到证明；宽高仅取当前邻接让位边界的局部投影跨度')
  }
  if (info.thicknessMm) {
    const opposite = sample.pos.clone().addScaledVector(wrapDir, info.thicknessMm)
    const oppositeArms = armsAt(opposite, (index.parts.get(selectedId) ?? []).filter((edge) => edge.faceIndex !== selectedFace), translation)
      .filter((arm) => Math.abs(arm.tangent.dot(boundary.tangent)) > .98)
    const selectedFootprint = footprint(selected)
    const counterpart = oppositeArms.find((arm) => {
      const opposingFootprint = footprint(index.faces.get(`${selectedId}|${arm.edge.faceIndex}`))
      if (!selectedFootprint || !opposingFootprint || Math.abs(selectedFootprint.normal.dot(opposingFootprint.normal)) < .99
        || Math.abs(selectedFootprint.normal.dot(wrapDir)) < .99) return false
      const planeSeparation = Math.abs(opposingFootprint.origin.clone().sub(selectedFootprint.origin).dot(wrapDir))
      return Math.abs(planeSeparation - info.thicknessMm!) <= Math.max(EPS, info.thicknessMm! * .001)
    })
    const supportAtStart = supported(sample.pos, other, otherPart, mesh)
    const supportAtEnd = supported(opposite, other, otherPart, mesh)
    const mateFootprint = footprint(other)
    const corridor = mateFootprint ? materialCorridor(sample.pos, opposite, mateFootprint) : null
    const probes = corridor ? [] : [0, .25, .5, .75, 1].map((t) => supported(sample.pos.clone()
      .addScaledVector(wrapDir, info.thicknessMm! * t), other, otherPart, mesh))
    if (counterpart && selectedFootprint && corridor?.continuous) {
      info.wrapAvailableMm = info.thicknessMm; info.sidesConnected = !relief
      info.sourceBoundaryIds.push(idOf(counterpart.edge))
      info.basis.push(relief ? '板厚横向有对应让位边界，但开口折回，不视为直边全包连通'
        : '板厚对面有对应完整直边，整段仍受另一接头板支撑，证明两侧连通')
    } else if (corridor && !corridor.continuous) {
      info.wrapAvailableMm = corridor.available; info.sidesConnected = false
      info.basis.push('按全部边界交点分区，沿板厚绕行段存在缺失支撑的有限区间')
    } else if (probes.some((value) => value === false)) {
      const firstMissing = probes.findIndex((value) => value === false)
      info.wrapAvailableMm = Math.max(0, (firstMissing - 1) / 4 * info.thicknessMm)
      info.sidesConnected = false
      info.basis.push('沿板厚方向的实际绕行段离开另一接头板的有限支撑')
    } else {
      // The local boundary proves a possible half wrap, but not a complete
      // traversal: missing topology is represented as unknown, never as full.
      info.sidesConnected = relief ? false : null
      if (corridor?.continuous || !mateFootprint && supportAtStart === true && supportAtEnd === true && probes.every((value) => value === true))
        info.wrapAvailableMm = info.thicknessMm
      info.basis.push('对面边界或完整拓扑证据不足，不能证明全包连通')
    }
    // This is occupancy of the finite TCP line, independent of any gun mesh or
    // robot envelope. It cannot borrow the outward-extend result because the
    // two rays are generally perpendicular.
    const wrapBlock = thirdPartBoundary(weld, sample.pos, wrapDir, parts, mesh, info.thicknessMm + EPS)
    if (wrapBlock && wrapBlock.distance < info.thicknessMm - EPS) {
      info.wrapBlockingPart = wrapBlock
      info.wrapAvailableMm = Math.min(info.wrapAvailableMm ?? wrapBlock.distance, wrapBlock.distance)
      info.sidesConnected = false
      info.basis.push(`包角方向被第三零件 ${wrapBlock.partId} 在 ${Math.round(wrapBlock.distance * 100) / 100}mm 阻断`)
    }
  }
  info.summary = summarize(info)
  return info
}

interface MeasurementCache { parts: PartsData; mesh: Float32Array; edges?: EdgesData | null;
  key: string; info: UnifiedEndpointInfo }
const measurements = new WeakMap<Weld, MeasurementCache[]>()

/** The loaded geometric objects are immutable. Bounded entries isolate each
 * model/layout/threshold and avoid repeated CAD indexing or BVH endpoint scans. */
export function measureEndpointClearance(weld: Weld, which: 'start' | 'end', parts: PartsData,
  mesh: Float32Array, edges?: EdgesData | null, options: EndpointClearanceOptions = {}): UnifiedEndpointInfo {
  const key = `${which}|${weld.start.join(',')}|${weld.end.join(',')}|${endpointWrapSide(weld, which)}|${thickness(weld, endpointWrapSide(weld, which), parts)}|${options.extendThreshold ?? 'off'}|${options.axialClearanceMm === undefined ? 'calculate' : options.axialClearanceMm}`
  const cache = measurements.get(weld) ?? []
  const saved = cache.find((item) => item.key === key && item.parts === parts && item.mesh === mesh && item.edges === edges)
  if (saved) return saved.info
  const info = measure(weld, which, parts, mesh, edges, options)
  cache.push({ parts, mesh, edges, key, info })
  if (cache.length > 8) cache.shift()
  measurements.set(weld, cache)
  return info
}
