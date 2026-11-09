import * as THREE from 'three'
import type { Part, PartsData, Weld } from '@/types/weld'
import { getPartGeometryIndex } from './partGeometryIndex'

export interface OpeningBoundaryInterference {
  partId: string
  /** Distance from the reported boundary point along the normalized outward direction. */
  distance: number
  boundaryPoint: number[]
  hitPoint: number[]
}

const EPS = .05
const finite = (point: THREE.Vector3) => [point.x, point.y, point.z].every(Number.isFinite)
interface HalfSpace { normal: THREE.Vector3; offset: number }
interface Strip {
  origin: THREE.Vector3
  segment: THREE.Vector3
  box: THREE.Box3
  clips: HalfSpace[]
  boundaryAt: (point: THREE.Vector3) => { boundary: THREE.Vector3; distance: number }
}

/** Clip a whole finite triangle, including coplanar areas. Sampling only CAD
 * vertices or triangle vertices misses thin material between those vertices. */
function clipPolygon(points: THREE.Vector3[], planes: HalfSpace[], origin: THREE.Vector3): THREE.Vector3[] {
  let polygon = points
  for (const plane of planes) {
    if (!polygon.length) return polygon
    const next: THREE.Vector3[] = []
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length]
      const da = a.clone().sub(origin).dot(plane.normal) - plane.offset
      const db = b.clone().sub(origin).dot(plane.normal) - plane.offset
      if (da <= 0) next.push(a)
      if ((da <= 0) !== (db <= 0)) next.push(a.clone().lerp(b, da / (da - db)))
    }
    polygon = next
  }
  return polygon
}

function makeStrip(a: THREE.Vector3, b: THREE.Vector3, outward: THREE.Vector3, limit: number): Strip {
  const segment = b.clone().sub(a), axialSpan = segment.dot(outward)
  const transverse = segment.clone().addScaledVector(outward, -axialSpan), span = transverse.length()
  const box = new THREE.Box3().setFromPoints([a, b, a.clone().addScaledVector(outward, limit),
    b.clone().addScaledVector(outward, limit)]).expandByScalar(EPS)
  const range = (normal: THREE.Vector3, low: number, high: number): HalfSpace[] => [
    { normal, offset: high }, { normal: normal.clone().negate(), offset: -low }]
  if (span <= 1e-8 * Math.max(1, segment.length())) {
    // A parallel sweep is a finite line interval. Clip triangles against its
    // narrow tolerance tube, rather than raycasting only either CAD endpoint.
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
    const reference = axes.reduce((best, axis) => Math.abs(axis.dot(outward)) < Math.abs(best.dot(outward)) ? axis : best)
    const transverseAxis = reference.clone().cross(outward).normalize()
    const normal = transverseAxis.clone().cross(outward).normalize()
    const low = Math.min(0, axialSpan), high = Math.max(0, axialSpan)
    return { origin: a, segment, box,
      clips: [...range(transverseAxis, -EPS, EPS), ...range(normal, -EPS, EPS), ...range(outward, low, high + limit)],
      boundaryAt: (point) => {
        const position = point.clone().sub(a).dot(outward)
        const boundaryPosition = THREE.MathUtils.clamp(position, low, high)
        const u = Math.abs(axialSpan) > 1e-12 ? THREE.MathUtils.clamp(boundaryPosition / axialSpan, 0, 1) : 0
        return { boundary: a.clone().addScaledVector(segment, u), distance: Math.max(0, position - high) }
      } }
  }
  const transverseAxis = transverse.multiplyScalar(1 / span)
  const normal = transverseAxis.clone().cross(outward).normalize()
  // Oblique coordinates recover the actual swept parallelogram: q=u*segment+d*outward.
  const distanceAxis = outward.clone().addScaledVector(transverseAxis, -axialSpan / span)
  return { origin: a, segment, box,
    clips: [...range(normal, -EPS, EPS), ...range(transverseAxis, 0, span), ...range(distanceAxis, 0, limit)],
    boundaryAt: (point) => {
      const relative = point.clone().sub(a), u = THREE.MathUtils.clamp(relative.dot(transverseAxis) / span, 0, 1)
      return { boundary: a.clone().addScaledVector(segment, u), distance: Math.max(0, relative.dot(distanceAxis)) }
    } }
}

function validPart(part: Part, mesh: Float32Array): boolean {
  return Number.isInteger(part.vertexOffset) && part.vertexOffset >= 0
    && Number.isInteger(part.vertexCount) && part.vertexCount >= 3
    && (part.vertexOffset + part.vertexCount) * 6 <= mesh.length
    && part.bbox.min.length === 3 && part.bbox.max.length === 3
    && [...part.bbox.min, ...part.bbox.max].every(Number.isFinite)
}

/** Find third material within the finite strip swept outwards from every CAD
 * segment of a local opening. Distances belong to that boundary, not the weld
 * endpoint TCP. The .05 mm normal tolerance accounts for CAD/Float32 mesh drift;
 * the outward distance still obeys the caller's strict threshold. */
export function measureOpeningBoundaryInterference(weld: Weld, points: THREE.Vector3[], outward: THREE.Vector3,
  parts: PartsData, mesh: Float32Array, threshold: number | null | undefined): OpeningBoundaryInterference | null {
  const outwardLength = Math.hypot(outward.x, outward.y, outward.z)
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0
    || !finite(outward) || !Number.isFinite(outwardLength) || outwardLength === 0
    || !points.length || !points.every(finite)) return null
  const direction = outward.clone().divideScalar(outwardLength)
  const strips = points.length === 1 ? [makeStrip(points[0], points[0], direction, threshold)]
    : points.slice(1).map((point, i) => makeStrip(points[i], point, direction, threshold))
  const bounds = strips.reduce((box, strip) => box.union(strip.box), new THREE.Box3())
  const result: { closest: OpeningBoundaryInterference | null } = { closest: null }
  for (const part of parts.parts) {
    if (part.id === weld.mainPartId || part.id === weld.subPartId || !validPart(part, mesh)) continue
    const partBox = new THREE.Box3(new THREE.Vector3().fromArray(part.bbox.min), new THREE.Vector3().fromArray(part.bbox.max))
    if (!partBox.intersectsBox(bounds)) continue
    const tree = getPartGeometryIndex(mesh, part).tree
    tree?.shapecast({
      intersectsBounds: (box) => strips.some((strip) => box.intersectsBox(strip.box)),
      intersectsTriangle: (triangle) => {
        if (![triangle.a, triangle.b, triangle.c].every(finite)) return false
        const triangleBox = new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c])
        for (const strip of strips) {
          if (!triangleBox.intersectsBox(strip.box)) continue
          const polygon = clipPolygon([triangle.a, triangle.b, triangle.c], strip.clips, strip.origin)
          for (const hit of polygon) {
            const candidate = strip.boundaryAt(hit)
            if (candidate.distance < threshold && Number.isFinite(candidate.distance)
              && (!result.closest || candidate.distance < result.closest.distance)) {
              result.closest = { partId: part.id, distance: candidate.distance,
                boundaryPoint: candidate.boundary.toArray(), hitPoint: hit.toArray() }
            }
          }
        }
        return result.closest?.distance === 0
      },
    })
    if (result.closest?.distance === 0) break
  }
  return result.closest
}
