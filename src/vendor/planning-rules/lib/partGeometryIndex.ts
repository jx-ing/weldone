import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { Part } from '@/types/weld'

export interface PartGeometryIndex {
  geometry: THREE.BufferGeometry
  tree: MeshBVH | null
  vertexOffset: number
  vertexCount: number
}

// Model buffers and part records define geometry ownership. A part from another
// layout of the same buffer must never borrow an index just because its id matches.
const indexes = new WeakMap<Float32Array, WeakMap<Part, PartGeometryIndex>>()

/** Lazy, shared index; never reorder or modify the source model triangles. */
export function getPartGeometryIndex(mesh: Float32Array, part: Part): PartGeometryIndex {
  let byPart = indexes.get(mesh)
  if (!byPart) { byPart = new WeakMap(); indexes.set(mesh, byPart) }
  const cached = byPart.get(part)
  if (cached && cached.vertexOffset === part.vertexOffset && cached.vertexCount === part.vertexCount) return cached
  const geometry = new THREE.BufferGeometry()
  const data = new THREE.InterleavedBuffer(mesh.subarray(part.vertexOffset * 6,
    (part.vertexOffset + part.vertexCount) * 6), 6)
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0))
  geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(data, 3, 3))
  const tree = part.vertexCount >= 3 ? new MeshBVH(geometry, { indirect: true }) : null
  if (tree) geometry.boundsTree = tree
  const result = { geometry, tree, vertexOffset: part.vertexOffset, vertexCount: part.vertexCount }
  byPart.set(part, result)
  return result
}
