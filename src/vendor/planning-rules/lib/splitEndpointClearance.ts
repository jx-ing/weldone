import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { PartsData } from '@/types/weld'
import type { PathSample } from './torch'

type Solid = { box: THREE.Box3; tree: MeshBVH; closed: boolean }
const cache = new WeakMap<Float32Array, Map<string, Solid>>()
const SURFACE_TOLERANCE = .01

function solidOf(parts: PartsData, mesh: Float32Array, partId: string): Solid | null {
  let solids = cache.get(mesh)
  if (!solids) { solids = new Map(); cache.set(mesh, solids) }
  const cached = solids.get(partId)
  if (cached) return cached
  const part = parts.parts.find((part) => part.id === partId)
  if (!part || part.vertexCount < 3 || part.vertexCount % 3 !== 0) return null
  const positions = new Float32Array(part.vertexCount * 3)
  for (let i = 0; i < part.vertexCount; i++) positions.set(mesh.subarray((part.vertexOffset + i) * 6, (part.vertexOffset + i) * 6 + 3), i * 3)
  if (!positions.every(Number.isFinite)) return null
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  const edges = new Map<string, number>(), key = (i: number) => `${positions[i]},${positions[i + 1]},${positions[i + 2]}`
  let closed = part.vertexCount >= 12
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [key(i), key(i + 3), key(i + 6)]
    if (new Set(vertices).size !== 3) closed = false
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3], edge = a < b ? `${a}|${b}` : `${b}|${a}`
      edges.set(edge, (edges.get(edge) ?? 0) + 1)
    }
  }
  closed &&= [...edges.values()].every((count) => count === 2)
  const result = { box: geometry.boundingBox!, tree: new MeshBVH(geometry, { indirect: true }), closed }
  solids.set(partId, result)
  return result
}

function inside(solid: Solid, point: THREE.Vector3): boolean {
  if (!solid.closed || !solid.box.containsPoint(point)) return false
  let votes = 0
  for (const direction of [new THREE.Vector3(1, .371, .529), new THREE.Vector3(.217, 1, .613), new THREE.Vector3(.433, .293, 1)]) {
    const distances = solid.tree.raycast(new THREE.Ray(point, direction.normalize()), THREE.DoubleSide, 1e-7)
      .map((hit) => hit.distance).sort((a, b) => a - b)
    let previous = -Infinity, count = 0
    for (const distance of distances) if (distance - previous > 1e-5) { count++; previous = distance }
    if (count % 2 === 1) votes++
  }
  return votes >= 2
}

/** A split's offset distance is not axial clearance. Recheck only its associated
 * finite obstacle meshes at the current TCP and outward travel tangent. Closed
 * solid containment/surface contact is zero; otherwise use a real forward ray hit.
 * Missing evidence stays null and cannot alone authorize a pose-change action. */
export function splitEndpointAxialClearance(
  sample: Pick<PathSample, 'pos' | 'tangent'>, which: 'start' | 'end',
  parts: PartsData, mesh: Float32Array, associatedPartIds: Iterable<string>,
): number | null {
  if (![...sample.pos.toArray(), ...sample.tangent.toArray()].every(Number.isFinite) || sample.tangent.lengthSq() < 1e-12) return null
  const direction = sample.tangent.clone().normalize().multiplyScalar(which === 'start' ? -1 : 1)
  const ray = new THREE.Ray(sample.pos, direction)
  let distance = Infinity
  for (const id of new Set(associatedPartIds)) {
    const solid = solidOf(parts, mesh, id)
    if (!solid) continue
    if (solid.box.distanceToPoint(sample.pos) <= SURFACE_TOLERANCE) {
      const nearest = solid.tree.closestPointToPoint(sample.pos)
      if ((nearest && nearest.distance <= SURFACE_TOLERANCE) || inside(solid, sample.pos)) return 0
    }
    if (!ray.intersectsBox(solid.box)) continue
    const hit = solid.tree.raycastFirst(ray, THREE.DoubleSide, 0)
    if (hit && Number.isFinite(hit.distance) && hit.distance >= 0) distance = Math.min(distance, hit.distance)
  }
  return Number.isFinite(distance) ? distance : null
}
