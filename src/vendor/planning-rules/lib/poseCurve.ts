import * as THREE from 'three'

export interface PoseCurveKey { s: number; quaternion: THREE.Quaternion }

interface PoseCurveSegment {
  start: number
  end: number
  /** Cubic Bezier controls of the world rotation vector, in radians. */
  controls: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]
}

/** C1 attitude curve; TCP geometry remains on the original path. */
export interface PoseCurve {
  start: number
  end: number
  keys: PoseCurveKey[]
  referenceQuaternion: THREE.Quaternion
  segments: PoseCurveSegment[]
}

export interface PoseCurveOptions {
  /** World angular velocity per path unit, matched at the boundary. Defaults to zero. */
  startAngularVelocity?: THREE.Vector3
  endAngularVelocity?: THREE.Vector3
  /** Explicit rotation-vector derivative, overriding the angular-velocity option. */
  startDerivative?: THREE.Vector3
  endDerivative?: THREE.Vector3
}

const EPS = 1e-12
const TAU = 2 * Math.PI

function negateQuaternion(q: THREE.Quaternion): void {
  q.set(-q.x, -q.y, -q.z, -q.w)
}

/** Choose the logarithm branch nearest the preceding vector, including a crossing of pi. */
function rotationVector(q: THREE.Quaternion, previous: THREE.Vector3): THREE.Vector3 {
  const relative = q.clone().normalize()
  if (relative.w < 0) negateQuaternion(relative)
  const sinHalf = Math.hypot(relative.x, relative.y, relative.z)
  if (sinHalf < EPS) {
    const turns = Math.round(previous.length() / TAU)
    return previous.lengthSq() > EPS && turns > 0
      ? previous.clone().normalize().multiplyScalar(turns * TAU) : new THREE.Vector3()
  }
  const axis = new THREE.Vector3(relative.x, relative.y, relative.z).divideScalar(sinHalf)
  const angle = 2 * Math.atan2(sinHalf, Math.max(0, relative.w))
  const center = Math.round((previous.dot(axis) - angle) / TAU)
  let best = axis.clone().multiplyScalar(angle + center * TAU)
  let bestDistance = best.distanceToSquared(previous)
  for (const turn of [center - 1, center + 1]) {
    const candidate = axis.clone().multiplyScalar(angle + turn * TAU)
    const distance = candidate.distanceToSquared(previous)
    if (distance < bestDistance) { best = candidate; bestDistance = distance }
  }
  return best
}

/** Inverse left Jacobian of SO(3): world angular velocity -> rotation-vector derivative. */
function derivativeFromAngularVelocity(v: THREE.Vector3, velocity: THREE.Vector3): THREE.Vector3 {
  if (velocity.lengthSq() < EPS) return new THREE.Vector3()
  const theta = v.length()
  const cross = v.clone().cross(velocity)
  const cross2 = v.clone().cross(cross)
  if (theta < 1e-5) return velocity.clone().addScaledVector(cross, -0.5).addScaledVector(cross2, 1 / 12)
  if (Math.abs(Math.sin(theta / 2)) < 1e-8) {
    throw new RangeError('A nonzero boundary angular velocity cannot use a rotation-vector chart at a full turn')
  }
  const coefficient = (1 - (theta / 2) / Math.tan(theta / 2)) / (theta * theta)
  return velocity.clone().addScaledVector(cross, -0.5).addScaledVector(cross2, coefficient)
}

/** Nonuniform tangents with rotation-invariant speed/direction limits. */
function interiorDerivative(
  previous: THREE.Vector3, current: THREE.Vector3, next: THREE.Vector3,
  before: number, after: number,
): THREE.Vector3 {
  const incoming = current.clone().sub(previous).divideScalar(before)
  const outgoing = next.clone().sub(current).divideScalar(after)
  const derivative = incoming.clone().multiplyScalar(after).addScaledVector(outgoing, before)
    .divideScalar(before + after)
  // A tangent must advance along both adjacent rotations. At a true reversal it
  // becomes zero; bounding its norm also keeps a tiny adjacent span from overshooting.
  if (derivative.dot(incoming) <= 0 || derivative.dot(outgoing) <= 0) return new THREE.Vector3()
  const limit = 3 * Math.min(incoming.length(), outgoing.length())
  if (derivative.length() > limit) derivative.setLength(limit)
  return derivative
}

export function createPoseCurve(input: PoseCurveKey[], options: PoseCurveOptions = {}): PoseCurve {
  if (input.length < 2) throw new RangeError('An attitude curve needs at least two distinct path keys')
  if (input.some((key) => key.quaternion.lengthSq() < EPS || !key.quaternion.toArray().every(Number.isFinite))) {
    throw new RangeError('Attitude curve quaternions must be finite and nonzero')
  }
  const keys = input.map(({ s, quaternion }) => ({ s, quaternion: quaternion.clone().normalize() }))
    .sort((a, b) => a.s - b.s)
  for (let i = 0; i < keys.length; i++) {
    if (!Number.isFinite(keys[i].s) || !keys[i].quaternion.toArray().every(Number.isFinite)
      || (i > 0 && keys[i].s <= keys[i - 1].s)) throw new RangeError('Attitude curve keys must have finite, distinct coordinates')
    if (i > 0 && keys[i].quaternion.dot(keys[i - 1].quaternion) < 0) negateQuaternion(keys[i].quaternion)
  }
  const referenceQuaternion = keys[0].quaternion.clone()
  const inverseReference = referenceQuaternion.clone().invert()
  const vectors: THREE.Vector3[] = []
  for (const key of keys) vectors.push(rotationVector(key.quaternion.clone().multiply(inverseReference),
    vectors[vectors.length - 1] ?? new THREE.Vector3()))
  const last = keys.length - 1
  const derivative = vectors.map((v, i) => {
    if (i === 0) return options.startDerivative?.clone()
      ?? derivativeFromAngularVelocity(v, options.startAngularVelocity ?? new THREE.Vector3())
    if (i === last) return options.endDerivative?.clone()
      ?? derivativeFromAngularVelocity(v, options.endAngularVelocity ?? new THREE.Vector3())
    return interiorDerivative(vectors[i - 1], v, vectors[i + 1], keys[i].s - keys[i - 1].s, keys[i + 1].s - keys[i].s)
  })
  if (derivative.some((v) => !v.toArray().every(Number.isFinite))) throw new RangeError('Attitude curve derivatives must be finite')
  const segments = keys.slice(0, -1).map((key, i): PoseCurveSegment => {
    const span = keys[i + 1].s - key.s
    return {
      start: key.s, end: keys[i + 1].s,
      controls: [vectors[i].clone(), vectors[i].clone().addScaledVector(derivative[i], span / 3),
        vectors[i + 1].clone().addScaledVector(derivative[i + 1], -span / 3), vectors[i + 1].clone()],
    }
  })
  return { start: keys[0].s, end: keys[last].s, keys, referenceQuaternion, segments }
}

export function poseCurveQuaternionAt(curve: PoseCurve, s: number): THREE.Quaternion {
  if (s <= curve.start) return curve.keys[0].quaternion.clone()
  if (s >= curve.end) return curve.keys[curve.keys.length - 1].quaternion.clone()
  const segment = curve.segments.find((piece) => s <= piece.end)!
  const t = (s - segment.start) / (segment.end - segment.start)
  const u = 1 - t
  const [p0, p1, p2, p3] = segment.controls
  const v = p0.clone().multiplyScalar(u ** 3).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t ** 3)
  const angle = v.length()
  const rotation = angle > EPS ? new THREE.Quaternion().setFromAxisAngle(v.divideScalar(angle), angle)
    : new THREE.Quaternion()
  return rotation.multiply(curve.referenceQuaternion).normalize()
}

/** Exact world angular velocity per path unit, including the one-sided boundary values. */
export function poseCurveAngularVelocityAt(curve: PoseCurve, s: number): THREE.Vector3 {
  if (s < curve.start || s > curve.end) return new THREE.Vector3()
  const segment = curve.segments.find((piece) => s <= piece.end)!
  const span = segment.end - segment.start
  const t = (s - segment.start) / span, u = 1 - t
  const [p0, p1, p2, p3] = segment.controls
  const v = p0.clone().multiplyScalar(u ** 3).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t ** 3)
  const derivative = p1.clone().sub(p0).multiplyScalar(3 * u * u / span)
    .addScaledVector(p2.clone().sub(p1), 6 * u * t / span)
    .addScaledVector(p3.clone().sub(p2), 3 * t * t / span)
  const theta = v.length()
  const cross = v.clone().cross(derivative)
  const cross2 = v.clone().cross(cross)
  const a = theta < 1e-5 ? 0.5 : (1 - Math.cos(theta)) / (theta * theta)
  const b = theta < 1e-5 ? 1 / 6 : (theta - Math.sin(theta)) / (theta ** 3)
  return derivative.addScaledVector(cross, a).addScaledVector(cross2, b)
}

/**
 * Conservative accumulated rotation (radians) inside [a,b]. The SO(3) exponential's
 * Jacobian has operator norm <=1. Its angular speed is therefore bounded by the
 * rotation-vector derivative, a quadratic Bezier within the derivative control hull.
 * Clipping the derivative Bezier to the requested interval keeps refinement useful.
 */
export function poseCurveRotationBound(curve: PoseCurve, a: number, b: number): number {
  const low = Math.min(a, b), high = Math.max(a, b)
  let bound = 0
  for (const segment of curve.segments) {
    const start = Math.max(low, segment.start), end = Math.min(high, segment.end)
    if (end <= start) continue
    const span = segment.end - segment.start
    const t0 = (start - segment.start) / span, t1 = (end - segment.start) / span
    const [p0, p1, p2, p3] = segment.controls
    const d0 = p1.clone().sub(p0).multiplyScalar(3)
    const d1 = p2.clone().sub(p1).multiplyScalar(3)
    const d2 = p3.clone().sub(p2).multiplyScalar(3)
    const valueAt = (t: number) => d0.clone().multiplyScalar((1 - t) ** 2)
      .addScaledVector(d1, 2 * (1 - t) * t).addScaledVector(d2, t * t)
    const first = valueAt(t0)
    const last = valueAt(t1)
    const middle = first.clone().addScaledVector(d1.clone().sub(d0), (t1 - t0) * (1 - t0))
      .addScaledVector(d2.clone().sub(d1), (t1 - t0) * t0)
    bound += (t1 - t0) * Math.max(first.length(), middle.length(), last.length())
  }
  return bound
}

export function shiftPoseCurve(curve: PoseCurve, offset: number): PoseCurve {
  if (!Number.isFinite(offset)) throw new RangeError('Attitude curve shift must be finite')
  return {
    start: curve.start + offset, end: curve.end + offset,
    referenceQuaternion: curve.referenceQuaternion.clone(),
    keys: curve.keys.map((key) => ({ s: key.s + offset, quaternion: key.quaternion.clone() })),
    segments: curve.segments.map((segment) => ({ start: segment.start + offset, end: segment.end + offset,
      controls: segment.controls.map((v) => v.clone()) as PoseCurveSegment['controls'] })),
  }
}
