import { Vector3 } from 'three'
import type { BoundaryWire, Edge, EdgesData } from '@/types/weld'
import { FINITE_INTERVAL_JOIN_TOLERANCE } from './weldMerge'

export interface GeometryWrapBoundaryProof {
  partId: string
  faceIndex: number
  wireId: string
  boundaryIds: string[]
  /** Only source boundaries traversed by the proved local connector. */
  pathBoundaryIds?: string[]
}
export interface GeometryWrapBoundaryResult {
  ok: boolean
  reason: string
  points?: number[][]
  proof?: GeometryWrapBoundaryProof
}
const tolerance = FINITE_INTERVAL_JOIN_TOLERANCE
const vector = (point: number[]) => new Vector3().fromArray(point)
const distance = (a: number[], b: number[]) => vector(a).distanceTo(vector(b))
const finitePoint = (point: unknown): point is number[] => Array.isArray(point)
  && point.length === 3 && point.every(Number.isFinite)
const length = (points: number[][]) => points.slice(1).reduce((sum, point, index) => sum + distance(point, points[index]), 0)
interface BoundaryIndex {
  wires: Map<string, BoundaryWire[]>
  edges: Map<string, Edge[]>
  rings: Map<BoundaryWire, number[][] | null>
}
const boundaryIndexes = new WeakMap<EdgesData, BoundaryIndex>()
const wireKey = (value: Pick<BoundaryWire, 'partId' | 'faceIndex' | 'wireId'>) =>
  JSON.stringify([value.partId, value.faceIndex, value.wireId])
function boundaryIndex(data: EdgesData): BoundaryIndex {
  const existing = boundaryIndexes.get(data)
  if (existing) return existing
  const index: BoundaryIndex = { wires: new Map(), edges: new Map(), rings: new Map() }
  let wires = data.wires ?? [], edges = data.edges
  if (!wires.length && data.boundaryRecognitionVersion !== 1) {
    // Legacy CAD exports have one labelled outer ring per face but no semantic
    // wire IDs. Infer identity only; ringForWire still proves the entire finite
    // degree-two cycle before any path can be used. Explicit incomplete modern
    // wires are never upgraded this way.
    const legacy = new Map<string, Edge[]>()
    for (const edge of edges) {
      if (edge.wire !== 'outer') continue
      const wireId = edge.wireId ?? `cad-outer:${edge.partId}:${edge.faceIndex}`
      const normalized = { ...edge, wireId, boundaryId: edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}` }
      const key = wireKey(normalized), items = legacy.get(key)
      if (items) items.push(normalized)
      else legacy.set(key, [normalized])
    }
    edges = [...legacy.values()].flat()
    wires = [...legacy.values()].map(items => ({ partId: items[0].partId, faceIndex: items[0].faceIndex,
      wireId: items[0].wireId!, boundaryIds: items.map(edge => edge.boundaryId!), wire: 'outer', closed: true, topologyComplete: true }))
  }
  for (const wire of wires) index.wires.set(wire.partId, [...index.wires.get(wire.partId) ?? [], wire])
  for (const edge of edges) {
    const key = wireKey({ ...edge, wireId: edge.wireId ?? '' })
    const items = index.edges.get(key)
    if (items) items.push(edge)
    else index.edges.set(key, [edge])
  }
  boundaryIndexes.set(data, index)
  return index
}

export function sanitizeGeometryWrapBoundaryProof(value: unknown): GeometryWrapBoundaryProof | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<GeometryWrapBoundaryProof>
  if (typeof input.partId !== 'string' || !input.partId || typeof input.wireId !== 'string' || !input.wireId
    || !Number.isInteger(input.faceIndex) || input.faceIndex! < 0 || !Array.isArray(input.boundaryIds)
    || input.boundaryIds.length < 2 || input.boundaryIds.some(id => typeof id !== 'string' || !id)
    || new Set(input.boundaryIds).size !== input.boundaryIds.length) return null
  const pathBoundaryIds = Array.isArray(input.pathBoundaryIds) && input.pathBoundaryIds.length > 0
    && input.pathBoundaryIds.every(id => typeof id === 'string' && input.boundaryIds!.includes(id))
    ? [...new Set(input.pathBoundaryIds)] : undefined
  return { partId: input.partId, wireId: input.wireId, faceIndex: input.faceIndex!, boundaryIds: [...input.boundaryIds],
    ...(pathBoundaryIds ? { pathBoundaryIds } : {}) }
}

/** Recover one complete CAD ring. A wire label alone cannot prove continuity:
 * every finite edge must participate once, with degree two at every vertex. */
function ringForWire(wire: BoundaryWire, all: Edge[]): number[][] | null {
  const ids = new Set(wire.boundaryIds)
  if (ids.size !== wire.boundaryIds.length) return null
  const edges = all.filter(edge => edge.partId === wire.partId && edge.faceIndex === wire.faceIndex
    && edge.wireId === wire.wireId && edge.boundaryId && ids.has(edge.boundaryId))
  if (edges.length !== ids.size || new Set(edges.map(edge => edge.boundaryId)).size !== ids.size
    || edges.some(edge => edge.wire !== 'outer' || !finitePoint(edge.start) || !finitePoint(edge.end)
      || edge.points.length < 2 || !edge.points.every(finitePoint)
      || length(edge.points) <= tolerance || distance(edge.start, edge.points[0]) > tolerance
      || distance(edge.end, edge.points.at(-1)!) > tolerance)) return null
  const nodes: { point: number[]; edges: number[] }[] = []
  const ends = edges.map((edge, index) => [edge.points[0], edge.points.at(-1)!].map(point => {
    let node = nodes.find(item => distance(item.point, point) <= tolerance)
    if (!node) { node = { point, edges: [] }; nodes.push(node) }
    node.edges.push(index)
    return node
  }))
  if (nodes.some(node => node.edges.length !== 2)) return null
  const visited = new Set<number>(), points: number[][] = []
  let edgeIndex = 0, entry = ends[0][0]
  while (!visited.has(edgeIndex)) {
    visited.add(edgeIndex)
    const forward = ends[edgeIndex][0] === entry
    const path = forward ? edges[edgeIndex].points : [...edges[edgeIndex].points].reverse()
    points.push(...(points.length ? path.slice(1) : path).map(point => point.slice()))
    entry = ends[edgeIndex][forward ? 1 : 0]
    edgeIndex = entry.edges.find(index => index !== edgeIndex)!
  }
  const origin = vector(points[0])
  const area = points.slice(1).reduce((sum, point, index) =>
    sum.add(vector(points[index]).sub(origin).cross(vector(point).sub(origin))), new Vector3())
  return visited.size === edges.length && distance(points[0], points.at(-1)!) <= tolerance
    && area.length() > tolerance * tolerance ? points : null
}

function project(points: number[][], point: number[]) {
  let along = 0, best = { distance: Infinity, along: 0 }
  for (let index = 1; index < points.length; index++) {
    const a = vector(points[index - 1]), ab = vector(points[index]).sub(a), segmentLength = ab.length()
    const fraction = segmentLength ? Math.max(0, Math.min(1, vector(point).sub(a).dot(ab) / ab.lengthSq())) : 0
    const gap = a.addScaledVector(ab, fraction).distanceTo(vector(point))
    if (gap < best.distance) best = { distance: gap, along: along + fraction * segmentLength }
    along += segmentLength
  }
  return best
}
function pointAt(points: number[][], at: number): number[] {
  let along = 0
  for (let index = 1; index < points.length; index++) {
    const segmentLength = distance(points[index - 1], points[index])
    if (along + segmentLength >= at) return vector(points[index - 1]).lerp(vector(points[index]),
      segmentLength ? Math.max(0, Math.min(1, (at - along) / segmentLength)) : 0).toArray()
    along += segmentLength
  }
  return points.at(-1)!.slice()
}
function slice(points: number[][], from: number, to: number): number[][] {
  const output = [pointAt(points, from)]
  let along = 0
  for (let index = 1; index < points.length; index++) {
    along += distance(points[index - 1], points[index])
    if (along > from + 1e-8 && along < to - 1e-8) output.push(points[index].slice())
  }
  output.push(pointAt(points, to))
  return output
}

/** Only local, actual outer-wire paths at the exposed end can connect T sides.
 * No inferred chord, extended ray, faceted semicircle or inner-hole edge is used. */
export function findGeometryWrapBoundaryPath(from: number[], to: number[], outward: number[],
  partIds: readonly string[], data: EdgesData | null | undefined,
  requiredProof?: GeometryWrapBoundaryProof): GeometryWrapBoundaryResult {
  const fail = (reason: string): GeometryWrapBoundaryResult => ({ ok: false, reason })
  if (![from, to, outward].every(finitePoint) || vector(outward).lengthSq() < 1e-12)
    return fail('端部方向或坐标无效，不能生成全包连接。')
  const direction = vector(outward).normalize(), gap = distance(from, to)
  if (Math.abs(vector(to).sub(vector(from)).dot(direction)) > tolerance)
    return fail('左右侧端点不在同一实际板端，不能跨板连接。')
  if (!data) return fail('缺少完整 CAD 外边界环，不能自动生成全包连接。')
  const index = boundaryIndex(data)
  if (!index.wires.size) return fail('缺少完整 CAD 外边界环，不能自动生成全包连接。')
  const candidates: { points: number[][]; proof: GeometryWrapBoundaryProof }[] = []
  for (const wire of [...new Set(partIds)].flatMap(partId => index.wires.get(partId) ?? [])) {
    if (!partIds.includes(wire.partId) || wire.wire !== 'outer' || !wire.closed || wire.topologyComplete !== true) continue
    if (requiredProof && (wire.partId !== requiredProof.partId || wire.faceIndex !== requiredProof.faceIndex
      || wire.wireId !== requiredProof.wireId || JSON.stringify([...wire.boundaryIds].sort())
        !== JSON.stringify([...requiredProof.boundaryIds].sort()))) continue
    if (!index.rings.has(wire)) index.rings.set(wire, ringForWire(wire, index.edges.get(wireKey(wire)) ?? []))
    const ring = index.rings.get(wire)
    if (!ring) continue
    const start = project(ring, from), end = project(ring, to)
    if (start.distance > tolerance || end.distance > tolerance) continue
    const low = Math.min(start.along, end.along), high = Math.max(start.along, end.along), total = length(ring)
    const paths = [slice(ring, low, high), [...slice(ring, high, total), ...slice(ring, 0, low).slice(1)]]
    for (const [pathIndex, path] of paths.entries()) {
      const reverse = pathIndex === 0 ? start.along > end.along : start.along < end.along
      const points = reverse ? path.reverse() : path
      points[0] = from.slice(); points[points.length - 1] = to.slice()
      // A whole far-away perimeter is not an end-local wrap. A local rounded
      // edge can be longer than its chord, but cannot detour around the plate.
      if (length(points) > 2 * gap + tolerance || points.some(point =>
        vector(point).sub(vector(from)).dot(direction) < -tolerance)) continue
      const pathBoundaryIds = new Set<string>()
      for (let segment = 1; segment < points.length; segment++) {
        if (distance(points[segment - 1], points[segment]) <= tolerance) continue
        const middle = vector(points[segment - 1]).lerp(vector(points[segment]), .5).toArray()
        const matching = (index.edges.get(wireKey(wire)) ?? []).find(edge => edge.boundaryId
          && [points[segment - 1], middle, points[segment]].every(point => project(edge.points, point).distance <= tolerance))
        if (!matching?.boundaryId) { pathBoundaryIds.clear(); break }
        pathBoundaryIds.add(matching.boundaryId)
      }
      if (!pathBoundaryIds.size) continue
      candidates.push({ points, proof: { partId: wire.partId, faceIndex: wire.faceIndex,
        wireId: wire.wireId, boundaryIds: [...wire.boundaryIds], pathBoundaryIds: [...pathBoundaryIds] } })
    }
  }
  candidates.sort((a, b) => length(a.points) - length(b.points))
  const first = candidates[0]
  return first ? { ok: true, reason: '已确认同一完整 CAD 外边界上的有限端部连接。', ...first }
    : fail('未找到同一完整 CAD 外边界上的局部端部连接，不能自动合并左右侧；请保留独立焊道。')
}

/** The bridge belongs to this actual CAD face, rather than either original
 * side face. Return a normal only for a proved planar ring; curved surface
 * normals cannot be invented from its tessellation. */
export function geometryWrapBoundaryFaceNormal(value: GeometryWrapBoundaryProof,
  data: EdgesData | null | undefined, outward: number[]): number[] | null {
  const proof = sanitizeGeometryWrapBoundaryProof(value)
  if (!proof || !data || !finitePoint(outward) || vector(outward).lengthSq() < 1e-12) return null
  const index = boundaryIndex(data), wire = (index.wires.get(proof.partId) ?? []).find(item =>
    item.faceIndex === proof.faceIndex && item.wireId === proof.wireId && item.closed && item.topologyComplete === true
      && JSON.stringify([...item.boundaryIds].sort()) === JSON.stringify([...proof.boundaryIds].sort()))
  if (!wire) return null
  if (!index.rings.has(wire)) index.rings.set(wire, ringForWire(wire, index.edges.get(wireKey(wire)) ?? []))
  const ring = index.rings.get(wire)
  if (!ring) return null
  const origin = vector(ring[0]), normal = ring.slice(1).reduce((sum, point, pointIndex) =>
    sum.add(vector(ring[pointIndex]).sub(origin).cross(vector(point).sub(origin))), new Vector3()).normalize()
  if (normal.lengthSq() < 1e-12 || ring.some(point => Math.abs(vector(point).sub(origin).dot(normal)) > tolerance)) return null
  const direction = vector(outward).normalize()
  if (Math.abs(normal.dot(direction)) < 1e-6) return null
  if (normal.dot(direction) < 0) normal.negate()
  return normal.toArray()
}
