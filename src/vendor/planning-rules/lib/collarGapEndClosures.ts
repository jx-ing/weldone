import type { Edge, EdgesData, Part, PartsData, Weld, WeldsData } from '@/types/weld'
import { verifiedCollarGapPlanning, type CollarGapPlanning } from './collarGapPlanning'

type V = number[]
const TOLERANCE = .02
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v)
  ? v as Record<string, unknown> : {}
const vector = (v: unknown): v is V => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
const sub = (a: V, b: V) => a.map((n, i) => n - b[i])
const dot = (a: V, b: V) => a.reduce((s, n, i) => s + n * b[i], 0)
const length = (a: V) => Math.hypot(...a)
const distance = (a: V, b: V) => length(sub(a, b))
const near = (a: V, b: V) => distance(a, b) <= TOLERANCE
const unit = (a: V): V | null => length(a) > 1e-9 ? a.map((n) => n / length(a)) : null
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const touches = (edge: Edge, p: V) => near(edge.start, p) || near(edge.end, p)
const otherEnd = (edge: Edge, p: V) => near(edge.start, p) ? edge.end : edge.start
const sameLine = (edge: Edge, weld: Weld) => (near(edge.start, weld.start) && near(edge.end, weld.end))
  || (near(edge.start, weld.end) && near(edge.end, weld.start))

function supportNormal(weld: Weld): V | null {
  const rows = weld.properties.焊缝段
  if (!Array.isArray(rows) || rows.length !== 1) return null
  const face = record(record(rows[0]).主板面)
  return face.类型 === '平面' && vector(face.法向) ? unit(face.法向) : null
}

/** Signed turning with both arcs oriented along the same local boundary walk. */
function arcTurning(edge: Edge, normal: V, junction: V, arrives: boolean): number {
  if (edge.type !== '圆弧' || edge.closed || edge.points.length < 3 || !edge.points.every(vector)) return 0
  const points = (near(edge.end, junction) === arrives) ? edge.points : [...edge.points].reverse()
  let result = 0
  for (let i = 1; i + 1 < points.length; i++) {
    const a = unit(sub(points[i], points[i - 1])), b = unit(sub(points[i + 1], points[i]))
    if (a && b) result += dot(cross(a, b), normal)
  }
  return result
}

/** An independently extracted weld on the transverse edge makes it an actual
 * joint, rather than a free end cap. Even a partial overlap preserves it. */
function overlapsCap(weld: Weld, cap: Edge): boolean {
  const delta = sub(cap.end, cap.start), capLength = length(delta), axis = unit(delta)
  if (!axis) return false
  return weld.segments.some((segment) => {
    if (segment.type !== '直线') return false
    const a = sub(segment.start, cap.start), b = sub(segment.end, cap.start)
    const pa = dot(a, axis), pb = dot(b, axis)
    if (length(sub(a, axis.map((n) => n * pa))) > TOLERANCE
      || length(sub(b, axis.map((n) => n * pb))) > TOLERANCE) return false
    return Math.min(capLength, Math.max(pa, pb)) - Math.max(0, Math.min(pa, pb)) > TOLERANCE
  })
}

export interface CollarGapEndClosureReference {
  weldId: string
  pairedWeldId: string
  collarPartId: string
  otherPartId: string
  sourceFaceIndex: number
  hostFaceIndex: number
  lengthMm: number
  thicknessMm: number
  measuredMinGapMm: number
  measuredMaxGapMm: number
  boundaryId: string
  innerArcBoundaryId: string
  freeCapBoundaryId: string
  outerArcBoundaryId: string
  kind: '无间隙规划端部短封口参考'
}

interface Candidate {
  weld: Weld
  part: Part
  normal: V
  faceNormal: V
  policy: CollarGapPlanning
  boundary: Edge
  innerArc: Edge
  freeCap: Edge
  outerArc: Edge
}

/** Exclude only the paired short return legs closing a collar's fitting gap.
 *
 * Eligibility requires finite CAD gap witnesses, confirmed collar role, a whole
 * straight outer-boundary edge, an unambiguous concave-arc / right-angle free cap /
 * convex-arc end topology, and a matching leg across the complete plate thickness.
 * The two straight legs must each be shorter than two plate thicknesses. Length
 * alone never removes a weld. True intersections, projected laps, side arcs,
 * slot bottoms and long fitting edges remain unchanged, as do all source files.
 */
export function separateCollarGapEndClosures(data: WeldsData, parts: PartsData, edges: EdgesData | null): {
  weldsData: WeldsData; references: CollarGapEndClosureReference[]
} {
  const references: CollarGapEndClosureReference[] = []
  if (!edges?.wires?.length) return { weldsData: data, references }
  const partsById = new Map(parts.parts.map((part) => [part.id, part]))
  const edgesByFace = new Map<string, Edge[]>()
  for (const edge of edges.edges) {
    const key = `${edge.partId}|${edge.faceIndex}`, rows = edgesByFace.get(key) ?? []
    rows.push(edge); edgesByFace.set(key, rows)
  }
  const wiresById = new Map(edges.wires.map((wire) => [wire.wireId, wire]))
  const weldsByFace = new Map<string, Weld[]>()
  for (const weld of data.welds) {
    const key = `${weld.mainPartId}|${weld.subPartId}|${weld.mainFaceIndex}`, rows = weldsByFace.get(key) ?? []
    rows.push(weld); weldsByFace.set(key, rows)
  }
  const candidates: Candidate[] = []
  for (const weld of data.welds) {
    if (weld.closed || weld.properties.投影搭接 || !weld.properties.装配间隙
      || weld.segments.length !== 1 || weld.segments[0].type !== '直线'
      || !vector(weld.start) || !vector(weld.end)) continue
    const part = partsById.get(weld.mainPartId)
    if (!part?.partRole || part.partRole.status === '待确认' || !['补板', '水密补板'].includes(part.partRole.type)
      || !Number.isFinite(part.thickness) || part.thickness <= 0 || !vector(part.mainNormal)) continue
    const normal = unit(part.mainNormal), faceNormal = supportNormal(weld)
    const weldLength = distance(weld.start, weld.end), axis = unit(sub(weld.end, weld.start))
    if (!normal || !faceNormal || !axis || Math.abs(dot(normal, faceNormal)) < .999
      || Math.abs(dot(axis, normal)) > .01 || weldLength <= TOLERANCE
      || weldLength > 2 * part.thickness + TOLERANCE || Math.abs(weldLength - weld.length) > TOLERANCE) continue
    const policy = verifiedCollarGapPlanning(weld, parts)
    if (!policy || policy.source !== '装配间隙' || policy.measuredMinGapMm <= TOLERANCE) continue
    const faceEdges = edgesByFace.get(`${part.id}|${weld.mainFaceIndex}`) ?? []
    const boundaries = faceEdges.filter((edge) => edge.type === '直线' && !edge.closed && edge.wire === 'outer'
      && edge.boundaryId && edge.wireId && sameLine(edge, weld))
    if (boundaries.length !== 1) continue
    const boundary = boundaries[0], wire = wiresById.get(boundary.wireId!)
    if (!wire?.closed || !wire.topologyComplete || wire.partId !== part.id || wire.faceIndex !== weld.mainFaceIndex) continue
    const wireEdges = faceEdges.filter((edge) => edge.wireId === boundary.wireId
      && edge.boundaryId && wire.boundaryIds.includes(edge.boundaryId))
    if (wireEdges.length !== wire.boundaryIds.length || !wireEdges.includes(boundary)) continue
    const atStart = wireEdges.filter((edge) => edge !== boundary && touches(edge, boundary.start))
    const atEnd = wireEdges.filter((edge) => edge !== boundary && touches(edge, boundary.end))
    if (atStart.length !== 1 || atEnd.length !== 1) continue
    const capAtStart = atStart[0].type === '直线'
    const freeCap = capAtStart ? atStart[0] : atEnd[0], innerArc = capAtStart ? atEnd[0] : atStart[0]
    if (freeCap.type !== '直线' || innerArc.type !== '圆弧' || freeCap.closed) continue
    const capLength = distance(freeCap.start, freeCap.end), capAxis = unit(sub(freeCap.end, freeCap.start))
    if (!capAxis || capLength <= TOLERANCE || capLength > 2 * part.thickness + TOLERANCE
      || Math.abs(dot(axis, capAxis)) > .05) continue
    const capNear = capAtStart ? boundary.start : boundary.end, capFar = otherEnd(freeCap, capNear)
    const outside = wireEdges.filter((edge) => edge !== freeCap && touches(edge, capFar))
    if (outside.length !== 1 || outside[0].type !== '圆弧' || outside[0] === innerArc) continue
    const outerArc = outside[0], innerNear = capAtStart ? boundary.end : boundary.start
    const innerTurn = arcTurning(innerArc, normal, innerNear, true), outerTurn = arcTurning(outerArc, normal, capFar, false)
    if (Math.abs(innerTurn) < .1 || Math.abs(outerTurn) < .1 || innerTurn * outerTurn >= 0) continue
    const sameFaceWelds = weldsByFace.get(`${part.id}|${weld.subPartId}|${weld.mainFaceIndex}`) ?? []
    if (sameFaceWelds.some((other) => other !== weld && overlapsCap(other, freeCap))) continue
    candidates.push({ weld, part, normal, faceNormal, policy, boundary, innerArc, freeCap, outerArc })
  }
  const mirrors = (a: Candidate, b: Candidate): boolean => {
    if (a === b || a.part.id !== b.part.id || a.weld.subPartId !== b.weld.subPartId
      || a.weld.subFaceIndex !== b.weld.subFaceIndex || a.weld.mainFaceIndex === b.weld.mainFaceIndex
      || dot(a.faceNormal, b.faceNormal) > -.999 || Math.abs(a.weld.length - b.weld.length) > TOLERANCE) return false
    return [false, true].some((reversed) => {
      const delta = sub(reversed ? b.weld.end : b.weld.start, a.weld.start), along = dot(delta, a.normal)
      return Math.abs(Math.abs(along) - a.part.thickness) <= TOLERANCE
        && length(sub(delta, a.normal.map((n) => n * along))) <= TOLERANCE
        && distance(sub(reversed ? b.weld.start : b.weld.end, a.weld.end), delta) <= TOLERANCE
    })
  }
  const peers = new Map(candidates.map((candidate) => [candidate, candidates.filter((other) => mirrors(candidate, other))]))
  for (const candidate of candidates) {
    const matched = peers.get(candidate)!
    if (matched.length !== 1 || peers.get(matched[0])?.length !== 1) continue
    const { weld, part, policy, boundary, innerArc, freeCap, outerArc } = candidate
    references.push({ weldId: weld.id, pairedWeldId: matched[0].weld.id,
      collarPartId: part.id, otherPartId: weld.subPartId, sourceFaceIndex: weld.mainFaceIndex, hostFaceIndex: weld.subFaceIndex,
      lengthMm: weld.length, thicknessMm: part.thickness,
      measuredMinGapMm: policy.measuredMinGapMm, measuredMaxGapMm: policy.measuredMaxGapMm,
      boundaryId: boundary.boundaryId!, innerArcBoundaryId: innerArc.boundaryId!,
      freeCapBoundaryId: freeCap.boundaryId!, outerArcBoundaryId: outerArc.boundaryId!, kind: '无间隙规划端部短封口参考' })
  }
  if (!references.length) return { weldsData: data, references }
  const removed = new Set(references.map((row) => row.weldId))
  return { weldsData: { ...data, welds: data.welds.filter((weld) => !removed.has(weld.id)) }, references }
}
