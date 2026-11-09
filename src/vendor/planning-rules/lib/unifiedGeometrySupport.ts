import type { Weld, WeldsData } from '@/types/weld'

/** Opt-in marker belongs only to the unified geometry platform. The retained
 * full platform keeps its established extension behavior and original data. */
export const UNIFIED_GEOMETRY_SUPPORT_KEY = '统一端部几何'
const markedWelds = new WeakMap<Weld, Weld>()
const markedData = new WeakMap<WeldsData, WeldsData>()

export function withUnifiedGeometrySupport(data: WeldsData): WeldsData {
  const saved = markedData.get(data)
  if (saved) return saved
  let changed = false
  const welds = data.welds.map((weld) => {
    if (weld.properties[UNIFIED_GEOMETRY_SUPPORT_KEY] === true) return weld
    changed = true
    const existing = markedWelds.get(weld)
    if (existing) return existing
    const marked = { ...weld, properties: { ...weld.properties, [UNIFIED_GEOMETRY_SUPPORT_KEY]: true } }
    markedWelds.set(weld, marked)
    return marked
  })
  const result = changed ? { ...data, welds } : data
  markedData.set(data, result)
  markedData.set(result, result)
  return result
}
