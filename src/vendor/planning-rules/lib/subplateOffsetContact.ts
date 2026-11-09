import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { EdgesData, Part, PartsData, Weld } from '@/types/weld'
import { hasSemanticBoundaries, offsetInspectionDirections, referenceNormal, weldPolyline } from './gapDetection'
import { getPartGeometryIndex } from './partGeometryIndex'
import { WELD_CONTACT_TOLERANCE } from './weldContactGeometry'
import { clipOffsetFaceRibbon } from './finiteOffsetFace'

export interface SubplateOffsetContact {
  faceKey: '主板面' | '副板面'
  partId: string
  direction: '正面' | '上面'
  distanceMm: number
  start: number[]
  end: number[]
  hitStart?: number[]
  hitEnd?: number[]
}

const identity = new THREE.Matrix4()
const physicalContacts = new WeakMap<Float32Array, WeakMap<PartsData, WeakMap<Part, Part[]>>>()
const results = new WeakMap<Float32Array, WeakMap<PartsData, WeakMap<Weld, WeakMap<object, SubplateOffsetContact[]>>>>()
const noFiniteFaceBoundaries = {}
interface FiniteFaceIndex { geometry: THREE.BufferGeometry; tree: MeshBVH | null; contacts: WeakMap<Part, boolean> }
const finiteFaces = new WeakMap<Float32Array, WeakMap<Part, Map<string, FiniteFaceIndex>>>()
const vector = (point: number[]) => new THREE.Vector3().fromArray(point)
const boundsOf = (part: Part) => new THREE.Box3(vector(part.bbox.min), vector(part.bbox.max))

function hasTriangles(mesh: Float32Array, part: Part) {
  return Number.isInteger(part.vertexOffset) && part.vertexOffset >= 0 && Number.isInteger(part.vertexCount)
    && part.vertexCount >= 3 && (part.vertexOffset + part.vertexCount) * 6 <= mesh.length
}

/** A body-level contact on the opposite side of a plate does not establish a
 * contact with this weld's support face. Retain only real mesh triangles on
 * that finite CAD plane; an infinite plane or a closest-pair witness would
 * also accept remote/other-side contacts. */
function touchingSubplateFace(mesh: Float32Array, subplate: Part | undefined, candidate: Part,
  face: { 类型?: unknown; 法向?: unknown } | null | undefined, point: THREE.Vector3): boolean {
  if (!subplate || face?.类型 !== '平面' || !Array.isArray(face.法向) || face.法向.length !== 3
    || !face.法向.every(value => typeof value === 'number' && Number.isFinite(value))) return true
  const normal = new THREE.Vector3().fromArray(face.法向 as number[]).normalize()
  if (normal.lengthSq() < .5) return true
  const plane = point.dot(normal)
  let byPart = finiteFaces.get(mesh)
  if (!byPart) { byPart = new WeakMap(); finiteFaces.set(mesh, byPart) }
  let byPlane = byPart.get(subplate)
  if (!byPlane) { byPlane = new Map(); byPart.set(subplate, byPlane) }
  const key = [...normal.toArray(), plane].map(value => value.toFixed(6)).join('|')
  let finite = byPlane.get(key)
  if (!finite) {
    const values: number[] = [], vertex = new THREE.Vector3()
    for (let at = subplate.vertexOffset * 6; at + 17 < (subplate.vertexOffset + subplate.vertexCount) * 6; at += 18) {
      const offsets = [at, at + 6, at + 12]
      if (!offsets.every(index => Math.abs(vertex.fromArray(mesh, index).dot(normal) - plane) <= WELD_CONTACT_TOLERANCE)) continue
      for (const index of offsets) values.push(mesh[index], mesh[index + 1], mesh[index + 2])
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3))
    finite = { geometry, tree: values.length >= 9 ? new MeshBVH(geometry, { indirect: true }) : null, contacts: new WeakMap() }
    byPlane.set(key, finite)
  }
  const cached = finite.contacts.get(candidate)
  if (cached !== undefined) return cached
  const other = getPartGeometryIndex(mesh, candidate)
  const closest = finite.tree?.closestPointToGeometry(other.geometry, identity, undefined, undefined,
    0, WELD_CONTACT_TOLERANCE + 1e-9)
  const touching = !!closest && closest.distance <= WELD_CONTACT_TOLERANCE + 1e-9
  finite.contacts.set(candidate, touching)
  return touching
}

/** Geometry is immutable for one model. Prove each subplate/third-part pair
 * once; a contacts.json pair or overlapping boxes alone are insufficient. */
function touchingParts(mesh: Float32Array, parts: PartsData, subplate: Part): Part[] {
  let byParts = physicalContacts.get(mesh)
  if (!byParts) { byParts = new WeakMap(); physicalContacts.set(mesh, byParts) }
  let bySubplate = byParts.get(parts)
  if (!bySubplate) { bySubplate = new WeakMap(); byParts.set(parts, bySubplate) }
  const cached = bySubplate.get(subplate)
  if (cached) return cached
  const found: Part[] = []
  if (hasTriangles(mesh, subplate)) {
    const bounds = boundsOf(subplate).expandByScalar(WELD_CONTACT_TOLERANCE)
    const index = getPartGeometryIndex(mesh, subplate)
    for (const part of parts.parts) {
      if (part === subplate || !hasTriangles(mesh, part) || !bounds.intersectsBox(boundsOf(part))) continue
      const other = getPartGeometryIndex(mesh, part)
      const closest = index.tree?.closestPointToGeometry(other.geometry, identity, undefined, undefined,
        0, WELD_CONTACT_TOLERANCE + 1e-9)
      if (closest && closest.distance <= WELD_CONTACT_TOLERANCE + 1e-9) found.push(part)
    }
  }
  bySubplate.set(subplate, found)
  return found
}

/** Finite bound from the actual weld/part geometry, not an offset setting. */
function rayRange(weld: Weld, part: Part): number {
  const polyline = weldPolyline(weld)
  const weldBounds = new THREE.Box3().setFromPoints(polyline)
  if (weldBounds.isEmpty()) return 0
  const bounds = boundsOf(part)
  const extent = new THREE.Vector3(
    Math.max(Math.abs(bounds.min.x - weldBounds.max.x), Math.abs(bounds.max.x - weldBounds.min.x)),
    Math.max(Math.abs(bounds.min.y - weldBounds.max.y), Math.abs(bounds.max.y - weldBounds.min.y)),
    Math.max(Math.abs(bounds.min.z - weldBounds.max.z), Math.abs(bounds.max.z - weldBounds.min.z)),
  )
  // Covers the existing perpendicular ray's 0.05 mm normal lift as well.
  return extent.length() + 1
}

interface RibbonPoint { s: number; r: number }
interface RibbonSpan {
  from: number
  to: number
  start: THREE.Vector3
  end: THREE.Vector3
  hitStart: THREE.Vector3
  hitEnd: THREE.Vector3
  distanceMm: number
}

function clipRibbon(points: RibbonPoint[], key: 's' | 'r', boundary: number, sign: number): RibbonPoint[] {
  const result: RibbonPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const da = sign * (a[key] - boundary), db = sign * (b[key] - boundary)
    if (da <= 1e-9) result.push(a)
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db)
      result.push({ s: a.s + (b.s - a.s) * t, r: a.r + (b.r - a.r) * t })
    }
  }
  return result
}

/** Exact finite intersection of one face triangle with a transverse-ray ribbon.
 * Unlike a ray sampling grid this retains even a sub-millimetre entity. */
function triangleRibbon(triangle: THREE.Triangle, origin: THREE.Vector3, tangent: THREE.Vector3,
  direction: THREE.Vector3, length: number, far: number): RibbonPoint[] {
  if (Math.abs(triangle.getNormal(new THREE.Vector3()).dot(direction)) <= 1e-8) return []
  const normal = new THREE.Vector3().crossVectors(tangent, direction)
  const vertices = [triangle.a, triangle.b, triangle.c]
  const signed = vertices.map(vertex => vertex.clone().sub(origin).dot(normal))
  const points: THREE.Vector3[] = []
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3, a = signed[i], b = signed[j]
    if (Math.abs(a) <= 1e-9) points.push(vertices[i])
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) points.push(vertices[i].clone().lerp(vertices[j], a / (a - b)))
  }
  if (!points.length) return []
  let projected = points.map(point => {
    const relative = point.clone().sub(origin)
    return { s: relative.dot(tangent), r: relative.dot(direction) }
  })
  for (const [key, boundary, sign] of [['s', 0, -1], ['s', length, 1], ['r', .1, -1], ['r', far, 1]] as const) {
    projected = clipRibbon(projected, key, boundary, sign)
    if (!projected.length) break
  }
  return projected
}

function finiteOffsetSpans(weld: Weld, mesh: Float32Array, parts: PartsData, candidate: Part,
  faceKey: '主板面' | '副板面', directionName: '正面' | '上面', far: number, edges?: EdgesData | null): RibbonSpan[] {
  const tree = getPartGeometryIndex(mesh, candidate).tree
  if (!tree) return []
  const properties = (weld.properties.焊缝段 ?? []) as {
    index?: number; 起点法向?: unknown
    主板面?: { 类型?: unknown; 法向?: unknown } | null
    副板面?: { 类型?: unknown; 法向?: unknown } | null
  }[]
  const support = parts.parts.find(part => part.id === (faceKey === '主板面' ? weld.mainPartId : weld.subPartId))
  const otherSupport = parts.parts.find(part => part.id === (faceKey === '主板面' ? weld.subPartId : weld.mainPartId))
  const subplate = parts.parts.find(part => part.id === weld.subPartId)
  const spans: RibbonSpan[] = []
  let accumulated = 0
  for (const segment of weld.segments) {
    const property = properties.find(value => value.index === segment.index) ?? properties[segment.index - 1]
    for (let i = 1; i < segment.points.length; i++) {
      const a = vector(segment.points[i - 1]), b = vector(segment.points[i]), tangent = b.clone().sub(a)
      const length = tangent.length()
      if (length <= 1e-9) continue
      tangent.divideScalar(length)
      const midpoint = a.clone().lerp(b, .5)
      if (!touchingSubplateFace(mesh, subplate, candidate, property?.副板面, midpoint)) { accumulated += length; continue }
      const normal = referenceNormal(property?.[faceKey], property, tangent, midpoint, mesh, support)
      const otherFace = property?.[faceKey === '主板面' ? '副板面' : '主板面']
      const otherNormal = otherFace || otherSupport
        ? referenceNormal(otherFace, property, tangent, midpoint, mesh, otherSupport) : null
      const directions = offsetInspectionDirections(normal, tangent, otherNormal ? [normal, otherNormal] : [normal])
      const direction = directionName === '上面' ? directions.up : directions.front
      if (!direction) { accumulated += length; continue }
      const origin = a.clone().addScaledVector(normal, .05)
      const ribbonBounds = new THREE.Box3().setFromPoints([origin, origin.clone().addScaledVector(tangent, length),
        origin.clone().addScaledVector(direction, far), origin.clone().addScaledVector(tangent, length).addScaledVector(direction, far)])
        .expandByScalar(1e-7)
      tree.shapecast({
        intersectsBounds: bounds => bounds.intersectsBox(ribbonBounds),
        intersectsTriangle: triangle => {
          const intersection = triangleRibbon(triangle, origin, tangent, direction, length, far)
          if (!intersection.length) return false
          for (const clipped of clipOffsetFaceRibbon(weld, origin, tangent, direction, length, intersection, edges)) {
            const from = Math.max(0, Math.min(...clipped.map(point => point.s)))
            const to = Math.min(length, Math.max(...clipped.map(point => point.s)))
            if (to - from <= 1e-8) continue
            const radiusAt = (s: number) => clipped.reduce((best, point) => Math.abs(point.s - s) < Math.abs(best.s - s) - 1e-9
              || (Math.abs(point.s - s) <= Math.abs(best.s - s) + 1e-9 && point.r < best.r) ? point : best).r
            spans.push({ from: accumulated + from, to: accumulated + to,
              start: a.clone().addScaledVector(tangent, from), end: a.clone().addScaledVector(tangent, to),
              hitStart: origin.clone().addScaledVector(tangent, from).addScaledVector(direction, radiusAt(from)),
              hitEnd: origin.clone().addScaledVector(tangent, to).addScaledVector(direction, radiusAt(to)),
              distanceMm: Math.min(...clipped.map(point => point.r)) })
          }
          return false
        },
      })
      accumulated += length
    }
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to)
  const merged: RibbonSpan[] = []
  for (const span of spans) {
    const previous = merged.at(-1)
    if (previous && span.from <= previous.to + 1e-7) {
      if (span.to > previous.to) { previous.to = span.to; previous.end = span.end; previous.hitEnd = span.hitEnd }
      previous.distanceMm = Math.min(previous.distanceMm, span.distanceMm)
    } else merged.push({ ...span })
  }
  return merged
}

/**
 * Offset-direction entities physically touching the subplate remain effective
 * independently of the configured detection distance and split threshold.
 * Continuous ray ribbons retain gapDetection's local transverse directions.
 * Each proven part is queried separately: another nearest hit may
 * not hide the fact that this entity exists in that offset direction.
 */
export function getSubplateOffsetContacts(weld: Weld, mesh: Float32Array, parts: PartsData,
  edges?: EdgesData | null, _contactPairs?: Set<string> | null): SubplateOffsetContact[] {
  let byParts = results.get(mesh)
  if (!byParts) { byParts = new WeakMap(); results.set(mesh, byParts) }
  let byWeld = byParts.get(parts)
  if (!byWeld) { byWeld = new WeakMap(); byParts.set(parts, byWeld) }
  let byEdges = byWeld.get(weld)
  if (!byEdges) { byEdges = new WeakMap(); byWeld.set(weld, byEdges) }
  const edgeKey = edges && hasSemanticBoundaries(edges) ? edges : noFiniteFaceBoundaries
  const cached = byEdges.get(edgeKey)
  if (cached) return cached
  const found: SubplateOffsetContact[] = []
  const subplate = parts.parts.find(part => part.id === weld.subPartId)
  if (subplate) for (const part of touchingParts(mesh, parts, subplate)) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId) continue
    const range = rayRange(weld, part)
    if (!(range > 0) || !Number.isFinite(range)) continue
    for (const faceKey of ['主板面', '副板面'] as const) {
      for (const direction of ['正面', '上面'] as const) for (const span of finiteOffsetSpans(weld, mesh, parts, part, faceKey, direction, range, edges))
        found.push({ faceKey, partId: part.id, direction, distanceMm: span.distanceMm,
          start: span.start.toArray(), end: span.end.toArray(), hitStart: span.hitStart.toArray(), hitEnd: span.hitEnd.toArray() })
    }
  }
  byEdges.set(edgeKey, found)
  return found
}
