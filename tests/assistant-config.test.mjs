import assert from 'node:assert/strict';
import test from 'node:test';
import {ASSISTANT_PROVIDER_PRESETS, assistantConfigFromInput} from '../scripts/local-assistant.mjs';

test('预置服务覆盖常见提供商', () => {
  const ids = ASSISTANT_PROVIDER_PRESETS.map(preset => preset.id);
  assert.deepEqual(ids, ['deepseek', 'openai', 'local', 'custom']);
  assert.ok(ASSISTANT_PROVIDER_PRESETS.every(preset => preset.label));
});

test('应用内配置接受任意 OpenAI 兼容服务', () => {
  const deepseek = assistantConfigFromInput({baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-a'});
  assert.equal(String(deepseek.url), 'https://api.deepseek.com/v1/chat/completions');
  const custom = assistantConfigFromInput({baseUrl: 'http://127.0.0.1:11434/v1/', model: 'qwen2.5', apiKey: 'local'});
  assert.equal(String(custom.url), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(custom.model, 'qwen2.5');
});

test('缺项、明文外网地址和超长模型名被拒绝', () => {
  assert.equal(assistantConfigFromInput({baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat'}), null);
  assert.equal(assistantConfigFromInput({baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-a'}), null);
  assert.equal(assistantConfigFromInput({baseUrl: 'http://example.com/v1', model: 'm', apiKey: 'sk-a'}), null);
  assert.equal(assistantConfigFromInput({baseUrl: 'https://api.deepseek.com/v1?x=1', model: 'm', apiKey: 'sk-a'}), null);
  assert.equal(assistantConfigFromInput({baseUrl: 'https://api.deepseek.com/v1', model: 'm'.repeat(101), apiKey: 'sk-a'}), null);
});
