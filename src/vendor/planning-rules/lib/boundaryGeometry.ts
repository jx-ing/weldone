import * as THREE from 'three'

const EPS = 1e-9

export interface BoundaryProjectionSpan {
  startS: number
  endS: number
  startPoint: THREE.Vector3
  endPoint: THREE.Vector3
  startBoundaryPoint: THREE.Vector3
  endBoundaryPoint: THREE.Vector3
  startDistance: number
  endDistance: number
  minDistance: number
}

/** Parameter range where |origin + u * delta| <= radius, restricted to [lo, hi]. */
function distanceInterval(origin: THREE.Vector3, delta: THREE.Vector3, radius: number, lo: number, hi: number): [number, number] | null {
  const a = delta.lengthSq()
  const b = origin.dot(delta)
  const c = origin.lengthSq() - radius * radius
  if (a < 1e-20) return c <= 1e-10 ? [lo, hi] : null
  const discriminant = b * b - a * c
  if (discriminant < -1e-8 * Math.max(1, a)) return null
  const root = Math.sqrt(Math.max(0, discriminant))
  const start = Math.max(lo, (-b - root) / a)
  const end = Math.min(hi, (-b + root) / a)
  return start <= end + EPS ? [start, Math.max(start, end)] : null
}

/**
 * Continuous proximity to the CAD polyline, with projection measured in weld arc
 * length. A closed boundary is evaluated over all its segments, not start/end.
 * Orthogonal projections are solved analytically; no sampling pitch can hide
 * a crossing or add a split at every chord of a faceted circle. Internal chord
 * end-caps are excluded; the two actual weld endpoint caps remain available
 * for endpoint proximity display.
 */
export function boundaryProjectionSpans(
  weld: THREE.Vector3[], boundary: THREE.Vector3[], distance: number,
): BoundaryProjectionSpan[] {
  if (weld.length < 2 || boundary.length < 2 || !Number.isFinite(distance) || distance < 0) return []
  const pieces: BoundaryProjectionSpan[] = []
  let accumulated = 0
  for (let wi = 0; wi + 1 < weld.length; wi++) {
    const start = weld[wi]
    const vector = weld[wi + 1].clone().sub(start)
    const length = vector.length()
    if (length < EPS) continue
    const direction = vector.clone().divideScalar(length)
    for (let bi = 0; bi + 1 < boundary.length; bi++) {
      const a = boundary[bi]
      const b = boundary[bi + 1]
      if (['x', 'y', 'z'].some((axis) => {
        const key = axis as 'x' | 'y' | 'z'
        return Math.max(a[key], b[key]) < Math.min(start[key], weld[wi + 1][key]) - distance
          || Math.min(a[key], b[key]) > Math.max(start[key], weld[wi + 1][key]) + distance
      })) continue
      const delta = b.clone().sub(a)
      if (delta.lengthSq() < EPS * EPS) continue
      const relative = a.clone().sub(start)
      const axial = relative.dot(direction)
      const slope = delta.dot(direction)
      const breaks = [0, 1]
      if (Math.abs(slope) > EPS) {
        for (const value of [-axial / slope, (length - axial) / slope]) {
          if (value > EPS && value < 1 - EPS) breaks.push(value)
        }
      }
      breaks.sort((x, y) => x - y)
      for (let i = 0; i + 1 < breaks.length; i++) {
        const lo = breaks[i]
        const hi = breaks[i + 1]
        const midpointProjection = axial + slope * (lo + hi) / 2
        // This interval lies wholly before/after the finite weld chord. Its
        // spherical end-cap proximity is not an offset projection. Clamping
        // it onto the chord creates one false zero-width span per arc sample.
        // Keep genuine transverse crossings (slope=0, projection in range),
        // including zero-width spans at a real chord endpoint. The first and
        // last weld endpoint caps still describe real endpoint proximity;
        // weldSplit already excludes them from internal split points.
        const before = midpointProjection < -EPS
        const after = midpointProjection > length + EPS
        if (before && wi !== 0 || after && wi !== weld.length - 2) continue
        const residual = relative.clone()
        const residualDelta = delta.clone()
        if (!before && !after) {
          residual.addScaledVector(direction, -axial)
          residualDelta.addScaledVector(direction, -slope)
        } else if (after) residual.sub(vector)
        const interval = distanceInterval(residual, residualDelta, distance, lo, hi)
        if (!interval) continue
        const at = (u: number) => {
          const boundaryPoint = a.clone().addScaledVector(delta, u)
          const along = THREE.MathUtils.clamp(axial + slope * u, 0, length)
          const point = start.clone().addScaledVector(direction, along)
          return { s: accumulated + along, point, boundaryPoint, distance: point.distanceTo(boundaryPoint) }
        }
        const first = at(interval[0])
        const last = at(interval[1])
        const uMin = residualDelta.lengthSq() > 1e-20
          ? THREE.MathUtils.clamp(-residual.dot(residualDelta) / residualDelta.lengthSq(), interval[0], interval[1])
          : interval[0]
        const minDistance = residual.clone().addScaledVector(residualDelta, uMin).length()
        const [left, right] = first.s <= last.s ? [first, last] : [last, first]
        pieces.push({ startS: left.s, endS: right.s, startPoint: left.point, endPoint: right.point,
          startBoundaryPoint: left.boundaryPoint, endBoundaryPoint: right.boundaryPoint,
          startDistance: left.distance, endDistance: right.distance, minDistance })
      }
    }
    accumulated += length
  }
  return mergeBoundarySpans(pieces)
}

/** Merge overlapping projections before creating split points. */
export function mergeBoundarySpans(pieces: BoundaryProjectionSpan[]): BoundaryProjectionSpan[] {
  const merged: BoundaryProjectionSpan[] = []
  for (const span of [...pieces].sort((a, b) => a.startS - b.startS || a.endS - b.endS)) {
    const previous = merged.at(-1)
    if (!previous || span.startS > previous.endS + 1e-7) {
      merged.push({ ...span })
      continue
    }
    previous.minDistance = Math.min(previous.minDistance, span.minDistance)
    if (span.endS > previous.endS) {
      previous.endS = span.endS
      previous.endPoint = span.endPoint
      previous.endBoundaryPoint = span.endBoundaryPoint
      previous.endDistance = span.endDistance
    }
  }
  return merged
}

/** First actual CAD boundary hit along an outward ray, never a lateral near point.
 * The 2 micron tolerance covers independent 0.001 mm export rounding only.
 */
export function axialBoundaryHit(
  origin: THREE.Vector3, direction: THREE.Vector3, boundary: THREE.Vector3[], tolerance = 0.002,
): { distance: number; point: THREE.Vector3 } | null {
  if (direction.lengthSq() < EPS || boundary.length < 2) return null
  const ray = new THREE.Ray(origin, direction.clone().normalize())
  const rayPoint = new THREE.Vector3()
  const edgePoint = new THREE.Vector3()
  let best: { distance: number; point: THREE.Vector3 } | null = null
  for (let i = 0; i + 1 < boundary.length; i++) {
    if (boundary[i].distanceToSquared(boundary[i + 1]) < EPS * EPS) continue
    const segment = boundary[i + 1].clone().sub(boundary[i])
    // THREE's parallel closest-point solution can choose either end of a
    // collinear segment. A ray hit requires the first positive end instead.
    if (segment.clone().cross(ray.direction).lengthSq() <= segment.lengthSq() * 1e-16) {
      const first = boundary[i].clone().sub(origin)
      const last = boundary[i + 1].clone().sub(origin)
      const firstS = first.dot(ray.direction)
      const lastS = last.dot(ray.direction)
      const distance = Math.min(firstS, lastS)
      if (distance <= tolerance || (best && distance >= best.distance)
        || first.addScaledVector(ray.direction, -firstS).length() > tolerance
        || last.addScaledVector(ray.direction, -lastS).length() > tolerance) continue
      best = { distance, point: ray.at(distance, new THREE.Vector3()) }
      continue
    }
    const residualSq = ray.distanceSqToSegment(boundary[i], boundary[i + 1], rayPoint, edgePoint)
    if (residualSq > tolerance * tolerance) continue
    const distance = rayPoint.clone().sub(origin).dot(ray.direction)
    if (distance < -tolerance || (best && distance >= best.distance)) continue
    // A transverse boundary at the endpoint is a zero gap, so do not cross it
    // and pick a farther opposite side of a hole. Only collinear supports above
    // are ignored at the origin.
    best = { distance: Math.max(0, distance), point: rayPoint.clone() }
  }
  return best
}
