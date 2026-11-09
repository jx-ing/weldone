import type { Weld, WeldsData } from '@/types/weld'
import type { WeldSplit } from './weldSplit'

interface LugContour {
  version: 1
  kind: 'outer'
  componentId: string
  sourceWeldIds: string[]
  connectionToleranceMm: number
}

/** This proof is produced only from opposing, trimmed CAD contact faces. */
export function lugOuterContour(weld: Weld): LugContour | null {
  const value = weld.properties.耳板接触轮廓 as Partial<LugContour> & {
    contactFaceIndices?: unknown[]; wireRoles?: unknown[]
  } | undefined
  return value?.version === 1 && value.kind === 'outer' && typeof value.componentId === 'string'
    && Array.isArray(value.sourceWeldIds) && value.sourceWeldIds.includes(weld.id)
    && value.contactFaceIndices?.length === 2 && value.contactFaceIndices.every(Number.isInteger)
    && value.wireRoles?.includes('outer') && typeof value.connectionToleranceMm === 'number'
    && value.connectionToleranceMm > 0 && value.connectionToleranceMm <= .02
    ? value as LugContour : null
}

/** Filter independent short welds, not the short native edges joining a real
 * lug contact contour. Recheck present, uncut geometry: metadata alone never
 * exempts a deleted, isolated, obstructed, extended or manually moved fragment.
 * This only retains edges; ordinary weld-position merge rules still apply. */
export function retainedLugContourUnitKeys(welds: WeldsData, splits: Map<string, WeldSplit> | null,
  minimumLength = 50): Set<string> {
  const retained = new Set<string>()
  if (!splits) return retained
  const groups = new Map<string, { key: string; start: number[]; end: number[]; length: number; tolerance: number }[]>()
  const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]))
  for (const weld of welds.welds) {
    const proof = lugOuterContour(weld), split = splits.get(weld.id)
    if (!proof || !split || split.subWelds.length !== 1 || split.splitPoints.length
      || split.startExtension || split.endExtension) continue
    const sub = split.subWelds[0]
    if (sub.geometryObstruction || sub.geometryEdited || distance(sub.start, weld.start) > .02
      || distance(sub.end, weld.end) > .02) continue
    const key = [weld.mainPartId, weld.subPartId].sort().join('|') + '|' + proof.componentId
    const group = groups.get(key) ?? []
    group.push({ key: `${weld.id}|0`, start: sub.start, end: sub.end, length: sub.length, tolerance: proof.connectionToleranceMm })
    groups.set(key, group)
  }
  for (const units of groups.values()) {
    const remaining = new Set(units.map((_, index) => index))
    while (remaining.size) {
      const first = remaining.values().next().value!
      const connected = [first], pending = [first]
      remaining.delete(first)
      while (pending.length) {
        const a = units[pending.pop()!]
        for (const index of remaining) {
          const b = units[index]
          if (![a.start, a.end].some(p => [b.start, b.end].some(q => distance(p, q) <= Math.min(a.tolerance, b.tolerance) + .015))) continue
          remaining.delete(index); pending.push(index); connected.push(index)
        }
      }
      if (connected.length > 1 && connected.reduce((sum, index) => sum + units[index].length, 0) >= minimumLength) {
        for (const index of connected) retained.add(units[index].key)
      }
    }
  }
  return retained
}
