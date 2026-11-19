import assert from 'node:assert/strict';
import test from 'node:test';
import {accumulateUsage, emptyUsage, normalizeUsage, usageSummary} from '../src/assistantUsage.mjs';

test('解析 DeepSeek 用量字段', () => {
  assert.deepEqual(normalizeUsage({
    prompt_tokens: 6, completion_tokens: 5, total_tokens: 11,
    prompt_cache_hit_tokens: 2, prompt_tokens_details: {cached_tokens: 2},
  }), {prompt: 6, completion: 5, total: 11, cached: 2});
  assert.equal(normalizeUsage(null), null);
  assert.equal(normalizeUsage({prompt_tokens: 0, completion_tokens: 0}), null);
  assert.deepEqual(normalizeUsage({prompt: 6, completion: 5, total: 11, cached: 2}),
    {prompt: 6, completion: 5, total: 11, cached: 2});
});

test('累计按天汇总并保留最近记录', () => {
  let state = emptyUsage();
  state = accumulateUsage(state, {
    usage: {prompt_tokens: 10, completion_tokens: 5, total_tokens: 15},
    model: 'deepseek-chat', at: new Date('2026-11-18T02:00:00Z'), words: 3,
  });
  state = accumulateUsage(state, {
    usage: {prompt_tokens: 20, completion_tokens: 8, total_tokens: 28},
    model: 'deepseek-chat', at: new Date('2026-11-19T02:00:00Z'),
  });
  assert.equal(state.total.calls, 2);
  assert.equal(state.total.total, 43);
  assert.equal(state.days['2026-11-18'].total, 15);
  assert.equal(state.days['2026-11-19'].total, 28);
  assert.equal(state.recent.length, 2);
  assert.equal(state.recent[0].total, 28);
});

test('汇总包含今日与最近 14 天', () => {
  let state = emptyUsage();
  state = accumulateUsage(state, {usage: {prompt_tokens: 3, completion_tokens: 2, total_tokens: 5}, at: new Date('2026-11-18T10:00:00Z')});
  const summary = usageSummary(state, '2026-11-18');
  assert.equal(summary.total.total, 5);
  assert.equal(summary.today.total, 5);
  assert.equal(summary.days.length, 1);
  assert.equal(summary.days[0][0], '2026-11-18');
});
