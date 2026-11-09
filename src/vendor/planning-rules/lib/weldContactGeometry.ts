import * as THREE from 'three'
import type { Part } from '@/types/weld'
import { getPartGeometryIndex } from './partGeometryIndex'

// CAD points are doubles while the displayed mesh is Float32. Keep the contact
// tolerance below drawing-scale clearance, including at large model coordinates.
export const WELD_CONTACT_TOLERANCE = 0.02 // mm per transverse axis

export interface WeldContactSpan {
  startS: number
  endS: number
  start: THREE.Vector3
  end: THREE.Vector3
}

type Point = [number, number, number]

/** Clip a triangle to a narrow corridor around a weld segment, in local units. */
function clip(points: Point[], axis: number, limit: number, sign: number): Point[] {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const da = sign * (a[axis] - limit), db = sign * (b[axis] - limit)
    if (da <= 0) result.push(a)
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db)
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t])
    }
  }
  return result
}

/**
 * Continuous surface contact with a third part, including a weld lying on a
 * triangle interior or a solid's edge. No ray start offset or sampling grid is
 * involved. Bounding boxes only reject candidates; triangles decide contact.
 */
export function weldPartContactSpans(
  poly: THREE.Vector3[], mesh: Float32Array, part: Part,
): WeldContactSpan[] {
  const intervals: { a: number; b: number; start: THREE.Vector3; end: THREE.Vector3 }[] = []
  const box = new THREE.Box3(new THREE.Vector3().fromArray(part.bbox.min),
    new THREE.Vector3().fromArray(part.bbox.max)).expandByScalar(WELD_CONTACT_TOLERANCE)
  let index: ReturnType<typeof getPartGeometryIndex> | undefined
  let accumulated = 0
  for (let i = 0; i + 1 < poly.length; i++) {
    const origin = poly[i], delta = poly[i + 1].clone().sub(origin), length = delta.length()
    if (length < 1e-9) continue
    const segmentBox = new THREE.Box3().setFromPoints([origin, poly[i + 1]])
    if (!box.intersectsBox(segmentBox)) { accumulated += length; continue }
    const tangent = delta.clone().divideScalar(length)
    const axis = Math.abs(tangent.x) < 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = new THREE.Vector3().crossVectors(tangent, axis).normalize()
    const v = new THREE.Vector3().crossVectors(tangent, u)
    index ??= getPartGeometryIndex(mesh, part)
    const triangles: number[] = []
    if (index.tree) {
      // The exact clip uses a square tube in the local u/v plane, not a
      // world-axis radius. Its corners can exceed 0.02 mm on a world axis.
      const extent = new THREE.Vector3(Math.abs(u.x) + Math.abs(v.x),
        Math.abs(u.y) + Math.abs(v.y), Math.abs(u.z) + Math.abs(v.z)).multiplyScalar(WELD_CONTACT_TOLERANCE)
      const roundoff = Number.EPSILON * 16 * Math.max(1,
        Math.abs(origin.x), Math.abs(origin.y), Math.abs(origin.z),
        Math.abs(poly[i + 1].x), Math.abs(poly[i + 1].y), Math.abs(poly[i + 1].z))
      const corridor = segmentBox.clone().expandByVector(extent).expandByScalar(roundoff)
      index.tree.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(corridor),
        intersectsTriangle: (_triangle, triangleIndex) => { triangles.push(triangleIndex); return false },
      })
      // Indirect BVH traversal reports original triangle indices, but visits
      // them spatially. Restore CAD order so equal-span endpoint ties stay exact.
      triangles.sort((a, b) => a - b)
    } else {
      for (let k = 0; k + 2 < part.vertexCount; k += 3) triangles.push(k / 3)
    }
    const point = new THREE.Vector3()
    for (const triangleIndex of triangles) {
      const k = part.vertexOffset + triangleIndex * 3
      let polygon: Point[] = []
      for (let j = 0; j < 3; j++) {
        point.set(mesh[(k + j) * 6], mesh[(k + j) * 6 + 1], mesh[(k + j) * 6 + 2]).sub(origin)
        polygon.push([point.dot(tangent), point.dot(u), point.dot(v)])
      }
      for (const [coordinate, limit, sign] of [
        [0, 0, -1], [0, length, 1],
        [1, -WELD_CONTACT_TOLERANCE, -1], [1, WELD_CONTACT_TOLERANCE, 1],
        [2, -WELD_CONTACT_TOLERANCE, -1], [2, WELD_CONTACT_TOLERANCE, 1],
      ]) {
        polygon = clip(polygon, coordinate, limit, sign)
        if (!polygon.length) break
      }
      if (!polygon.length) continue
      const a = Math.min(...polygon.map((p) => p[0])), b = Math.max(...polygon.map((p) => p[0]))
      intervals.push({ a: accumulated + a, b: accumulated + b,
        start: origin.clone().addScaledVector(tangent, a), end: origin.clone().addScaledVector(tangent, b) })
    }
    accumulated += length
  }
  intervals.sort((a, b) => a.a - b.a)
  const result: WeldContactSpan[] = []
  for (const span of intervals) {
    const previous = result.at(-1)
    if (previous && span.a <= previous.endS + 1e-6) {
      if (span.b > previous.endS) { previous.endS = span.b; previous.end = span.end }
    } else result.push({ startS: span.a, endS: span.b, start: span.start, end: span.end })
  }
  return result
}
