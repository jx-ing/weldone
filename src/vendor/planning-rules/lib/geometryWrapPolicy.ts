import { abstractEndpointSpace, type EndpointSpace, type UnifiedEndpointInfo } from './endpointClearance'
import type { BaojiaoEndpoint } from './baojiao'

/** Library record types do not authorize automatic execution. Nongeneric
 * positions and joints are handled only by an explicitly selected template. */
export function supportsGeometryAutomaticWrap(positionCode: string, jointType: string | undefined): boolean {
  return positionCode === 'PB' && (jointType === 'T接' || jointType === '角接')
}

export function geometryAutomaticWrapUnavailableReason(positionCode: string, jointType: string | undefined): string {
  return positionCode === 'PF' ? 'PF 起点和终点默认不包角；当前不支持手工半包或全包'
    : `${positionCode || '未确认焊接位置'} · ${jointType || '未确认接头形式'} 暂不支持通用包角；自动判定为不包角`
}

/** Also guards previously calculated endpoints after metadata edits or merge
 * reversal. Independent preparation and measured CAD/collision evidence stay. */
export function limitGeometryAutomaticWrap(ep: BaojiaoEndpoint, positionCode: string, jointType: string | undefined): BaojiaoEndpoint {
  if (supportsGeometryAutomaticWrap(positionCode, jointType) || ep.type === '无' || ep.type === '变姿态'
    || ep.geometryWrapTemplateId && (ep.type === '全包' || ep.type === '半包')) return ep
  const reason = geometryAutomaticWrapUnavailableReason(positionCode, jointType)
  const next: BaojiaoEndpoint = { ...ep, type: '不包角', subtype: null, scheme: null,
    wrapPathDistance: 0, poses: null, offsetDir: null, rotDeg: null, movePose: null,
    rule: ep.rule.includes(reason) ? ep.rule : `${ep.rule}${ep.rule ? '；' : ''}${reason}` }
  delete next.geometryManualScheme
  if (next.variantKey?.startsWith('外角')) delete next.variantKey
  if (ep.processDecision) next.processDecision = { ...ep.processDecision,
    status: ep.processDecision.status === 'not-applicable' ? 'not-applicable' : 'resolved',
    wrap: 'none', action: 'no-wrap', travelWrapDistance: false,
    reason: ep.processDecision.reason.includes(reason) ? ep.processDecision.reason : `${ep.processDecision.reason}；${reason}` }
  return next
}

export type GeometryWrapChoice = '全包' | '半包' | '不包角'
export interface GeometryWrapChoiceInput {
  positionCode: string
  jointType: string
  wrapType: GeometryWrapChoice
  endpointInfo?: UnifiedEndpointInfo | null
  extendThreshold: number | null
  minimumHoleMm?: number
}
export interface GeometryWrapChoiceDecision {
  allowed: boolean
  route: 'direct' | 'template' | 'reject'
  geometryPassed: boolean
  holeSizeMm: number | null
  space: EndpointSpace | null
  reason: string
}

/** Only the generic PB T/fillet procedure is built in. Other positions and
 * joint forms keep their explicit requested action in a user template. */
export function evaluateGeometryWrapChoice(input: GeometryWrapChoiceInput): GeometryWrapChoiceDecision {
  const space = input.endpointInfo ? abstractEndpointSpace(input.endpointInfo, input.extendThreshold) : null
  const direct = supportsGeometryAutomaticWrap(input.positionCode, input.jointType)
  const route = direct ? 'direct' : 'template'
  const result: GeometryWrapChoiceDecision = { allowed: true, route, geometryPassed: true,
    holeSizeMm: null, space, reason: direct ? '使用平角焊通用包角参数' : '当前焊接位置或接头形式暂不支持通用包角' }
  if (input.wrapType === '不包角') return { ...result, route: 'direct', reason: '明确指定不包角' }
  if (input.wrapType === '半包') return result
  const reject = (reason: string): GeometryWrapChoiceDecision => ({ ...result, allowed: false,
    route: 'reject', geometryPassed: false, reason })
  if (!input.endpointInfo || space?.isEndpoint !== true || space.endpointType === null)
    return reject('端部几何尚未确认，不能指定全包')
  if (space.endpointType !== '自由端') return reject('全包需要已确认的自由端')
  const threshold = input.extendThreshold, clearance = input.endpointInfo.axialClearanceMm
  if (threshold === null || !Number.isFinite(threshold) || threshold <= 0) return reject('全包需要有效的 extend 检测阈值')
  // Infinity is an explicit clear outward ray. Missing evidence is not zero
  // and cannot borrow the inspection limit as a fabricated measured distance.
  if (clearance === null || typeof clearance !== 'number' || Number.isNaN(clearance) || clearance < threshold)
    return reject('全包需要已确认的 extend 距离达到当前检测阈值')
  const minimum = input.minimumHoleMm ?? 40
  if (!Number.isFinite(minimum) || minimum <= 0) return reject('全包需要有效的过焊孔最小阈值')
  const hole = space.passHoleSize
  if (hole) {
    if (hole.scope !== 'complete') return reject('仅有局部让位，完整过焊孔尚未确认，不能指定全包')
    if (hole.widthMm === null || hole.heightMm === null || !Number.isFinite(hole.widthMm) || !Number.isFinite(hole.heightMm))
      return reject('完整过焊孔的宽、高尚未确认，不能指定全包')
    result.holeSizeMm = Math.min(hole.widthMm, hole.heightMm)
  } else result.holeSizeMm = 0
  if (result.holeSizeMm > 0 && result.holeSizeMm < minimum)
    return reject(`完整过焊孔最小尺寸 ${result.holeSizeMm} mm 未达到 ${minimum} mm，不能指定全包`)
  return { ...result, reason: direct ? '自由端的 extend 与完整过焊孔条件通过，使用平角焊通用全包'
    : '全包几何条件通过；当前焊接位置或接头形式暂不支持通用包角' }
}
