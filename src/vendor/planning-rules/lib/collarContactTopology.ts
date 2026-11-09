import type { Part, PartsData, Weld, WeldsData } from '@/types/weld'

type V = [number, number, number]
const vector = (value: unknown): V | null => Array.isArray(value) && value.length === 3
  && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? value as V : null
const sub = (a: number[], b: number[]) => a.map((n, i) => n - b[i]) as V
const dot = (a: number[], b: number[]) => a.reduce((s, n, i) => s + n * b[i], 0)
const magnitude = (v: number[]) => Math.hypot(...v)
const unit = (v: number[]) => magnitude(v) > 1e-9 ? v.map((n) => n / magnitude(v)) as V : null
const distance = (a: number[], b: number[]) => magnitude(sub(a, b))
const TOLERANCE = .02
const pairKey = (w: Weld) => [w.mainPartId, w.subPartId].sort().join('|')

function support(weld: Weld, partId: string): { normal: V; faceIndex: number; otherFaceIndex: number } | null {
  const records = weld.properties.焊缝段
  if (!Array.isArray(records) || records.length !== 1) return null
  const isMain = partId === weld.mainPartId
  const face = records[0]?.[isMain ? '主板面' : '副板面']
  const rawNormal = vector(face?.法向), normal = rawNormal && unit(rawNormal)
  if (!normal || face?.类型 !== '平面') return null
  return { normal, faceIndex: isMain ? weld.mainFaceIndex : weld.subFaceIndex,
    otherFaceIndex: isMain ? weld.subFaceIndex : weld.mainFaceIndex }
}

export interface CollarThicknessReference {
  weldId: string
  collarPartId: string
  otherPartId: string
  sideWeldIds: [string, string]
  thicknessMm: number
  supportFaceIndices: [number, number, number]
  hostFaceIndex: number
  /** 原 CAD 边仍保留在输入数据中；其端封口由包角动作负责，不重复生成一条横穿板厚的焊道。 */
  kind: '板厚端部参考' | '相向接触面边界'
}

/** Separate the two exposed side seams from the thickness edges of a collar.
 *
 * A short edge alone is never discarded. The source support topology must show
 * two opposite broad faces of the *same* recognized collar meeting the same
 * host face, and this edge must join their actual vertices across the complete
 * thickness. Projected contours, arcs and unrelated short welds are untouched.
 * Source JSON is retained so these CAD edges remain available as wrap evidence.
 */
export function separateCollarContactSides(data: WeldsData, partsData: PartsData,
  options: { independentThicknessWeldIds?: ReadonlySet<string> } = {}): {
  weldsData: WeldsData; references: CollarThicknessReference[]
} {
  const byPart = new Map(partsData.parts.map((part) => [part.id, part]))
  const byPair = new Map<string, Weld[]>()
  for (const weld of data.welds) {
    const key = pairKey(weld), group = byPair.get(key) ?? []
    group.push(weld); byPair.set(key, group)
  }
  const references: CollarThicknessReference[] = []
  const sideReferences = new Map<string, CollarThicknessReference[]>()
  for (const weld of data.welds) {
    if (options.independentThicknessWeldIds?.has(weld.id)) continue
    if (weld.closed || weld.properties.投影搭接 || weld.properties.装配间隙
      || weld.segments.length !== 1 || weld.segments[0].type !== '直线') continue
    const a = vector(weld.start), b = vector(weld.end)
    if (!a || !b) continue
    const delta = sub(b, a), length = magnitude(delta)
    if (length <= TOLERANCE) continue
    for (const partId of [weld.mainPartId, weld.subPartId]) {
      const part: Part | undefined = byPart.get(partId)
      if (!part?.partRole
        || !['补板', '水密补板'].includes(part.partRole.type)) continue
      const axis = vector(part.mainNormal), normal = axis && unit(axis)
      if (!normal || !Number.isFinite(part.thickness) || part.thickness <= 0
        || Math.abs(Math.abs(dot(delta, normal)) - part.thickness) > TOLERANCE
        || Math.abs(length - part.thickness) > TOLERANCE) continue
      // The connector lies on an end face, not either of the broad faces.
      const connector = support(weld, partId)
      if (!connector || Math.abs(dot(connector.normal, normal)) > .01) continue
      const otherPartId = partId === weld.mainPartId ? weld.subPartId : weld.mainPartId
      const candidates = (byPair.get(pairKey(weld)) ?? []).filter((side) => {
        if (side.id === weld.id || side.closed || side.properties.投影搭接) return false
        const face = support(side, partId)
        return face && face.otherFaceIndex === connector.otherFaceIndex
          && Math.abs(dot(face.normal, normal)) > .999
          && Math.abs(dot(sub(side.end, side.start), normal)) <= TOLERANCE
          && side.length > part.thickness * 2
      })
      const left = candidates.filter((side) => Math.min(distance(side.start, a), distance(side.end, a)) <= TOLERANCE)
      const right = candidates.filter((side) => Math.min(distance(side.start, b), distance(side.end, b)) <= TOLERANCE)
      // Ambiguous/branching topology must remain intact until it is resolved.
      if (left.length !== 1 || right.length !== 1 || left[0].id === right[0].id) continue
      const fa = support(left[0], partId)!, fb = support(right[0], partId)!
      if (fa.faceIndex === fb.faceIndex || dot(fa.normal, fb.normal) > -.999) continue
      const otherSupport = support(weld, otherPartId)
      const reference: CollarThicknessReference = {
        weldId: weld.id, collarPartId: partId, otherPartId,
        sideWeldIds: [left[0].id, right[0].id], thicknessMm: part.thickness,
        supportFaceIndices: [fa.faceIndex, connector.faceIndex, fb.faceIndex],
        hostFaceIndex: connector.otherFaceIndex,
        kind: otherSupport && dot(connector.normal, otherSupport.normal) < -.999
          ? '相向接触面边界' : '板厚端部参考',
      }
      references.push(reference)
      for (const side of [left[0], right[0]]) {
        const rows = sideReferences.get(side.id) ?? []
        rows.push(reference); sideReferences.set(side.id, rows)
      }
      break
    }
  }
  if (!references.length) return { weldsData: data, references }
  const connectorIds = new Set(references.map((row) => row.weldId))
  return { references, weldsData: { ...data, welds: data.welds.filter((w) => !connectorIds.has(w.id)).map((weld) => {
    const rows = sideReferences.get(weld.id)
    return rows ? { ...weld, properties: { ...weld.properties, 补板侧焊缝: {
      规则: '两侧焊道保持独立；板厚端边仅供包角，自动合并不得横穿板厚。',
      厚度连接参考: rows.map((row) => row.weldId),
      对侧焊缝: [...new Set(rows.flatMap((row) => row.sideWeldIds).filter((id) => id !== weld.id))],
    } } } : weld
  }) } }
}
