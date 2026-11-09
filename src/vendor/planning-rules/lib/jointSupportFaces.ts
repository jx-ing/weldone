import { Vector3 } from 'three'
import type { BoundaryWire, Edge, EdgesData, PartsData, Weld, WeldsData } from '@/types/weld'
import { WELD_POSITION_NAMES } from './weldParameters'

const TOL = .025
const rec = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const vec = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
const v = (p: number[]) => new Vector3().fromArray(p)
const round = (n: number) => Number(n.toFixed(6))
const angle = (a: Vector3, b: Vector3) => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI
const pointSegmentDistance = (p: Vector3, a: Vector3, b: Vector3) => {
  const d = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(d) / d.lengthSq()))
  return p.distanceTo(a.clone().addScaledVector(d, t))
}
type FaceIndex = { wire: BoundaryWire; edges: Edge[] }
type SupportReplacement = { side: '主板面' | '副板面'; oldIndex: number; faceIndex: number; normal: Vector3; thickness: number }

function replacement(weld: Weld, parts: PartsData, faces: Map<string, FaceIndex>, rows: Record<string, unknown>[]): SupportReplacement | null {
  if (weld.jointType !== 'T接' || weld.closed || weld.segments.some(s => !/直线/.test(s.type)) || rows.length !== 1) return null
  const row = rows[0], main = rec(row.主板面), sub = rec(row.副板面)
  if (main.类型 !== '平面' || sub.类型 !== '平面' || !vec(main.法向) || !vec(sub.法向)) return null
  const oldA = v(main.法向).normalize(), oldB = v(sub.法向).normalize()
  // Restrict this repair to the erroneous near-opposing broad-face choice.
  // Normal right-angle fillets, bevel faces and deliberately inclined walls
  // keep their own real support surfaces.
  if (oldA.dot(oldB) > -Math.cos(Math.PI / 6)) return null
  const evidence = rec(rec(weld.properties.坡口).端面证据)
  const points = weld.segments.flatMap(s => s.points).map(v)
  const candidates: SupportReplacement[] = []
  for (const side of ['主板面', '副板面'] as const) {
    const isMain = side === '主板面', partId = isMain ? weld.mainPartId : weld.subPartId
    const oldIndex = isMain ? weld.mainFaceIndex : weld.subFaceIndex
    const oldNormal = isMain ? oldA : oldB, other = isMain ? oldB : oldA
    const thickness = parts.parts.find(p => p.id === partId)?.thickness
    if (!thickness || thickness <= 0) continue
    const witnesses = evidence[isMain ? '主板' : '副板']
    if (!Array.isArray(witnesses)) continue
    for (const raw of witnesses) {
      const witness = rec(raw), faceIndex = Number(witness.面索引), span = Number(witness.端面跨厚度)
      const face = faces.get(`${partId}|${faceIndex}`)
      if (!face || faceIndex === oldIndex || face.wire.topologyComplete !== true || !face.wire.closed || !vec(face.wire.normal)
        || Math.abs(span - thickness) > Math.max(.1, thickness * .01) || Number(witness.端面距焊缝) > TOL) continue
      const normal = v(face.wire.normal).normalize()
      if (Math.abs(normal.dot(oldNormal)) > .01 || Math.abs(normal.dot(other)) > .7) continue
      const boundary = face.edges.find(edge => /直线/.test(edge.type) && points.every(p => pointSegmentDistance(p, v(edge.start), v(edge.end)) < TOL))
      if (!boundary || face.edges.some(edge => edge.points.some(p => Math.abs(v(p).sub(points[0]).dot(normal)) > TOL))) continue
      candidates.push({ side, oldIndex, faceIndex, normal, thickness })
    }
  }
  return candidates.length === 1 ? candidates[0] : null
}

/** Correct the selected contact face only where a native closed thickness
 * end face shares the complete weld edge. An inclined plate's broad face is
 * not the wall bordering the local welding opening at its thickness end. */
export function normalizeJointSupportFaces(data: WeldsData, parts: PartsData, edges: EdgesData | null): WeldsData {
  if (!edges?.wires?.length) return data
  const faces = new Map<string, FaceIndex>()
  for (const wire of edges.wires) if (wire.wire === 'outer') faces.set(`${wire.partId}|${wire.faceIndex}`, { wire, edges: [] })
  for (const edge of edges.edges) faces.get(`${edge.partId}|${edge.faceIndex}`)?.edges.push(edge)
  let changed = false
  const welds = data.welds.map(weld => {
    if (weld.properties.工艺支撑面修正) return weld
    const rows = Array.isArray(weld.properties.焊缝段) ? weld.properties.焊缝段.map(rec) : []
    const found = replacement(weld, parts, faces, rows)
    if (!found) return weld
    const row = rows[0], main = found.side === '主板面' ? found.normal : v(rec(row.主板面).法向 as number[]).normalize()
    const sub = found.side === '副板面' ? found.normal : v(rec(row.副板面).法向 as number[]).normalize()
    const travel = v(weld.end).sub(v(weld.start)).normalize(), opening = main.clone().add(sub)
    opening.addScaledVector(travel, -opening.dot(travel)).normalize()
    if (opening.lengthSq() < .5) return weld
    const slope = Math.asin(Math.min(1, Math.abs(travel.z))) * 180 / Math.PI
    const rotation = angle(opening, new Vector3(0, 0, 1))
    let code = '—'
    if (slope >= 85) code = travel.z > 0 ? 'PF' : 'PG'
    else if (slope <= 5) {
      const nominal = [0, 45, 90, 135, 180].reduce((best, n) => Math.abs(n - rotation) < Math.abs(best - rotation) ? n : best, 0)
      if (Math.abs(nominal - rotation) <= 10) code = ['PA', 'PB', 'PC', 'PD', 'PE'][nominal / 45]
    }
    const oldPosition = rec(weld.properties.焊接位置), oldGroove = rec(weld.properties.坡口), params = rec(oldGroove.参数)
    const contactAngle = angle(main, sub), gapAngle = round(180 - contactAngle)
    const samples = [.2, .5, .8].map(t => ({ 坐标: v(weld.start).lerp(v(weld.end), t).toArray(), 代号: code,
      焊缝倾角: round(slope), 焊缝转角: round(rotation), 焊接方向: travel.toArray(), 名义焊缝面法向: opening.toArray() }))
    const groove = Math.abs(gapAngle - 90) > 1 ? {
      ...oldGroove, 类型: '自然V形坡口',
      参数: { ...params, 坡口角度: gapAngle, 观测开口角度: gapAngle,
        坡口面角度: { 面1: round(gapAngle / 2), 面2: round(gapAngle / 2), 参照: '实际开口等角平分方向，不是加工斜角' } },
      识别依据: '与整条焊缝共边的完整厚度端面与主板形成自然V开口；加工坡口仍保留原始来源状态',
    } : { ...oldGroove, 参数: { ...params, 观测开口角度: gapAngle } }
    changed = true
    return { ...weld, ...(found.side === '副板面' ? { subFaceIndex: found.faceIndex } : { mainFaceIndex: found.faceIndex }),
      properties: { ...weld.properties, 主板面与副板面夹角: round(contactAngle),
        焊缝段: [{ ...row, [found.side]: { ...rec(row[found.side]), 法向: found.normal.toArray(), 来源面索引: found.faceIndex } }],
        焊接位置: { ...oldPosition, 位置: WELD_POSITION_NAMES[code], 代号: code, 焊缝倾角: round(slope), 焊缝转角: round(rotation),
          倾角范围: [round(slope), round(slope)], 转角范围: [round(rotation), round(rotation)], 采样: samples,
          识别依据: '焊缝共边完整厚度端面与主板的实际开放夹角，相对当前工件上方向' },
        坡口: groove,
        工艺支撑面修正: { version: 1, 构件: found.side, 原面索引: found.oldIndex, 有效面索引: found.faceIndex,
          完整端面厚度mm: found.thickness, 原焊接位置: oldPosition, 原坡口: oldGroove,
          依据: 'CAD完整面环、焊缝全长共边、端面跨完整板厚；不根据焊缝编号或名义角度覆盖' },
      } }
  })
  return changed ? { ...data, welds } : data
}
