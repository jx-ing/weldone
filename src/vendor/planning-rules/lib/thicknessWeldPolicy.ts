import type { PartsData, Weld, WeldsData } from '@/types/weld'
import type { CadPathCorner } from './cadPathCornerGeometry'
import type { MergeGroup } from './weldMerge'

export const DEFAULT_THICKNESS_WELD_THRESHOLD_MM = 50

export function sanitizeThicknessWeldThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_THICKNESS_WELD_THRESHOLD_MM
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const validVector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
const dot = (a: number[], b: number[]) => a.reduce((sum, n, axis) => sum + n * b[axis], 0)
const subtract = (a: number[], b: number[]) => a.map((n, axis) => n - b[axis])
const TOLERANCE_MM = .02

export interface ThicknessWeldDecision {
  /** Source end-face evidence alone also describes long side seams; a finite
   * path across the complete thickness must confirm this is a thickness edge. */
  applicable: boolean
  thicknessMm: number | null
  thresholdMm: number
  independent: boolean | null
}

export function thicknessWeldDecision(weld: Weld, partsData: PartsData, thresholdMm?: unknown): ThicknessWeldDecision {
  const threshold = sanitizeThicknessWeldThreshold(thresholdMm), joint = record(weld.properties.接头形式)
  const sub = partsData.parts.find(part => part.id === weld.subPartId)
  const thickness = sub && Number.isFinite(sub.thickness) && sub.thickness > 0 ? sub.thickness : null
  const result: ThicknessWeldDecision = { applicable: false, thicknessMm: thickness, thresholdMm: threshold, independent: null }
  if ((joint.是否由副板板厚形成 ?? joint.板厚是否形成单独焊缝) !== true || thickness === null
    || !sub || !validVector(sub.mainNormal) || !validVector(weld.start) || !validVector(weld.end) || weld.closed) return result
  const norm = Math.hypot(...sub.mainNormal)
  if (norm <= 1e-9) return result
  const axis = sub.mainNormal.map(n => n / norm), chord = subtract(weld.end, weld.start)
  if (Math.abs(Math.abs(dot(chord, axis)) - thickness) > TOLERANCE_MM) return result
  const points = weld.segments.flatMap(segment => segment.points)
  if (points.length < 2 || !points.every(validVector) || points.some(point => {
    const delta = subtract(point, weld.start), axial = dot(delta, axis)
    return Math.hypot(...delta.map((n, index) => n - axis[index] * axial)) > TOLERANCE_MM
      || axial * dot(chord, axis) < -TOLERANCE_MM || Math.abs(axial) > thickness + TOLERANCE_MM
  })) return result
  return { ...result, applicable: true, independent: thickness >= threshold }
}

/** This is a planning policy, never a rewrite of the physical CAD evidence. */
export function applyThicknessWeldThreshold(data: WeldsData, partsData: PartsData, thresholdMm?: unknown): WeldsData {
  let changed = false
  const welds = data.welds.map(weld => {
    const decision = thicknessWeldDecision(weld, partsData, thresholdMm)
    const joint = record(weld.properties.接头形式)
    if (!decision.applicable) return weld
    if (joint.板厚形成独立焊缝 === decision.independent && joint.板厚形成焊缝阈值mm === decision.thresholdMm) return weld
    changed = true
    return { ...weld, properties: { ...weld.properties, 接头形式: { ...joint,
      板厚形成独立焊缝: decision.independent, 板厚形成焊缝阈值mm: decision.thresholdMm } } }
  })
  return changed ? { ...data, welds } : data
}

/** Geometry remains untouched: thin T-end travel is a wrap action, not a pair
 * of independent corners. Only the source-CAD-proved connector is affected. */
export function filterThicknessWrapCorners(corners: readonly CadPathCorner[],
  group: Pick<MergeGroup, 'geometryBoundary' | 'members'>, partsData: PartsData,
  thresholdMm?: unknown): CadPathCorner[] {
  if (!group.geometryBoundary || !group.members.length || group.members.some(member => member.jointType !== 'T接')) return [...corners]
  const partId = group.geometryBoundary.partId
  // The actual connector must cross the common subplate; a differently
  // oriented main-plate boundary is not governed by subplate thickness.
  if (!group.members.every(member => member.subPartId === partId)) return [...corners]
  const thickness = partsData.parts.find(part => part.id === partId)?.thickness
  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0
    || thickness >= sanitizeThicknessWeldThreshold(thresholdMm)) return [...corners]
  return corners.filter(corner => !corner.incomingBoundaryId && !corner.outgoingBoundaryId)
}

/** Existing finite thickness welds can supply the full-wrap connector without
 * a CAD bridge proof. Apply the same policy only to explicitly full-wrap groups. */
export function keepsThicknessMemberCorner(group: MergeGroup, sourceWelds: readonly Weld[], partsData: PartsData,
  incomingMemberIndex: number, outgoingMemberIndex: number, thresholdMm?: unknown): boolean {
  if (!group.geometryFullWrap && !group.manualFullWrap) return true
  const adjacent = [group.members[incomingMemberIndex], group.members[outgoingMemberIndex]]
  return !adjacent.some(member => {
    if (!member || member.jointType !== 'T接') return false
    const weld = sourceWelds.find(source => source.id === member.weldId)
    return !!weld && thicknessWeldDecision(weld, partsData, thresholdMm).independent === false
  })
}
