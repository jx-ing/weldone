import * as THREE from 'three'

export const RAFFLES_STL_URL = '/models/solver_Raffles.stl'
export const RAFFLES_MODEL_NAME = 'solver_Raffles'

/**
 * solver_Raffles.stl 原始坐标，单位 mm；仅校准模型，不改现有工具/TCP 约定。
 * 出口的 8 个顶点做最小二乘端面 + 面内圆拟合；轴朝出口外 (+X,+Z)。
 * 原 STL 出口是 6 面实心帽，简化后并非严格共面。tip 取拟合圆心轴线与
 * 实际帽面交点，使焊丝起点落在实际出口，而非埋入帽面 0.2191 mm。
 * bodyAxis 由 50 面直枪颈两端截面圆心连线确定，指向法兰端。
 */
export const RAFFLES_SOURCE_CALIBRATION = {
  tip: [100.20526251347992, 0.0956684416928615, 509.3874793917652],
  axis: [0.707035355777587, 0.0018273741550241735, 0.7071758383769616],
  bodyAxis: [-0.00019779567764925915, 0.0002563789093507309, -0.9999999475733611],
  fittedCircleCenter: [100.0503536457843, 0.09526807068043919, 509.2325397448445],
  outletRadiusMm: 10.595059026652136,
  outletPlaneResidualRmsMm: 0.23032284062267303,
  outletPlaneResidualMaxMm: 0.3243997025643631,
  outletCircleResidualRmsMm: 0.13297314509794317,
  outletSurfaceProjectionMm: 0.2190963527209439,
  componentTriangleCounts: [28, 28, 50, 32, 52, 74],
  nozzleTriangleCount: 74,
  neckTriangleCount: 190,
} as const

export interface RafflesTorchGeometry {
  neckGeom: THREE.BufferGeometry
  nozzleGeom: THREE.BufferGeometry
  /** 同工具数据坐标中的枪身朝向，指向法兰端。 */
  bodyAxis: THREE.Vector3
  /** 原 STL 坐标 → 现有工具数据坐标的刚体矩阵；缩放恒为 1。 */
  sourceToTool: THREE.Matrix4
}

/** 按共享顶点识别完整组件；不按位置切三角形，保留源模型的封闭实体。 */
function connectedTriangleComponents(source: THREE.BufferGeometry): number[][] {
  const position = source.getAttribute('position')
  const index = source.getIndex()
  const vertexCount = index?.count ?? position.count
  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error('Raffles 机头必须包含完整三角网格')
  }
  const triangleCount = vertexCount / 3
  const parents = Array.from({ length: triangleCount }, (_, i) => i)
  const firstTriangleAtVertex = new Map<string, number>()
  const root = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]]
      i = parents[i]
    }
    return i
  }
  for (let face = 0; face < triangleCount; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index ? index.getX(face * 3 + corner) : face * 3 + corner
      // 0.0001 mm 仅用于识别共享顶点，输出仍复制每个源顶点的原始坐标。
      const key = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
        .map((value) => Math.round(value * 10000)).join(',')
      const first = firstTriangleAtVertex.get(key)
      if (first === undefined) firstTriangleAtVertex.set(key, face)
      else parents[root(face)] = root(first)
    }
  }
  const components = new Map<number, number[]>()
  for (let face = 0; face < triangleCount; face++) {
    const key = root(face)
    const component = components.get(key) ?? []
    component.push(face)
    components.set(key, component)
  }
  return [...components.values()]
}

function componentGeometry(
  source: THREE.BufferGeometry, faces: number[], sourceToTool: THREE.Matrix4,
): THREE.BufferGeometry {
  const position = source.getAttribute('position')
  const index = source.getIndex()
  const triangles = new Float32Array(faces.length * 9)
  let cursor = 0
  for (const face of faces) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = index ? index.getX(face * 3 + corner) : face * 3 + corner
      triangles[cursor++] = position.getX(vertex)
      triangles[cursor++] = position.getY(vertex)
      triangles[cursor++] = position.getZ(vertex)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(triangles, 3))
  geometry.applyMatrix4(sourceToTool)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * 整套机头刚体对齐到既有出口/枪轴；喷嘴使用末端完整 74 面组件，
 * 枪身使用其余 5 个完整组件。264 面全部保留，显示与碰撞共用这些几何。
 */
export function prepareRafflesTorchGeometry(
  source: THREE.BufferGeometry, targetTip: THREE.Vector3, targetAxis: THREE.Vector3,
): RafflesTorchGeometry {
  if (!Number.isFinite(targetTip.lengthSq())
    || !Number.isFinite(targetAxis.lengthSq()) || targetAxis.lengthSq() < 1e-12) {
    throw new Error('Raffles 机头校准需要有效出口中心与枪轴')
  }
  const components = connectedTriangleComponents(source)
  const counts = components.map((component) => component.length).sort((a, b) => a - b)
  const expectedCounts = [...RAFFLES_SOURCE_CALIBRATION.componentTriangleCounts].sort((a, b) => a - b)
  if (counts.join(',') !== expectedCounts.join(',')) {
    throw new Error('Raffles 机头网格组件与校准模型不一致')
  }
  const sourceTip = new THREE.Vector3(...RAFFLES_SOURCE_CALIBRATION.tip)
  const sourceAxis = new THREE.Vector3(...RAFFLES_SOURCE_CALIBRATION.axis).normalize()
  const rotation = new THREE.Quaternion().setFromUnitVectors(sourceAxis, targetAxis.clone().normalize())
  const translation = targetTip.clone().sub(sourceTip.clone().applyQuaternion(rotation))
  const sourceToTool = new THREE.Matrix4().compose(translation, rotation, new THREE.Vector3(1, 1, 1))

  // 本固定模型只有末端组件是 74 面；按完整组件归类，不切开帽面/枪颈。
  const nozzleFaces = components.find((component) => component.length === RAFFLES_SOURCE_CALIBRATION.nozzleTriangleCount)!
  const neckFaces = components.filter((component) => component !== nozzleFaces).flat().sort((a, b) => a - b)
  return {
    neckGeom: componentGeometry(source, neckFaces, sourceToTool),
    nozzleGeom: componentGeometry(source, nozzleFaces, sourceToTool),
    bodyAxis: new THREE.Vector3(...RAFFLES_SOURCE_CALIBRATION.bodyAxis).applyQuaternion(rotation).normalize(),
    sourceToTool,
  }
}
