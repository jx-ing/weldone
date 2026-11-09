import { Vector3 } from 'three'
import type { Edge, EdgesData, PartsData, Weld, WeldsData } from '@/types/weld'

const TOL = .025
type Circle = { center: Vector3; normal: Vector3; radius: number; points: Vector3[]; sweep: number }
type Shell = { partIds: string[]; center: Vector3; normal: Vector3; inner: number; outer: number; low: number; high: number }
export interface CompositeShellRing {
  key: string
  shellPartIds: string[]
  hostPartId: string
  hostFaceIndex: number
  center: number[]
  normal: number[]
  radius: number
}
export interface CompositeShellReference { weldId: string; reason: 'inner-wall' | 'shell-internal'; partIds: string[] }
const rec = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const vec = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
const v = (p: number[]) => new Vector3().fromArray(p)
const canonical = (n: Vector3) => { const a = n.toArray().find(x => Math.abs(x) > 1e-6) ?? 1; return a < 0 ? n.negate() : n }

/** Fit only an already identified native CAD circle; reject non-circular polylines. */
function circle(points: number[][], expectedRadius: number): Circle | null {
  if (points.length < 3 || !Number.isFinite(expectedRadius) || expectedRadius <= 0 || !points.every(vec)) return null
  const p = points.map(v), a = p[0]
  let best: { b: Vector3; c: Vector3; cross: Vector3; area: number } | null = null
  for (const bi of [Math.floor(p.length / 3), Math.floor(p.length / 2)]) for (const ci of [Math.floor(2 * p.length / 3), p.length - 1]) {
    const b = p[bi].clone().sub(a), c = p[ci].clone().sub(a), cross = b.clone().cross(c), area = cross.lengthSq()
    if (!best || area > best.area) best = { b, c, cross, area }
  }
  if (!best || best.area < 1e-8) return null
  const { b, c, cross, area } = best
  const center = a.clone().add(c.clone().cross(cross).multiplyScalar(b.lengthSq())
    .add(cross.clone().cross(b).multiplyScalar(c.lengthSq())).multiplyScalar(1 / (2 * area)))
  const normal = canonical(cross.normalize()), radius = a.distanceTo(center)
  // Legacy weld samples are rounded to 0.001 mm; a shallow, large-radius arc
  // magnifies that rounding in a three-point centre fit. The native radius is
  // still required, while every sample must fit the same plane and circle.
  if (Math.abs(radius - expectedRadius) > Math.max(TOL, expectedRadius * .00002) || p.some(q => Math.abs(q.clone().sub(center).dot(normal)) > TOL
    || Math.abs(q.distanceTo(center) - radius) > TOL)) return null
  let sweep = 0
  for (let i = 1; i < p.length; i++) {
    const x = p[i - 1].clone().sub(center).normalize(), y = p[i].clone().sub(center).normalize()
    sweep += Math.atan2(normal.dot(x.clone().cross(y)), x.dot(y))
  }
  return { center, normal, radius, points: p, sweep }
}

function edgeCircle(edge: Edge): Circle | null {
  return /圆/.test(edge.type) && typeof edge.radius === 'number' ? circle(edge.points, edge.radius) : null
}
function sameAxis(a: Circle, b: Circle): boolean {
  const delta = a.center.clone().sub(b.center)
  return Math.abs(a.normal.dot(b.normal)) > .999999 && delta.clone().addScaledVector(a.normal, -delta.dot(a.normal)).length() < TOL
}
function sameArc(a: Circle, b: Circle): boolean {
  return a.center.distanceTo(b.center) < TOL && Math.abs(a.radius - b.radius) < TOL
    && a.points[Math.floor(a.points.length / 2)].distanceTo(b.points[Math.floor(b.points.length / 2)]) < TOL
    && Math.abs(Math.abs(a.sweep) - Math.abs(b.sweep)) < .001
}
function completeRing(circles: Circle[]): boolean {
  if (!circles.length) return false
  const unique = circles.filter((item, i) => !circles.slice(0, i).some(other => sameArc(item, other)))
  const first = unique[0], u = first.points[0].clone().sub(first.center).normalize(), w = first.normal.clone().cross(u)
  const intervals: [number, number][] = []
  const tau = Math.PI * 2
  for (const item of unique) {
    let angle = Math.atan2(item.points[0].clone().sub(item.center).dot(w), item.points[0].clone().sub(item.center).dot(u))
    if (item.sweep < 0) angle += item.sweep
    angle = (angle % tau + tau) % tau
    const end = angle + Math.abs(item.sweep)
    if (end > tau) { intervals.push([angle, tau], [0, end - tau]) } else intervals.push([angle, end])
  }
  intervals.sort((a, b) => a[0] - b[0])
  let end = 0
  for (const interval of intervals) {
    // A complete shell cannot be inferred from coincident/overlapping halves.
    if (interval[0] > end + .001 || interval[0] < end - .001) return false
    end = Math.max(end, interval[1])
  }
  return Math.abs(end - tau) < .001
}

/** A shell needs two concentric CAD skins, two distinct end planes and a
 * complete, non-overlapping circumference contributed by multiple parts. */
function detectShells(parts: PartsData, edges: EdgesData | null): Shell[] {
  if (!edges) return []
  const byPart = new Map<string, Circle[]>()
  for (const edge of edges.edges) {
    const c = edgeCircle(edge)
    if (!c) continue
    const list = byPart.get(edge.partId) ?? []
    if (!list.some(other => sameArc(c, other))) list.push(c)
    byPart.set(edge.partId, list)
  }
  const candidates: { partId: string; circles: Circle[]; inner: number; outer: number; low: number; high: number }[] = []
  for (const part of parts.parts) {
    const all = byPart.get(part.id) ?? []
    if (all.length < 4 || !all.every(c => sameAxis(c, all[0]))) continue
    const radii = all.map(c => c.radius).sort((a, b) => a - b).filter((r, i, a) => i === 0 || r - a[i - 1] > TOL)
    const levels = all.map(c => c.center.dot(all[0].normal)).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > TOL)
    if (radii.length !== 2 || levels.length !== 2 || radii[1] - radii[0] < .5 || levels[1] - levels[0] < radii[1] - radii[0]) continue
    if (radii.some(r => levels.some(z => !all.some(c => Math.abs(c.radius - r) < TOL && Math.abs(c.center.dot(c.normal) - z) < TOL)))) continue
    candidates.push({ partId: part.id, circles: all, inner: radii[0], outer: radii[1], low: levels[0], high: levels[1] })
  }
  const used = new Set<string>(), shells: Shell[] = []
  for (const candidate of candidates) {
    if (used.has(candidate.partId)) continue
    const family = candidates.filter(other => sameAxis(candidate.circles[0], other.circles[0])
      && Math.abs(other.inner - candidate.inner) < TOL && Math.abs(other.outer - candidate.outer) < TOL
      && Math.abs(other.low - candidate.low) < TOL && Math.abs(other.high - candidate.high) < TOL)
    if (family.length < 2) continue
    const all = family.flatMap(p => p.circles)
    if ([candidate.inner, candidate.outer].some(r => [candidate.low, candidate.high].some(z => !completeRing(all.filter(c => Math.abs(c.radius - r) < TOL && Math.abs(c.center.dot(c.normal) - z) < TOL))))) continue
    family.forEach(p => used.add(p.partId))
    shells.push({ partIds: family.map(p => p.partId).sort(), center: candidate.circles[0].center,
      normal: candidate.circles[0].normal, inner: candidate.inner, outer: candidate.outer, low: candidate.low, high: candidate.high })
  }
  return shells
}

function weldCircle(weld: Weld): Circle | null {
  if (!weld.segments.length || weld.segments.some(s => !/圆/.test(s.type))) return null
  const props = Array.isArray(weld.properties.焊缝段) ? weld.properties.焊缝段.map(rec) : []
  const radii = props.flatMap(p => [rec(p.主板面).半径, rec(p.副板面).半径]).filter((r): r is number => typeof r === 'number' && r > 0)
  if (!radii.length) return null
  const points = weld.segments.flatMap((s, i) => i ? s.points.slice(1) : s.points)
  return radii.map(r => circle(points, r)).find(c => c !== null) ?? null
}

/** The original exporter treated a curved wall as a butt joint whenever it
 * lacked one constant normal. The native circular section plus perpendicular
 * planar support supplies the missing T-joint witness. */
function correctedCurvedTJoint(weld: Weld, curve: Circle | null): Weld {
  if (!curve || weld.jointType !== '对接' || Math.abs(Number(weld.properties.主板面与副板面夹角) - 90) > 1) return weld
  const rows = Array.isArray(weld.properties.焊缝段) ? weld.properties.焊缝段.map(rec) : []
  const plane = rows.map(p => [rec(p.主板面), rec(p.副板面)]).find(pair => pair.some(p => p.类型 === '平面' && vec(p.法向)) && pair.some(p => p.类型 === '曲面' && Number(p.半径) > 0))
  const face = plane?.find(p => p.类型 === '平面' && vec(p.法向))
  if (!face || !vec(face.法向) || Math.abs(v(face.法向).normalize().dot(curve.normal)) < .999) return weld
  const normal = v(face.法向).normalize(), position = rec(weld.properties.焊接位置)
  const horizontal = Math.abs(normal.z) > .999
  return { ...weld, jointType: 'T接', properties: { ...weld.properties,
    接头形式: { ...rec(weld.properties.接头形式), 类型: 'T接', 几何依据: '平面支撑与垂直圆柱侧壁形成原生圆弧交线' },
    ...(horizontal ? { 焊接位置: { ...position, 代号: normal.z > 0 ? 'PB' : 'PD', 位置: normal.z > 0 ? '横角焊位置' : '仰角焊位置', 焊缝转角: normal.z > 0 ? 45 : 135 } } : {}),
  } }
}

export function normalizeCompositeShellWelds(data: WeldsData, parts: PartsData, edges: EdgesData | null): {
  weldsData: WeldsData; references: CompositeShellReference[]
} {
  const shells = detectShells(parts, edges), references: CompositeShellReference[] = []
  const welds: Weld[] = []
  for (const source of data.welds) {
    const curve = weldCircle(source), weld = correctedCurvedTJoint(source, curve)
    const shell = shells.find(s => s.partIds.includes(weld.mainPartId) || s.partIds.includes(weld.subPartId))
    if (!shell) { welds.push(weld); continue }
    if (shell.partIds.includes(weld.mainPartId) && shell.partIds.includes(weld.subPartId)) {
      references.push({ weldId: weld.id, reason: 'shell-internal', partIds: shell.partIds }); continue
    }
    if (!curve || !sameAxis(curve, { ...curve, center: shell.center, normal: shell.normal })
      || curve.center.dot(shell.normal) < shell.low - TOL || curve.center.dot(shell.normal) > shell.high + TOL) { welds.push(weld); continue }
    if (Math.abs(curve.radius - shell.inner) < TOL) {
      references.push({ weldId: weld.id, reason: 'inner-wall', partIds: shell.partIds }); continue
    }
    if (Math.abs(curve.radius - shell.outer) >= TOL) { welds.push(weld); continue }
    const shellIsSub = shell.partIds.includes(weld.subPartId), hostPartId = shellIsSub ? weld.mainPartId : weld.subPartId
    const hostFaceIndex = shellIsSub ? weld.mainFaceIndex : weld.subFaceIndex
    const ring: CompositeShellRing = { key: JSON.stringify([shell.partIds, hostPartId, hostFaceIndex, curve.center.toArray().map(n => Number(n.toFixed(2)))]),
      shellPartIds: shell.partIds, hostPartId, hostFaceIndex, center: curve.center.toArray(), normal: curve.normal.toArray(), radius: curve.radius }
    welds.push({ ...weld, properties: { ...weld.properties, 组合壳体外环: ring } })
  }
  return { weldsData: { ...data, welds }, references }
}

export function compositeShellRing(weld: Pick<Weld, 'properties'>): CompositeShellRing | undefined {
  const data = rec(weld.properties.组合壳体外环)
  return typeof data.key === 'string' && vec(data.center) && vec(data.normal) && typeof data.radius === 'number'
    && Array.isArray(data.shellPartIds) && data.shellPartIds.every(p => typeof p === 'string')
    && typeof data.hostPartId === 'string' && typeof data.hostFaceIndex === 'number' ? data as unknown as CompositeShellRing : undefined
}

export function compositeShellTangent(ring: CompositeShellRing, point: Vector3, inside: Vector3): Vector3 | null {
  const radius = point.clone().sub(v(ring.center)), normal = v(ring.normal)
  if (Math.abs(radius.length() - ring.radius) > TOL || Math.abs(radius.dot(normal)) > TOL) return null
  const tangent = normal.cross(radius).normalize()
  return tangent.dot(inside) < 0 ? tangent.negate() : tangent
}
