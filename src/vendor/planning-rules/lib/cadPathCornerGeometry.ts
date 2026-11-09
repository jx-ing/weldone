import type { BoundaryWire, Edge, EdgesData, Weld } from '@/types/weld'
import { FINITE_INTERVAL_JOIN_TOLERANCE, type MergeGroup } from './weldMerge'
import { sanitizeGeometryWrapBoundaryProof } from './geometryWrapBoundary'

export interface CadPathCorner {
  pos: number[]
  d1: number[]
  d2: number[]
  memberIndex: number
  incomingMemberIndex: number
  outgoingMemberIndex: number
  stationMm: number
  incomingBoundaryId?: string
  outgoingBoundaryId?: string
}
type Primitive = { type: string; points: number[][]; properties?: Record<string, unknown>; center?: number[] | null; normal?: number[] | null; boundaryId?: string }
const EPS = 1e-9, TOL = FINITE_INTERVAL_JOIN_TOLERANCE
const vector = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
const sub = (a: number[], b: number[]) => a.map((n, i) => n - b[i])
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0)
const norm = (a: number[]) => Math.hypot(...a)
const dist = (a: number[], b: number[]) => norm(sub(a, b))
const near = (a: number[], b: number[]) => dist(a, b) <= TOL + EPS
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: number[]) => norm(a) > EPS ? a.map((n) => n / norm(a)) : null
const line = (type: string) => /直线|^line$/i.test(type)

function pathDistance(point: number[], points: number[][]): number {
  let result = Infinity
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], direction = sub(points[i], a), squared = dot(direction, direction)
    if (squared <= EPS * EPS) continue
    const t = Math.max(0, Math.min(1, dot(sub(point, a), direction) / squared))
    result = Math.min(result, dist(point, a.map((n, axis) => n + t * direction[axis])))
  }
  return result
}

function tangent(primitive: Primitive, point: number[], traversal: number[]): number[] | null {
  const orient = (direction: number[] | null) => direction && dot(direction, traversal) < 0 ? direction.map((n) => -n) : direction
  const projection = primitive.properties?.投影搭接 as Record<string, unknown> | undefined
  if (projection && Array.isArray(projection.projectedPoints) && Array.isArray(projection.sourceNormals) && vector(projection.hostNormal)) {
    const index = projection.projectedPoints.findIndex((candidate) => vector(candidate) && near(candidate, point))
    if (index >= 0 && vector(projection.sourceNormals[index])) return orient(unit(cross(projection.hostNormal, projection.sourceNormals[index])))
  }
  if (line(primitive.type)) return orient(unit(sub(primitive.points.at(-1)!, primitive.points[0])))
  if (!/圆|arc|circle/i.test(primitive.type)) return null
  let center = vector(primitive.center) ? primitive.center : null, normal = vector(primitive.normal) ? unit(primitive.normal) : null
  const a = primitive.points[0]
  let b = a
  for (const candidate of primitive.points) if (dist(candidate, a) > dist(b, a)) b = candidate
  const u = sub(b, a)
  let c = a
  for (const candidate of primitive.points) if (norm(cross(u, sub(candidate, a))) > norm(cross(u, sub(c, a)))) c = candidate
  const v = sub(c, a), area = cross(u, v), squared = dot(area, area)
  if (squared > EPS * EPS) {
    normal ??= unit(area)
    if (!center) {
      const vn = cross(v, area), nu = cross(area, u)
      center = a.map((n, axis) => n + (vn[axis] * dot(u, u) + nu[axis] * dot(v, v)) / (2 * squared))
    }
  }
  return center && normal ? orient(unit(cross(normal, sub(point, center)))) : null
}

type EdgeBucket = { wire?: BoundaryWire; edges: Map<string, Edge>; duplicate: boolean }
const edgeIndexes = new WeakMap<EdgesData, { legacy: boolean; buckets: Map<string, EdgeBucket> }>()
const wireKey = (partId: string, face: number, wire: string) => JSON.stringify([partId, face, wire])
function boundaryIndex(data: EdgesData) {
  const prior = edgeIndexes.get(data)
  if (prior) return prior
  const result = { legacy: !data.wires?.length && data.boundaryRecognitionVersion !== 1, buckets: new Map<string, EdgeBucket>() }
  for (const edge of data.edges) {
    const wire = edge.wireId ?? (result.legacy ? `cad-outer:${edge.partId}:${edge.faceIndex}` : '')
    const key = wireKey(edge.partId, edge.faceIndex, wire)
    let bucket = result.buckets.get(key)
    if (!bucket) { bucket = { edges: new Map(), duplicate: false }; result.buckets.set(key, bucket) }
    const id = edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}`
    if (bucket.edges.has(id)) bucket.duplicate = true
    bucket.edges.set(id, edge)
  }
  for (const wire of data.wires ?? []) {
    const key = wireKey(wire.partId, wire.faceIndex, wire.wireId), bucket = result.buckets.get(key)
    if (bucket) { if (bucket.wire) bucket.duplicate = true; bucket.wire = wire }
  }
  edgeIndexes.set(data, result)
  return result
}

function boundaryPrimitives(value: unknown, data: EdgesData | null | undefined): Primitive[] | null {
  const proof = sanitizeGeometryWrapBoundaryProof(value)
  if (!proof?.pathBoundaryIds?.length || !data) return null
  const index = boundaryIndex(data), bucket = index.buckets.get(wireKey(proof.partId, proof.faceIndex, proof.wireId))
  if (!bucket || bucket.duplicate) return null
  if (!index.legacy && (!bucket.wire?.closed || !bucket.wire.topologyComplete || bucket.wire.wire !== 'outer')) return null
  if (JSON.stringify([...bucket.edges.keys()].sort()) !== JSON.stringify([...proof.boundaryIds].sort())) return null
  const edges = proof.pathBoundaryIds.map((id) => bucket.edges.get(id))
  if (edges.some((edge) => !edge || edge.wire !== 'outer' || edge.points.length < 2 || !edge.points.every(vector))) return null
  return (edges as Edge[]).map((edge) => ({ type: edge.type, points: edge.points, center: edge.center, normal: edge.normal,
    boundaryId: edge.boundaryId ?? `${edge.partId}:${edge.faceIndex}:${edge.edgeIndex}` }))
}

/** Current finite members already contain the proved CAD connector. Never use
 * group.points or join across an unverified gap to generate an angle. */
function actualRuns(group: Pick<MergeGroup, 'members'>) {
  const runs: { points: number[][]; edgeMembers: number[] }[] = []
  group.members.forEach((member, memberIndex) => {
    if (member.points.length < 2 || !member.points.every(vector)) return
    const points = member.points.filter((point, index) => !index || dist(point, member.points[index - 1]) > EPS)
    if (points.length < 2) return
    const last = runs.at(-1)
    if (!last || !near(last.points.at(-1)!, points[0])) {
      runs.push({ points: points.map((point) => [...point]), edgeMembers: points.slice(1).map(() => memberIndex) })
    } else {
      const start = dist(last.points.at(-1)!, points[0]) <= EPS ? 1 : 0
      for (const point of points.slice(start)) { last.points.push([...point]); last.edgeMembers.push(memberIndex) }
    }
  })
  return runs
}

/** null: no current verified source. []: verified curve is entirely G1 smooth.
 * Only endpoints of real CAD primitives can become corners, using exact line,
 * circle or projected-native derivatives rather than tessellation chord angles.
 * A CAD line can support a real member's verified collinear extend; no new
 * travel segment or extrapolated curve is created by this calculation. */
export function geometryBoundaryCadCorners(group: Pick<MergeGroup, 'geometryBoundary' | 'members'>,
  sourceWelds: readonly Weld[], edgesData?: EdgesData | null): CadPathCorner[] | null {
  const boundary = boundaryPrimitives(group.geometryBoundary, edgesData)
  if (!boundary) return null
  const sourceIds = new Set(group.members.map((member) => member.weldId))
  const primitives: Primitive[] = [...sourceWelds.filter((weld) => sourceIds.has(weld.id)).flatMap((weld) =>
    weld.segments.filter((segment) => segment.points.length >= 2 && segment.points.every(vector)).map((segment) =>
      ({ type: segment.type, points: segment.points, properties: weld.properties }))), ...boundary]
  const candidates = primitives.flatMap((primitive) => [primitive.points[0], primitive.points.at(-1)!])
  const supports = (primitive: Primitive, span: number[][]) => {
    if (!line(primitive.type)) return span.every((point) => pathDistance(point, primitive.points) <= TOL + EPS)
    const direction = unit(sub(primitive.points.at(-1)!, primitive.points[0]))
    return !!direction && [...primitive.points, ...span].every((point) => norm(cross(sub(point, primitive.points[0]), direction)) <= TOL + EPS)
  }
  const result: CadPathCorner[] = []
  let runStation = 0
  for (const run of actualRuns(group)) {
    const closed = near(run.points[0], run.points.at(-1)!), stations = [0]
    for (let index = 1; index < run.points.length; index++) stations.push(stations[index - 1] + dist(run.points[index - 1], run.points[index]))
    for (let index = 0; index < run.points.length - (closed ? 1 : 0); index++) {
      const point = run.points[index]
      if ((!closed && (index === 0 || index + 1 === run.points.length)) || !candidates.some((candidate) => near(candidate, point))) continue
      const before = run.points[index - 1] ?? run.points.at(-2)!, after = run.points[index + 1]
      const arrives = unit(sub(point, before)), leaves = unit(sub(after, point))
      if (!arrives || !leaves) continue
      const incoming = primitives.find((primitive) => supports(primitive, [point, before])), outgoing = primitives.find((primitive) => supports(primitive, [point, after]))
      if (!incoming || !outgoing) continue
      const d1 = tangent(incoming, point, arrives), d2 = tangent(outgoing, point, leaves)
      if (!d1 || !d2 || dot(d1, d2) > Math.cos(Math.PI / 180) || result.some((corner) => near(corner.pos, point))) continue
      const incomingMemberIndex = run.edgeMembers[index - 1] ?? run.edgeMembers.at(-1)!, outgoingMemberIndex = run.edgeMembers[index]
      result.push({ pos: [...point], d1, d2, memberIndex: incomingMemberIndex, incomingMemberIndex, outgoingMemberIndex,
        stationMm: runStation + stations[index],
        ...(incoming.boundaryId ? { incomingBoundaryId: incoming.boundaryId } : {}),
        ...(outgoing.boundaryId ? { outgoingBoundaryId: outgoing.boundaryId } : {}) })
    }
    runStation += stations.at(-1)!
  }
  return result
}
