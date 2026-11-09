/** Shared matching conditions for parameter and path libraries. */
import { normalizeWeldGrooveType } from './weldParameters'

export const CALIBRATION_POSITIONS = ['PA', 'PB', 'PC', 'PD', 'PE', 'PF', 'PG', '—', '未指定'] as const
export const CALIBRATION_JOINT_TYPES = ['T接', '对接', '角接', '搭接'] as const
export type CalibrationPosition = typeof CALIBRATION_POSITIONS[number]
export interface ProcessGrooveParameters {
  angleDeg: number | null
  depthMm: number | null
  rootGapMm: number | null
  rootFaceMm: number | null
}
export interface ProcessGrooveConditions { grooveType: string; grooveParameters: ProcessGrooveParameters }
export const GROOVE_FIELDS = [
  { key: 'angleDeg', label: '坡口角度', unit: '°', min: 0, max: 180 },
  { key: 'depthMm', label: '坡口深度', unit: 'mm', min: 0, max: Infinity },
  { key: 'rootGapMm', label: '根部间隙', unit: 'mm', min: 0, max: Infinity },
  { key: 'rootFaceMm', label: '钝边', unit: 'mm', min: 0, max: Infinity },
] as const
export interface ProcessCalibration {
  position: string
  jointType: string
  weldLegMm: number | null
  layerCount: number | null
  passCount: number | null
  /** Missing fields in older records mean no groove and unspecified sizes. */
  grooveType?: string
  grooveParameters?: ProcessGrooveParameters
}
export function createDefaultGrooveParameters(): ProcessGrooveParameters {
  return { angleDeg: null, depthMm: null, rootGapMm: null, rootFaceMm: null }
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null
export function calibrationGrooveErrors(value: unknown): string[] {
  const item = record(value)
  if (!item) return ['匹配条件格式无效']
  const errors: string[] = []
  if (item.grooveType !== undefined && !normalizeWeldGrooveType(item.grooveType))
    errors.push('请选择匹配坡口类型')
  const parameters = item.grooveParameters === undefined ? {} : record(item.grooveParameters)
  if (!parameters) return [...errors, '坡口参数格式无效']
  for (const field of GROOVE_FIELDS) {
    const number = parameters[field.key]
    if (number !== undefined && number !== null && (typeof number !== 'number' || !Number.isFinite(number)
      || number < field.min || number > field.max))
      errors.push(`${field.label}${field.max === Infinity ? '必须为不小于 0 的有效数值' : '必须为 0–180 之间的有效数值'}，或留空表示未设置`)
  }
  return errors
}
/** Normalize only omitted legacy values; explicit invalid values stay invalid. */
export function normalizeCalibrationGroove(value: unknown): ProcessGrooveConditions | null {
  if (calibrationGrooveErrors(value).length) return null
  const item = record(value)!, parameters = record(item.grooveParameters) ?? {}
  return { grooveType: item.grooveType === undefined ? '无坡口' : normalizeWeldGrooveType(item.grooveType)!,
    grooveParameters: { angleDeg: parameters.angleDeg as number | null | undefined ?? null,
      depthMm: parameters.depthMm as number | null | undefined ?? null,
      rootGapMm: parameters.rootGapMm as number | null | undefined ?? null,
      rootFaceMm: parameters.rootFaceMm as number | null | undefined ?? null } }
}
export function normalizeCalibrationPosition(value: unknown): CalibrationPosition | null {
  if (value === '倾斜焊') return '—'
  return CALIBRATION_POSITIONS.includes(value as CalibrationPosition) ? value as CalibrationPosition : null
}
export function calibrationErrors(value: ProcessCalibration): string[] {
  const errors: string[] = []
  const position = normalizeCalibrationPosition(value.position)
  if (!position || position === '未指定') errors.push('请选择匹配焊接位置')
  if (!CALIBRATION_JOINT_TYPES.includes(value.jointType as typeof CALIBRATION_JOINT_TYPES[number])) errors.push('请选择匹配接头类型')
  if (typeof value.weldLegMm !== 'number' || !Number.isFinite(value.weldLegMm) || value.weldLegMm <= 0) errors.push('匹配焊脚必须大于 0 mm')
  if (typeof value.layerCount !== 'number' || !Number.isSafeInteger(value.layerCount) || value.layerCount < 1) errors.push('层数必须为正整数')
  if (typeof value.passCount !== 'number' || !Number.isSafeInteger(value.passCount) || value.passCount < 1) errors.push('总道数必须为正整数')
  if (typeof value.layerCount === 'number' && typeof value.passCount === 'number' && value.passCount < value.layerCount) errors.push('总道数不能小于层数')
  return [...errors, ...calibrationGrooveErrors(value)]
}
export function calibrationKey(value: ProcessCalibration): string | null {
  if (calibrationErrors(value).length) return null
  const groove = normalizeCalibrationGroove(value)!
  return JSON.stringify([normalizeCalibrationPosition(value.position), value.jointType, value.weldLegMm, value.layerCount, value.passCount,
    groove.grooveType, ...GROOVE_FIELDS.map(field => groove.grooveParameters[field.key])])
}
export function calibrationLabel(value: ProcessCalibration): string {
  const position = normalizeCalibrationPosition(value.position)
  const groove = normalizeCalibrationGroove(value), parameters = groove ? GROOVE_FIELDS
    .filter(field => groove.grooveParameters[field.key] !== null)
    .map(field => `${field.label} ${groove.grooveParameters[field.key]} ${field.unit}`) : []
  const grooveLabel = groove ? `${groove.grooveType}${parameters.length ? `（${parameters.join('，')}）`
    : groove.grooveType === '无坡口' ? '' : '（参数未设置）'}` : '坡口条件待补充'
  return `${position === '—' ? '倾斜焊' : position ?? '未设匹配条件'} · ${value.jointType} · 焊脚 ${value.weldLegMm ?? '—'} mm · ${value.layerCount ?? '—'} 层 ${value.passCount ?? '—'} 道 · ${grooveLabel}`
}
