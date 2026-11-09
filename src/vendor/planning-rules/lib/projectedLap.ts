import * as THREE from 'three'
import type { Weld } from '@/types/weld'

const triple = (value: unknown): value is [number, number, number] => Array.isArray(value)
  && value.length === 3 && value.every(Number.isFinite)

/** Pose support comes from the corresponding original collar sidewall, not
 * the nearest triangle on a collar body intentionally left across the gap. */
export function projectedLapNormalsAt(weld: Weld, point: number[]): {
  nMain: THREE.Vector3; nSub: THREE.Vector3
} | null {
  const evidence = weld.properties['投影搭接'] as {
    projectedPoints?: number[][]; sourceNormals?: number[][]; hostNormal?: number[]
  } | undefined
  if (!evidence || !triple(evidence.hostNormal) || !Array.isArray(evidence.projectedPoints)
    || !Array.isArray(evidence.sourceNormals) || evidence.projectedPoints.length < 2
    || evidence.projectedPoints.length !== evidence.sourceNormals.length) return null
  const points = evidence.projectedPoints, normals = evidence.sourceNormals
  let best = Infinity, closest: THREE.Vector3 | null = null
  const p = new THREE.Vector3().fromArray(point)
  for (let i = 1; i < points.length; i++) {
    if (![points[i - 1], points[i], normals[i - 1], normals[i]].every(triple)) return null
    const a = new THREE.Vector3().fromArray(points[i - 1])
    const delta = new THREE.Vector3().fromArray(points[i]).sub(a)
    const length = delta.lengthSq()
    const t = length > 1e-20 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(delta) / length, 0, 1) : 0
    const distance = a.addScaledVector(delta, t).distanceToSquared(p)
    if (distance < best) {
      best = distance
      closest = new THREE.Vector3().fromArray(normals[i - 1]).lerp(new THREE.Vector3().fromArray(normals[i]), t)
    }
  }
  const host = new THREE.Vector3().fromArray(evidence.hostNormal)
  return closest && closest.lengthSq() > 1e-12 && host.lengthSq() > 1e-12
    ? { nMain: closest.normalize(), nSub: host.normalize() } : null
}
