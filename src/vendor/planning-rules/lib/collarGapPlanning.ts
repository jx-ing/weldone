import type { PartsData, Weld, WeldsData } from '@/types/weld'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const point = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(finite)
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, i) => value - b[i]))
const close = (a: unknown, b: unknown) => point(a) && point(b) && distance(a, b) <= .01
const interval = (value: unknown): value is number[] => Array.isArray(value) && value.length === 2
  && value.every(finite) && value[1] > value[0]
const KEY = '补板间隙规划'

export interface CollarGapPlanning {
  version: 1
  source: '投影搭接' | '装配间隙'
  sourcePartId: string
  matePartId: string
  measuredMinGapMm: number
  measuredMaxGapMm: number
  planningGapMm: 0
  scope: '已核验有限接头'
  说明: string
}

/** This marker is derived from role and finite CAD evidence at model load. */
export function collarGapPlanning(weld: Weld): CollarGapPlanning | null {
  const policy = record(weld.properties[KEY])
  return policy.version === 1 && policy.scope === '已核验有限接头' && policy.planningGapMm === 0
    && typeof policy.sourcePartId === 'string' && typeof policy.matePartId === 'string'
    && (policy.source === '投影搭接' || policy.source === '装配间隙')
    ? policy as unknown as CollarGapPlanning : null
}

/** A role or a nearby host alone is never sufficient to invent a connection. */
export function verifiedCollarGapPlanning(weld: Weld, parts: PartsData): CollarGapPlanning | null {
  const source = parts.parts.find((part) => part.id === weld.mainPartId)
  const mate = parts.parts.find((part) => part.id === weld.subPartId)
  if (!source || !mate || ![source, mate].some((part) => part.partRole
    && ['补板', '水密补板'].includes(part.partRole.type) && part.partRole.status !== '待确认')) return null
  const projection = record(weld.properties['投影搭接'])
  const fitting = record(weld.properties['装配间隙'])
  let kind: CollarGapPlanning['source'], min: number, max: number
  if (Object.keys(projection).length) {
    const clip = record(projection.finiteClip)
    const sourcePoints = projection.sourcePoints, projectedPoints = projection.projectedPoints
    const vector = projection.projectionVector
    if (projection.version !== 1 || projection.sourcePartId !== source.id || projection.hostPartId !== mate.id
      || !source.partRole || source.partRole.status === '待确认' || !['补板', '水密补板'].includes(source.partRole.type)
      || clip.kernel !== 'BRepAlgoAPI_Common' || !finite(clip.retainedLengthMm) || clip.retainedLengthMm <= 0
      || !finite(clip.sourceLengthMm) || clip.retainedLengthMm > clip.sourceLengthMm + .01
      || !finite(clip.maxExportedHostGapMm) || clip.maxExportedHostGapMm > .01
      || !finite(clip.maxExportedSourceGapMm) || clip.maxExportedSourceGapMm > .01
      || !Array.isArray(sourcePoints) || !Array.isArray(projectedPoints) || sourcePoints.length < 2
      || sourcePoints.length !== projectedPoints.length || !sourcePoints.every(point) || !projectedPoints.every(point)
      || !point(vector) || !finite(projection.gapMm) || projection.gapMm < 0
      || Math.abs(Math.hypot(...vector) - projection.gapMm) > .01
      || sourcePoints.some((p, i) => !close(p.map((n, axis) => n + vector[axis]), projectedPoints[i]))) return null
    if (![projectedPoints[0], projectedPoints.at(-1)].some((p) => close(p, weld.start))
      || ![projectedPoints[0], projectedPoints.at(-1)].some((p) => close(p, weld.end))) return null
    kind = '投影搭接'; min = max = projection.gapMm
  } else {
    const probes = fitting.probes
    if (fitting.kind !== 'source-clip-clearance-edge' || !['face', 'edge'].includes(String(fitting.mateKind))
      || !interval(fitting.retainedCurveParameters) || !interval(fitting.sourceCurveParameters)
      || fitting.retainedCurveParameters[0] < fitting.sourceCurveParameters[0] - 1e-6
      || fitting.retainedCurveParameters[1] > fitting.sourceCurveParameters[1] + 1e-6
      || !finite(fitting.minSampleGapMm) || fitting.minSampleGapMm < 0
      || !finite(fitting.maxSampleGapMm) || fitting.maxSampleGapMm < fitting.minSampleGapMm
      || !finite(fitting.acceptanceMaxGapMm) || fitting.acceptanceMaxGapMm > 2
      || fitting.maxSampleGapMm > fitting.acceptanceMaxGapMm + 1e-6
      || !finite(fitting.maxClipSupportDistanceMm) || fitting.maxClipSupportDistanceMm > .01
      || !Array.isArray(probes) || probes.length < 2) return null
    for (const raw of probes) {
      const probe = record(raw)
      if (!point(probe.sourcePoint) || !point(probe.profilePoint) || !finite(probe.gapMm)
        || Math.abs(distance(probe.sourcePoint, probe.profilePoint) - probe.gapMm) > .01
        || probe.gapMm > fitting.maxSampleGapMm + .01 || probe.gapMm < fitting.minSampleGapMm - .01
        || !finite(probe.sourceFaceDistanceMm) || probe.sourceFaceDistanceMm > .01
        || !finite(probe.profileFaceDistanceMm) || probe.profileFaceDistanceMm > .01) return null
    }
    if (!probes.some((p) => close(record(p).sourcePoint, weld.start))
      || !probes.some((p) => close(record(p).sourcePoint, weld.end))) return null
    kind = '装配间隙'; min = fitting.minSampleGapMm; max = fitting.maxSampleGapMm
  }
  return { version: 1, source: kind, sourcePartId: source.id, matePartId: mate.id,
    measuredMinGapMm: min, measuredMaxGapMm: max, planningGapMm: 0, scope: '已核验有限接头',
    说明: '补板/水密补板的已核验有限接头按无间隙连接规划，根部间隙为0mm；原零件位置、实体间隙及碰撞网格保留。自身配合边界不重复打断，有限区间外不自动延伸或跨空白合并；第三零件遮挡和焊枪碰撞仍按真实几何检测。' }
}

/** Keep source measurements intact and change only derived planning properties. */
export function applyCollarGapPlanning(welds: WeldsData, parts: PartsData): WeldsData {
  return { ...welds, welds: welds.welds.map((weld) => {
    const policy = verifiedCollarGapPlanning(weld, parts)
    if (!policy) return weld
    const groove = record(weld.properties['坡口']), parameters = record(groove['参数'])
    return { ...weld, properties: { ...weld.properties, [KEY]: policy,
      坡口: { ...groove, 参数: { ...parameters, 根部间隙: 0 }, 根部间隙依据: '补板已核验有限接头按无间隙连接规划；实体测量见补板间隙规划和原始证据' } } }
  }) }
}
