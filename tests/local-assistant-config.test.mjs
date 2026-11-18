import assert from 'node:assert/strict';
import test from 'node:test';
import {assistantModelConfig} from '../scripts/local-assistant.mjs';

test('缺少密钥时不启用模型问答', () => {
  assert.equal(assistantModelConfig({}), null);
  assert.equal(assistantModelConfig({WELDONE_AI_MODEL: 'deepseek-chat'}), null);
});

test('只提供密钥时使用 DeepSeek 官方接口', () => {
  const config = assistantModelConfig({WELDONE_AI_API_KEY: 'sk-test'});
  assert.equal(String(config.url), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(config.model, 'deepseek-chat');
  assert.equal(config.key, 'sk-test');
});

test('支持 DEEPSEEK_API_KEY 回退和地址尾斜杠', () => {
  const config = assistantModelConfig({DEEPSEEK_API_KEY: 'sk-env', WELDONE_AI_BASE_URL: 'https://api.deepseek.com/v1//'});
  assert.equal(String(config.url), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(config.model, 'deepseek-chat');
});

test('本机兼容服务可自定义地址和模型', () => {
  const config = assistantModelConfig({
    WELDONE_AI_API_KEY: 'local',
    WELDONE_AI_BASE_URL: 'http://127.0.0.1:11434/v1',
    WELDONE_AI_MODEL: 'qwen2.5',
  });
  assert.equal(String(config.url), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(config.model, 'qwen2.5');
});

test('自定义服务缺少模型名时不启用', () => {
  assert.equal(assistantModelConfig({
    WELDONE_AI_API_KEY: 'local',
    WELDONE_AI_BASE_URL: 'http://127.0.0.1:11434/v1',
  }), null);
});

test('拒绝非本机的明文地址和带参数的地址', () => {
  assert.equal(assistantModelConfig({
    WELDONE_AI_API_KEY: 'sk-test',
    WELDONE_AI_BASE_URL: 'http://example.com/v1',
    WELDONE_AI_MODEL: 'm',
  }), null);
  assert.equal(assistantModelConfig({
    WELDONE_AI_API_KEY: 'sk-test',
    WELDONE_AI_BASE_URL: 'https://api.deepseek.com/v1?x=1',
  }), null);
});
