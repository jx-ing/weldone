/** Reversible property overrides for the geometry-only platform. Raw CAD data
 * and the retained tool-aware platform are never mutated. */
import * as THREE from 'three'
import type { PartsData, Selection, Weld, WeldsData } from '@/types/weld'
import type { BaojiaoEndpoint, BaojiaoResult, BaojiaoSubtype } from './baojiao'
import { CORNER_VARIANT_KEYS, POSITION_CODES, cornerPoints, endpointVariantKey, matchEndpointScheme, type CornerInstance, type CornerScheme, type CornerVariantKey } from './cornerSchemes'
import { computeGeometryCornerInstances, computeGeometryWeldBaojiao, geometryTargetEndpoints, GEOMETRY_WRAP_CAPABILITIES, withoutGeometryEndpointSchemes, type GeometryActionOptions } from './geometryActions'
import type { MergeGroup, MergeResult, MergeUnit } from './weldMerge'
import { inheritedGeometrySplitEvidence, subplateContactEndpointEvidence, type SubWeld, type WeldSplit } from './weldSplit'
import { normalizeWeldGrooveType, WELD_JOINT_TYPES, WELD_POSITION_NAMES } from './weldParameters'
import { GROOVE_FIELDS, type ProcessGrooveParameters } from './processCalibration'
import { usesOriginalSegments } from './weldPresentation'
import { endpointSample } from './torch'
import { endpointWrapDirections, endpointWrapSide } from './baojiaoFrame'
import { limitGeometryAutomaticWrap } from './geometryWrapPolicy'

export interface GeometryLegSettings { mode: 'thickness' | 'global'; globalLegMm: number }
export const DEFAULT_GEOMETRY_LEG_SETTINGS: GeometryLegSettings = { mode: 'thickness', globalLegMm: 8 }
export interface GeometrySchemeChoice { schemeId: string | null; variantKey?: CornerVariantKey }
export interface GeometryEndpointEdit {
  /** An explicit template authorizes a nongeneric manual wrap action. */
  templateId?: string
  wrapType?: '全包' | '半包' | '不包角' | '待定'
  wrapSubtype?: BaojiaoSubtype
  wrapScheme?: GeometrySchemeChoice
  poseChange?: boolean
  poseScheme?: GeometrySchemeChoice
}
export interface GeometryPropertyEdit {
  legMm?: number
  positionCode?: string
  jointType?: string
  grooveType?: string
  grooveParameters?: Partial<ProcessGrooveParameters>
  start?: number[]
  end?: number[]
  endpoints?: { start?: GeometryEndpointEdit; end?: GeometryEndpointEdit }
  corners?: Record<string, GeometrySchemeChoice | undefined>
  /** Independent corner type edits; never treated as library selections. */
  cornerTypes?: Record<string, CornerVariantKey | undefined>
}
export type GeometryEdits = Record<string, GeometryPropertyEdit>
export interface GeometryEditContext {
  weldsData: WeldsData
  splits: Map<string, WeldSplit> | null
  merges: MergeResult | null
  partsData?: PartsData
  mesh?: Float32Array
  schemes?: CornerScheme[]
  options?: GeometryActionOptions
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const point = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
const samePoint = (a: number[], b: number[]) => a.length === 3 && b.length === 3 && a.every((n, axis) => Math.abs(n - b[axis]) < 1e-6)
const pointKey = (value: number[]) => value.map((n) => Number(n.toFixed(6)))
const findLast = <T,>(values: T[], predicate: (value: T) => boolean) => { for (let i = values.length - 1; i >= 0; i--) if (predicate(values[i])) return i; return -1 }

export function sanitizeGeometryLegSettings(raw: unknown): GeometryLegSettings {
  const value = record(raw)
  return { mode: value.mode === 'global' ? 'global' : 'thickness', globalLegMm: positive(value.globalLegMm) ? value.globalLegMm : 8 }
}

export function sanitizeGeometryEdits(raw: unknown): GeometryEdits {
  const result: GeometryEdits = {}
  for (const [key, value] of Object.entries(record(raw))) {
    const input = record(value), edit: GeometryPropertyEdit = {}
    if (positive(input.legMm)) edit.legMm = input.legMm
    if (typeof input.positionCode === 'string' && POSITION_CODES.includes(input.positionCode)) edit.positionCode = input.positionCode
    if (typeof input.jointType === 'string' && (WELD_JOINT_TYPES as readonly string[]).includes(input.jointType)) edit.jointType = input.jointType
    const grooveType = normalizeWeldGrooveType(input.grooveType)
    if (grooveType) edit.grooveType = grooveType
    const grooveParameters: Partial<ProcessGrooveParameters> = {}
    for (const field of GROOVE_FIELDS) {
      const value = record(input.grooveParameters)[field.key]
      if (value === null || typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max)
        grooveParameters[field.key] = value
    }
    if (Object.keys(grooveParameters).length) edit.grooveParameters = grooveParameters
    if (point(input.start)) edit.start = [...input.start]
    if (point(input.end)) edit.end = [...input.end]
    const choice = (rawChoice: unknown): GeometrySchemeChoice | undefined => {
      const candidate = record(rawChoice)
      if (candidate.schemeId !== null && typeof candidate.schemeId !== 'string') return undefined
      const variantKey = typeof candidate.variantKey === 'string' && (CORNER_VARIANT_KEYS as readonly string[]).includes(candidate.variantKey) ? candidate.variantKey as CornerVariantKey : undefined
      return { schemeId: candidate.schemeId as string | null, ...(variantKey ? { variantKey } : {}) }
    }
    const endpoints: NonNullable<GeometryPropertyEdit['endpoints']> = {}
    for (const which of ['start', 'end'] as const) {
      const ep = record(record(input.endpoints)[which]), clean: GeometryEndpointEdit = {}
      if (typeof ep.templateId === 'string' && ep.templateId.trim() && ep.templateId.length <= 200) clean.templateId = ep.templateId.trim()
      if (typeof ep.wrapType === 'string' && ['全包', '半包', '不包角', '待定'].includes(ep.wrapType)) clean.wrapType = ep.wrapType as GeometryEndpointEdit['wrapType']
      if (typeof ep.wrapSubtype === 'string' && ['原地包角', '不变姿态包角', '变姿态包角', '待定'].includes(ep.wrapSubtype)) clean.wrapSubtype = ep.wrapSubtype as BaojiaoSubtype
      if (typeof ep.poseChange === 'boolean') clean.poseChange = ep.poseChange
      const wrapScheme = choice(ep.wrapScheme), poseScheme = choice(ep.poseScheme)
      if (wrapScheme) clean.wrapScheme = wrapScheme
      if (poseScheme) clean.poseScheme = poseScheme
      if (Object.keys(clean).length) endpoints[which] = clean
    }
    if (Object.keys(endpoints).length) edit.endpoints = endpoints
    const corners: NonNullable<GeometryPropertyEdit['corners']> = {}
    for (const [corner, value] of Object.entries(record(input.corners))) { const clean = choice(value); if (clean) corners[corner] = clean }
    if (Object.keys(corners).length) edit.corners = corners
    const cornerTypes: NonNullable<GeometryPropertyEdit['cornerTypes']> = {}
    for (const [corner, value] of Object.entries(record(input.cornerTypes))) {
      if (typeof value === 'string' && (CORNER_VARIANT_KEYS as readonly string[]).includes(value)) cornerTypes[corner] = value as CornerVariantKey
    }
    if (Object.keys(cornerTypes).length) edit.cornerTypes = cornerTypes
    if (Object.keys(edit).length && key.length <= 20000) result[key] = edit
  }
  return result
}

function subKey(weldId: string, sub: SubWeld): string {
  const boundary = (which: 'start' | 'end') => {
    const source = sub[which === 'start' ? '起点来源' : '终点来源']
    return source.类型 === '打断点' ? pointKey((which === 'start' ? sub.geometryOriginalStart : sub.geometryOriginalEnd) ?? sub[which]) : source.类型
  }
  return JSON.stringify(['sub', weldId, boundary('start'), boundary('end')])
}

export function geometrySelectionKey(selection: Selection, context: GeometryEditContext): string | null {
  if (!selection || selection.kind === 'part') return null
  if (selection.kind === 'merge') {
    const group = context.merges?.groups.find((item) => item.id === selection.mergeId)
    if (!group) return null
    const members = group.geometryOriginalMemberKeys ?? group.members.map((member) => {
      const sub = context.splits?.get(member.weldId)?.subWelds[member.subIndex]
      return sub ? subKey(member.weldId, sub) : JSON.stringify(['source', member.weldId])
    })
    return JSON.stringify(['merge', [...members].sort()])
  }
  if (selection.kind === 'segment') return JSON.stringify(['segment', selection.weldId, selection.segmentIndex])
  const split = context.splits?.get(selection.weldId)
  const index = selection.kind === 'subweld' ? selection.subIndex : !selection.source && split?.subWelds.length === 1 && !usesOriginalSegments(split) ? 0 : undefined
  const sub = index === undefined ? undefined : split?.subWelds[index]
  return sub ? subKey(selection.weldId, sub) : JSON.stringify(['source', selection.weldId])
}

export function geometryCornerKey(corner: CornerInstance, context?: GeometryEditContext): string {
  const group = context?.merges?.groups.find((item) => item.id === corner.groupId)
  const from = group?.members[corner.memberIndex], to = group?.members[(corner.memberIndex + 1) % group.members.length]
  const member = (unit: MergeUnit | undefined, fallback: string) => {
    const sub = unit && context?.splits?.get(unit.weldId)?.subWelds[unit.subIndex]
    return sub && unit ? subKey(unit.weldId, sub) : fallback
  }
  return JSON.stringify([member(from, corner.fromId), member(to, corner.toId), pointKey(corner.pos)])
}

export function getGeometryCoordinatePoints(selection: Selection, context: GeometryEditContext): number[][] {
  if (!selection || selection.kind === 'part') return []
  if (selection.kind === 'merge') {
    const group = context.merges?.groups.find((item) => item.id === selection.mergeId)
    return group?.geometryOriginalPoints ?? group?.points ?? []
  }
  const weld = context.weldsData.welds.find((item) => item.id === selection.weldId)
  if (!weld) return []
  if (selection.kind === 'segment') return weld.segments.find((item) => item.index === selection.segmentIndex)?.points ?? []
  const split = context.splits?.get(weld.id)
  if (selection.kind === 'subweld' || selection.kind === 'weld' && !selection.source && split?.subWelds.length === 1 && !usesOriginalSegments(split)) {
    const sub = split?.subWelds[selection.kind === 'subweld' ? selection.subIndex : 0]
    return sub?.geometryOriginalPoints ?? sub?.points ?? []
  }
  return weld.segments.flatMap((segment, index) => index ? segment.points.slice(1) : segment.points)
}

export function getGeometryEffectiveProperties(selection: Selection, context: GeometryEditContext): Record<string, unknown> {
  if (!selection || selection.kind === 'part') return {}
  if (selection.kind === 'merge') return context.merges?.groups.find((item) => item.id === selection.mergeId)?.geometryProperties ?? {}
  const weld = context.weldsData.welds.find((item) => item.id === selection.weldId)
  const split = context.splits?.get(selection.weldId)
  const sub = selection.kind === 'subweld' ? split?.subWelds[selection.subIndex]
    : selection.kind === 'weld' && !selection.source && split?.subWelds.length === 1 && !usesOriginalSegments(split) ? split.subWelds[0] : null
  const segment = selection.kind === 'segment' ? weld?.segments.find((item) => item.index === selection.segmentIndex) : null
  return { ...weld?.properties, ...segment?.geometryProperties, ...sub?.geometryProperties }
}

// Implementations below keep geometry preprocessing independent from metadata.
const pathLength = (points: number[][]) => points.slice(1).reduce((sum, value, index) => sum + Math.hypot(...value.map((n, axis) => n - points[index][axis])), 0)
function locatePoint(points: number[][], target: number[]): number | null {
  let arc = 0
  for (let i = 1; i < points.length; i++) {
    const a = new THREE.Vector3().fromArray(points[i - 1]), b = new THREE.Vector3().fromArray(points[i])
    const line = new THREE.Line3(a, b), t = line.closestPointToPointParameter(new THREE.Vector3().fromArray(target), true)
    const projected = line.at(t, new THREE.Vector3()), length = a.distanceTo(b)
    if (projected.distanceToSquared(new THREE.Vector3().fromArray(target)) <= 1e-10) return arc + t * length
    arc += length
  }
  return null
}
function pathAt(points: number[][], s: number): number[] {
  let arc = 0
  for (let i = 1; i < points.length; i++) {
    const a = new THREE.Vector3().fromArray(points[i - 1]), b = new THREE.Vector3().fromArray(points[i]), length = a.distanceTo(b)
    if (s <= arc + length + 1e-8) return a.lerp(b, length > 1e-12 ? Math.max(0, Math.min(1, (s - arc) / length)) : 0).toArray()
    arc += length
  }
  return points.at(-1)!
}
function pathSlice(points: number[][], from: number, to: number): number[][] {
  const total = pathLength(points)
  if (from <= 1e-8 && to >= total - 1e-8) return points
  const result = [pathAt(points, from)]
  let arc = 0
  for (let i = 1; i < points.length; i++) {
    arc += Math.hypot(...points[i].map((n, axis) => n - points[i - 1][axis]))
    if (arc > from + 1e-8 && arc < to - 1e-8) result.push(points[i])
  }
  const end = pathAt(points, to)
  if (!samePoint(result.at(-1)!, end)) result.push(end)
  return result
}
function trimPath(points: number[][], edit?: GeometryPropertyEdit): number[][] {
  if (!edit || !edit.start && !edit.end || points.length < 2) return points
  const total = pathLength(points)
  const start = edit.start ? locatePoint(points, edit.start) : 0
  const end = edit.end ? locatePoint(points, edit.end) : total
  // Coordinate menus may only shorten an existing path, never manufacture a
  // bridge or a reverse/zero-length path through plate material.
  if (start === null || end === null || end - start < 1e-6) return points
  return pathSlice(points, start, end)
}

function withProperties(props: Record<string, unknown>, edit?: GeometryPropertyEdit, leg?: number): Record<string, unknown> {
  const value = { ...props }
  if (positive(edit?.legMm) || positive(leg)) value.焊脚 = edit?.legMm ?? leg
  if (edit?.positionCode) value.焊接位置 = { ...record(props.焊接位置), 代号: edit.positionCode, 位置: WELD_POSITION_NAMES[edit.positionCode] }
  if (edit?.jointType) value.接头形式 = { ...record(props.接头形式), 类型: edit.jointType }
  if (edit?.grooveType || edit?.grooveParameters) {
    const groove = record(props.坡口), parameters = { ...record(groove.参数) }
    const names: Record<keyof ProcessGrooveParameters, string> = { angleDeg: '坡口角度', depthMm: '坡口深度', rootGapMm: '根部间隙', rootFaceMm: '钝边' }
    for (const field of GROOVE_FIELDS) if (edit.grooveParameters?.[field.key] !== undefined)
      parameters[names[field.key]] = edit.grooveParameters[field.key]
    value.坡口 = { ...groove, ...(edit.grooveType ? { 类型: normalizeWeldGrooveType(edit.grooveType) ?? edit.grooveType } : {}), 参数: parameters }
  }
  return value
}

export function geometryAutomaticLeg(weld: Weld, parts: PartsData): number {
  const thickness = record(weld.properties.厚度)
  const values = [typeof weld.properties.厚度 === 'number' ? weld.properties.厚度 : thickness.主板厚度,
    typeof weld.properties.厚度 === 'number' ? weld.properties.厚度 : thickness.副板厚度]
    .map((raw, index) => positive(raw) ? raw : parts.parts.find((p) => p.id === (index ? weld.subPartId : weld.mainPartId))?.thickness)
    .filter(positive)
  const automatic = values.length ? Math.min(...values) * 2 / 3 : positive(weld.properties.焊脚) ? weld.properties.焊脚 : 8
  return Math.max(0.5, Math.round(automatic * 2) / 2)
}

const coordinateCache = new WeakMap<WeldsData, Map<string, WeldsData>>()
export function applyGeometrySourceCoordinates(data: WeldsData, edits: GeometryEdits): WeldsData {
  const relevant = Object.entries(edits).filter(([key, edit]) => (edit.start || edit.end) && (key.startsWith('["source",') || key.startsWith('["segment",')))
    .map(([key, edit]) => [key, edit.start, edit.end]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  if (!relevant.length) return data
  const cacheKey = JSON.stringify(relevant)
  let cache = coordinateCache.get(data)
  if (!cache) { cache = new Map(); coordinateCache.set(data, cache) }
  const existing = cache.get(cacheKey)
  if (existing) return existing
  let changed = false
  const welds = data.welds.map((weld) => {
    const source = edits[JSON.stringify(['source', weld.id])]
    const all = weld.segments.flatMap((segment, index) => index ? segment.points.slice(1) : segment.points)
    const trimmed = !weld.closed ? trimPath(all, source) : all
    let segmentChanged = trimmed !== all
    const startS = trimmed === all ? 0 : locatePoint(all, trimmed[0])!
    const endS = trimmed === all ? pathLength(all) : locatePoint(all, trimmed.at(-1)!)!
    let cursor = 0
    const segments = weld.segments.flatMap((segment) => {
      const segmentStart = cursor, segmentEnd = cursor + pathLength(segment.points)
      cursor = segmentEnd
      if (segmentEnd <= startS + 1e-8 || segmentStart >= endS - 1e-8) { segmentChanged = true; return [] }
      const local = pathSlice(segment.points, Math.max(0, startS - segmentStart), Math.min(pathLength(segment.points), endS - segmentStart))
      const segmentEdit = edits[JSON.stringify(['segment', weld.id, segment.index])]
      const points = trimPath(local, segmentEdit)
      const same = points.length === segment.points.length && points.every((p, i) => samePoint(p, segment.points[i]))
      if (same) return [segment]
      segmentChanged = true
      return [{ ...segment, points, start: points[0], end: points.at(-1)!, length: pathLength(points) }]
    })
    if (!segmentChanged || !segments.length) return weld
    changed = true
    return { ...weld, segments, start: segments[0].start, end: segments.at(-1)!.end,
      length: segments.reduce((sum, segment) => sum + segment.length, 0), properties: { ...weld.properties,
        几何内部端点: { start: !samePoint(weld.start, segments[0].start), end: !samePoint(weld.end, segments.at(-1)!.end) },
        ...(samePoint(weld.start, segments[0].start) ? {} : { 起点特征: { 特征类型: '平角' } }),
        ...(samePoint(weld.end, segments.at(-1)!.end) ? {} : { 终点特征: { 特征类型: '平角' } }) } }
  })
  const result = changed ? { ...data, welds } : data
  if (cache.size >= 10) cache.delete(cache.keys().next().value!)
  cache.set(cacheKey, result)
  return result
}

export function applyGeometrySourceEdits(data: WeldsData, parts: PartsData, settings: GeometryLegSettings, edits: GeometryEdits): WeldsData {
  return { ...data, welds: data.welds.map((weld) => {
    const sourceEdit = edits[JSON.stringify(['source', weld.id])]
    const leg = settings.mode === 'global' ? settings.globalLegMm : geometryAutomaticLeg(weld, parts)
    const properties = withProperties({ ...weld.properties, 接头形式: { ...record(weld.properties.接头形式), 类型: weld.jointType } }, sourceEdit, leg)
    const segments = weld.segments.map((segment) => {
      const edit = edits[JSON.stringify(['segment', weld.id, segment.index])]
      return edit && (positive(edit.legMm) || edit.positionCode || edit.jointType || edit.grooveType || edit.grooveParameters)
        ? { ...segment, geometryProperties: withProperties(properties, edit) } : segment
    })
    return { ...weld, properties, segments, jointType: sourceEdit?.jointType ?? weld.jointType }
  }) }
}

/** Include the actual dimensions and edited metadata of derived selections
 * when creating position defaults. A position introduced on one child/group
 * must have its own fallback even when no original CAD weld used that code. */
export function geometryDefaultSchemeWelds(data: WeldsData, edits: GeometryEdits): WeldsData {
  const byId = new Map(data.welds.map((weld) => [weld.id, weld])), virtual: Weld[] = []
  for (const [key, edit] of Object.entries(edits)) {
    if (!positive(edit.legMm) && !edit.positionCode && !edit.jointType && !edit.grooveType && !edit.grooveParameters) continue
    let identity: unknown
    try { identity = JSON.parse(key) } catch { continue }
    if (!Array.isArray(identity) || identity[0] === 'source') continue
    const parents: string[] = []
    if ((identity[0] === 'segment' || identity[0] === 'sub') && typeof identity[1] === 'string') parents.push(identity[1])
    if (identity[0] === 'merge' && Array.isArray(identity[1])) for (const memberKey of identity[1]) {
      try { const member = JSON.parse(memberKey); if (Array.isArray(member) && ['sub', 'source'].includes(member[0]) && typeof member[1] === 'string') parents.push(member[1]) } catch { /* invalid saved member */ }
    }
    for (const id of new Set(parents)) {
      const source = byId.get(id)
      if (source) virtual.push({ ...source, id: `geometry-default:${key}:${id}`, jointType: edit.jointType ?? source.jointType,
        properties: withProperties(source.properties, edit) })
    }
  }
  return virtual.length ? { ...data, welds: [...data.welds, ...virtual] } : data
}

function segmentProperties(weld: Weld, sub: SubWeld): Record<string, unknown> {
  const midpoint = sub.points[Math.floor(sub.points.length / 2)]
  const match = weld.segments.find((segment) => segment.geometryProperties && locatePoint(segment.points, midpoint) !== null)
  return match?.geometryProperties ?? weld.properties
}

export function applyGeometrySplitEdits(splits: Map<string, WeldSplit> | null, weldsData: WeldsData, edits: GeometryEdits): Map<string, WeldSplit> | null {
  if (!splits) return null
  const byId = new Map(weldsData.welds.map((weld) => [weld.id, weld]))
  return new Map([...splits].map(([id, split]) => {
    const weld = byId.get(id)
    if (!weld) return [id, split]
    const subWelds = split.subWelds.map((sub) => {
      const edit = edits[subKey(id, sub)], properties = withProperties({ ...segmentProperties(weld, sub),
        ...(sub.geometryProperties?.间断焊 ? sub.geometryProperties : {}) }, edit)
      const points = sub.closed ? sub.points : trimPath(sub.points, edit)
      const coordinatesChanged = points !== sub.points
      return { ...sub, geometryProperties: properties, ...(coordinatesChanged ? {
        ...inheritedGeometrySplitEvidence(sub, points),
        geometryOriginalStart: sub.geometryOriginalStart ?? sub.start,
        geometryOriginalEnd: sub.geometryOriginalEnd ?? sub.end, geometryEdited: true,
        geometryOriginalPoints: sub.geometryOriginalPoints ?? sub.points,
        points, start: points[0], end: points.at(-1)!, length: pathLength(points),
        startTangent: new THREE.Vector3().fromArray(points[1]).sub(new THREE.Vector3().fromArray(points[0])).normalize().toArray(),
        endTangent: new THREE.Vector3().fromArray(points.at(-1)!).sub(new THREE.Vector3().fromArray(points.at(-2)!)).normalize().toArray(),
      } : {}) }
    })
    return [id, { ...split, subWelds }]
  }))
}

function editedUnit(unit: MergeUnit, points: number[][], properties: Record<string, unknown>): MergeUnit {
  const start = new THREE.Vector3().fromArray(points[0]), end = new THREE.Vector3().fromArray(points.at(-1)!)
  const chord = end.clone().sub(start).normalize()
  return { ...unit, points, start, end, chord, length: pathLength(points),
    jointType: typeof record(properties.接头形式).类型 === 'string' ? record(properties.接头形式).类型 as string : unit.jointType,
    weldingPosition: typeof record(properties.焊接位置).代号 === 'string' ? record(properties.焊接位置).代号 as string : unit.weldingPosition,
    焊脚: positive(properties.焊脚) ? properties.焊脚 : unit.焊脚,
    ...(samePoint(points[0], unit.points[0]) ? {} : { startNativeTangent: null, startNativeVertex: null }),
    ...(samePoint(points.at(-1)!, unit.points.at(-1)!) ? {} : { endNativeTangent: null, endNativeVertex: null }) }
}

function groupProperties(group: MergeGroup, data: WeldsData, splits: Map<string, WeldSplit> | null): Record<string, unknown> {
  const first = group.members[0], source = data.welds.find((w) => w.id === first?.weldId)
  const vote = (key: 'weldingPosition' | 'jointType' | '焊脚') => {
    const totals = new Map<string, { value: unknown; weight: number }>()
    for (const unit of group.members) {
      const value = unit[key], signature = String(value), old = totals.get(signature)
      if (old) old.weight += unit.length
      else totals.set(signature, { value, weight: unit.length })
    }
    return [...totals.values()].sort((a, b) => b.weight - a.weight)[0]?.value
  }
  const position = vote('weldingPosition')
  const grooves = new Map<string, { value: unknown; weight: number }>()
  for (const member of group.members) {
    const weld = data.welds.find(item => item.id === member.weldId), sub = splits?.get(member.weldId)?.subWelds[member.subIndex]
    const value = sub?.geometryProperties?.坡口 ?? weld?.properties.坡口
    const signature = JSON.stringify(value), current = grooves.get(signature)
    if (current) current.weight += member.length
    else grooves.set(signature, { value, weight: member.length })
  }
  return { ...source?.properties, 焊脚: vote('焊脚'),
    坡口: [...grooves.values()].sort((a, b) => b.weight - a.weight)[0]?.value ?? source?.properties.坡口,
    焊接位置: { ...record(source?.properties.焊接位置), 代号: position, 位置: WELD_POSITION_NAMES[String(position)] },
    接头形式: { ...record(source?.properties.接头形式), 类型: vote('jointType') } }
}

export function applyGeometryMergeEdits<T extends MergeResult>(merges: T | null, weldsData: WeldsData, splits: Map<string, WeldSplit> | null, edits: GeometryEdits): T | null {
  if (!merges) return null
  const context = { weldsData, splits, merges }, replacements = new Map<string, MergeUnit>()
  const removed = new Set<string>()
  const groups = merges.groups.map((group) => {
    const key = geometrySelectionKey({ kind: 'merge', mergeId: group.id }, context)!, edit = edits[key]
    const properties = withProperties(groupProperties(group, weldsData, splits), edit)
    // Group display polylines can contain a tolerated joining gap. Such a
    // display span is not weld geometry and cannot become a chosen endpoint.
    const onMember = (coordinate?: number[]) => !coordinate || group.members.some((member) => locatePoint(member.points, coordinate) !== null)
    const coordinatesSupported = onMember(edit?.start) && onMember(edit?.end)
    const points = group.closed || !coordinatesSupported ? group.points : trimPath(group.points, edit)
    const changed = points !== group.points
    const startPoint = points[0], endPoint = points.at(-1)!
    const startMember = changed ? group.members.findIndex((unit) => {
      const at = locatePoint(unit.points, startPoint)
      return at !== null && at < unit.length - 1e-6
    }) : 0
    let endMember = changed ? findLast(group.members, (unit) => {
      const at = locatePoint(unit.points, endPoint)
      return at !== null && at > 1e-6
    }) : group.members.length - 1
    if (endMember < startMember) endMember = startMember
    const members = group.members.flatMap((unit, index) => {
      if (index < startMember || index > endMember) { removed.add(unit.key); return [] }
      const localEdit = { ...(index === startMember && changed ? { start: startPoint } : {}), ...(index === endMember && changed ? { end: endPoint } : {}) }
      const local = trimPath(unit.points, localEdit)
      const unitProperties = withProperties({ 焊脚: unit.焊脚, 焊接位置: { 代号: unit.weldingPosition }, 接头形式: { 类型: unit.jointType } }, edit)
      const effective = edit ? editedUnit(unit, local, unitProperties) : unit
      replacements.set(unit.key, effective)
      return [effective]
    })
    return { ...group, geometryProperties: properties, members,
      ...(edit && (changed || positive(edit.legMm) || edit.positionCode || edit.jointType || edit.grooveType || edit.grooveParameters) ? { geometryEdited: true } : {}),
      geometryOriginalMemberKeys: group.geometryOriginalMemberKeys ?? group.members.map((unit) => {
        const sub = splits?.get(unit.weldId)?.subWelds[unit.subIndex]
        return sub ? subKey(unit.weldId, sub) : JSON.stringify(['source', unit.weldId])
      }),
      geometryOriginalPoints: group.geometryOriginalPoints ?? group.points,
      ...(changed ? { points, start: startPoint, end: endPoint,
        totalLength: members.reduce((sum, unit) => sum + unit.length, 0),
        connections: group.connections.filter((connection) => members.some((m) => m.id === connection.from) && members.some((m) => m.id === connection.to)) } : {}) }
  })
  return { ...merges, groups, units: merges.units.filter((unit) => !removed.has(unit.key)).map((unit) => replacements.get(unit.key) ?? unit) }
}

function schemeEndpoint(ep: BaojiaoEndpoint, choice: GeometrySchemeChoice | undefined, schemes: CornerScheme[], which: 'start' | 'end', action: 'wrap' | 'pose-change'): BaojiaoEndpoint {
  if (!choice) return ep
  const kind = action === 'wrap' ? '外角' : '内角'
  const variantKey = choice.variantKey?.startsWith(kind) ? choice.variantKey : ep.variantKey?.startsWith(kind) ? ep.variantKey : `${kind}-右转` as CornerVariantKey
  const scheme = choice.schemeId === null ? undefined : schemes.find((item) => item.id === choice.schemeId)
  const variant = scheme?.variants[variantKey]
  return { ...ep, variantKey, geometryManualScheme: true,
    scheme: scheme && variant ? { id: scheme.id, name: scheme.name, variant: variantKey, a: which === 'start' ? variant.a : variant.b, c: variant.c } : null }
}

export function applyGeometryEndpointEdit(ep: BaojiaoEndpoint, edit: GeometryEndpointEdit | undefined, position: string, schemes: CornerScheme[], which: 'start' | 'end', closed = false,
  matching?: { weld: Weld; partsData: PartsData; mesh: Float32Array; wrapDistanceRatio?: number; schemesEnabled?: boolean },
  options?: Pick<GeometryActionOptions, 'schemesEnabled' | 'wrapDistanceRatio'>): BaojiaoEndpoint {
  const noSchemes = options?.schemesEnabled === false || matching?.schemesEnabled === false
  const ratio = matching?.wrapDistanceRatio ?? options?.wrapDistanceRatio
  let clean = noSchemes ? withoutGeometryEndpointSchemes(ep, ratio) : ep
  if (noSchemes && matching && !closed) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which)
    if (sample) {
      const side = clean.wrapSide ?? endpointWrapSide(matching.weld, which)
      clean = { ...clean, variantKey: endpointVariantKey(sample, which, side, 'wrap'),
        ...(clean.poseChange ? { poseChange: { ...clean.poseChange,
          variantKey: endpointVariantKey(sample, which, side, 'pose-change') } } : {}) }
    }
  }
  if (closed) return { ...clean, type: '无', subtype: null, poseChange: undefined, scheme: null, wrapPathDistance: 0 }
  if (!edit?.wrapType) clean = limitGeometryAutomaticWrap(clean, position,
    String(record(matching?.weld.properties.接头形式).类型 ?? matching?.weld.jointType ?? ''))
  if (!edit) return clean
  let next = { ...clean }
  if (edit.wrapType) next.type = edit.wrapType
  const templateId = edit.templateId || (!edit.wrapType || edit.wrapType === clean.type ? clean.geometryWrapTemplateId : undefined)
  if (templateId && ['全包', '半包'].includes(next.type)) next.geometryWrapTemplateId = templateId
  else delete next.geometryWrapTemplateId
  const missingPFTemplate = position === 'PF' && ['全包', '半包'].includes(next.type) && !templateId
  if (missingPFTemplate) next.type = '不包角'
  if (next.type === '全包' && !templateId && !GEOMETRY_WRAP_CAPABILITIES.verticalFullWrap && position === 'PG') next.type = '半包'
  if (next.type === '半包') next.subtype = noSchemes ? null : edit.wrapSubtype ?? next.subtype ?? '变姿态包角'
  else next.subtype = null
  if (['全包', '半包'].includes(next.type) && matching) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which)
    const side = next.wrapSide ?? endpointWrapSide(matching.weld, which)
    if (sample) {
      next.offsetDir = endpointWrapDirections(sample, which, side).wrapDir.toArray()
      const thickness = record(matching.weld.properties.厚度)[side === 'main' ? '主板厚度' : '副板厚度']
      next.offsetDist = positive(thickness) ? thickness : matching.partsData.parts.find((p) => p.id === (side === 'main' ? matching.weld.mainPartId : matching.weld.subPartId))?.thickness ?? null
      if (noSchemes) next.variantKey = endpointVariantKey(sample, which, side, 'wrap')
      if (!noSchemes && !edit.wrapScheme && !next.scheme) {
        const hit = matchEndpointScheme(matching.weld, next.feature, next.wrapAngle ?? 90, sample, schemes, which, side, 'wrap')
        if (hit) next = schemeEndpoint(next, { schemeId: hit.scheme.id, variantKey: hit.variantKey }, schemes, which, 'wrap')
      }
    }
  }
  if (!noSchemes) next = schemeEndpoint(next, edit.wrapScheme, schemes, which, 'wrap')
  if (!['全包', '半包'].includes(next.type)) { next.scheme = null; next.wrapPathDistance = 0 }
  if (next.subtype === '原地包角') next.wrapPathDistance = 0
  else if (noSchemes && next.offsetDist && ['全包', '半包'].includes(next.type)) next.wrapPathDistance = Number.isFinite(ratio ?? 2 / 3)
    && (ratio ?? 2 / 3) > 0 ? Math.max(0, Math.min(next.offsetDist * (ratio ?? 2 / 3), next.unifiedInfo?.wrapAvailableMm ?? 0)) : 0
  else if (next.scheme && next.offsetDist && ['全包', '半包'].includes(next.type)) next.wrapPathDistance = Math.min(
    next.offsetDist * (matching?.wrapDistanceRatio ?? 2 / 3), next.scheme.a, next.unifiedInfo?.wrapAvailableMm ?? Infinity)
  if (edit.poseChange === false) delete next.poseChange
  else if (edit.poseChange === true && !next.poseChange) next.poseChange = { ...clean, type: '变姿态', subtype: null, poseChange: undefined,
    variantKey: ep.variantKey?.includes('左转') ? '内角-左转' : '内角-右转', scheme: null, wrapAngle: ep.wrapAngle ?? 90, rule: '人工指定端点变姿态（内角方案）' }
  if (next.poseChange && noSchemes && matching) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which)
    next.poseChange = { ...next.poseChange, scheme: null, wrapPathDistance: 0,
      rule: edit.poseChange === true ? '人工指定独立端点变姿态' : next.poseChange.rule,
      ...(sample ? { variantKey: endpointVariantKey(sample, which,
        next.poseChange.wrapSide ?? endpointWrapSide(matching.weld, which), 'pose-change') } : {}) }
  }
  if (!noSchemes && next.poseChange && edit.poseChange === true && !edit.poseScheme && !next.poseChange.scheme && matching) {
    const sample = endpointSample(matching.weld, matching.partsData, matching.mesh, which)
    const hit = sample ? matchEndpointScheme(matching.weld, next.poseChange.feature, next.poseChange.wrapAngle, sample, schemes,
      which, next.poseChange.wrapSide ?? endpointWrapSide(matching.weld, which), 'pose-change') : null
    if (hit) next.poseChange = schemeEndpoint(next.poseChange, { schemeId: hit.scheme.id, variantKey: hit.variantKey }, schemes, which, 'pose-change')
  }
  if (!noSchemes && next.poseChange && edit.poseScheme) next.poseChange = schemeEndpoint(next.poseChange, edit.poseScheme, schemes, which, 'pose-change')
  if (edit.wrapType || !noSchemes && edit.wrapSubtype) next.rule = missingPFTemplate
    ? 'PF 手工包角需要模板；旧手工半包或全包暂不执行'
    : `人工指定${next.type}${next.subtype ? ` · ${next.subtype}` : ''}${templateId ? ' · 包角模板' : ''}${edit.wrapType === '全包' && next.type === '半包' ? '；立焊暂不支持全包' : ''}`
  if (next.processDecision && (edit.wrapType || !noSchemes && edit.wrapSubtype || edit.poseChange !== undefined)) next.processDecision = {
    ...next.processDecision, manuallyOverridden: true,
    ...(missingPFTemplate ? { wrap: 'none', action: 'no-wrap', travelWrapDistance: false } : {}),
  }
  return next
}

export function applyGeometryBaojiaoEdits(result: BaojiaoResult | null, context: GeometryEditContext, edits: GeometryEdits): BaojiaoResult | null {
  if (!result) return null
  const schemes = context.schemes ?? [], byWeld = new Map(result.byWeld)
  for (const weld of context.weldsData.welds) {
    const source = byWeld.get(weld.id)
    if (!source) continue
    const edit = edits[JSON.stringify(['source', weld.id])], position = String(record(weld.properties.焊接位置).代号 ?? '—')
    const matching = context.partsData && context.mesh ? { weld, partsData: context.partsData, mesh: context.mesh,
      wrapDistanceRatio: context.options?.wrapDistanceRatio, schemesEnabled: context.options?.schemesEnabled } : undefined
    const current = { ...source,
      起点: applyGeometryEndpointEdit(source.起点, edit?.endpoints?.start, position, schemes, 'start', weld.closed, matching, context.options),
      终点: applyGeometryEndpointEdit(source.终点, edit?.endpoints?.end, position, schemes, 'end', weld.closed, matching, context.options),
      bySubWeld: { ...source.bySubWeld } }
    const split = context.splits?.get(weld.id)
    split?.subWelds.forEach((sub, index) => {
      const selectedSegment = weld.segments.find((segment) => segment.geometryProperties && locatePoint(segment.points, sub.points[Math.floor(sub.points.length / 2)]) !== null)
      const localEdit = edits[subKey(weld.id, sub)] ?? (selectedSegment ? edits[JSON.stringify(['segment', weld.id, selectedSegment.index])] : undefined)
      const properties = sub.geometryProperties ?? weld.properties
      const metadataChanged = properties.焊脚 !== weld.properties.焊脚 || record(properties.焊接位置).代号 !== position || record(properties.接头形式).类型 !== weld.jointType
      let pair = current.bySubWeld[index] ?? { 起点: current.起点, 终点: current.终点 }
      // Unedited generated intervals were measured asynchronously already.
      // Local metadata or coordinate edits still require their own analysis.
      const derivedInterval = !!sub.geometryProperties?.间断焊 && !metadataChanged
        && samePoint(sub.start, sub.geometryOriginalStart ?? sub.start)
        && samePoint(sub.end, sub.geometryOriginalEnd ?? sub.end)
      if (!derivedInterval && (sub.geometryEdited || metadataChanged) && context.partsData && context.mesh) {
        const localWeld: Weld = { ...weld, properties: { ...properties,
          几何干涉端点: subplateContactEndpointEvidence(sub),
          几何内部端点: { start: sub.起点来源.类型 === '打断点' || sub.geometryEdited && !samePoint(sub.start, sub.geometryOriginalStart ?? sub.start),
            end: sub.终点来源.类型 === '打断点' || sub.geometryEdited && !samePoint(sub.end, sub.geometryOriginalEnd ?? sub.end) },
          起点特征: sub.起点来源.类型 === '打断点' || sub.geometryEdited && !samePoint(sub.start, sub.geometryOriginalStart ?? sub.start) ? { 特征类型: '平角' } : split?.startFeature ?? weld.properties.起点特征,
          终点特征: sub.终点来源.类型 === '打断点' || sub.geometryEdited && !samePoint(sub.end, sub.geometryOriginalEnd ?? sub.end) ? { 特征类型: '平角' } : split?.endFeature ?? weld.properties.终点特征 },
          jointType: String(record(properties.接头形式).类型 ?? weld.jointType), start: sub.start, end: sub.end, length: sub.length, closed: sub.closed,
          segments: [{ ...weld.segments[0], points: sub.points, start: sub.start, end: sub.end, length: sub.length }] }
        const computed = computeGeometryWeldBaojiao(localWeld, context.partsData, context.mesh, schemes, undefined, context.options)
        pair = { 起点: computed.起点, 终点: computed.终点 }
      }
      const subPosition = String(record(properties.焊接位置).代号 ?? position)
      const localMatching = matching ? { ...matching, weld: { ...weld, properties,
        jointType: String(record(properties.接头形式).类型 ?? weld.jointType), start: sub.start, end: sub.end, length: sub.length,
        segments: [{ ...weld.segments[0], points: sub.points, start: sub.start, end: sub.end, length: sub.length }] } } : undefined
      const inherited = (which: 'start' | 'end') => {
        const type = sub[which === 'start' ? '起点来源' : '终点来源'].类型
        return type === '原焊缝起点' ? edit?.endpoints?.start : type === '原焊缝终点' ? edit?.endpoints?.end : undefined
      }
      current.bySubWeld[index] = {
        起点: applyGeometryEndpointEdit(applyGeometryEndpointEdit(pair.起点, inherited('start'), subPosition, schemes, 'start', sub.closed, localMatching, context.options), localEdit?.endpoints?.start, subPosition, schemes, 'start', sub.closed, localMatching, context.options),
        终点: applyGeometryEndpointEdit(applyGeometryEndpointEdit(pair.终点, inherited('end'), subPosition, schemes, 'end', sub.closed, localMatching, context.options), localEdit?.endpoints?.end, subPosition, schemes, 'end', sub.closed, localMatching, context.options) }
    })
    byWeld.set(weld.id, current)
  }
  const geometryMergeEndpoints: NonNullable<BaojiaoResult['geometryMergeEndpoints']> = {}
  const updated = { ...result, byWeld }
  if (context.partsData && context.mesh) {
    const endpointContext = { weldsData: context.weldsData, partsData: context.partsData, mesh: context.mesh,
      splits: context.splits, merges: context.merges, schemes, options: context.options }
    for (const group of context.merges?.groups ?? []) {
      if (group.closed || !group.members.length) continue
      const key = geometrySelectionKey({ kind: 'merge', mergeId: group.id }, context), edit = key ? edits[key] : undefined
      const pair = geometryTargetEndpoints({ kind: 'merge', mergeId: group.id }, endpointContext, updated)
      if (!pair.start || !pair.end) continue
      const properties = group.geometryProperties ?? pair.start.weld.properties
      const position = String(record(properties.焊接位置).代号 ?? '—')
      const resolve = (which: 'start' | 'end') => {
        const original = pair[which]!, member = which === 'start' ? group.members[0] : group.members.at(-1)!
        let endpoint = original.ep
        if (group.geometryEdited) {
          const source = original.weld, unitProperties = { ...source.properties, ...properties }
          const originalPoint = which === 'start' ? group.geometryOriginalPoints?.[0] : group.geometryOriginalPoints?.at(-1)
          const changed = !!originalPoint && !samePoint(group[which], originalPoint)
          const feature = original.ep.feature
          const featureProperties = { 特征类型: ['直角', '锐角', '优角', '钝角'].includes(feature) ? '角' : feature.includes('圆弧') ? '圆' : feature,
            角类型: feature, 圆类型: feature, 包角转角: original.ep.wrapAngle }
          const local: Weld = { ...source, properties: { ...unitProperties,
            几何干涉端点: !changed && original.ep.unifiedInfo?.offsetSubplateContact
              ? { [which]: original.ep.unifiedInfo.offsetSubplateContact } : {},
            几何内部端点: { [which]: changed },
            [which === 'start' ? '起点特征' : '终点特征']: changed ? { 特征类型: '平角' } : featureProperties },
            jointType: member.jointType, start: member.start.toArray(), end: member.end.toArray(), length: member.length, closed: false,
            segments: [{ ...source.segments[0], points: member.points, start: member.start.toArray(), end: member.end.toArray(), length: member.length }] }
          endpoint = computeGeometryWeldBaojiao(local, context.partsData!, context.mesh!, schemes, undefined, context.options)[which === 'start' ? '起点' : '终点']
        }
        const matchingWeld = { ...original.weld, properties, jointType: String(record(properties.接头形式).类型 ?? member.jointType),
          start: member.start.toArray(), end: member.end.toArray(),
          segments: [{ ...original.weld.segments[0], points: member.points, start: member.start.toArray(), end: member.end.toArray(), length: member.length }] }
        return applyGeometryEndpointEdit(endpoint, edit?.endpoints?.[which], position, schemes, which, false,
          { weld: matchingWeld, partsData: context.partsData!, mesh: context.mesh!, wrapDistanceRatio: context.options?.wrapDistanceRatio,
            schemesEnabled: context.options?.schemesEnabled }, context.options)
      }
      geometryMergeEndpoints[group.id] = { 起点: resolve('start'), 终点: resolve('end') }
    }
  }
  return { ...updated, geometryMergeEndpoints }
}

export function applyGeometryCornerEdits(corners: CornerInstance[], context: GeometryEditContext, edits: GeometryEdits): CornerInstance[] {
  if (context.options?.schemesEnabled === false) {
    const dirty = corners.some((corner) => corner.match || corner.applied || corner.未匹配原因 || corner.overridden)
    const measured = dirty && context.partsData && context.mesh
      ? new Map(computeGeometryCornerInstances(context.merges, context.weldsData, context.partsData, context.mesh, [], context.options)
        .map((corner) => [corner.id, corner])) : null
    return corners.map((corner) => {
      const clean = measured?.get(corner.id) ?? (dirty ? { ...corner, match: null, applied: null, 未匹配原因: null,
        overridden: false, 判定依据: '保留真实转角几何，方案已停用' } : corner)
      const selectionKey = geometrySelectionKey({ kind: 'merge', mergeId: corner.groupId }, context)
      const type = selectionKey ? edits[selectionKey]?.cornerTypes?.[geometryCornerKey(corner, context)] : undefined
      return type && CORNER_VARIANT_KEYS.includes(type) ? { ...clean, variantKey: type, overridden: true,
        判定依据: `人工指定转角类型 ${type}（自动：${clean.variantKey}）` } : clean
    })
  }
  return corners.map((corner) => {
    const selectionKey = geometrySelectionKey({ kind: 'merge', mergeId: corner.groupId }, context)
    const choice = selectionKey ? edits[selectionKey]?.corners?.[geometryCornerKey(corner, context)] : undefined
    if (!choice) return corner
    const variantKey = choice.variantKey ?? corner.variantKey, scheme = choice.schemeId === null ? undefined : context.schemes?.find((s) => s.id === choice.schemeId), variant = scheme?.variants[variantKey]
    return { ...corner, variantKey, overridden: true, 判定依据: '人工选择当前转角方案',
      match: scheme ? { id: scheme.id, name: scheme.name } : null, 未匹配原因: scheme ? null : '人工选择无匹配方案',
      applied: variant ? { a: variant.a, b: variant.b, c: variant.c,
        ...cornerPoints(new THREE.Vector3().fromArray(corner.pos), new THREE.Vector3().fromArray(corner.d1), new THREE.Vector3().fromArray(corner.d2), variant.a, variant.b, variant.c) } : null }
  })
}
