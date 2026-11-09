import type { Weld, WeldsData } from '@/types/weld'
import { inheritedGeometrySplitEvidence, type SubWeld, type WeldSplit } from '@/lib/weldSplit'
import { summarizeBaojiao, type BaojiaoEndpoint, type BaojiaoResult } from '@/lib/baojiao'
import type { MergeResult } from '@/lib/weldMerge'
import { FINITE_INTERVAL_JOIN_TOLERANCE } from '@/lib/weldMerge'

export type IntermittentWeldMode = 'uniform' | 'endWeld'

export interface IntermittentWeldSettings {
  enabled: boolean
  mode: IntermittentWeldMode
  weldDistanceMm: number
  gapDistanceMm: number
  weldingPositions: string[]
  jointTypes: string[]
}

export interface IntermittentWeldMetadata {
  version: 1
  sourceWeldId: string
  sourceSubWeldId: string
  sourceSubIndex: number
  sourceLengthMm: number
  startStationMm: number
  endStationMm: number
  closedSource: boolean
  crossesSourceSeam: boolean
  startIsIntermittentCut: boolean
  endIsIntermittentCut: boolean
  mode: IntermittentWeldMode
  weldDistanceMm: number
  gapDistanceMm: number
}

export interface IntermittentWeldRange { startMm: number; endMm: number }

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>

export const INTERMITTENT_WELD_STORAGE_KEY = 'weldViewerNext.intermittentWelding.v1'
export const DEFAULT_INTERMITTENT_WELD_SETTINGS: Readonly<IntermittentWeldSettings> = {
  enabled: false,
  mode: 'uniform',
  weldDistanceMm: 50,
  gapDistanceMm: 50,
  weldingPositions: ['PA', 'PB', 'PC', 'PD', 'PE', 'PF', 'PG', '—'],
  jointTypes: ['T接', '角接', '搭接', '对接'],
}

const EPS = 1e-8
const MAX_RANGES = 10_000
/** Match the retained corner analyzer's 1 degree rejection of straight continuations. */
export const INTERMITTENT_CORNER_MIN_TURN_DEG = 1
/** With no measured leg, use the existing planning default; otherwise protect ± one leg. */
export const INTERMITTENT_CORNER_FALLBACK_LEG_MM = 8
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const selection = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > 128 || !value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 128)) return null
  return [...new Set(value.map((item: string) => item.trim()))]
}
const defaults = (): IntermittentWeldSettings => ({ ...DEFAULT_INTERMITTENT_WELD_SETTINGS,
  weldingPositions: [...DEFAULT_INTERMITTENT_WELD_SETTINGS.weldingPositions],
  jointTypes: [...DEFAULT_INTERMITTENT_WELD_SETTINGS.jointTypes] })

export function validateIntermittentWeldSettings(value: unknown): IntermittentWeldSettings | null {
  const source = record(value)
  const positions = selection(source.weldingPositions), joints = selection(source.jointTypes)
  if (typeof source.enabled !== 'boolean' || source.mode !== 'uniform' && source.mode !== 'endWeld'
    || !positive(source.weldDistanceMm) || !positive(source.gapDistanceMm)
    || !Number.isFinite(source.weldDistanceMm + source.gapDistanceMm) || !positions || !joints) return null
  return { enabled: source.enabled, mode: source.mode, weldDistanceMm: source.weldDistanceMm,
    gapDistanceMm: source.gapDistanceMm, weldingPositions: positions, jointTypes: joints }
}

/** Invalid old storage never silently activates geometry processing. */
export function sanitizeIntermittentWeldSettings(value: unknown): IntermittentWeldSettings {
  return validateIntermittentWeldSettings(value) ?? defaults()
}

export function readIntermittentWeldSettings(storage?: ReadStorage | null): IntermittentWeldSettings {
  try {
    const target = storage === undefined ? window.localStorage : storage
    const raw = target?.getItem(INTERMITTENT_WELD_STORAGE_KEY)
    return raw ? sanitizeIntermittentWeldSettings(JSON.parse(raw)) : defaults()
  } catch { return defaults() }
}

export function saveIntermittentWeldSettings(value: unknown, storage?: WriteStorage | null): { ok: true } | { ok: false; error: string } {
  const valid = validateIntermittentWeldSettings(value)
  if (!valid) return { ok: false, error: '间断焊参数无效：焊接距离、间断距离必须大于 0，分类选择和模式必须有效。' }
  try {
    const target = storage === undefined ? window.localStorage : storage
    if (!target) return { ok: false, error: '间断焊设置未保存：浏览器存储不可用。' }
    target.setItem(INTERMITTENT_WELD_STORAGE_KEY, JSON.stringify(valid))
    return { ok: true }
  } catch { return { ok: false, error: '间断焊设置未保存：浏览器存储不可用或空间不足。' } }
}

function positionOf(properties: Record<string, unknown>): string {
  const position = properties.焊接位置
  const code = typeof position === 'string' ? position : record(position).代号
  return typeof code === 'string' ? code.trim().toUpperCase() : ''
}

function jointOf(properties: Record<string, unknown>, weld: Weld): string {
  const value = properties.接头形式
  const label = typeof value === 'string' ? value : record(value).类型
  return typeof label === 'string' && label.trim() ? label.trim() : weld.jointType
}

export function intermittentWeldCategories(welds: WeldsData, splits?: ReadonlyMap<string, WeldSplit> | null): {
  weldingPositions: string[]; jointTypes: string[]
} {
  const positions = new Set<string>(), joints = new Set<string>()
  for (const weld of welds.welds) {
    const inputs = [weld.properties, ...(splits?.get(weld.id)?.subWelds ?? []).map((sub) => ({ ...weld.properties, ...sub.geometryProperties }))]
    for (const properties of inputs) {
      const position = positionOf(properties), joint = jointOf(properties, weld)
      if (position) positions.add(position)
      if (joint) joints.add(joint)
    }
  }
  return { weldingPositions: [...positions].sort(), jointTypes: [...joints].sort((a, b) => a.localeCompare(b, 'zh-CN')) }
}

/** Both classifications must match; an empty multiselection means no matching welds. */
export function matchesIntermittentWeld(weld: Weld, sub: SubWeld, settings: IntermittentWeldSettings): boolean {
  const properties = { ...weld.properties, ...sub.geometryProperties }
  return settings.enabled && settings.weldingPositions.includes(positionOf(properties))
    && settings.jointTypes.includes(jointOf(properties, weld))
}

/**
 * Open uniform: fixed weld/gap lengths, surplus shared by the two end margins.
 * Open endWeld: fixed weld lengths, surplus shared by internal gaps, both ends welded.
 * Closed: distribute welds uniformly around the actual ring length; the seam lies
 * in a gap for uniform mode and at the centre of one weld for endWeld mode.
 * Very short seams stay continuous. Null rejects unreasonable segment counts.
 */
export function intermittentWeldRanges(lengthMm: number, settings: Pick<IntermittentWeldSettings, 'mode' | 'weldDistanceMm' | 'gapDistanceMm'>,
  closed = false): IntermittentWeldRange[] | null {
  const w = settings.weldDistanceMm, g = settings.gapDistanceMm
  if (!positive(lengthMm) || !positive(w) || !positive(g) || w <= EPS || g <= EPS || !Number.isFinite(w + g)
    || settings.mode !== 'uniform' && settings.mode !== 'endWeld') return null
  if (lengthMm <= w + EPS) return [{ startMm: 0, endMm: lengthMm }]
  if (closed) {
    const count = Math.max(1, Math.floor((lengthMm + EPS) / (w + g)))
    if (count > MAX_RANGES) return null
    const period = lengthMm / count, gap = period - w
    if (settings.mode === 'uniform') return Array.from({ length: count }, (_, index) => ({
      startMm: gap / 2 + index * period, endMm: gap / 2 + index * period + w,
    }))
    const ranges = Array.from({ length: count - 1 }, (_, index) => ({
      startMm: (index + 1) * period - w / 2, endMm: (index + 1) * period + w / 2,
    }))
    // One actual polyline traverses the source closing point, rather than two
    // independent half-welds or a chord through the middle of the ring.
    ranges.push({ startMm: lengthMm - w / 2, endMm: lengthMm + w / 2 })
    return ranges
  }
  if (settings.mode === 'endWeld' && lengthMm < 2 * w + g - EPS) return [{ startMm: 0, endMm: lengthMm }]
  const count = Math.max(1, Math.floor((lengthMm + g + EPS) / (w + g)))
  if (count > MAX_RANGES) return null
  if (settings.mode === 'endWeld') {
    const gap = (lengthMm - count * w) / (count - 1)
    return Array.from({ length: count }, (_, index) => ({
      startMm: index === count - 1 ? lengthMm - w : index * (w + gap),
      endMm: index === count - 1 ? lengthMm : index * (w + gap) + w,
    }))
  }
  const margin = Math.max(0, (lengthMm - count * w - (count - 1) * g) / 2)
  return Array.from({ length: count }, (_, index) => ({ startMm: margin + index * (w + g), endMm: margin + index * (w + g) + w }))
}

type Trace = { points: number[][]; stations: number[]; length: number }
const distance = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
const equalPoint = (a: number[], b: number[]) => distance(a, b) <= EPS

function traceOf(points: number[][]): Trace | null {
  if (points.length < 2 || points.some((point) => point.length !== 3 || point.some((value) => !Number.isFinite(value)))) return null
  const clean: number[][] = []
  for (const point of points) if (!clean.length || !equalPoint(clean[clean.length - 1], point)) clean.push(point)
  if (clean.length < 2) return null
  const stations = [0]
  for (let index = 1; index < clean.length; index++) stations.push(stations[index - 1] + distance(clean[index - 1], clean[index]))
  return { points: clean, stations, length: stations[stations.length - 1] }
}

function upperStationIndex(stations: number[], station: number): number {
  let low = 0, high = stations.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (stations[middle] <= station) low = middle + 1
    else high = middle
  }
  return low
}

function pointAt(trace: Trace, station: number): number[] {
  const s = Math.min(trace.length, Math.max(0, station))
  const index = Math.max(0, Math.min(trace.points.length - 2, upperStationIndex(trace.stations, s) - 1))
  const a = trace.points[index], b = trace.points[index + 1]
  const ratio = (s - trace.stations[index]) / (trace.stations[index + 1] - trace.stations[index])
  return a.map((value, axis) => value + (b[axis] - value) * ratio)
}

function cutTrace(trace: Trace, startMm: number, endMm: number): number[][] {
  const points = [pointAt(trace, startMm)]
  for (let index = upperStationIndex(trace.stations, startMm + EPS);
    index < trace.points.length - 1 && trace.stations[index] < endMm - EPS; index++) points.push([...trace.points[index]])
  const end = pointAt(trace, endMm)
  if (!equalPoint(points[points.length - 1], end)) points.push(end)
  return points
}

function tangent(a: number[], b: number[]): number[] {
  const length = distance(a, b)
  return a.map((value, axis) => (b[axis] - value) / length)
}

type ProtectedTrace = { weld: Weld; sub: SubWeld; trace: Trace; leg: number; ranges: IntermittentWeldRange[] }
type TraceEndpoint = { owner: ProtectedTrace; which: 'start' | 'end'; point: number[]; inward: number[]; line: boolean }
const delta = (a: number[], b: number[]) => a.map((value, axis) => value - b[axis])
const dot = (a: number[], b: number[]) => a.reduce((sum, value, axis) => sum + value * b[axis], 0)
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalized = (a: number[]) => {
  const size = Math.hypot(...a)
  return size > EPS ? a.map((value) => value / size) : null
}
const isArc = (type: string) => ['圆弧', '圆弧曲线', '圆', 'arc', 'circle'].includes(type.toLowerCase())
const isLine = (type: string) => ['直线', 'line'].includes(type.toLowerCase())
const nearEndpoint = (a: number[], b: number[]) => distance(a, b) <= FINITE_INTERVAL_JOIN_TOLERANCE + EPS
const isTurn = (arrives: number[], leaves: number[]) => Math.acos(Math.max(-1, Math.min(1, dot(arrives, leaves))))
  * 180 / Math.PI >= INTERMITTENT_CORNER_MIN_TURN_DEG

/** Locate an existing source node on the current trimmed trace, never extend it. */
function stationOf(trace: Trace, point: number[]): number | null {
  let best = FINITE_INTERVAL_JOIN_TOLERANCE + EPS, station: number | null = null
  for (let index = 0; index + 1 < trace.points.length; index++) {
    const a = trace.points[index], vector = delta(trace.points[index + 1], a), squared = dot(vector, vector)
    const ratio = Math.max(0, Math.min(1, dot(delta(point, a), vector) / squared))
    const gap = distance(point, a.map((value, axis) => value + vector[axis] * ratio))
    if (gap < best) { best = gap; station = trace.stations[index] + Math.sqrt(squared) * ratio }
  }
  return station
}

/** Exact circular endpoint tangent from original arc samples; chords do not invent a G1 corner. */
function arcTangent(points: number[][], point: number[], inside: number[]): number[] | null {
  if (points.length < 3) return null
  const a = points[0], b = points[Math.floor(points.length / 3)], c = points[Math.floor(2 * points.length / 3)]
  const u = delta(b, a), v = delta(c, a), normal = cross(u, v), squared = dot(normal, normal)
  if (squared <= EPS * EPS) return null
  const vn = cross(v, normal), nu = cross(normal, u)
  const center = a.map((value, axis) => value + (vn[axis] * dot(u, u) + nu[axis] * dot(v, v)) / (2 * squared))
  const direction = normalized(cross(normal, delta(point, center)))
  return direction && dot(direction, inside) < 0 ? direction.map((value) => -value) : direction
}

function inwardAt(points: number[][], which: 'start' | 'end', type: string, props?: Record<string, unknown>, arcPoints = points): number[] {
  const point = which === 'start' ? points[0] : points[points.length - 1]
  const adjacent = which === 'start' ? points[1] : points[points.length - 2]
  const inside = tangent(point, adjacent), projection = record(props?.投影搭接)
  const sourcePoints = projection.projectedPoints, normals = projection.sourceNormals, host = projection.hostNormal
  const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  if (Array.isArray(sourcePoints) && Array.isArray(normals) && vector(host)) {
    const index = sourcePoints.findIndex((candidate) => vector(candidate) && nearEndpoint(point, candidate))
    if (index >= 0 && vector(normals[index])) {
      const native = normalized(cross(host, normals[index]))
      if (native) return dot(native, inside) < 0 ? native.map((value) => -value) : native
    }
  }
  return isArc(type) ? arcTangent(arcPoints, point, inside) ?? inside : inside
}

function protectAt(owner: ProtectedTrace, station: number) {
  owner.ranges.push({ startMm: station - owner.leg, endMm: station + owner.leg })
}

/** Only original CAD edge junctions are corners; a curve's tessellation vertices are not. */
function protectSourceCorners(owner: ProtectedTrace) {
  const { weld, trace } = owner, segments = weld.segments.filter((segment) => traceOf(segment.points))
  for (let index = 0; index < segments.length; index++) {
    const before = segments[index], after = segments[(index + 1) % segments.length]
    if ((index + 1 === segments.length && (!weld.closed || segments.length < 2))
      || !nearEndpoint(before.end, after.start)) continue
    const station = stationOf(trace, before.end)
    const arrives = inwardAt(before.points, 'end', before.type, weld.properties).map((value) => -value)
    const leaves = inwardAt(after.points, 'start', after.type, weld.properties)
    if (station !== null && isTurn(arrives, leaves)) protectAt(owner, station)
  }
  // A tangential line/arc/line transition has no sharp junction, but its whole
  // original round must survive. Preserve only its overlap with the current sub.
  segments.forEach((segment, index) => {
    if (!isArc(segment.type) || segment.start.every((value, axis) => value === segment.end[axis])) return
    const before = segments[(index - 1 + segments.length) % segments.length], after = segments[(index + 1) % segments.length]
    if ((!weld.closed && (index === 0 || index + 1 === segments.length))
      || !isLine(before.type) || !isLine(after.type) || !nearEndpoint(before.end, segment.start) || !nearEndpoint(segment.end, after.start)) return
    const arrives = inwardAt(before.points, 'end', before.type, weld.properties).map((value) => -value)
    if (!isTurn(arrives, inwardAt(after.points, 'start', after.type, weld.properties))) return
    const arc = traceOf(segment.points)!, stations: number[] = []
    segment.points.forEach((point) => { const station = stationOf(trace, point); if (station !== null) stations.push(station) })
    trace.points.forEach((point, at) => { if (stationOf(arc, point) !== null) stations.push(trace.stations[at]) })
    if (stations.length) owner.ranges.push({ startMm: Math.min(...stations) - owner.leg, endMm: Math.max(...stations) + owner.leg })
  })
}

/** Spatial buckets keep true cross-source endpoint checks linear in the model size. */
function cornerProtectedTraces(splits: Map<string, WeldSplit>, welds: ReadonlyMap<string, Weld>): Map<SubWeld, ProtectedTrace> {
  const traces = new Map<SubWeld, ProtectedTrace>(), endpoints: TraceEndpoint[] = []
  const traceEndpoints = new Map<ProtectedTrace, TraceEndpoint[]>()
  const buckets = new Map<string, TraceEndpoint[]>(), neighbours = new Map<TraceEndpoint, TraceEndpoint[]>()
  const cell = (point: number[]) => point.map((value) => Math.floor(value / FINITE_INTERVAL_JOIN_TOLERANCE))
  const key = (indices: number[]) => indices.join(',')
  for (const [id, split] of splits) {
    const weld = welds.get(id)
    if (!weld) continue
    for (const sub of split.subWelds) {
      if (isIntermittentWeld(sub)) continue
      const trace = traceOf(sub.points)
      if (!trace || sub.closed && !equalPoint(trace.points[0], trace.points[trace.points.length - 1])) continue
      const leg = { ...weld.properties, ...sub.geometryProperties }.焊脚
      const owner: ProtectedTrace = { weld, sub, trace, leg: positive(leg) ? leg : INTERMITTENT_CORNER_FALLBACK_LEG_MM, ranges: [] }
      traces.set(sub, owner); protectSourceCorners(owner)
      if (sub.closed) continue
      for (const which of ['start', 'end'] as const) {
        const point = which === 'start' ? trace.points[0] : trace.points[trace.points.length - 1]
        const segment = weld.segments.find((candidate) => stationOf(traceOf(candidate.points) ?? trace, point) !== null)
        const type = segment?.type ?? ''
        const endpoint = { owner, which, point, inward: inwardAt(trace.points, which, type, { ...weld.properties, ...sub.geometryProperties }, segment?.points), line: isLine(type) }
        endpoints.push(endpoint)
        traceEndpoints.set(owner, [...(traceEndpoints.get(owner) ?? []), endpoint])
        const bucket = key(cell(point)); buckets.set(bucket, [...(buckets.get(bucket) ?? []), endpoint])
      }
    }
  }
  for (const endpoint of endpoints) {
    const indices = cell(endpoint.point), matches: TraceEndpoint[] = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of buckets.get(key([indices[0] + dx, indices[1] + dy, indices[2] + dz])) ?? []) {
        if (other.owner === endpoint.owner || !nearEndpoint(endpoint.point, other.point)) continue
        const a = endpoint.owner.weld, b = other.owner.weld
        if (![a.mainPartId, a.subPartId].some((id) => id === b.mainPartId || id === b.subPartId)
          || jointOf({ ...a.properties, ...endpoint.owner.sub.geometryProperties }, a) !== jointOf({ ...b.properties, ...other.owner.sub.geometryProperties }, b)) continue
        matches.push(other)
        if (isTurn(endpoint.inward.map((value) => -value), other.inward)) {
          protectAt(endpoint.owner, endpoint.which === 'start' ? 0 : endpoint.owner.trace.length)
        }
      }
    }
    neighbours.set(endpoint, matches)
  }
  for (const owner of traces.values()) {
    if (owner.sub.closed || owner.weld.segments.length !== 1 || !isArc(owner.weld.segments[0].type)) continue
    const ends = traceEndpoints.get(owner)!
    const before = neighbours.get(ends[0])?.filter((endpoint) => endpoint.line) ?? [], after = neighbours.get(ends[1])?.filter((endpoint) => endpoint.line) ?? []
    const rounded = before.some((a) => after.some((b) => a.owner !== b.owner && isTurn(a.inward.map((value) => -value), b.inward)))
    if (!rounded) continue
    owner.ranges.push({ startMm: 0, endMm: owner.trace.length })
    for (const endpoint of [...before, ...after]) protectAt(endpoint.owner, endpoint.which === 'start' ? 0 : endpoint.owner.trace.length)
  }
  return traces
}

/** Add continuous corner spans to the regular pattern; wrap a closed seam using source points. */
function retainCornerRanges(ranges: IntermittentWeldRange[], protectedRanges: IntermittentWeldRange[], length: number, closed: boolean): IntermittentWeldRange[] {
  if (!protectedRanges.length) return ranges
  const flat: IntermittentWeldRange[] = []
  for (const range of [...ranges, ...protectedRanges]) {
    if (closed) {
      const span = range.endMm - range.startMm
      if (span >= length - EPS) return [{ startMm: 0, endMm: length }]
      const start = ((range.startMm % length) + length) % length, end = start + span
      flat.push({ startMm: start, endMm: Math.min(length, end) })
      if (end > length + EPS) flat.push({ startMm: 0, endMm: end - length })
    } else flat.push({ startMm: Math.max(0, range.startMm), endMm: Math.min(length, range.endMm) })
  }
  flat.sort((a, b) => a.startMm - b.startMm)
  const result: IntermittentWeldRange[] = []
  for (const range of flat) {
    if (range.endMm - range.startMm <= EPS) continue
    const previous = result[result.length - 1]
    if (previous && range.startMm <= previous.endMm + EPS) previous.endMm = Math.max(previous.endMm, range.endMm)
    else result.push({ ...range })
  }
  if (closed && result.length > 1 && result[0].startMm <= EPS && result[result.length - 1].endMm >= length - EPS) {
    const first = result.shift()!, last = result.pop()!
    result.push({ startMm: last.startMm, endMm: length + first.endMm })
  }
  return result
}

export function intermittentWeldMetadata(sub: Pick<SubWeld, 'geometryProperties'>): IntermittentWeldMetadata | null {
  const value = record(sub.geometryProperties?.间断焊)
  return value.version === 1 && typeof value.sourceWeldId === 'string' && typeof value.sourceSubWeldId === 'string'
    && Number.isFinite(value.startStationMm) && Number.isFinite(value.endStationMm)
    ? value as unknown as IntermittentWeldMetadata : null
}

export function isIntermittentWeld(sub: Pick<SubWeld, 'geometryProperties'>): boolean {
  return intermittentWeldMetadata(sub) !== null
}

export const isIntermittentSubWeld = isIntermittentWeld

/** Apply only after the real endpoint geometry has been recomputed. */
export function intermittentCutEndpoint(sub: SubWeld, which: 'start' | 'end', endpoint: BaojiaoEndpoint): BaojiaoEndpoint {
  const metadata = intermittentWeldMetadata(sub)
  if (!metadata?.[which === 'start' ? 'startIsIntermittentCut' : 'endIsIntermittentCut']) return endpoint
  const reason = '间断焊在原接头内部起弧／收弧，无过焊孔，不执行包角或端点变姿态'
  const info = endpoint.unifiedInfo, decision = endpoint.processDecision
  if (endpoint.type === '不包角' && endpoint.subtype === null && endpoint.feature === '平角' && endpoint.rule === reason
    && !endpoint.poseChange && endpoint.scheme === null && endpoint.variantKey === undefined && endpoint.wrapPathDistance === 0
    && (!info || info.kind === 'interior' && info.geometryConnection === 'continuous' && info.openingWidthMm === 0 && info.openingHeightMm === 0)
    && (!decision || decision.status === 'resolved' && decision.action === 'no-wrap' && decision.wrap === 'none'
      && !decision.postureChange && !decision.travelWrapDistance && !decision.extendArcOffTime && !decision.deferred
      && decision.holeSizeMm === 0 && decision.holeSizeCategory === 'zero' && decision.manuallyOverridden === false)) return endpoint
  return { ...endpoint, type: '不包角', subtype: null, feature: '平角', rule: reason,
    poseChange: undefined, scheme: null, variantKey: undefined, wrapPathDistance: 0,
    ...(endpoint.unifiedInfo ? { unifiedInfo: { ...endpoint.unifiedInfo, kind: 'interior' as const,
      geometryConnection: 'continuous' as const, openingWidthMm: 0, openingHeightMm: 0,
      openingMeasurementScope: 'complete' as const, openingBoundaryIds: [], openingBoundaryPoints: [],
      basis: endpoint.unifiedInfo.basis.includes(reason) ? endpoint.unifiedInfo.basis : [...endpoint.unifiedInfo.basis, reason], summary: reason } } : {}),
    ...(endpoint.processDecision ? { processDecision: { ...endpoint.processDecision,
      status: 'resolved' as const, action: 'no-wrap' as const, wrap: 'none' as const, postureChange: false,
      travelWrapDistance: false, extendArcOffTime: false, deferred: false, holeSizeMm: 0,
      holeSizeCategory: 'zero' as const, manuallyOverridden: false, reason } } : {}),
  }
}

/** Preserve recomputed physical clearances; remove only actions at generated cuts. */
export function applyIntermittentWeldEndpointRules(result: BaojiaoResult | null,
  splits: ReadonlyMap<string, WeldSplit> | null, merges?: MergeResult | null): BaojiaoResult | null {
  if (!result || !splits) return result
  let byWeld: BaojiaoResult['byWeld'] | null = null
  let hasCuts = false
  for (const [id, split] of splits) {
    const current = result.byWeld.get(id)
    if (!current?.bySubWeld) continue
    let bySubWeld = current.bySubWeld
    split.subWelds.forEach((sub, index) => {
      const metadata = intermittentWeldMetadata(sub)
      if (metadata?.startIsIntermittentCut || metadata?.endIsIntermittentCut) hasCuts = true
      const pair = current.bySubWeld?.[index]
      if (!pair) return
      const start = intermittentCutEndpoint(sub, 'start', pair.起点), end = intermittentCutEndpoint(sub, 'end', pair.终点)
      if (start === pair.起点 && end === pair.终点) return
      if (bySubWeld === current.bySubWeld) bySubWeld = { ...bySubWeld }
      bySubWeld[index] = { 起点: start, 终点: end }
    })
    if (bySubWeld === current.bySubWeld) continue
    if (!byWeld) byWeld = new Map(result.byWeld)
    byWeld.set(id, { ...current, bySubWeld })
  }
  let geometryMergeEndpoints: BaojiaoResult['geometryMergeEndpoints'] | null = null
  for (const group of merges?.groups ?? []) {
    const pair = result.geometryMergeEndpoints?.[group.id]
    if (group.closed || !group.members.length || !pair) continue
    const at = (which: 'start' | 'end'): BaojiaoEndpoint => {
      const member = which === 'start' ? group.members[0] : group.members[group.members.length - 1]
      const sub = splits.get(member.weldId)?.subWelds[member.subIndex]
      const current = pair[which === 'start' ? '起点' : '终点']
      if (!sub) return current
      // Merge members follow the group traversal and may be reversed relative
      // to the source subweld. Resolve provenance at the actual exposed point.
      const sourceWhich = distance(group[which], sub.start) <= distance(group[which], sub.end) ? 'start' : 'end'
      return intermittentCutEndpoint(sub, sourceWhich, current)
    }
    const start = at('start'), end = at('end')
    if (start === pair.起点 && end === pair.终点) continue
    if (!geometryMergeEndpoints) geometryMergeEndpoints = { ...result.geometryMergeEndpoints }
    geometryMergeEndpoints[group.id] = { 起点: start, 终点: end }
  }
  if (!byWeld && !geometryMergeEndpoints && !hasCuts) return result
  const currentWelds = byWeld ?? result.byWeld, statistics = summarizeBaojiao(currentWelds)
  if (!byWeld && !geometryMergeEndpoints && (Object.keys(statistics) as (keyof typeof statistics)[])
    .every((key) => statistics[key] === result.统计[key])) return result
  return { ...result, byWeld: currentWelds, 统计: statistics,
    ...(geometryMergeEndpoints ? { geometryMergeEndpoints } : {}) }
}

function splitSubWeld(weld: Weld, sub: SubWeld, sourceSubIndex: number, settings: IntermittentWeldSettings, protection?: ProtectedTrace): SubWeld[] | null {
  const trace = protection?.trace ?? traceOf(sub.points)
  if (!trace || sub.closed && !equalPoint(trace.points[0], trace.points[trace.points.length - 1])) return null
  const pattern = intermittentWeldRanges(trace.length, settings, sub.closed)
  if (!pattern) return null
  const ranges = retainCornerRanges(pattern, protection?.ranges ?? [], trace.length, sub.closed)
  return ranges.map((range, index) => {
    const crossesSeam = range.endMm > trace.length + EPS
    const points = crossesSeam
      ? [...cutTrace(trace, range.startMm, trace.length), ...cutTrace(trace, 0, range.endMm - trace.length).slice(1)]
      : cutTrace(trace, range.startMm, range.endMm)
    const whole = range.startMm <= EPS && Math.abs(range.endMm - trace.length) <= EPS
    const originalStart = whole || !sub.closed && range.startMm <= EPS
    const originalEnd = whole || !sub.closed && Math.abs(range.endMm - trace.length) <= EPS
    const metadata: IntermittentWeldMetadata = {
      version: 1, sourceWeldId: weld.id, sourceSubWeldId: sub.id, sourceSubIndex, sourceLengthMm: trace.length,
      startStationMm: range.startMm, endStationMm: range.endMm, closedSource: sub.closed, crossesSourceSeam: crossesSeam,
      startIsIntermittentCut: !originalStart, endIsIntermittentCut: !originalEnd,
      mode: settings.mode, weldDistanceMm: settings.weldDistanceMm, gapDistanceMm: settings.gapDistanceMm,
    }
    return { ...sub, ...inheritedGeometrySplitEvidence(sub, points), id: `${sub.id}-I${String(index + 1).padStart(3, '0')}`,
      index: index + 1, length: range.endMm - range.startMm, closed: whole && sub.closed,
      points, start: [...points[0]], end: [...points[points.length - 1]],
      startTangent: tangent(points[0], points[1]), endTangent: tangent(points[points.length - 2], points[points.length - 1]),
      起点来源: originalStart ? sub.起点来源 : { 类型: '打断点' },
      终点来源: originalEnd ? sub.终点来源 : { 类型: '打断点' },
      // Each generated interval has its own edit/selection baseline. Source
      // lineage lives in metadata; sharing its endpoints would alias all cuts.
      geometryEdited: true, geometryOriginalPoints: points,
      geometryOriginalStart: points[0], geometryOriginalEnd: points[points.length - 1],
      geometryProperties: { ...weld.properties, ...sub.geometryProperties, 间断焊: metadata,
        ...(!originalStart ? { 起点特征: { 特征类型: '平角' } } : {}),
        ...(!originalEnd ? { 终点特征: { 特征类型: '平角' } } : {}),
        几何内部端点: { start: !originalStart || sub.起点来源.类型 === '打断点', end: !originalEnd || sub.终点来源.类型 === '打断点' } },
    }
  })
}

/**
 * Derive displayable geometry after user split/property edits and before merge
 * and endpoint analysis. Feed the original edited input each time; switching off
 * returns its exact map identity. Intentional short intervals must bypass the
 * generic minimum-length deletion and must not merge across their skipped gaps.
 */
export function applyIntermittentWeldSplits(splits: Map<string, WeldSplit> | null, welds: WeldsData,
  value: IntermittentWeldSettings): Map<string, WeldSplit> | null {
  const settings = validateIntermittentWeldSettings(value)
  if (!splits || !settings?.enabled || !settings.weldingPositions.length || !settings.jointTypes.length) return splits
  const byId = new Map(welds.welds.map((weld) => [weld.id, weld]))
  const protection = cornerProtectedTraces(splits, byId)
  let next: Map<string, WeldSplit> | null = null
  for (const [id, split] of splits) {
    const weld = byId.get(id)
    if (!weld) continue
    let changed = false
    const subWelds = split.subWelds.flatMap((sub, index) => {
      if (!matchesIntermittentWeld(weld, sub, settings) || isIntermittentWeld(sub)) return [sub]
      const derived = splitSubWeld(weld, sub, index, settings, protection.get(sub))
      if (!derived) return [sub]
      changed = true
      return derived
    })
    if (!changed) continue
    if (!next) next = new Map(splits)
    next.set(id, { ...split, subWelds: subWelds.map((sub, index) => sub.index === index + 1 ? sub : { ...sub, index: index + 1 }) })
  }
  return next ?? splits
}
