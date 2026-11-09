import type { BBox, ModelCoordinateFrame } from '@/types/weld'
import type { ModelData } from './loadData'

function validateFrame(frame: ModelCoordinateFrame): void {
  const { rotation: r, origin } = frame
  if (!frame.id || !Array.isArray(r) || r.length !== 3
    || r.some((row) => !Array.isArray(row) || row.length !== 3 || !row.every(Number.isFinite))
    || !Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) throw new Error('模型坐标变换参数无效')
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const product = r[i].reduce((sum, v, k) => sum + v * r[j][k], 0)
    if (Math.abs(product - (i === j ? 1 : 0)) > 1e-8) throw new Error('模型坐标变换必须为刚体旋转')
  }
  const determinant = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1])
    - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
    + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])
  if (Math.abs(determinant - 1) > 1e-8) throw new Error('模型坐标变换不允许镜像')
}

/** Transform the complete runtime geometry before split/merge/torch calculations.
 * Exported CAD files and their audit coordinates remain unchanged.
 */
export function applyModelCoordinateFrame(data: ModelData, frame: ModelCoordinateFrame): ModelData {
  validateFrame(frame)
  const signature = JSON.stringify([frame.id, frame.rotation, frame.origin])
  if (data.appliedCoordinateFrame === signature) return data
  if (data.appliedCoordinateFrame) throw new Error('模型已转换坐标，请从源数据重新加载后应用新的坐标系')
  const vector = (value: number[]) => frame.rotation.map((row) =>
    row.reduce((sum, n, i) => sum + n * value[i], 0))
  const point = (value: number[]) => vector(value.map((n, i) => n - frame.origin[i]))
  const bounds = (box: BBox): BBox => {
    const corners = Array.from({ length: 8 }, (_, bits) => point(
      Array.from({ length: 3 }, (_, axis) => (bits & (1 << axis)) ? box.max[axis] : box.min[axis])))
    return { min: [0, 1, 2].map((axis) => Math.min(...corners.map((p) => p[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...corners.map((p) => p[axis]))) }
  }
  // Only coordinate-bearing fields are transformed. Three scalar process
  // parameters must not accidentally be treated as a spatial vector.
  const isTriple = (value: unknown): value is number[] => Array.isArray(value)
    && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
  const properties = (value: unknown, key = ''): unknown => {
    if (isTriple(value)) {
      if (/(?:法向|方向|切向)\d*$/.test(key) || /^(?:source|profile)(?:Normals?|AdjacentFaceNormals)$/.test(key)
        || key === 'hostNormal' || key === 'projectionVector') return vector(value)
      if (/(?:坐标|关联点|投影点|延伸到|圆心|位置)\d*$/.test(key) || /^(?:source|profile|projected)Points?$/.test(key)) return point(value)
    }
    if (Array.isArray(value)) return value.map((item) => properties(item, key))
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, properties(child, childKey)]))
    return value
  }
  const mesh = new Float32Array(data.mesh.length)
  for (let i = 0; i < data.mesh.length; i += 6) {
    mesh.set(point(Array.from(data.mesh.subarray(i, i + 3))), i)
    mesh.set(vector(Array.from(data.mesh.subarray(i + 3, i + 6))), i + 3)
  }
  return {
    ...data, mesh, appliedCoordinateFrame: signature,
    partsData: { ...data.partsData, bbox: bounds(data.partsData.bbox),
      parts: data.partsData.parts.map((part) => ({ ...part, bbox: bounds(part.bbox), mainNormal: vector(part.mainNormal) })) },
    weldsData: { ...data.weldsData, welds: data.weldsData.welds.map((weld) => ({
      ...weld, start: point(weld.start), end: point(weld.end),
      segments: weld.segments.map((segment) => ({ ...segment, start: point(segment.start), end: point(segment.end),
        points: segment.points.map(point) })),
      properties: properties(weld.properties) as Record<string, unknown>,
    })) },
    edgesData: data.edgesData ? { ...data.edgesData,
      ...(data.edgesData.wires ? { wires: data.edgesData.wires.map((wire) => ({ ...wire,
        ...(wire.normal ? { normal: vector(wire.normal) } : {}) })) } : {}),
      edges: data.edgesData.edges.map((edge) => ({
      ...edge, start: point(edge.start), end: point(edge.end), points: edge.points.map(point),
      ...(edge.center ? { center: point(edge.center) } : {}),
      ...(edge.normal ? { normal: vector(edge.normal) } : {}),
    })) } : null,
  }
}
