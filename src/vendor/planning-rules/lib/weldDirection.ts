import * as THREE from 'three'
import type { PartsData, Weld, WeldSegment, WeldsData } from '@/types/weld'
import { DEFAULT_TORCH_BODY_AXIS, DOC_D_S, weldNormalsAt } from './torch'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The exported endpoint “normals” are directed curve tangents, not plate face normals. */
function negateVector(value: unknown): unknown {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')
    ? value.map((v) => v === 0 ? 0 : -v)
    : value
}

/** Swap only weld-end-relative fields; nested face normals remain unchanged. */
function reverseEndFields(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    const reversedKey = key.startsWith('起点') ? `终点${key.slice(2)}`
      : key.startsWith('终点') ? `起点${key.slice(2)}` : key
    result[reversedKey] = key === '起点法向' || key === '终点法向' || key === '焊接方向'
      ? negateVector(field) : field
  }
  return result
}

function reverseSegment(segment: WeldSegment): WeldSegment {
  // Keep the source index: properties.焊缝段 uses it to locate the two supporting faces.
  return { ...segment, start: segment.end, end: segment.start, points: [...segment.points].reverse() }
}

/**
 * Convert a source weld to the opposite travel direction without modifying source data.
 * Geometry, endpoint features, directed tangents, and extend measurements move together.
 * Offset measurements describe independent detected edges, so their endpoints do not swap.
 */
export function reverseWeldDirection(weld: Weld): Weld {
  const properties = reverseEndFields(weld.properties)
  if (Array.isArray(properties['焊缝段'])) {
    properties['焊缝段'] = [...properties['焊缝段']].reverse()
      .map((segment) => isRecord(segment) ? reverseEndFields(segment) : segment)
  }
  const gap = properties['间隙检测']
  if (isRecord(gap)) {
    const reversedGap = { ...gap }
    for (const key of ['extend', '沿轴线方向']) {
      const axial = gap[key]
      if (isRecord(axial)) {
        reversedGap[key] = Object.fromEntries(Object.entries(axial)
          .map(([name, group]) => [name, isRecord(group) ? reverseEndFields(group) : group]))
      }
    }
    properties['间隙检测'] = reversedGap
  }
  const result: Weld = {
    ...weld, start: weld.end, end: weld.start,
    segments: [...weld.segments].reverse().map(reverseSegment), properties,
  }
  if (weld.sourceTraversalReversed) delete result.sourceTraversalReversed
  else result.sourceTraversalReversed = true
  return result
}

/** Viewer travel direction is opposite to the CAD export's edge traversal. */
export function reverseWeldsDirection(data: WeldsData): WeldsData {
  return { ...data, welds: data.welds.map(reverseWeldDirection) }
}

export type VerticalWeldDirection = 'up' | 'down'

export const sanitizeVerticalWeldDirection = (value: unknown): VerticalWeldDirection => value === 'down' ? 'down' : 'up'

/** Orient vertical weld geometry and its directed evidence together. The
 * source model and all nonvertical welds remain unchanged. */
export function applyVerticalWeldDirection(data: WeldsData, direction: VerticalWeldDirection = 'up'): WeldsData {
  const code = direction === 'down' ? 'PG' : 'PF'
  let changed = false
  const welds = data.welds.map((weld) => {
    const position = weld.properties.焊接位置
    if (!isRecord(position) || !['PF', 'PG'].includes(String(position.代号))) return weld
    const rise = weld.end[2] - weld.start[2]
    const oriented = (direction === 'down' ? rise > 1e-8 : rise < -1e-8) ? reverseWeldDirection(weld) : weld
    const properties = syncDerivedDirection(oriented)
    const updated = properties.焊接位置 as Record<string, unknown>
    if (oriented === weld && updated.代号 === code && position.代号 === code) return weld
    changed = true
    return { ...oriented, properties: { ...properties,
      焊接位置: { ...updated, 代号: code, 位置: direction === 'down' ? '立向下焊位置' : '立向上焊位置' } } }
  })
  return changed ? { ...data, welds } : data
}

/** Retained default for saved demonstrations and existing callers. */
export function defaultVerticalUpWeldDirections(data: WeldsData): WeldsData {
  return applyVerticalWeldDirection(data, 'up')
}

/**
 * Stable nominal direction of a negative advance-angle rotation. The body axis
 * points towards the flange; the nozzle axis points towards the wire tip.
 * d(tipAxis)/d(-advance) = -(bodyAxis x tipAxis).
 *
 * Use the same upright-neck branch as the nominal torch, but construct it only
 * from supporting-face normals. Never let the existing travel tangent, a prior
 * pose, editable process angles, or avoidance pick this reference direction.
 */
export function nominalNegativeAdvanceDirection(nMain: THREE.Vector3, nSub: THREE.Vector3): THREE.Vector3 | null {
  if (![...nMain.toArray(), ...nSub.toArray()].every(Number.isFinite)
    || nMain.lengthSq() < 1e-12 || nSub.lengthSq() < 1e-12) return null
  const bis = nMain.clone().normalize().add(nSub.clone().normalize())
  if (bis.lengthSq() < 0.04) bis.copy(nMain)
  const tip = bis.normalize().negate()
  const bodyPerpendicular = new THREE.Vector3(0, 0, 1).addScaledVector(tip, -tip.z)
  // Nominal roll falls back to the tangent here. That branch cannot determine
  // the tangent itself without circular reasoning; retain the existing travel.
  if (bodyPerpendicular.lengthSq() <= 1e-4) return null
  const axial = THREE.MathUtils.clamp(DEFAULT_TORCH_BODY_AXIS.dot(DOC_D_S), -1, 1)
  const perpendicular = Math.sqrt(Math.max(0, 1 - axial * axial))
  if (perpendicular < 1e-4) return null
  const body = tip.clone().multiplyScalar(axial)
    .addScaledVector(bodyPerpendicular.normalize(), perpendicular)
  return body.cross(tip).negate().normalize()
}

/** Geometric orientation from the supporting-face bisector and model up.
 * No gun axis or TCP parameter participates. The resulting orientation is
 * the same as the retained upright-neck convention for its nondegenerate cases.
 */
export function geometricTravelDirection(nMain: THREE.Vector3, nSub: THREE.Vector3): THREE.Vector3 | null {
  if (![...nMain.toArray(), ...nSub.toArray()].every(Number.isFinite)
    || nMain.lengthSq() < 1e-12 || nSub.lengthSq() < 1e-12) return null
  const bisector = nMain.clone().normalize().add(nSub.clone().normalize())
  if (bisector.lengthSq() < 0.04) bisector.copy(nMain)
  const direction = new THREE.Vector3(0, 0, 1).cross(bisector.normalize())
  return direction.lengthSq() > 1e-4 ? direction.normalize() : null
}

/** Current derived position evidence must follow travel; historical audit is untouched. */
function syncDerivedDirection(weld: Weld): Record<string, unknown> {
  const props = { ...weld.properties }
  const edges = weld.segments.flatMap((segment) => {
    const points = segment.points.length >= 2 ? segment.points : [segment.start, segment.end]
    return points.slice(1).flatMap((point, i) => {
      const start = new THREE.Vector3().fromArray(points[i]), end = new THREE.Vector3().fromArray(point)
      const delta = end.clone().sub(start), length = delta.length()
      return Number.isFinite(length) && length > 1e-9
        ? [{ start, delta, length, tangent: delta.clone().divideScalar(length) }] : []
    })
  })
  const verticalCode = (code: unknown, rise: number): unknown => (code === 'PF' || code === 'PG') && Math.abs(rise) > 1e-8
    ? rise < 0 ? 'PG' : 'PF' : code
  const position = props.焊接位置
  if (isRecord(position)) {
    // Matching the same nearest-edge rule to physical coordinates preserves the
    // direction of each curved segment; negating all source samples is unsafe
    // because some CAD exports already store a platform-reversed sample set.
    const samples = Array.isArray(position.采样) ? position.采样.map((sample) => {
      if (!isRecord(sample) || !Array.isArray(sample.坐标) || sample.坐标.length !== 3
        || !sample.坐标.every(Number.isFinite)) return sample
      const point = new THREE.Vector3().fromArray(sample.坐标 as number[])
      let best: typeof edges[number] | null = null, distance = Infinity
      for (const edge of edges) {
        const t = THREE.MathUtils.clamp(point.clone().sub(edge.start).dot(edge.delta) / (edge.length * edge.length), 0, 1)
        const current = edge.start.clone().addScaledVector(edge.delta, t).distanceToSquared(point)
        if (current < distance) { best = edge; distance = current }
      }
      return best ? { ...sample, 焊接方向: best.tangent.toArray().map((v) => v === 0 ? 0 : v),
        ...(sample.代号 ? { 代号: verticalCode(sample.代号, best.tangent.z) } : {}),
      } : sample
    }) : undefined
    // PF/PG are directed labels. Retain all nonvertical position classifications.
    const rise = edges.reduce((sum, edge) => sum + (Math.abs(edge.tangent.z) >= Math.SQRT1_2 - 1e-12
      ? Math.sign(edge.tangent.z) * edge.length : 0), 0)
    const code = verticalCode(position.代号, rise)
    props.焊接位置 = { ...position, ...(samples ? { 采样: samples } : {}),
      ...(code !== position.代号 ? { 代号: code, 位置: code === 'PF' ? '立向上焊位置' : '立向下焊位置' } : {}),
    }
  }
  if (isRecord(props.工艺识别)) props.工艺识别 = { ...props.工艺识别, 平台行进反向: weld.sourceTraversalReversed === true }
  return props
}

/** Apply after model coordinates, before endpoint splitting and position labels. */
export function normalizeWeldTravelDirections(data: WeldsData, partsData: PartsData, mesh: Float32Array,
  mode: 'tool' | 'geometry' = 'tool'): WeldsData {
  const round = (value: number) => Math.round(value * 1e8) / 1e8
  return { ...data, welds: data.welds.map((weld) => {
    let total = 0, supported = 0, signed = 0, absolute = 0
    for (const segment of weld.segments) {
      const points = segment.points.length >= 2 ? segment.points : [segment.start, segment.end]
      for (let i = 1; i < points.length; i++) {
        const start = new THREE.Vector3().fromArray(points[i - 1])
        const end = new THREE.Vector3().fromArray(points[i])
        const delta = end.clone().sub(start), length = delta.length()
        if (!Number.isFinite(length) || length < 1e-9) continue
        total += length
        const midpoint = start.add(end).multiplyScalar(0.5).toArray() as [number, number, number]
        const normals = weldNormalsAt(weld, partsData, mesh, midpoint)
        const direction = mode === 'geometry' ? geometricTravelDirection(normals.nMain, normals.nSub)
          : nominalNegativeAdvanceDirection(normals.nMain, normals.nSub)
        if (!direction) continue
        const projection = delta.divideScalar(length).dot(direction)
        supported += length
        signed += length * projection
        absolute += length * Math.abs(projection)
      }
    }
    const score = total > 1e-9 ? signed / total : 0
    const coverage = total > 1e-9 ? supported / total : 0
    const resolved = coverage >= 0.5 && Math.abs(score) > 0.05
    const changed = resolved && score < 0 ? reverseWeldDirection(weld) : weld
    const reason = resolved ? mode === 'geometry' ? '按模型上方向与支撑面角平分线确定几何方向，沿实际折线弧长加权'
      : '按名义枪颈负前进旋转方向确定焊接方向，沿实际折线弧长加权'
      : total < 1e-9 ? '无有效焊道长度，保留既有方向'
      : coverage < 0.5 ? mode === 'geometry' ? '几何参考方向退化，保留既有方向' : '名义枪颈滚转退化，无法独立确定方向，保留既有方向'
      : absolute / total <= 0.05 ? mode === 'geometry' ? '几何参考方向与焊道近垂直，保留既有方向' : '负前进旋转方向与焊道近垂直，保留既有方向'
      : '曲线各段方向证据抵消，保留既有方向'
    return { ...changed, properties: { ...syncDerivedDirection(changed),
      焊接方向归一化: {
        version: 1, rule: mode === 'geometry' ? '支撑面与模型上方向' : '负前进角旋转方向', status: resolved ? '已定向' : '保留既有方向',
        basis: reason, weightedProjection: round(resolved ? Math.abs(score) : score),
        supportedRatio: round(coverage), evaluatedLengthMm: round(total),
      },
    } }
  }) }
}
