import type { Weld, WeldsData } from '@/types/weld'

const FACES = ['上', '下', '前', '后', '左', '右'] as const
type Workface = typeof FACES[number]
const rec = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const rows = (value: unknown) => Array.isArray(value) ? value.map(rec) : []
const vector = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) return null
  const length = Math.hypot(...value)
  return length > 1e-8 ? value.map(n => n / length) : null
}
const known = (value: unknown): value is Workface => FACES.includes(value as Workface)

/** Opening direction in the current workpiece frame. Preserve the established
 * upper/lower convention for sloping openings; horizontal openings use X right,
 * Y back. This is independent of weld travel and the camera viewpoint. */
function faceOf(direction: number[]): Workface {
  if (Math.abs(direction[2]) > 1e-6) return direction[2] > 0 ? '上' : '下'
  if (Math.abs(direction[0]) > Math.abs(direction[1])) return direction[0] > 0 ? '右' : '左'
  return direction[1] > 0 ? '后' : '前'
}

function resolve(weld: Weld): Weld {
  const props = weld.properties, previous = rec(props.工作面识别)
  const manual = weld.parameterAudit?.defaults.焊缝所在工作面?.basis === '用户单条设定'
  // Source/user classifications stay intact. Only our own calculated values
  // are recomputed when another base frame is selected.
  if (known(props.焊缝所在工作面) && (manual || previous.version !== 1)) return weld
  const blocked = rows(rec(props.工艺识别).异常说明).some(row => row.代码 === 'opening-occupied-by-solid')
  const evidence: { 开口方向: number[]; 权重: number; 来源: string }[] = []
  // Workface describes orientation, not reachability. Preserve an existing
  // CAD position sample even when its opening is obstructed; the obstruction
  // evidence remains intact for the separate weldability checks.
  for (const sample of rows(rec(props.焊接位置).采样)) {
    const direction = vector(sample.名义焊缝面法向)
    if (direction) evidence.push({ 开口方向: direction, 权重: 1, 来源: 'CAD开口采样' })
  }
  if (!blocked) {
    // Older exports may not contain process samples. Plane normals are valid
    // local support evidence; a curve's descriptive normal is not.
    if (!evidence.length) for (const row of rows(props.焊缝段)) {
      const a = rec(row.主板面), b = rec(row.副板面)
      if (a.类型 !== '平面' || b.类型 !== '平面') continue
      const na = vector(a.法向), nb = vector(b.法向)
      if (!na || !nb) continue
      const tangent = Array.isArray(row.起点坐标) && Array.isArray(row.终点坐标)
        ? vector(row.终点坐标.map((n, i) => Number(n) - Number((row.起点坐标 as number[])[i]))) : null
      const sum = na.map((n, i) => n + nb[i])
      const projection = tangent ? sum.reduce((s, n, i) => s + n * tangent[i], 0) : 0
      const direction = vector(sum.map((n, i) => n - (tangent?.[i] ?? 0) * projection))
      if (!direction) continue
      const segment = weld.segments.find(s => s.index === row.index)
      evidence.push({ 开口方向: direction, 权重: Math.max(segment?.length ?? 1, 1e-8), 来源: 'CAD平面支撑法向' })
    }
  }
  const votes = new Map<Workface, number>()
  for (const sample of evidence) {
    const face = faceOf(sample.开口方向)
    votes.set(face, (votes.get(face) ?? 0) + sample.权重)
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1])
  const tied = ranked.length > 1 && Math.abs(ranked[0][1] - ranked[1][1]) < 1e-8
  const result = ranked.length && !tied ? ranked[0][0] : '待确认'
  const reason = blocked && !evidence.length ? '实际实体占据焊接开口，缺少有效工作面'
    : !evidence.length ? '缺少有效开口法向或平面支撑证据'
      : tied ? '多个工作面证据相同，不能唯一确定'
        : '按当前工件坐标系的CAD开口方向识别；水平开口按X右、Y后区分'
  const audit = { version: 1, 结果: result, 依据: reason, 采样: evidence }
  if (props.焊缝所在工作面 === result && JSON.stringify(previous) === JSON.stringify(audit)) return weld
  return { ...weld, properties: { ...props, 焊缝所在工作面: result, 工作面识别: audit } }
}

/** Run after coordinate and support-face correction, before workface filters.
 * Does not default joint, position, groove, leg size or endpoint features. */
export function normalizeWeldWorkfaces(data: WeldsData): WeldsData {
  const welds = data.welds.map(resolve)
  return welds.every((weld, i) => weld === data.welds[i]) ? data : { ...data, welds }
}
