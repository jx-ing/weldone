import type { PartsData, Weld, WeldsData } from '@/types/weld'
import type { MergeGroup } from './weldMerge'
import { collarGapPlanning, type CollarGapPlanning } from './collarGapPlanning'

type RecordValue = Record<string, unknown>
type DefaultMap = NonNullable<Weld['parameterAudit']>['defaults']

function gapPlanningProperties(policies: CollarGapPlanning[]): RecordValue {
  return { 规划间隙mm: 0, 实体最小间隙mm: Math.min(...policies.map((policy) => policy.measuredMinGapMm)),
    实体最大间隙mm: Math.max(...policies.map((policy) => policy.measuredMaxGapMm)),
    适用范围: '已确认补板/水密补板的已核验有限接头',
    说明: '按无间隙连接规划；模型实际间隙与位置保留，第三零件遮挡和焊枪碰撞仍按真实几何检测' }
}
export interface WeldParameterOptions {
  partsData?: PartsData
  /** 已转换平台坐标用Z向上；在源坐标发布时传入已验证的sourceUp。 */
  worldUp?: number[]
}
export interface WeldParameterOverrides {
  jointType?: string
  positionCode?: string
  grooveType?: string
  workface?: '上' | '下' | '前' | '后' | '左' | '右'
  legMm?: number
}

export const WELD_JOINT_TYPES = ['T接', '对接', '角接', '搭接'] as const
export const WELD_GROOVE_TYPES = ['无坡口', '单V形', 'V形', '喇叭形'] as const
export type WeldGrooveType = typeof WELD_GROOVE_TYPES[number]
const GROOVE_ALIASES: Record<string, WeldGrooveType> = {
  '自然V形坡口': 'V形', 'V形坡口': 'V形', 'V型': 'V形', 'V型坡口': 'V形',
  '单V形坡口': '单V形', '单V型': '单V形', '单V型坡口': '单V形', 'I形坡口': '无坡口',
  '喇叭形坡口': '喇叭形', '喇叭型': '喇叭形', '喇叭型坡口': '喇叭形', '自然喇叭形坡口': '喇叭形',
}
/** Normalize labels only. Shape dimensions never imply a groove type here. */
export function normalizeWeldGrooveType(value: unknown): WeldGrooveType | null {
  if (typeof value !== 'string') return null
  const label = value.trim(), english = label.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')
  if (/^flare(?: (?:bevel|v))?(?: groove)?(?: weld)?$/.test(english)) return '喇叭形'
  return GROOVE_ALIASES[label] ?? (WELD_GROOVE_TYPES.includes(label as WeldGrooveType) ? label as WeldGrooveType : null)
}
/** All editors share one canonical choice list; legacy labels normalize above. */
export function weldGrooveChoices(_current?: string): readonly WeldGrooveType[] {
  return WELD_GROOVE_TYPES
}
export const WELD_WORKFACES = ['上', '下', '前', '后', '左', '右'] as const
export const WELD_POSITION_NAMES: Record<string, string> = {
  PA: '平焊位置', PB: '横角焊位置', PC: '横焊位置', PD: '仰角焊位置',
  PE: '仰焊位置', PF: '立向上焊位置', PG: '立向下焊位置',
  '—': '倾斜焊位置',
}
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordValue : {}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const positive = (value: unknown): value is number => finite(value) && value > 0
const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every(finite)
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0)
const unit = (value: number[]) => {
  const length = Math.hypot(...value)
  return length > 1e-12 ? value.map((n) => n / length) : null
}
const round = (value: number, digits = 3) => Number(value.toFixed(digits))
const known = (value: unknown, choices: readonly string[]) => typeof value === 'string' && choices.includes(value)

/** “—” is also the existing scheme key for a positively identified inclined
 * position, not just a missing value. Require the export's unanimous geometric
 * witnesses so unknown/combined positions still use the single-value fallback. */
function confirmedInclinedPosition(position: RecordValue): boolean {
  if (position.代号 !== '—' || position.位置 !== '倾斜焊位置'
    || !finite(position.焊缝倾角) || !finite(position.焊缝转角)) return false
  const samples = Array.isArray(position.采样) ? position.采样.map(record) : []
  return samples.length > 0 && samples.every((sample) => sample.代号 === '—'
    && finite(sample.焊缝倾角) && finite(sample.焊缝转角)
    && vector(sample.焊接方向) && vector(sample.名义焊缝面法向))
}

/** Nearest nominal position, for a single editable default outside the main-position ranges. */
function nearestPosition(slope: number, rotation: number, verticalDirection: number): string {
  if (slope >= 45) return verticalDirection < 0 ? 'PG' : 'PF'
  const horizontal = ['PA', 'PB', 'PC', 'PD', 'PE']
  return horizontal.reduce((best, code, index) =>
    Math.abs(index * 45 - rotation) < Math.abs(horizontal.indexOf(best) * 45 - rotation) ? code : best, 'PA')
}

function positionDefault(weld: Weld, position: RecordValue, up: number[]): string {
  const samples = Array.isArray(position.采样) ? position.采样.map(record) : []
  const weights = new Map<string, number>()
  for (const segment of weld.segments) for (let i = 1; i < segment.points.length; i++) {
    const a = segment.points[i - 1], b = segment.points[i]
    const delta = b.map((n, k) => n - a[k]), length = Math.hypot(...delta)
    if (length <= 1e-12) continue
    const midpoint = a.map((n, k) => (n + b[k]) / 2)
    const sample = samples.reduce<RecordValue | null>((best, candidate) => {
      if (!vector(candidate.坐标)) return best
      const distance = (value: RecordValue) => Math.hypot(...(value.坐标 as number[]).map((n, k) => n - midpoint[k]))
      return !best || distance(candidate) < distance(best) ? candidate : best
    }, null) ?? {}
    let travel = delta.map((n) => n / length)
    // Source exports and viewer traversal differ. The process witness records
    // the actual intended welding direction in either coordinate frame.
    if (vector(sample.焊接方向) && dot(travel, sample.焊接方向) < 0) travel = travel.map((n) => -n)
    const slope = Math.asin(Math.min(1, Math.abs(dot(travel, up)))) * 180 / Math.PI
    const opening = vector(sample.名义焊缝面法向) ? unit(sample.名义焊缝面法向) : null
    const rotation = opening ? Math.acos(Math.max(-1, Math.min(1, dot(opening, up)))) * 180 / Math.PI
      : finite(sample.焊缝转角) ? sample.焊缝转角 : finite(position.焊缝转角) ? position.焊缝转角 : 45
    const code = nearestPosition(slope, rotation, dot(travel, up))
    weights.set(code, (weights.get(code) ?? 0) + length)
  }
  if (weights.size) return [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  const sample = samples[0] ?? {}
  const direction = vector(sample.焊接方向) ? dot(sample.焊接方向, up) : 1
  return nearestPosition(finite(position.焊缝倾角) ? position.焊缝倾角 : 0,
    finite(position.焊缝转角) ? position.焊缝转角 : 45, direction)
}

function endpointParameter(value: unknown, key: string, defaults: DefaultMap): RecordValue {
  const source = record(value), result = { ...source }
  // A feature has already been selected by the recognizer. Alternative face
  // evidence remains in parameterAudit, never presented as editable choices.
  delete result.候选特征
  delete result.原端点特征
  const type = source.特征类型
  if (!known(type, ['角', '圆', '平角', '普通端点'])) {
    defaults[key] = { value: '普通端点', basis: '无有效端部边界证据，默认普通端点且不生成包角动作' }
    return { 特征类型: '普通端点', 关联面: source.关联面 ?? '副板面',
      默认动作: '不包角', 包角转角: 0, 动作需确认: false, 包角待确认: false }
  }
  const set = (field: string, fallback: number) => {
    if (!finite(result[field])) {
      result[field] = fallback
      defaults[`${key}.${field}`] = { value: fallback, basis: '演示参数默认值，未作为源几何实测值' }
    }
  }
  if (type === '圆') {
    const radius = positive(source.R1) ? source.R1 : positive(source.半径R) ? source.半径R : null
    if (radius === null) {
      defaults[key] = { value: '普通端点', basis: '缺少可靠正半径，默认普通端点且不生成包角动作' }
      return { 特征类型: '普通端点', 关联面: source.关联面 ?? '副板面',
        默认动作: '不包角', 包角转角: 0, 动作需确认: false, 包角待确认: false }
    }
    result.R1 = result.半径R = radius
    set('L1', 0)
    if (!finite(source.L1) || source.包角待确认 === true) {
      result.默认动作 = '不包角'
      defaults[`${key}.默认动作`] = { value: '不包角', basis: '保留真实圆弧；局部动作区间无充分证据时采用不包角默认' }
    }
    if (source.圆类型 == null) result.圆类型 = '圆弧'
  } else if (type === '角') {
    set('角度', 90)
    if (source.角类型 == null) result.角类型 = '直角'
    set('长', 0); set('高', 0)
  } else {
    result.默认动作 = '不包角'
    set('长', 0); set('高', 0)
  }
  return result
}

/** Preserve source geometry and evidence, choose exactly one editable process value. */
export function normalizeWeldParameters(weld: Weld, options: WeldParameterOptions = {}): Weld {
  if (weld.parameterAudit?.version === 1) {
    const groove = record(weld.properties.坡口), type = normalizeWeldGrooveType(groove.类型)
    return type && type !== groove.类型 ? { ...weld, properties: { ...weld.properties, 坡口: { ...groove, 类型: type } } } : weld
  }
  const props = weld.properties, defaults: DefaultMap = {}
  const up = unit(options.worldUp ?? [0, 0, 1]) ?? [0, 0, 1]
  const jt = record(props.接头形式), position = record(props.焊接位置), groove = record(props.坡口)
  const joint = known(jt.类型, WELD_JOINT_TYPES) ? jt.类型 as string
    : known(weld.jointType, WELD_JOINT_TYPES) ? weld.jointType : 'T接'
  if (!known(jt.类型, WELD_JOINT_TYPES) && !known(weld.jointType, WELD_JOINT_TYPES))
    defaults.接头形式 = { value: joint, basis: '演示默认T接；原实体交叠或未定接头依据保留后台审计' }
  const recognizedPosition = known(position.代号, Object.keys(WELD_POSITION_NAMES).filter((code) => code !== '—'))
    || confirmedInclinedPosition(position)
  const code = recognizedPosition ? position.代号 as string
    : positionDefault(weld, position, up)
  if (!recognizedPosition)
    defaults.焊接位置 = { value: code, basis: '按实际行进切向与开口方向选择最近名义位置，按真实路径长度加权；原倾角和变化范围保留审计' }
  const grooveType = normalizeWeldGrooveType(groove.类型) ?? '无坡口'
  if (!normalizeWeldGrooveType(groove.类型))
    defaults.坡口 = { value: grooveType, basis: '未证实开放坡口时演示默认无坡口；不宣称源件没有加工坡口' }
  const thk = record(props.厚度)
  const thicknesses = [thk.主板厚度, thk.副板厚度].filter(positive)
  if (!thicknesses.length && options.partsData) for (const id of [weld.mainPartId, weld.subPartId]) {
    const value = options.partsData.parts.find((part) => part.id === id)?.thickness
    if (positive(value)) thicknesses.push(value)
  }
  const defaultLeg = round(Math.min(8, ...thicknesses), 1)
  const leg = positive(props.焊脚) ? props.焊脚 : Math.max(.1, defaultLeg)
  if (!positive(props.焊脚)) defaults.焊脚 = { value: leg,
    basis: '沿用工艺路径演示默认8mm，已测较薄板小于8mm时按该厚度限幅；非源实测或WPS' }
  const samples = Array.isArray(position.采样) ? position.采样.map(record) : []
  const opening = samples[Math.floor(samples.length / 2)]?.名义焊缝面法向
  const segment = Array.isArray(props.焊缝段) ? record(props.焊缝段[0]) : {}
  const normal = record(segment.主板面).法向
  const side = vector(opening) && Math.abs(dot(opening, up)) > 1e-8 ? dot(opening, up)
    : vector(normal) ? dot(normal, up) : 1
  const workface = known(props.焊缝所在工作面, WELD_WORKFACES) ? props.焊缝所在工作面 : side < 0 ? '下' : '上'
  if (!known(props.焊缝所在工作面, WELD_WORKFACES)) defaults.焊缝所在工作面 = { value: workface,
    basis: '按名义开口方向相对工件上方向选择；水平开口以主板外法向定上/下，退化时演示默认上' }
  const sourceParams = record(groove.参数), params = { ...sourceParams }
  const gap = record(props.装配间隙)
  const assign = (key: string, fallback: number, basis: string) => {
    if (!finite(params[key])) {
      params[key] = fallback
      defaults[`坡口.${key}`] = { value: fallback, basis }
    }
  }
  const measuredGap = finite(gap.minSampleGapMm) ? gap.minSampleGapMm : props.实体最小距离mm
  if (finite(measuredGap) && measuredGap >= 0) assign('根部间隙', measuredGap, '取源模型已核验装配间隙')
  assign('根部半径', 0, '源数据未给定加工根部半径，演示默认0mm')
  assign('坡口角度', grooveType === '无坡口' ? 0 : finite(sourceParams.观测开口角度) ? sourceParams.观测开口角度 : 90,
    '取已有几何开口角度或演示默认角度；不作为加工斜角实测值')
  const normalized = { ...props, 识别状态: '参数已设定', 接头形式: { ...jt, 类型: joint },
    焊接位置: { ...position, 位置: WELD_POSITION_NAMES[code], 代号: code },
    坡口: { ...groove, 类型: grooveType, 参数: params }, 焊脚: leg, 焊缝所在工作面: workface,
    起点特征: endpointParameter(props.起点特征, '起点特征', defaults),
    终点特征: endpointParameter(props.终点特征, '终点特征', defaults) }
  return { ...weld, jointType: joint, properties: normalized,
    parameterAudit: { version: 1, sourceProperties: structuredClone(props), defaults } }
}

export function normalizeWeldsParameters(data: WeldsData, options: WeldParameterOptions = {}): WeldsData {
  return { ...data, welds: data.welds.map((weld) => normalizeWeldParameters(weld, options)) }
}

/** A concrete per-weld edit changes effective values and leaves source evidence intact. */
export function overrideWeldParameters(weld: Weld, overrides: WeldParameterOverrides): Weld {
  const normalized = normalizeWeldParameters(weld), props = { ...normalized.properties }
  const defaults = { ...normalized.parameterAudit!.defaults }
  const edited = (key: string, value: unknown) => { defaults[key] = { value, basis: '用户单条设定' } }
  let jointType = normalized.jointType
  if (known(overrides.jointType, WELD_JOINT_TYPES)) {
    jointType = overrides.jointType!
    props.接头形式 = { ...record(props.接头形式), 类型: jointType }; edited('接头形式', jointType)
  }
  if (known(overrides.positionCode, Object.keys(WELD_POSITION_NAMES))) {
    props.焊接位置 = { ...record(props.焊接位置), 位置: WELD_POSITION_NAMES[overrides.positionCode!], 代号: overrides.positionCode }
    edited('焊接位置', overrides.positionCode)
  }
  const overrideGrooveType = normalizeWeldGrooveType(overrides.grooveType)
  if (overrideGrooveType) {
    props.坡口 = { ...record(props.坡口), 类型: overrideGrooveType }; edited('坡口', overrideGrooveType)
  }
  if (known(overrides.workface, WELD_WORKFACES)) { props.焊缝所在工作面 = overrides.workface; edited('焊缝所在工作面', overrides.workface) }
  if (positive(overrides.legMm)) { props.焊脚 = overrides.legMm; edited('焊脚', overrides.legMm) }
  return { ...normalized, jointType, properties: props, parameterAudit: { ...normalized.parameterAudit!, defaults } }
}

/** Explicit presentation contract: effective parameters only, no candidate/evidence tree. */
export function weldParameterProperties(weld: Weld, displayedProps: RecordValue = weld.properties): RecordValue {
  if (!weld.parameterAudit) return displayedProps
  const props = displayedProps, jt = record(props.接头形式), position = record(props.焊接位置)
  const groove = record(props.坡口), params = record(groove.参数)
  const feature = (value: unknown, key: string) => {
    const f = endpointParameter(value, key, {}), type = f.特征类型
    const selected: RecordValue = { 特征类型: type ?? '普通端点', 关联面: f.关联面 ?? '副板面' }
    if (type === '角') Object.assign(selected, { 角类型: f.角类型, 角度: f.角度, 长: f.长 ?? 0, 高: f.高 ?? 0 })
    if (type === '圆') Object.assign(selected, { 圆类型: f.圆类型, 半径R: f.R1 ?? f.半径R,
      ...(!weld.parameterAudit?.defaults[`${key}.L1`] && f.默认动作 !== '不包角' && finite(f.L1) ? { L1: f.L1 } : {}) })
    if (f.默认动作) selected.默认动作 = f.默认动作
    return selected
  }
  const output: RecordValue = {
    '开放/闭合': props['开放/闭合'], 焊缝线长度: props.焊缝线长度,
    起点坐标: props.起点坐标, 终点坐标: props.终点坐标,
    起点行进方向: props.起点法向 ?? props.起点行进方向,
    终点行进方向: props.终点法向 ?? props.终点行进方向,
    焊缝所在工作面: props.焊缝所在工作面,
    接头形式: jt.类型, 焊接位置: { 位置: position.位置, 代号: position.代号,
      ...(finite(position.焊缝倾角) ? { 焊缝倾角: position.焊缝倾角 } : {}),
      ...(finite(position.焊缝转角) ? { 焊缝转角: position.焊缝转角 } : {}) },
    焊脚: props.焊脚,
    坡口: { 类型: groove.类型, 参数: { 坡口角度: params.坡口角度, 坡口深度: params.坡口深度, 根部间隙: params.根部间隙,
      钝边: params.钝边, 根部半径: params.根部半径 } },
    起点特征: feature(props.起点特征, '起点特征'), 终点特征: feature(props.终点特征, '终点特征'),
    参数来源: Object.keys(weld.parameterAudit.defaults).length ? '计算默认，可单独修正' : '源几何识别',
  }
  const policy = collarGapPlanning(weld)
  if (policy) output.连接间隙规划 = gapPlanningProperties([policy])
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined && value !== null))
}

/** Single nominal group values; member geometry and tool poses remain segment-specific. */
export function mergeWeldParameterProperties(group: Pick<MergeGroup, 'members'>,
  welds: readonly Weld[] | WeldsData, displayedProps: RecordValue): RecordValue {
  const source = Array.isArray(welds) ? welds as readonly Weld[] : (welds as WeldsData).welds
  const members = group.members.map((member) => ({ member, weld: source.find((weld) => weld.id === member.weldId) }))
  if (!members.length || members.some(({ weld }) => !weld?.parameterAudit)) return displayedProps
  const memberPositions = (weld: Weld, member: MergeGroup['members'][number]) => {
    const position = record(weld.properties.焊接位置)
    if (position.代号 !== 'PF' && position.代号 !== 'PG') return [{ item: position, weight: member.length }]
    const points = Array.isArray(member.points) && member.points.length > 1 ? member.points
      : member.start && member.end ? [member.start.toArray(), member.end.toArray()] : []
    let upLength = 0, downLength = 0
    for (let i = 1; i < points.length; i++) {
      if (!vector(points[i - 1]) || !vector(points[i])) continue
      const delta = points[i].map((value, axis) => value - points[i - 1][axis])
      const length = Math.hypot(...delta), rise = delta[2]
      // Use the same nearest vertical-position boundary as single-weld defaults.
      if (length <= 1e-12 || Math.abs(rise) / length < Math.SQRT1_2 - 1e-12) continue
      if (rise > 0) upLength += length
      else downLength += length
    }
    // Contribute both directions directly: a curved member's minority sections
    // must not gain the majority direction when voting across the whole group.
    if (upLength || downLength) return [
      { item: { ...position, 位置: WELD_POSITION_NAMES.PF, 代号: 'PF' }, weight: upLength },
      { item: { ...position, 位置: WELD_POSITION_NAMES.PG, 代号: 'PG' }, weight: downLength },
    ]
    const first = points[0], last = points.at(-1)
    const endpointRise = vector(first) && vector(last) ? last[2] - first[2] : 0
    if (Math.abs(endpointRise) <= 1e-8) return [{ item: position, weight: member.length }]
    const code = endpointRise < 0 ? 'PG' : 'PF'
    return [{ item: { ...position, 位置: WELD_POSITION_NAMES[code], 代号: code }, weight: member.length }]
  }
  const vote = (value: (weld: Weld, member: MergeGroup['members'][number]) => unknown,
    signature = (item: unknown) => JSON.stringify(item),
    contributions?: (weld: Weld, member: MergeGroup['members'][number]) => { item: unknown; weight: number }[]): unknown => {
    const choices = new Map<string, { weight: number; longest: number; value: unknown }>()
    for (const { member, weld } of members) {
      if (!positive(member.length)) continue
      for (const { item, weight } of contributions?.(weld!, member) ?? [{ item: value(weld!, member), weight: member.length }]) {
        if (!positive(weight)) continue
        const key = signature(item), previous = choices.get(key)
        if (!previous) choices.set(key, { weight, longest: weight, value: item })
        else { previous.weight += weight
          if (weight > previous.longest) { previous.longest = weight; previous.value = item } }
      }
    }
    return [...choices.entries()].sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))[0]?.[1].value
      ?? value(members[0].weld!, members[0].member)
  }
  const props = { ...displayedProps,
    接头形式: vote((weld) => weld.properties.接头形式, (item) => String(record(item).类型)),
    焊接位置: vote((weld) => weld.properties.焊接位置, (item) => String(record(item).代号), memberPositions),
    坡口: vote((weld) => weld.properties.坡口, (item) => String(record(item).类型)),
    焊缝所在工作面: vote((weld) => weld.properties.焊缝所在工作面),
    焊脚: vote((weld) => weld.properties.焊脚) }
  const policies = members.map(({ weld }) => collarGapPlanning(weld!)).filter((policy): policy is CollarGapPlanning => !!policy)
  return { ...weldParameterProperties(members[0].weld!, props),
    ...(policies.length ? { 连接间隙规划: { ...gapPlanningProperties(policies), 适用成员数: policies.length } } : {}),
    参数来源: '成员有效参数按路径长度选定；计算默认可单独修正' }
}
