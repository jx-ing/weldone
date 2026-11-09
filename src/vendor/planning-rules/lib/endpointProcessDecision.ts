/** Current process diagram as a pure decision. Measured CAD evidence and the
 * finite wrap corridor remain separate: this module neither measures geometry
 * nor replaces those safety gates. The caller supplies the configured minimum.
 * No delayed/buffered welding is enabled in this version. */
import type { EndpointSpace } from './endpointClearance'

export type EndpointDimensionMode = 'min-dimension' | 'width' | 'separate-dimensions'
export type EndpointProcessConfig =
  | { dimensionMode: 'min-dimension' | 'width'; minimumMm: number }
  | { dimensionMode: 'separate-dimensions'; minimumMm: { widthMm: number; heightMm: number } }

export interface EndpointProcessDecision {
  status: 'resolved' | 'pending' | 'not-applicable'
  action: 'full-wrap' | 'half-wrap-with-pose' | 'wrap-distance' | 'no-wrap' | 'extend-arc-off' | null
  wrap: 'full' | 'half' | 'none' | null
  postureChange: boolean | null
  travelWrapDistance: boolean | null
  extendArcOffTime: boolean | null
  deferred: false
  /** Separate per-dimension minima do not invent a scalar hole size. */
  holeSizeMm: number | null
  holeSizeCategory: 'zero' | 'below-minimum' | 'at-or-above-minimum' | null
  reason: string
}

const validDimension = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validMinimum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

function pending(reason: string): EndpointProcessDecision {
  return { status: 'pending', action: null, wrap: null, postureChange: null, travelWrapDistance: null,
    extendArcOffTime: null, deferred: false, holeSizeMm: null, holeSizeCategory: null, reason }
}

/** A zero size means a confirmed exposed endpoint without a passage, or an
 * actually measured zero in the explicitly chosen dimension mode. Unmeasured
 * and local-only dimensions are never treated as zero. Equality reaches the
 * minimum; the remaining positive sizes use the below-minimum branch. */
export function decideEndpointProcess(space: EndpointSpace, config: EndpointProcessConfig): EndpointProcessDecision {
  if (space.isEndpoint === false) return {
    status: 'not-applicable', action: null, wrap: 'none', postureChange: false, travelWrapDistance: false,
    extendArcOffTime: false, deferred: false, holeSizeMm: null, holeSizeCategory: null,
    reason: '接头内部点或闭合焊缝没有暴露端点，不适用端点动作',
  }
  if (space.isEndpoint !== true || space.endpointType === null) return pending('真实端点或自由端／干涉端尚未确认')
  const separate = config.dimensionMode === 'separate-dimensions'
  if (separate ? typeof config.minimumMm !== 'object' || config.minimumMm === null
    || !validMinimum(config.minimumMm.widthMm) || !validMinimum(config.minimumMm.heightMm)
    : (config.dimensionMode !== 'width' && config.dimensionMode !== 'min-dimension') || !validMinimum(config.minimumMm))
    return pending('过焊孔最小阈值尚未有效配置')

  const hole = space.passHoleSize
  let size: number | null = 0
  let category: EndpointProcessDecision['holeSizeCategory'] = 'zero'
  if (hole) {
    if (hole.scope !== 'complete') return pending('仅有局部让位尺寸，完整过焊孔尚未确认')
    if (!validDimension(hole.widthMm) || config.dimensionMode !== 'width' && !validDimension(hole.heightMm))
      return pending('所选尺寸口径所需的完整过焊孔尺寸尚未确认')
    if (config.dimensionMode === 'separate-dimensions') {
      size = null
      category = hole.widthMm === 0 && hole.heightMm === 0 ? 'zero'
        : hole.widthMm >= config.minimumMm.widthMm && hole.heightMm! >= config.minimumMm.heightMm
          ? 'at-or-above-minimum' : 'below-minimum'
    } else {
      size = config.dimensionMode === 'width' ? hole.widthMm : Math.min(hole.widthMm, hole.heightMm!)
      category = size === 0 ? 'zero' : size >= config.minimumMm ? 'at-or-above-minimum' : 'below-minimum'
    }
  }

  const result: EndpointProcessDecision = { status: 'resolved', action: null, wrap: null, postureChange: false,
    travelWrapDistance: false, extendArcOffTime: false, deferred: false, holeSizeMm: size,
    holeSizeCategory: category, reason: '' }
  if (space.endpointType === '自由端') {
    if (category === 'below-minimum') {
      result.action = 'no-wrap'; result.wrap = 'none'
      result.reason = '自由端的完整过焊孔大于零且未达到最小阈值，不执行包角'
    } else {
      result.action = 'full-wrap'; result.wrap = 'full'; result.travelWrapDistance = true
      result.reason = category === 'zero' ? '自由端无过焊孔，使用全包动作'
        : '自由端的完整过焊孔达到最小阈值，使用全包动作'
    }
  } else if (category === 'zero') {
    result.action = 'no-wrap'; result.wrap = 'none'; result.reason = '干涉端无过焊孔，不执行包角'
  } else if (category === 'at-or-above-minimum') {
    result.action = 'wrap-distance'; result.wrap = 'half'; result.travelWrapDistance = true
    result.reason = '干涉端的完整过焊孔达到最小阈值，姿态不变并走包角距离'
  } else {
    result.action = 'extend-arc-off'; result.wrap = 'none'; result.extendArcOffTime = true
    result.reason = '干涉端的完整过焊孔大于零且未达到最小阈值，姿态不变、原地延长熄弧时间'
  }
  return result
}
