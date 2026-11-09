import * as THREE from 'three'
import type { Edge } from '@/types/weld'

export interface LegacyFaceFootprint {
  origin: THREE.Vector3
  normal: THREE.Vector3
  axes: [number, number]
  loops: { hole: boolean; points: THREE.Vector2[] }[]
}

const EPS = .01
const cache = new WeakMap<Edge[], LegacyFaceFootprint | null>()
const vector = (point: number[]) => new THREE.Vector3().fromArray(point)
const finite = (point: number[]) => point.length === 3 && point.every(Number.isFinite)

/** Older exports lack wire IDs, but some faces still contain every boundary edge.
 * Accept only unique closed chains on one plane; partial, branching, crossing or
 * nonplanar evidence cannot veto an extension. This does not create CAD semantics
 * for gap detection or authorize a wrap at a new endpoint. */
export function legacyFaceFootprint(edges: Edge[]): LegacyFaceFootprint | null {
  if (cache.has(edges)) return cache.get(edges)!
  const result = reconstruct(edges)
  cache.set(edges, result)
  return result
}

function reconstruct(edges: Edge[]): LegacyFaceFootprint | null {
  if (!edges.length || edges.some((edge) => !['outer', 'inner'].includes(edge.wire)
    || edge.points.length < 2 || !edge.points.every(finite)
    || !finite(edge.start) || !finite(edge.end)
    || vector(edge.start).distanceTo(vector(edge.points[0])) > EPS
    || vector(edge.end).distanceTo(vector(edge.points.at(-1)!)) > EPS)) return null
  const nodes: { point: THREE.Vector3; edges: number[] }[] = []
  const ends = edges.map((edge, i) => [edge.start, edge.end].map((point) => {
    const p = vector(point), matches = nodes.flatMap((node, n) => node.point.distanceTo(p) <= EPS ? [n] : [])
    if (matches.length > 1) return -1
    const n = matches[0] ?? nodes.push({ point: p, edges: [] }) - 1
    nodes[n].edges.push(i)
    return n
  }))
  if (ends.some((pair) => pair.includes(-1)) || nodes.some((node) => node.edges.length !== 2)) return null
  const used = new Set<number>(), loops: { hole: boolean; points: THREE.Vector3[] }[] = []
  for (let first = 0; first < edges.length; first++) {
    if (used.has(first)) continue
    const start = ends[first][0], points: THREE.Vector3[] = [], hole = edges[first].wire === 'inner'
    let current = first, node = start
    while (!used.has(current)) {
      const edge = edges[current]
      if ((edge.wire === 'inner') !== hole) return null
      const forward = ends[current][0] === node
      const samples = edge.points.map(vector)
      if (!forward) samples.reverse()
      if (points.length && points.at(-1)!.distanceTo(samples[0]) > EPS) return null
      points.push(...(points.length ? samples.slice(1) : samples))
      used.add(current)
      node = ends[current][forward ? 1 : 0]
      if (node === start) break
      const next = nodes[node].edges.filter((i) => !used.has(i))
      if (next.length !== 1) return null
      current = next[0]
    }
    if (node !== start || points.length < 4 || points[0].distanceTo(points.at(-1)!) > EPS) return null
    loops.push({ hole, points })
  }
  if (!loops.some((loop) => !loop.hole)) return null
  const allPoints = loops.flatMap((loop) => loop.points), origin = allPoints[0]
  const longest = allPoints.reduce((a, b) => a.distanceToSquared(origin) > b.distanceToSquared(origin) ? a : b)
    .clone().sub(origin)
  const normal = allPoints.map((point) => longest.clone().cross(point.clone().sub(origin)))
    .reduce((a, b) => a.lengthSq() > b.lengthSq() ? a : b).normalize()
  if (normal.lengthSq() < .99 || allPoints.some((point) => Math.abs(point.clone().sub(origin).dot(normal)) > EPS)) return null
  const drop = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)))
  const axes = [0, 1, 2].filter((axis) => axis !== drop) as [number, number]
  const flat = loops.map((loop) => ({ hole: loop.hole, points: loop.points.map((point) => {
    const delta = point.clone().sub(origin)
    return new THREE.Vector2(delta.getComponent(axes[0]), delta.getComponent(axes[1]))
  }) }))
  const cross = (a: THREE.Vector2, b: THREE.Vector2) => a.x * b.y - a.y * b.x
  const segments = flat.flatMap((loop, l) => loop.points.slice(1).map((end, i) => ({ a: loop.points[i], b: end, l, i, count: loop.points.length - 1 })))
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i], b = segments[j]
    if (a.l === b.l && (Math.abs(a.i - b.i) === 1 || Math.abs(a.i - b.i) === a.count - 1)) continue
    const u = a.b.clone().sub(a.a), v = b.b.clone().sub(b.a), delta = b.a.clone().sub(a.a), determinant = cross(u, v)
    if (Math.abs(determinant) < 1e-9) {
      if (Math.abs(cross(delta, u)) < EPS * u.length()) {
        const t = delta.dot(u) / (u.lengthSq() || 1), s = b.b.clone().sub(a.a).dot(u) / (u.lengthSq() || 1)
        if (Math.max(Math.min(t, s), 0) <= Math.min(Math.max(t, s), 1)) return null
      }
      continue
    }
    const t = cross(delta, v) / determinant, s = cross(delta, u) / determinant
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return null
  }
  return { origin, normal, axes, loops: flat }
}
