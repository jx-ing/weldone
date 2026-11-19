const EMPTY = () => ({
  total: {calls: 0, prompt: 0, completion: 0, total: 0},
  days: {},
  recent: [],
});

const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;

export function emptyUsage() {
  return EMPTY();
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = number(usage.prompt_tokens ?? usage.prompt);
  const completion = number(usage.completion_tokens ?? usage.completion);
  const total = number(usage.total_tokens ?? usage.total) || prompt + completion;
  if (!prompt && !completion && !total) return null;
  return {
    prompt, completion, total,
    cached: number(usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cached),
  };
}

export function accumulateUsage(state, {usage, model = '', at = new Date(), words = 0} = {}) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return state;
  const base = state && typeof state === 'object' && state.total ? state : EMPTY();
  const day = at instanceof Date ? at.toLocaleDateString('sv-SE') : String(at).slice(0, 10);
  const dayEntry = base.days?.[day] ?? {calls: 0, prompt: 0, completion: 0, total: 0};
  const total = {...base.total}, days = {...base.days};
  for (const bucket of [total, dayEntry]) {
    bucket.calls += 1;
    bucket.prompt += normalized.prompt;
    bucket.completion += normalized.completion;
    bucket.total += normalized.total;
  }
  days[day] = dayEntry;
  const recent = [{
    at: at instanceof Date ? at.toISOString() : String(at),
    model,
    prompt: normalized.prompt,
    completion: normalized.completion,
    total: normalized.total,
    cached: normalized.cached,
  }, ...(base.recent ?? [])].slice(0, 20);
  return {total, days, recent};
}

export function usageSummary(state, today = new Date().toLocaleDateString('sv-SE')) {
  const base = state && typeof state === 'object' && state.total ? state : EMPTY();
  const day = base.days?.[today] ?? {calls: 0, prompt: 0, completion: 0, total: 0};
  return {
    total: {...base.total},
    today: {...day},
    days: Object.entries(base.days ?? {}).sort(([a], [b]) => a.localeCompare(b)).slice(-14),
    recent: base.recent ?? [],
  };
}
