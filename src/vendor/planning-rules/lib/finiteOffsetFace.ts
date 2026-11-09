import * as THREE from 'three'
import type { Edge, EdgesData, Weld } from '@/types/weld'
import { collarGapPlanning } from './collarGapPlanning'
import { WELD_CONTACT_TOLERANCE } from './weldContactGeometry'

export interface OffsetRibbonPoint { s: number; r: number }
interface BoundarySegment { a: OffsetRibbonPoint; b: OffsetRibbonPoint }
type Face = { 类型?: unknown; 法向?: unknown; 来源面索引?: unknown }
type SegmentProperty = { index?: number; 主板面?: Face | null; 副板面?: Face | null }
const EPS = 1e-8
const tolerance = WELD_CONTACT_TOLERANCE
const vector = (point: number[]) => new THREE.Vector3().fromArray(point)
const point3 = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3
  && value.every(component => typeof component === 'number' && Number.isFinite(component))
const byFace = new WeakMap<EdgesData, Map<string, Edge[]>>()
const projected = new WeakMap<EdgesData, WeakMap<Weld, Map<string, BoundarySegment[]>>>()

function faceEdges(edges: EdgesData, partId: string, faceIndex: number) {
  let index = byFace.get(edges)
  if (!index) {
    index = new Map()
    for (const edge of edges.edges) {
      const key = `${edge.partId}|${edge.faceIndex}`
      const group = index.get(key) ?? []
      group.push(edge); index.set(key, group)
    }
    byFace.set(edges, index)
  }
  return index.get(`${partId}|${faceIndex}`) ?? []
}

/** Locate the original segment, including when the ray was lifted 0.05 mm. */
function segmentProperty(weld: Weld, point: THREE.Vector3, tangent: THREE.Vector3): SegmentProperty | undefined {
  const properties = (weld.properties.焊缝段 ?? []) as SegmentProperty[]
  if (weld.segments.length === 1) return properties.find(property => property.index === weld.segments[0].index) ?? properties[0]
  let best = Infinity, bestAlignment = -1, selected = -1
  for (const [index, segment] of weld.segments.entries()) for (let i = 1; i < segment.points.length; i++) {
    const line = new THREE.Line3(vector(segment.points[i - 1]), vector(segment.points[i]))
    const distance = line.closestPointToPoint(point, true, new THREE.Vector3()).distanceToSquared(point)
    const alignment = Math.abs(line.delta(new THREE.Vector3()).normalize().dot(tangent))
    if (distance < best - EPS * EPS || Math.abs(distance - best) <= EPS * EPS && alignment > bestAlignment) {
      best = distance; bestAlignment = alignment; selected = index
    }
  }
  const segment = weld.segments[selected]
  return properties.find(property => property.index === segment?.index) ?? properties[selected]
}

function boundarySegments(weld: Weld, origin: THREE.Vector3, tangent: THREE.Vector3,
  direction: THREE.Vector3, edges?: EdgesData | null): BoundarySegment[] {
  if (!edges || !(typeof edges.boundaryRecognitionVersion === 'number' && edges.boundaryRecognitionVersion >= 1
    || edges.edges.some(edge => typeof edge.boundaryId === 'string' && Number.isInteger(edge.wireIndex)))) return []
  let byWeld = projected.get(edges)
  if (!byWeld) { byWeld = new WeakMap(); projected.set(edges, byWeld) }
  let cache = byWeld.get(weld)
  if (!cache) { cache = new Map(); byWeld.set(weld, cache) }
  const key = [...origin.toArray(), ...tangent.toArray(), ...direction.toArray()].join(',')
  const previous = cache.get(key)
  if (previous) return previous
  const property = segmentProperty(weld, origin, tangent)
  const result: BoundarySegment[] = []
  const policy = collarGapPlanning(weld)
  const evidence = weld.properties.投影搭接 as { projectionVector?: number[] } | undefined
  for (const [faceKey, partId, fallbackFace] of [
    ['主板面', weld.mainPartId, weld.mainFaceIndex], ['副板面', weld.subPartId, weld.subFaceIndex],
  ] as const) {
    const face = property?.[faceKey]
    if (face?.类型 !== '平面' || !point3(face.法向)) continue
    const normal = vector(face.法向)
    if (normal.lengthSq() <= EPS) continue
    normal.normalize()
    // A normal ray leaves the face immediately. Only movement along the face
    // has a finite in-plane boundary that can end this inspection direction.
    if (Math.abs(direction.dot(normal)) > 1e-6) continue
    const faceIndex = Number.isInteger(face.来源面索引) ? Number(face.来源面索引) : fallbackFace
    const translation = policy?.source === '投影搭接' && partId === policy.sourcePartId
      && point3(evidence?.projectionVector) ? vector(evidence.projectionVector) : new THREE.Vector3()
    for (const edge of faceEdges(edges, partId, faceIndex)) {
      const points = (edge.points?.length >= 2 ? edge.points : [edge.start, edge.end]).filter(point3)
        .map(point => vector(point).add(translation))
      if ((edge.closed || edge.type === '圆') && points.length > 2
        && points[0].distanceToSquared(points.at(-1)!) > EPS * EPS) points.push(points[0].clone())
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1].clone().sub(origin), b = points[i].clone().sub(origin)
        // The inspected ray can have a normal lift. Reject unrelated parallel
        // faces, while retaining the existing lift and CAD rounding tolerance.
        if (Math.abs(a.dot(normal)) > .05 + tolerance || Math.abs(b.dot(normal)) > .05 + tolerance) continue
        result.push({ a: { s: a.dot(tangent), r: a.dot(direction) },
          b: { s: b.dot(tangent), r: b.dot(direction) } })
      }
    }
  }
  if (cache.size >= 64) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}

/** First positive boundary of either planar supporting face followed by this
 * ray. Null keeps the established fallback for unknown or legacy geometry. */
export function offsetFaceRayLimit(weld: Weld, point: THREE.Vector3, tangent: THREE.Vector3,
  direction: THREE.Vector3, edges?: EdgesData | null): number | null {
  let limit = Infinity
  for (const { a, b } of boundarySegments(weld, point, tangent, direction, edges)) {
    const ds = b.s - a.s
    if (Math.abs(ds) <= EPS) {
      if (Math.abs(a.s) > tolerance) continue
      for (const distance of [a.r, b.r]) if (distance > tolerance) limit = Math.min(limit, distance)
    } else {
      const t = -a.s / ds
      if (t < -EPS || t > 1 + EPS) continue
      const distance = a.r + t * (b.r - a.r)
      // The root itself is the starting boundary, not an obstruction.
      if (distance > tolerance) limit = Math.min(limit, distance)
    }
  }
  return Number.isFinite(limit) ? limit + tolerance : null
}

function deduplicate(polygon: OffsetRibbonPoint[]): OffsetRibbonPoint[] {
  const result: OffsetRibbonPoint[] = []
  for (const point of polygon) {
    const previous = result.at(-1)
    if (!previous || Math.abs(previous.s - point.s) > EPS || Math.abs(previous.r - point.r) > EPS) result.push(point)
  }
  if (result.length > 1 && Math.abs(result[0].s - result.at(-1)!.s) <= EPS
    && Math.abs(result[0].r - result.at(-1)!.r) <= EPS) result.pop()
  return result
}

/** Retains points where the linear expression is nonpositive. Also handles a
 * two-point triangle/ribbon intersection without a sampling grid. */
function clip(polygon: OffsetRibbonPoint[], expression: (point: OffsetRibbonPoint) => number) {
  const result: OffsetRibbonPoint[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const da = expression(a), db = expression(b)
    const insideA = da <= EPS, insideB = db <= EPS
    if (insideA) result.push(a)
    if (insideA !== insideB) {
      const t = da / (da - db)
      result.push({ s: a.s + t * (b.s - a.s), r: a.r + t * (b.r - a.r) })
    }
  }
  return deduplicate(result)
}

function hasSpan(polygon: OffsetRibbonPoint[]) {
  return polygon.length >= 2 && Math.max(...polygon.map(point => point.s)) - Math.min(...polygon.map(point => point.s)) > EPS
}

/** Clip a continuous transverse-ray ribbon at the first finite face boundary.
 * Every boundary segment removes only the region farther along its own rays;
 * the union of these restrictions is the first crossing, including hole rims.
 * This preserves submillimetre candidate spans and sloping face edges exactly. */
export function clipOffsetFaceRibbon(weld: Weld, origin: THREE.Vector3, tangent: THREE.Vector3,
  direction: THREE.Vector3, length: number, polygon: OffsetRibbonPoint[], edges?: EdgesData | null): OffsetRibbonPoint[][] {
  const initial = clip(clip(polygon, point => -point.s), point => point.s - length)
  if (!hasSpan(initial)) return []
  let remaining = [initial]
  for (const segment of boundarySegments(weld, origin, tangent, direction, edges)) {
    let a = { ...segment.a }, b = { ...segment.b }
    if (a.r <= tolerance && b.r <= tolerance || Math.abs(b.s - a.s) <= EPS) continue
    // A root edge can slope across the ray origins. Only its positive part
    // ends a ray; zero and negative distances never shadow the forward side.
    if (a.r <= tolerance || b.r <= tolerance) {
      const t = (tolerance - a.r) / (b.r - a.r)
      const crossing = { s: a.s + t * (b.s - a.s), r: tolerance }
      if (a.r <= tolerance) a = crossing
      else b = crossing
    }
    if (a.s > b.s) [a, b] = [b, a]
    const low = Math.max(0, a.s), high = Math.min(length, b.s)
    if (high - low <= EPS) continue
    const slope = (b.r - a.r) / (b.s - a.s), intercept = a.r - slope * a.s
    const next: OffsetRibbonPoint[][] = []
    for (const piece of remaining) {
      const minimum = Math.min(...piece.map(point => point.s)), maximum = Math.max(...piece.map(point => point.s))
      if (maximum <= low + EPS || minimum >= high - EPS) { next.push(piece); continue }
      const left = clip(piece, point => point.s - low), right = clip(piece, point => high - point.s)
      const middle = clip(clip(piece, point => low - point.s), point => point.s - high)
      const visible = clip(middle, point => point.r - slope * point.s - intercept - tolerance)
      for (const candidate of [left, visible, right]) if (hasSpan(candidate)) next.push(candidate)
    }
    remaining = next
    if (!remaining.length) break
  }
  return remaining
}
