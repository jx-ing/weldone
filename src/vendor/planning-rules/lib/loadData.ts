import type { EdgesData, ModelAnalysis, PartsData, WeldsData } from '@/types/weld'
import { normalizeWeldTravelDirections, reverseWeldsDirection } from './weldDirection'
import { applyModelCoordinateFrame } from './modelCoordinateFrame'
import { normalizeWeldsParameters } from './weldParameters'
import { separateCollarContactSides, type CollarThicknessReference } from './collarContactTopology'
import { applyCollarGapPlanning } from './collarGapPlanning'
import { separateCollarGapEndClosures, type CollarGapEndClosureReference } from './collarGapEndClosures'
import { normalizeProjectedEndpointContinuity } from './endpointFeatures'
import { normalizeCompositeShellWelds, type CompositeShellReference } from './compositeShellWelds'
import { normalizeJointSupportFaces } from './jointSupportFaces'
import { normalizeWeldWorkfaces } from './weldWorkface'
import { applyThicknessWeldThreshold } from './thicknessWeldPolicy'

export interface ModelData {
  partsData: PartsData
  weldsData: WeldsData
  /** 整个 mesh.bin 的 Float32 视图 (每顶点 6 float: xyz + 法向 xyz) */
  mesh: Float32Array
  /** 模型边界边; edges.json 缺失或加载失败时为 null (间隙检测垂直分支显示 "—") */
  edgesData: EdgesData | null
  /** 零件直接接触对 (contacts.json, 双向 "A|B" 键集合); 缺失/加载失败为 null, 打断规则 2 不触发 */
  contactPairs: Set<string> | null
  /** 可选的模型来源、装配范围和分析摘要。 */
  analysis?: ModelAnalysis | null
  /** 防止对同一份运行时数据重复应用坐标变换。 */
  appliedCoordinateFrame?: string
  /** CAD 厚度连接边保留在源文件，运行时只作为包角参考。 */
  collarThicknessReferences?: CollarThicknessReference[]
  /** 无间隙规划的端部短封口保留 CAD 证据，不进入焊道和合并统计。 */
  collarGapEndClosureReferences?: CollarGapEndClosureReference[]
  compositeShellReferences?: CompositeShellReference[]
  /** 可选的演示模型几何处理结果；加载后仍需按当前几何和设置校验。 */
  processedWelds?: unknown
}

/** Finalize planning only after the selected frame has been applied. Imported
 * sources can stay immutable so selecting another base starts from CAD data. */
export function finalizeFramedModelData(data: ModelData, mode: 'geometry' | 'tool' = 'tool'): ModelData {
  const supported = normalizeJointSupportFaces(data.weldsData, data.partsData, data.edgesData)
  const shells = normalizeCompositeShellWelds(supported, data.partsData, data.edgesData)
  const planningWelds = normalizeProjectedEndpointContinuity(applyCollarGapPlanning(shells.weldsData, data.partsData))
  return { ...data, compositeShellReferences: shells.references,
    weldsData: normalizeWeldWorkfaces(normalizeWeldTravelDirections(planningWelds, data.partsData, data.mesh, mode)) }
}

/**
 * 焊缝数据契约归一化 (新契约为主, 旧契约键向后兼容, 旧键保留不删):
 *  - 接头形式: 是否由副板板厚形成 ??= 板厚是否形成单独焊缝
 *  - 起点特征/终点特征: 长 ??= 边长1, 高 ??= 边长2
 */
function normalizeWeldsData(weldsData: WeldsData): void {
  for (const weld of weldsData.welds) {
    const props = weld.properties as Record<string, unknown> | undefined
    if (!props) continue
    const jt = props['接头形式'] as Record<string, unknown> | undefined
    if (jt && jt['是否由副板板厚形成'] == null && jt['板厚是否形成单独焊缝'] != null) {
      jt['是否由副板板厚形成'] = jt['板厚是否形成单独焊缝']
    }
    for (const key of ['起点特征', '终点特征'] as const) {
      const f = props[key] as Record<string, unknown> | undefined
      if (!f) continue
      if (f['长'] == null && f['边长1'] != null) f['长'] = f['边长1']
      if (f['高'] == null && f['边长2'] != null) f['高'] = f['边长2']
    }
  }
}

async function loadOptionalJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(url, { signal, cache: 'no-store' })
    return response.ok ? await response.json() as T : null
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

/** Static servers may return the gzip file verbatim or transparently decompress
 * it through Content-Encoding. Inspect bytes so both responses remain valid. */
export async function readProcessedWeldsResponse(response: Response): Promise<unknown> {
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') throw new Error('Gzip decompression is unavailable')
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).json()
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function loadOptionalProcessedWelds(base: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(`${base}/processed-welds.json.gz`, { signal, cache: 'no-store' })
    if (response.ok) return await readProcessedWeldsResponse(response)
  } catch (error) {
    if (signal?.aborted) throw error
  }
  return loadOptionalJson<unknown>(`${base}/processed-welds.json`, signal)
}

async function readRequiredJson<T>(response: Response, filename: string, signal?: AbortSignal): Promise<T> {
  try { return await response.json() as T }
  catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`${filename} 数据格式错误：请确认模型文件已生成且为有效 JSON`)
  }
}

/** 从指定数据目录加载工件，默认保留原 /data 入口；切换模型可中止未完成请求。 */
export async function loadModelData(dataPath = '/data', signal?: AbortSignal,
  /** false returns source coordinates and defers frame-dependent planning. */
  options: { geometryOnly?: boolean; applyCoordinateFrame?: boolean; processedWelds?: boolean; thicknessWeldThresholdMm?: number } = {}): Promise<ModelData> {
  const base = dataPath.replace(/\/+$/, '')
  // Start mesh transfer as soon as its manifest arrives, while boundary data,
  // weld JSON and optional saved processing results are still being decoded.
  const partsPromise = fetch(`${base}/parts.json`, { signal, cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error(`parts.json 加载失败: ${response.status}`)
    const parts = await readRequiredJson<PartsData>(response, 'parts.json', signal)
    if (!parts || !Array.isArray(parts.parts) || !parts.bbox || typeof parts.meshFile !== 'string') throw new Error('parts.json 数据格式不完整')
    return parts
  })
  const weldsPromise = fetch(`${base}/welds.json`, { signal, cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error(`welds.json 加载失败: ${response.status}`)
    return readRequiredJson<WeldsData>(response, 'welds.json', signal)
  })
  const meshPromise = partsPromise.then(async parts => {
    const response = await fetch(`${base}/${parts.meshFile}`, { signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`${parts.meshFile} 加载失败: ${response.status}`)
    if (response.headers.get('content-type')?.includes('text/html')) throw new Error(`${parts.meshFile} 数据格式错误：未取得模型网格文件`)
    return new Float32Array(await response.arrayBuffer())
  })
  const [partsData, sourceWeldsData, mesh, edgesData, contactsData, analysis, processedWelds] = await Promise.all([
    partsPromise, weldsPromise, meshPromise,
    loadOptionalJson<EdgesData>(`${base}/edges.json`, signal),
    loadOptionalJson<{ contacts?: [string, string][] }>(`${base}/contacts.json`, signal),
    loadOptionalJson<ModelAnalysis>(`${base}/analysis.json`, signal),
    options.processedWelds ? loadOptionalProcessedWelds(base, signal) : undefined,
  ])
  if (!Array.isArray(sourceWeldsData?.welds)) throw new Error('welds.json 缺少焊缝列表')
  // Apply the agreed travel direction once, before split/merge/endpoint analysis.
  const thicknessDecisions = options.geometryOnly
    ? applyThicknessWeldThreshold(sourceWeldsData, partsData, options.thicknessWeldThresholdMm) : sourceWeldsData
  const independentThicknessWeldIds = new Set(thicknessDecisions.welds.filter(weld =>
    (weld.properties.接头形式 as Record<string, unknown> | undefined)?.板厚形成独立焊缝 === true).map(weld => weld.id))
  const topology = separateCollarContactSides(sourceWeldsData, partsData, { independentThicknessWeldIds })
  const gapClosures = separateCollarGapEndClosures(topology.weldsData, partsData, edgesData)
  const weldsData = reverseWeldsDirection(gapClosures.weldsData)
  normalizeWeldsData(weldsData)

  // contacts.json 为可选数据 (零件直接接触对), 失败不阻塞主流程
  let contactPairs: Set<string> | null = null
  if (Array.isArray(contactsData?.contacts)) {
    contactPairs = new Set<string>()
    for (const [a, b] of contactsData.contacts) {
      contactPairs.add(`${a}|${b}`)
      contactPairs.add(`${b}|${a}`)
    }
  }

  const currentRoleCounts: Record<string, number> = {}
  const separatedReferences = topology.references.length + gapClosures.references.length
  if (separatedReferences) {
    const roles = new Map(partsData.parts.filter((part) => part.partRole).map((part) => [part.id, part.partRole!.type]))
    for (const weld of weldsData.welds) for (const role of new Set([roles.get(weld.mainPartId), roles.get(weld.subPartId)])) {
      if (role) currentRoleCounts[role] = (currentRoleCounts[role] ?? 0) + 1
    }
  }
  const currentAnalysis = analysis && separatedReferences ? { ...analysis,
    collarContactTopologyAuditFile: 'collar-contact-topology-audit.json',
    ...(gapClosures.references.length ? { collarGapEndClosureAuditFile: 'collar-gap-end-closure-audit.json' } : {}),
    summary: { ...analysis.summary, candidateWeldCount: weldsData.welds.length,
      sourceCandidateWeldCount: sourceWeldsData.welds.length,
      sourceTotalLengthMm: sourceWeldsData.welds.reduce((sum, weld) => sum + weld.length, 0),
      thicknessReferenceCount: topology.references.length,
      gapEndClosureReferenceCount: gapClosures.references.length,
      gapEndClosureLengthMm: gapClosures.references.reduce((sum, row) => sum + row.lengthMm, 0),
      partRoleWeldCounts: currentRoleCounts,
      totalEndpointCount: weldsData.welds.length * 2,
      recognizedEndpointCount: weldsData.welds.reduce((sum, weld) => sum + ['起点特征', '终点特征'].filter((key) => {
        const feature = weld.properties[key] as { 特征类型?: string } | undefined
        return feature?.特征类型 && feature.特征类型 !== '未识别'
      }).length, 0),
      totalLengthMm: weldsData.welds.reduce((sum, weld) => sum + weld.length, 0) } } : analysis
  const data = { partsData, weldsData, mesh, edgesData, contactPairs, analysis: currentAnalysis,
    collarThicknessReferences: topology.references, collarGapEndClosureReferences: gapClosures.references,
    ...(options.processedWelds ? { processedWelds } : {}) }
  if (options.applyCoordinateFrame === false) return data
  const positioned = analysis?.coordinateFrame ? applyModelCoordinateFrame(data, analysis.coordinateFrame) : data
  const framed = finalizeFramedModelData(positioned, options.geometryOnly ? 'geometry' : 'tool')
  if (analysis?.modelId !== 'h1lb1b' && !base.endsWith('/models/h1lb1b')) return framed
  const effective = normalizeWeldsParameters(framed.weldsData, { partsData: framed.partsData, worldUp: [0, 0, 1] })
  const counts = (value: (weld: typeof effective.welds[number]) => string) => {
    const result: Record<string, number> = {}
    for (const weld of effective.welds) { const key = value(weld); result[key] = (result[key] ?? 0) + 1 }
    return result
  }
  return { ...framed, weldsData: effective, analysis: framed.analysis ? {
    ...framed.analysis,
    rule: '普通零件按小组立层级提取；补板和水密补板提取与任意部件的真实交线及已核验有限投影搭接轮廓。保留模型实际间隙与位置，已确认补板/水密补板连接按无间隙规划；经完整边界拓扑和两侧镜像核验的间隙端部短封口只作参考，不生成焊缝。',
    summary: { ...framed.analysis.summary,
      jointTypes: counts((weld) => weld.jointType),
      weldingPositions: counts((weld) => String((weld.properties.焊接位置 as { 代号: string }).代号)),
      grooveTypes: counts((weld) => String((weld.properties.坡口 as { 类型: string }).类型)),
    },
  } : null }
}
