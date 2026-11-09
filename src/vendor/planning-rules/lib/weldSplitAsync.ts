import { computeAllSplits, WELD_SPLIT_ALGORITHM_REVISION, type WeldSplit } from './weldSplit'
import type { WeldSplitCache } from './weldSplitCache'

export type WeldSplitInput = Parameters<typeof computeAllSplits>

export interface WeldSplitProgress {
  completed: number
  total: number
  elapsedMs: number
  slowest: { weldId: string; elapsedMs: number } | null
}

export interface WeldSplitAsyncOptions {
  /** Opt in only for immutable normalized model data; not mutable fixtures. */
  cache?: WeldSplitCache
  signal?: AbortSignal
  budgetMs?: number
  now?: () => number
  yieldControl?: () => Promise<void>
  onProgress?: (progress: WeldSplitProgress) => void
}

/** Keep the exact single-weld algorithm, but let input, drawing and cancellation
 * run between elapsed-time batches. A cancelled pass never returns a partial map. */
export async function computeAllSplitsAsync(
  input: WeldSplitInput, options: WeldSplitAsyncOptions = {},
): Promise<Map<string, WeldSplit> | null> {
  const [weldsData, mesh, parts, edges, contacts, offset, extendThreshold, offsetThreshold] = input
  const now = options.now ?? (() => performance.now())
  const yieldControl = options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const budget = Math.max(1, options.budgetMs ?? 16)
  const started = now()
  let batchAt = started
  let publishedAt = started
  let slowest: WeldSplitProgress['slowest'] = null
  const result = new Map<string, WeldSplit>()
  const cancelled = () => options.signal?.aborted === true
  const publish = (completed: number) => options.onProgress?.({ completed,
    total: weldsData.welds.length, elapsedMs: now() - started, slowest })
  if (cancelled()) return null
  publish(0)
  // In particular, let React commit the model before any geometry work, and
  // allow StrictMode's abandoned effect to cancel before calculating a weld.
  await yieldControl()
  if (cancelled()) return null
  const cache = options.cache?.forInput(input)
  batchAt = now()
  for (let i = 0; i < weldsData.welds.length; i++) {
    if (cancelled()) return null
    const weld = weldsData.welds[i], began = now()
    let one = cache?.get(weld)
    if (!one) {
      one = computeAllSplits({ welds: [weld] }, mesh, parts, edges, contacts,
        offset, extendThreshold, offsetThreshold).get(weld.id)!
      // Completed atomic welds remain reusable if this pass is later cancelled;
      // its partial result Map is still never returned or displayed.
      cache?.set(weld, one)
    }
    const ended = now(), elapsedMs = ended - began
    if (!slowest || elapsedMs > slowest.elapsedMs) slowest = { weldId: weld.id, elapsedMs }
    result.set(weld.id, one)
    if (ended - batchAt >= budget) {
      if (ended - publishedAt >= 500) { publish(i + 1); publishedAt = ended }
      await yieldControl()
      if (cancelled()) return null
      batchAt = now()
    }
  }
  if (cancelled()) return null
  publish(weldsData.welds.length)
  return result
}

export interface WeldSplitSnapshot {
  algorithmRevision?: number
  input: WeldSplitInput
  result: Map<string, WeldSplit> | null
  progress: WeldSplitProgress
  error: string | null
}

/** A new model/filter/threshold immediately hides previous geometry, even
 * before React runs effect cleanup for that previous input. */
export function currentWeldSplitSnapshot(snapshot: WeldSplitSnapshot | null, input: WeldSplitInput | null) {
  return snapshot?.input === input && snapshot.algorithmRevision === WELD_SPLIT_ALGORITHM_REVISION ? snapshot : null
}
