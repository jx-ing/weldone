import * as THREE from 'three'
import type { LegacyFaceFootprint } from './legacyFaceBoundary'

const EPS = .05
const NUMERIC_EPS = 1e-8
const finite3 = (point: THREE.Vector3) => [point.x, point.y, point.z].every(Number.isFinite)
const finite2 = (point: THREE.Vector2) => [point.x, point.y].every(Number.isFinite)
const cross = (a: THREE.Vector2, b: THREE.Vector2) => a.x * b.y - a.y * b.x

/** The query is already divided at every actual boundary crossing. Use only
 * numeric tolerance inside each open interval: expanding edges by CAD EPS
 * would erase narrow voids and material bridges between those crossings. */
function materialAt(point: THREE.Vector2, face: LegacyFaceFootprint): boolean {
  const locations = face.loops.map((loop) => {
    let inside = false
    for (let i = 0, j = loop.points.length - 1; i < loop.points.length; j = i++) {
      const a = loop.points[j], b = loop.points[i], edge = b.clone().sub(a)
      const fraction = THREE.MathUtils.clamp(point.clone().sub(a).dot(edge) / (edge.lengthSq() || 1), 0, 1)
      if (a.clone().addScaledVector(edge, fraction).distanceTo(point) <= NUMERIC_EPS)
        return { hole: loop.hole, edge: true, inside: false }
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return { hole: loop.hole, edge: false, inside }
  })
  return locations.some((item) => item.edge)
    || locations.some((item) => !item.hole && item.inside)
      && !locations.some((item) => item.hole && item.inside)
}

/** Measure the first positive material interval after a positive void interval
 * along the actual finite source face. Initial mating material and a free exit
 * from it are not obstructions. A later return into that same plate is.
 *
 * Complete face loops are a prerequisite supplied by the caller. No virtual
 * projection or gun envelope is used, and isolated tangent contacts do not
 * establish an occupied interval. The returned distance is in millimetres. */
export function firstSourceMaterialReentry(point: THREE.Vector3, direction: THREE.Vector3,
  face: LegacyFaceFootprint, threshold: number | null | undefined): number | null {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0
    || !finite3(point) || !finite3(direction) || !finite3(face.origin) || !finite3(face.normal)
    || !Number.isFinite(direction.lengthSq()) || !Number.isFinite(face.normal.lengthSq())
    || direction.lengthSq() <= NUMERIC_EPS * NUMERIC_EPS || face.normal.lengthSq() <= NUMERIC_EPS * NUMERIC_EPS
    || face.axes.length !== 2 || face.axes.some((axis) => !Number.isInteger(axis) || axis < 0 || axis > 2)
    || face.axes[0] === face.axes[1] || !face.loops.some((loop) => !loop.hole)
    || face.loops.some((loop) => loop.points.length < 4 || !loop.points.every(finite2)
      || loop.points.some((vertex, i) => !Number.isFinite(vertex.distanceToSquared(loop.points[(i + 1) % loop.points.length])))
      || loop.points[0].distanceTo(loop.points.at(-1)!) > EPS)) return null
  const normal = face.normal.clone().normalize(), unit = direction.clone().normalize()
  if (Math.abs(point.clone().sub(face.origin).dot(normal)) > EPS
    || Math.abs(unit.dot(normal)) > NUMERIC_EPS) return null
  const end = point.clone().addScaledVector(unit, threshold)
  if (!finite3(end)) return null
  const flatten = (position: THREE.Vector3) => {
    const delta = position.clone().sub(face.origin)
    return new THREE.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]))
  }
  const start = flatten(point), ray = new THREE.Vector2(unit.getComponent(face.axes[0]), unit.getComponent(face.axes[1]))
  if (!finite2(start) || !finite2(ray) || ray.lengthSq() <= NUMERIC_EPS * NUMERIC_EPS) return null
  const cuts = [0, threshold]
  for (const loop of face.loops) for (let i = 0, j = loop.points.length - 1; i < loop.points.length; j = i++) {
    const a = loop.points[j], b = loop.points[i], edge = b.clone().sub(a), delta = a.clone().sub(start)
    const determinant = cross(ray, edge)
    if (Math.abs(determinant) > NUMERIC_EPS * Math.max(1, edge.length())) {
      const distance = cross(delta, edge) / determinant, fraction = cross(delta, ray) / determinant
      if (Number.isFinite(distance) && Number.isFinite(fraction)
        && distance > 0 && distance < threshold && fraction >= -NUMERIC_EPS && fraction <= 1 + NUMERIC_EPS)
        cuts.push(distance)
    } else if (Math.abs(cross(delta, ray)) <= NUMERIC_EPS * ray.length()) {
      // A ray can overlap a genuine material edge after crossing a relief.
      // Both ends delimit that occupied interval, even without a transverse hit.
      for (const vertex of [a, b]) {
        const distance = vertex.clone().sub(start).dot(ray) / ray.lengthSq()
        if (distance > 0 && distance < threshold) cuts.push(distance)
      }
    }
  }
  cuts.sort((a, b) => a - b)
  const unique = cuts.filter((value, index) => index === 0 || value - cuts[index - 1] > NUMERIC_EPS)
  let voidSeen = false
  for (let i = 1; i < unique.length; i++) {
    const from = unique[i - 1], to = unique[i]
    if (to - from <= NUMERIC_EPS) continue
    const occupied = materialAt(start.clone().addScaledVector(ray, (from + to) / 2), face)
    if (!occupied) voidSeen = true
    else if (voidSeen && from > 0 && from < threshold) return from
  }
  return null
}
