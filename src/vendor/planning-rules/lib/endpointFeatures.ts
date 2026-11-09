import * as THREE from 'three'
import type { BoundaryWire, Edge, EdgesData, Weld, WeldsData } from '@/types/weld'
import { legacyFaceFootprint } from './legacyFaceBoundary'

export type EndpointFeature = Record<string, unknown>
const TOLERANCE = 0.05
const vec = (point: number[]) => new THREE.Vector3().fromArray(point)
const unknown = (reason: string): EndpointFeature => ({ 特征类型: '未识别', 角类型: null, 角度: null,
  圆类型: null, 半径R: null, R1: null, L1: null, 长: null, 高: null, 识别依据: reason,
  动作需确认: true, 包角待确认: true })

function chainDistance(point: THREE.Vector3, edge: Edge): number {
  let distance = Infinity
  for (let index = 1; index < edge.points.length; index++) {
    const line = new THREE.Line3(vec(edge.points[index - 1]), vec(edge.points[index]))
    distance = Math.min(distance, line.closestPointToPoint(point, true, new THREE.Vector3()).distanceTo(point))
  }
  return distance
}

function tangent(edge: Edge, atEnd: boolean): THREE.Vector3 | null {
  if (edge.center && edge.normal && typeof edge.sweepRad === 'number' && edge.radius) {
    return vec(edge.normal).cross(vec(atEnd ? edge.end : edge.start).sub(vec(edge.center)))
      .multiplyScalar(edge.sweepRad > 0 ? 1 : -1).normalize()
  }
  if (edge.type !== '直线' || edge.points.length < 2) return null
  return atEnd ? vec(edge.points.at(-1)!).sub(vec(edge.points.at(-2)!)).normalize()
    : vec(edge.points[1]).sub(vec(edge.points[0])).normalize()
}

type FaceFootprint = { origin: THREE.Vector3; normal: THREE.Vector3; axes: [number, number]; loops: { hole: boolean; points: THREE.Vector2[] }[] }
type BoundaryIndex = { faces: Map<string, Edge[]>; edges: Map<string, Edge>; wires: Map<string, BoundaryWire>;
  footprints: Map<string, FaceFootprint | null> }
const cache = new WeakMap<EdgesData, BoundaryIndex>()
function boundaryIndex(data: EdgesData): BoundaryIndex {
  let index = cache.get(data)
  if (index) return index
  index = { faces: new Map(), edges: new Map(), wires: new Map((data.wires ?? []).map((wire) => [wire.wireId, wire])), footprints: new Map() }
  for (const edge of data.edges) {
    const key = `${edge.partId}|${edge.faceIndex}`
    const face = index.faces.get(key) ?? []
    face.push(edge); index.faces.set(key, face)
    if (edge.boundaryId) index.edges.set(edge.boundaryId, edge)
  }
  cache.set(data, index)
  return index
}

function faceFootprint(key: string, index: BoundaryIndex): FaceFootprint | null {
  if (index.footprints.has(key)) return index.footprints.get(key)!
  index.footprints.set(key, null)
  const edges = index.faces.get(key) ?? []
  const ids = [...new Set(edges.map((edge) => edge.wireId))]
  const wires = ids.map((id) => id ? index.wires.get(id) : undefined)
  if (!wires.length || wires.some((wire) => !wire?.closed || !wire.topologyComplete
    || wire.shape === 'curved-unresolved' || !wire.normal)) return null
  const origin = vec(edges[0].start), normal = vec(wires[0]!.normal!).normalize()
  if (normal.lengthSq() < .99) return null
  const drop = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)))
  const axes = [0, 1, 2].filter((axis) => axis !== drop) as [number, number]
  const loops: FaceFootprint['loops'] = []
  for (const wire of wires as BoundaryWire[]) {
    if (Math.abs(vec(wire.normal!).normalize().dot(normal)) < .999999) return null
    const points: THREE.Vector3[] = []
    for (const id of wire.boundaryIds) {
      const edge = index.edges.get(id)
      if (!edge || edge.points.length < 2) return null
      if (points.length && points.at(-1)!.distanceTo(vec(edge.points[0])) > TOLERANCE) return null
      points.push(...edge.points.map(vec))
    }
    if (points.length < 3 || points[0].distanceTo(points.at(-1)!) > TOLERANCE
      || points.some((point) => Math.abs(point.clone().sub(origin).dot(normal)) > TOLERANCE)) return null
    loops.push({ hole: wire.wire === 'inner', points: points.map((point) => {
      const p = point.clone().sub(origin)
      return new THREE.Vector2(p.getComponent(axes[0]), p.getComponent(axes[1]))
    }) })
  }
  if (!loops.some((loop) => !loop.hole)) return null
  const result = { origin, normal, axes, loops }
  index.footprints.set(key, result)
  return result
}

function pointInLoop(point: THREE.Vector2, polygon: THREE.Vector2[]): 'edge' | 'in' | 'out' {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], ab = b.clone().sub(a)
    const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1)
    if (a.clone().addScaledVector(ab, t).distanceTo(point) <= TOLERANCE) return 'edge'
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside ? 'in' : 'out'
}

function materialAt(point: THREE.Vector2, face: FaceFootprint): boolean {
  const locations = face.loops.map((loop) => ({ hole: loop.hole, where: pointInLoop(point, loop.points) }))
  if (locations.some((item) => item.where === 'edge')) return true
  return locations.some((item) => !item.hole && item.where === 'in')
    && !locations.some((item) => item.hole && item.where === 'in')
}

/** Check every material interval, including holes crossed between two supported
 * endpoints. The unified geometry platform can recover every complete legacy
 * support face, independently of endpoint labels. Unmarked legacy exports keep
 * the retained platform's established source-arc-only extension veto. */
export function isWeldExtensionSupported(weld: Weld, atEnd: boolean, position: number[], data: EdgesData | null): boolean {
  if (!data?.edges.length) return true
  const index = boundaryIndex(data), start = vec(atEnd ? weld.end : weld.start), end = vec(position)
  const original = weld.properties[atEnd ? '终点特征' : '起点特征'] as EndpointFeature | undefined
  const radius = Number(original?.R1 ?? original?.半径R)
  const unified = weld.properties['统一端部几何'] === true
  if (!unified && !data.wires?.length && (original?.特征类型 !== '圆' || !(radius > 0))) return true
  for (const key of [`${weld.mainPartId}|${weld.mainFaceIndex}`, `${weld.subPartId}|${weld.subFaceIndex}`]) {
    if (!unified && !data.wires?.length && !index.faces.get(key)?.some((edge) => ['圆', '圆弧'].includes(edge.type)
      && edge.radius && Math.abs(edge.radius - radius) <= Math.max(.05, radius * 1e-4)
      && chainDistance(start, edge) <= TOLERANCE)) continue
    const face = data.wires?.length ? faceFootprint(key, index) : legacyFaceFootprint(index.faces.get(key) ?? [])
    if (!face || Math.abs(start.clone().sub(face.origin).dot(face.normal)) > TOLERANCE) continue
    const flatten = (point: THREE.Vector3) => {
      const delta = point.clone().sub(face.origin)
      return new THREE.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1]))
    }
    const a = flatten(start), b = flatten(end), direction = b.clone().sub(a)
    if (!materialAt(a, face)) continue // This is not proven to be the original support face.
    if (Math.abs(end.clone().sub(face.origin).dot(face.normal)) > TOLERANCE || !materialAt(b, face)) return false
    if (direction.lengthSq() < 1e-12) continue
    const cross = (u: THREE.Vector2, v: THREE.Vector2) => u.x * v.y - u.y * v.x
    const cuts = [0, 1]
    for (const loop of face.loops) for (let i = 1; i < loop.points.length; i++) {
      const p = loop.points[i - 1], q = loop.points[i], edge = q.clone().sub(p), delta = p.clone().sub(a)
      const determinant = cross(direction, edge)
      if (Math.abs(determinant) > 1e-10) {
        const t = cross(delta, edge) / determinant, u = cross(delta, direction) / determinant
        if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) cuts.push(t)
      } else if (Math.abs(cross(delta, direction)) < 1e-8) {
        for (const point of [p, q]) {
          const t = point.clone().sub(a).dot(direction) / direction.lengthSq()
          if (t > 0 && t < 1) cuts.push(t)
        }
      }
    }
    cuts.sort((x, y) => x - y)
    for (let i = 1; i < cuts.length; i++) {
      if (!materialAt(a.clone().addScaledVector(direction, (cuts[i - 1] + cuts[i]) / 2), face)) return false
    }
  }
  return true
}

/** Positive proof for retaining a continuous contact span. Unlike the extension
 * veto above, missing either source face or incomplete topology is not evidence
 * of material. Both source planar faces must support the complete interval. */
export function isWeldSpanSupported(weld: Weld, from: number[], to: number[], data: EdgesData | null): boolean {
  if (!data?.wires?.length || from.length !== 3 || to.length !== 3 || ![...from, ...to].every(Number.isFinite)) return false
  const index = boundaryIndex(data), start = vec(from)
  for (const key of [`${weld.mainPartId}|${weld.mainFaceIndex}`, `${weld.subPartId}|${weld.subFaceIndex}`]) {
    const face = faceFootprint(key, index)
    if (!face || Math.abs(start.clone().sub(face.origin).dot(face.normal)) > TOLERANCE) return false
    const delta = start.clone().sub(face.origin)
    if (!materialAt(new THREE.Vector2(delta.getComponent(face.axes[0]), delta.getComponent(face.axes[1])), face)) return false
  }
  return isWeldExtensionSupported({ ...weld, start: from }, false, to, data)
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const vector = (value: unknown): value is number[] => Array.isArray(value) && value.length === 3
  && value.every((component) => typeof component === 'number' && Number.isFinite(component))
type ProjectedEndpoint = { weld: Weld; key: '起点特征' | '终点特征'; point: THREE.Vector3;
  source: THREE.Vector3; into: THREE.Vector3 | null; group: string }

/** A sampled arc describes the path's curvature, not a turn at its tangent join
 * to the next weld. Require one unique continuation on the same finite source
 * contour and host face, with exact CAD normals and opposite inward tangents. */
export function normalizeProjectedEndpointContinuity(data: WeldsData): WeldsData {
  const groups = new Map<string, ProjectedEndpoint[]>()
  for (const weld of data.welds) {
    const props = record(weld.properties['投影搭接']), clip = record(props.finiteClip)
    const points = props.projectedPoints, sources = props.sourcePoints, normals = props.sourceNormals
    if (weld.closed || props.version !== 1 || clip.kernel !== 'BRepAlgoAPI_Common'
      || !Array.isArray(points) || !Array.isArray(sources) || points.length < 2 || points.length !== sources.length
      || !points.every(vector) || !sources.every(vector) || typeof props.sourcePartId !== 'string'
      || typeof props.hostPartId !== 'string' || !Number.isInteger(props.sourceFaceIndex) || !Number.isInteger(props.hostFaceIndex)) continue
    const group = `${props.sourcePartId}|${props.sourceFaceIndex}|${props.hostPartId}|${props.hostFaceIndex}`
    const endpoints = groups.get(group) ?? []
    for (const [key, position] of [['起点特征', weld.start], ['终点特征', weld.end]] as const) {
      const point = vec(position)
      const i = [0, points.length - 1].find((i) => point.distanceTo(vec(points[i])) <= .02)
      if (i === undefined) continue
      let into: THREE.Vector3 | null = null
      if (Array.isArray(normals) && normals.length === points.length && vector(normals[i]) && vector(props.hostNormal)) {
        const direction = vec(points[i === 0 ? 1 : i - 1]).sub(point)
        into = vec(props.hostNormal).cross(vec(normals[i]))
        if (into.lengthSq() < 1e-12 || direction.lengthSq() < 1e-12) into = null
        else { into.normalize(); if (into.dot(direction) < 0) into.negate() }
      }
      endpoints.push({ weld, key, point, source: vec(sources[i]), into, group })
    }
    groups.set(group, endpoints)
  }
  const updates = new Map<Weld, Record<string, unknown>>()
  for (const endpoints of groups.values()) for (const endpoint of endpoints) {
    const original = record(endpoint.weld.properties[endpoint.key])
    if (original.特征类型 === '平角' || !endpoint.into) continue
    const neighbors = endpoints.filter((candidate) => candidate.weld !== endpoint.weld
      && candidate.point.distanceTo(endpoint.point) <= .02 && candidate.source.distanceTo(endpoint.source) <= .02)
    if (neighbors.length !== 1 || !neighbors[0].into || endpoint.into.dot(neighbors[0].into) > -Math.cos(.1 * Math.PI / 180)) continue
    const neighbor = neighbors[0]
    const properties = updates.get(endpoint.weld) ?? { ...endpoint.weld.properties }
    properties[endpoint.key] = { ...original, 特征类型: '平角', 角类型: null, 角度: 180, 圆类型: null,
      半径R: null, R1: null, L1: null, 长: 0, 高: 0, 包角转角: 0, 动作需确认: false,
      包角待确认: false, 尺寸待确认: false, 原端点特征: original,
      识别依据: '同一有限投影搭接轮廓在该点只有一条相邻焊缝，CAD原生切向连续；路径圆弧曲率不作为端部转角',
      连续轮廓核验: { 相邻焊缝: neighbor.weld.id, 相邻端点: neighbor.key, 坐标: endpoint.point.toArray(),
        来源坐标: endpoint.source.toArray(), 轮廓: endpoint.group,
        切向转角: Math.acos(THREE.MathUtils.clamp(-endpoint.into.dot(neighbor.into!), -1, 1)) * 180 / Math.PI } }
    updates.set(endpoint.weld, properties)
  }
  return updates.size ? { ...data, welds: data.welds.map((weld) => updates.has(weld) ? { ...weld, properties: updates.get(weld)! } : weld) } : data
}

function onFace(point: THREE.Vector3, partId: string, faceIndex: number, index: BoundaryIndex): EndpointFeature {
  const candidates = (index.faces.get(`${partId}|${faceIndex}`) ?? []).filter((edge) => {
    const wire = edge.wireId ? index.wires.get(edge.wireId) : undefined
    return wire?.topologyComplete === true && wire.shape !== 'curved-unresolved'
      && chainDistance(point, edge) <= TOLERANCE
  })
  if (!candidates.length) return unknown('实际延伸端点不在原支撑面的已确认完整边界上')
  const arcs = candidates.filter((edge) => ['圆', '圆弧'].includes(edge.type)
    && edge.radius && edge.radius > 0 && edge.normal && edge.center && typeof edge.sweepRad === 'number')
  if (arcs.length) {
    arcs.sort((a, b) => chainDistance(point, a) - chainDistance(point, b))
    const arc = arcs[0], wire = index.wires.get(arc.wireId!)!
    if (typeof wire.signedArea !== 'number' || Math.abs(wire.signedArea) < 1e-9) return unknown('缺少可靠边界环方向，不能判定圆弧凹凸')
    const winding = wire.signedArea >= 0 ? 1 : -1
    let convex = arc.sweepRad! * winding > 0
    if (wire.wire === 'inner') convex = !convex
    const atBoundary = Math.min(point.distanceTo(vec(arc.start)), point.distanceTo(vec(arc.end))) <= TOLERANCE
    const known = !arc.closed && atBoundary && typeof arc.arcLength === 'number'
    return { 特征类型: '圆', 角类型: null, 角度: null, 圆类型: convex ? '凸圆弧' : '凹圆弧',
      半径R: arc.radius, R1: arc.radius, L1: known ? arc.arcLength : null, 长: null, 高: null,
      来源边界: [arc.boundaryId], 拟合误差: arc.fit, 闭合圆周: !!arc.closed,
      动作需确认: !known, 包角待确认: !known,
      识别依据: '实际延伸端点位于经确认的圆弧边界；局部曲率优先于邻接直线夹角' }
  }
  for (const wireId of new Set(candidates.map((edge) => edge.wireId!))) {
    const wire = index.wires.get(wireId)!
    const sequence = wire.boundaryIds.map((id) => index.edges.get(id))
    if (sequence.some((edge) => !edge) || !wire.normal || typeof wire.signedArea !== 'number') continue
    for (let i = 0; i < sequence.length; i++) {
      if (i === 0 && !wire.closed) continue
      const current = sequence[i]!, previous = sequence[(i + sequence.length - 1) % sequence.length]!
      if (current === previous || point.distanceTo(vec(current.start)) > TOLERANCE) continue
      const incoming = tangent(previous, true), outgoing = tangent(current, false)
      if (!incoming || !outgoing) return unknown('实际延伸端点邻接曲线的切向证据不足')
      const turn = Math.acos(THREE.MathUtils.clamp(incoming.dot(outgoing), -1, 1)) * 180 / Math.PI
      if (turn < 5) continue
      const signed = incoming.clone().cross(outgoing).dot(vec(wire.normal))
      let convex = signed * (wire.signedArea >= 0 ? 1 : -1) > 0
      if (wire.wire === 'inner') convex = !convex
      const angle = convex ? 180 - turn : 180 + turn
      const label = Math.abs(angle - 90) <= 2 ? '直角' : angle < 90 ? '锐角' : angle < 180 ? '钝角' : '优角'
      return { 特征类型: '角', 角类型: label, 角度: angle, 圆类型: null, 包角转角: turn,
        半径R: null, R1: null, L1: null, 长: null, 高: null, 尺寸待确认: true,
        来源边界: [previous.boundaryId, current.boundaryId], 动作需确认: label === '优角',
        识别依据: '实际延伸端点处完整边界环相邻基元的真实切线转角' }
    }
  }
  if (candidates.some((edge) => edge.type !== '直线')) return unknown('实际延伸端点处曲线不能可靠识别')
  return { 特征类型: '平角', 角类型: null, 角度: 180, 圆类型: null, 半径R: null, R1: null,
    L1: null, 长: 0, 高: 0, 来源边界: candidates.map((edge) => edge.boundaryId),
    动作需确认: false, 识别依据: '实际延伸端点位于已确认连续直线边界内部' }
}

/** Re-evaluate only moved endpoints; original features remain untouched and auditable. */
export function extendedEndpointFeature(weld: Weld, atEnd: boolean, position: number[], data: EdgesData | null): EndpointFeature | undefined {
  const original = weld.properties[atEnd ? '终点特征' : '起点特征'] as EndpointFeature | undefined
  const sourcePosition = atEnd ? weld.end : weld.start
  const point = vec(position), movement = point.distanceTo(vec(sourcePosition))
  if (movement < 1e-8) return original
  if (!data?.wires?.length) {
    if (original?.特征类型 !== '圆') return original // Legacy angle records have no reconstructable topology.
    const radius = Number(original.R1 ?? original.半径R)
    const matching = data?.edges.find((edge) => ['圆', '圆弧'].includes(edge.type)
      && ((edge.partId === weld.mainPartId && edge.faceIndex === weld.mainFaceIndex)
        || (edge.partId === weld.subPartId && edge.faceIndex === weld.subFaceIndex))
      && edge.radius && radius > 0 && Math.abs(edge.radius - radius) <= Math.max(.05, radius * 1e-4)
      && chainDistance(vec(sourcePosition), edge) <= TOLERANCE && chainDistance(point, edge) <= TOLERANCE)
    if (matching) {
      const atBoundary = Math.min(point.distanceTo(vec(matching.start)), point.distanceTo(vec(matching.end))) <= TOLERANCE
      return { ...original, 原端点特征: original,
        ...(!atBoundary ? { L1: null, 动作需确认: true, 包角待确认: true } : {}),
        延伸重识别: { 原坐标: sourcePosition, 实际坐标: position, 端点位移: movement,
          距原边界: chainDistance(point, matching), 边界容差: TOLERANCE,
          来源圆弧: { 零件: matching.partId, 面索引: matching.faceIndex, 边索引: matching.edgeIndex },
          状态: '实际端点仍在同一来源圆弧；保留源凹凸语义，不重推凹凸' } }
    }
    return { ...unknown('端点延伸后缺少完整来源边界拓扑，旧圆弧证据已失效'), 原端点特征: original,
      延伸重识别: { 原坐标: sourcePosition, 实际坐标: position, 端点位移: movement, 状态: '原圆弧证据失效' } }
  }
  const index = boundaryIndex(data)
  const candidates: EndpointFeature[] = ([['sub', '副板面'], ['main', '主板面']] as const).map(([side, name]) => ({
    ...onFace(point, weld[`${side}PartId`], weld[`${side}FaceIndex`], index), 关联面: name,
  }))
  const rank = (feature: EndpointFeature) => ({ 未识别: 0, 平角: 1, 角: 3, 圆: 4 })[String(feature.特征类型)] ?? 0
  const selected = candidates.reduce((best, feature) => rank(feature) > rank(best) ? feature : best)
  const originalIds = Array.isArray(original?.来源边界) ? original.来源边界 as string[] : []
  const distances = originalIds.map((id) => index.edges.get(id)).filter((edge): edge is Edge => !!edge)
    .map((edge) => chainDistance(point, edge))
  return { ...selected, 候选特征: candidates, 原端点特征: original,
    选择依据: '实际延伸端点分别核验原主副板支撑面完整边界；圆弧、真实角、平角、未识别依次优先',
    延伸重识别: { 原坐标: sourcePosition, 实际坐标: position, 端点位移: movement,
      距原边界: distances.length ? Math.min(...distances) : null, 边界容差: TOLERANCE,
      状态: selected.特征类型 === '未识别' ? '原特征证据失效' : '按实际端点重新识别' } }
}
