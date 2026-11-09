import { Line3, Vector3 } from 'three'
import type { Edge, Weld } from '@/types/weld'

// Native vertices use six-decimal millimetres. Fit validation is deliberately
// tighter than the established 0.002 mm (two micrometre) geometry comparison
// tolerance also used by axialBoundaryHit. Neither changes an offset setting.
const FIT_TOLERANCE = 2e-6
const GEOMETRY_TOLERANCE = .002
const TAU = Math.PI * 2
type Arc = { center: Vector3; normal: Vector3; radius: number; first: Vector3; last: Vector3;
  u: Vector3; v: Vector3; sweep: number }
const vec = (p: number[]) => new Vector3().fromArray(p)
function contains(a: Arc, p: Vector3): boolean {
  const d = p.clone().sub(a.center)
  let angle = Math.atan2(d.dot(a.v), d.dot(a.u))
  if (angle < -1e-9) angle += TAU
  return angle <= a.sweep + 1e-9 || TAU - angle <= 1e-9
}

/** Recover only an already identified native circle; ordinary polylines and
 * sparse guessed curves never acquire a circle from this check. */
function nativeArc(type: string, raw: number[][], expected: unknown): Arc | null {
  if (!['圆弧', '圆'].includes(type) || typeof expected !== 'number' || !Number.isFinite(expected) || expected <= 0
    || raw.length < 3 || raw.some(p => p.length !== 3 || !p.every(Number.isFinite))) return null
  const points = raw.map(vec), first = points[0], last = points.at(-1)!
  const b = points.reduce((best, p) => p.distanceToSquared(first) > best.distanceToSquared(first) ? p : best, first).clone().sub(first)
  const c = points.reduce((best, p) => b.clone().cross(p.clone().sub(first)).lengthSq()
    > b.clone().cross(best.clone().sub(first)).lengthSq() ? p : best, first).clone().sub(first)
  const area = b.clone().cross(c), squared = area.lengthSq()
  if (squared < 1e-14) return null
  const center = first.clone().add(c.clone().cross(area).multiplyScalar(b.lengthSq())
    .add(area.clone().cross(b).multiplyScalar(c.lengthSq())).multiplyScalar(1 / (2 * squared)))
  let normal = area.normalize(), radius = first.distanceTo(center)
  if (Math.abs(radius - expected) > GEOMETRY_TOLERANCE || points.some(p => Math.abs(p.distanceTo(center) - radius) > FIT_TOLERANCE
    || Math.abs(p.clone().sub(center).dot(normal)) > FIT_TOLERANCE)) return null
  let sweep = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].clone().sub(center), b = points[i].clone().sub(center)
    const delta = Math.atan2(normal.dot(a.clone().cross(b)), a.dot(b))
    if (i > 1 && Math.sign(delta) !== Math.sign(sweep) && Math.abs(delta) > 1e-8) return null
    sweep += delta
  }
  if (sweep < 0) { normal = normal.negate(); sweep = -sweep }
  if (sweep <= 1e-8 || sweep > TAU + 1e-7) return null
  // Retain the recovered radius: source radius is an independent validation,
  // not permission to move the exported finite arc endpoints.
  radius = first.distanceTo(center)
  const u = first.clone().sub(center).normalize(), v = normal.clone().cross(u)
  return { center, normal, radius, first, last, u, v, sweep }
}

function pointArcDistance(p: Vector3, a: Arc): number {
  const d = p.clone().sub(a.center), inPlane = d.clone().addScaledVector(a.normal, -d.dot(a.normal))
  const candidate = inPlane.lengthSq() > 1e-20 ? a.center.clone().add(inPlane.normalize().multiplyScalar(a.radius)) : null
  return Math.min(p.distanceTo(a.first), p.distanceTo(a.last), candidate && contains(a, candidate) ? p.distanceTo(candidate) : Infinity)
}

function arcLineDistance(a: Arc, first: Vector3, last: Vector3): number | null {
  if ([first, last].some(p => Math.abs(p.clone().sub(a.center).dot(a.normal)) > FIT_TOLERANCE)) return null
  const line = new Line3(first, last), delta = last.clone().sub(first), lengthSq = delta.lengthSq()
  if (lengthSq < 1e-20) return pointArcDistance(first, a)
  let min = Math.min(pointArcDistance(first, a), pointArcDistance(last, a),
    a.first.distanceTo(line.closestPointToPoint(a.first, true, new Vector3())),
    a.last.distanceTo(line.closestPointToPoint(a.last, true, new Vector3())))
  const closest = line.closestPointToPoint(a.center, false, new Vector3()), radial = closest.clone().sub(a.center)
  if (radial.lengthSq() > 1e-20) for (const sign of [-1, 1]) {
    const candidate = a.center.clone().add(radial.clone().normalize().multiplyScalar(sign * a.radius))
    const t = candidate.clone().sub(first).dot(delta) / lengthSq
    if (t >= 0 && t <= 1 && contains(a, candidate)) min = Math.min(min, candidate.distanceTo(line.at(t, new Vector3())))
  }
  const relative = first.clone().sub(a.center), b = relative.dot(delta), c = relative.lengthSq() - a.radius ** 2
  const discriminant = b * b - lengthSq * c
  if (discriminant >= 0) for (const sign of [-1, 1]) {
    const t = (-b + sign * Math.sqrt(discriminant)) / lengthSq
    if (t >= 0 && t <= 1 && contains(a, line.at(t, new Vector3()))) return 0
  }
  return min
}

function arcArcDistance(a: Arc, b: Arc): number | null {
  if (Math.abs(a.normal.dot(b.normal)) < 1 - 1e-10
    || Math.abs(b.center.clone().sub(a.center).dot(a.normal)) > FIT_TOLERANCE) return null
  let min = Math.min(pointArcDistance(a.first, b), pointArcDistance(a.last, b), pointArcDistance(b.first, a), pointArcDistance(b.last, a))
  const delta = b.center.clone().sub(a.center), d = delta.length()
  if (d < 1e-10) return min
  const axis = delta.clone().divideScalar(d)
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const pa = a.center.clone().addScaledVector(axis, sa * a.radius), pb = b.center.clone().addScaledVector(axis, sb * b.radius)
    if (contains(a, pa) && contains(b, pb)) min = Math.min(min, pa.distanceTo(pb))
  }
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d), acrossSq = a.radius ** 2 - along ** 2
  if (acrossSq >= 0) for (const sign of [-1, 1]) {
    const cross = a.center.clone().addScaledVector(axis, along)
      .addScaledVector(a.normal.clone().cross(axis), sign * Math.sqrt(acrossSq))
    if (contains(a, cross) && contains(b, cross)) return 0
  }
  return min
}

/** Return true only when native finite geometry proves that a polyline's
 * apparent near span is caused by chord sag. It never creates new spans or
 * changes third-part collision/contact detection. Unsupported shapes fall back. */
export function nativeArcBoundaryOutsideOffset(weld: Weld, edge: Edge, plannedBoundary: Vector3[], distance: number): boolean {
  if (weld.segments.length !== 1 || !Number.isFinite(distance) || distance <= 0) return false
  const segment = weld.segments[0], a = nativeArc(segment.type, segment.points, (segment as { radius?: number }).radius)
  if (!a) return false
  let min: number | null = null
  if (edge.type === '直线' && plannedBoundary.length === 2) min = arcLineDistance(a, plannedBoundary[0], plannedBoundary[1])
  else if (['圆弧', '圆'].includes(edge.type) && edge.center && edge.normal && typeof edge.radius === 'number'
    && edge.sourceTypes?.length && edge.sourceTypes.every(type => type === 'Circle')) {
    const b = nativeArc(edge.type, plannedBoundary.map(p => p.toArray()), edge.radius)
    if (b) min = arcArcDistance(a, b)
  }
  return min !== null && min >= distance - GEOMETRY_TOLERANCE
}
