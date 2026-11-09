import type { Weld, WeldUnitLine } from '@/types/weld'
import type { WeldSplit } from './weldSplit'
import { FINITE_INTERVAL_JOIN_TOLERANCE, type MergeResult } from './weldMerge'

/** 只有几何未经打断、延伸时才保留原始段的展示与选择粒度。 */
export function usesOriginalSegments(split: WeldSplit | null | undefined): boolean {
  return !!split && split.subWelds.length === 1 && split.splitPoints.length === 0
    && !split.startExtension && !split.endExtension && !split.subWelds[0].geometryEdited
}

/** 树与 3D 共用同一判断，延伸后的唯一子段同样属于处理后几何。 */
export function buildWeldUnits(
  allWelds: readonly Weld[], activeWelds: readonly Weld[],
  splits: Map<string, WeldSplit>, hiddenUnitKeys: ReadonlySet<string>,
): WeldUnitLine[] {
  const colors = new Map(allWelds.map((w, i) => [w.id, i]))
  const units: WeldUnitLine[] = []
  for (const weld of activeWelds) {
    const split = splits.get(weld.id)
    if (!split) continue
    const colorIdx = colors.get(weld.id) ?? 0
    if (usesOriginalSegments(split)) {
      if (hiddenUnitKeys.has(`${weld.id}|0`)) continue
      for (const seg of weld.segments) {
        if (seg.points.length < 2) continue
        units.push({
          key: `${weld.id}|s${seg.index}`, weldId: weld.id, subIndex: null,
          id: weld.id, points: seg.points, segmentIndex: seg.index, colorIdx,
          closedCircle: weld.closed,
        })
      }
    } else {
      split.subWelds.forEach((sub, subIndex) => {
        if (hiddenUnitKeys.has(`${weld.id}|${subIndex}`) || sub.points.length < 2) return
        units.push({
          key: `${weld.id}|${subIndex}`, weldId: weld.id, subIndex,
          id: sub.id, points: sub.points, segmentIndex: null, colorIdx,
          closedCircle: sub.closed,
        })
      })
    }
  }
  return units
}

/** Render and pick a merged weld as its group while retaining only real member
 * geometry. A tolerated automatic joining gap is not a weldable display span. */
export function applyGeometryMergedWeldUnits(units: WeldUnitLine[], merges: MergeResult | null,
  allWelds: readonly Weld[] = []): WeldUnitLine[] {
  if (!merges?.groups.length) return units
  const memberKey = (unit: WeldUnitLine) => `${unit.weldId}|${unit.subIndex ?? 0}`
  const sourceColors = new Map(units.filter((unit) => !unit.source).map((unit) => [memberKey(unit), unit.colorIdx]))
  const weldColors = new Map(allWelds.map((weld, index) => [weld.id, index]))
  for (const unit of units) if (!weldColors.has(unit.weldId)) weldColors.set(unit.weldId, unit.colorIdx)
  const groupIds = new Set(merges.groups.map((group) => group.id))
  const retained = units.filter((unit) => unit.source || !merges.mergedUnitKeys.has(memberKey(unit))
    && !(unit.mergeId && groupIds.has(unit.mergeId)))
  const squaredDistance = (a: number[], b: number[]) => a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0)
  const adjacent = (a: number[], b: number[]) => {
    // CAD coordinates may be large: compensate only for subtraction rounding
    // so an exact 0.02 mm seam does not become disconnected in floating point.
    const roundoff = Number.EPSILON * Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs)) * 8
    return squaredDistance(a, b) <= (FINITE_INTERVAL_JOIN_TOLERANCE + roundoff) ** 2
  }
  const validPoint = (point: number[]) => point.length === 3 && point.every(Number.isFinite)
  for (const group of merges.groups) {
    if (!group.members.length) continue
    const runs: number[][][] = []
    let run: number[][] | null = null
    for (const member of group.members) {
      const points = member.points
      if (points.length < 2 || !points.every(validPoint)) { run = null; continue }
      if (!run || !adjacent(run.at(-1)!, points[0])) {
        run = points.map((point) => [...point]); runs.push(run)
        continue
      }
      // Remove only a repeated joining vertex; every actual curved-path point
      // and both distinct quantized endpoints remain available to the renderer.
      const begin = run.at(-1)!.every((value, axis) => value === points[0][axis]) ? 1 : 0
      for (let index = begin; index < points.length; index++) run.push([...points[index]])
    }
    const first = group.members[0]
    const colorIdx = sourceColors.get(first.key) ?? weldColors.get(first.weldId) ?? 0
    const weldIds = [...new Set(group.members.map((member) => member.weldId))]
    runs.forEach((points, runIndex) => retained.push({ key: `M|${group.id}|${runIndex}`,
      id: group.id, mergeId: group.id, weldId: first.weldId, weldIds: [...weldIds],
      subIndex: null, segmentIndex: null, colorIdx, points,
      closedCircle: group.closed && runs.length === 1 }))
  }
  return retained
}
