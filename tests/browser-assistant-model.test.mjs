import test from 'node:test';
import assert from 'node:assert/strict';
import {askBrowserModel, normalizeBrowserModelConfig, testBrowserModel} from '../src/browserAssistantModel.mjs';

const config = {baseUrl: 'https://model.example/v1/', model: 'example', apiKey: 'test-secret'};
const reply = message => Response.json({choices: [{message}]});

test('浏览器模型接受 HTTPS 和免密回环地址，拒绝嵌入式凭据与远程 HTTP', () => {
  const root = 'http://[::1]:11434/v1';
  assert.deepEqual(normalizeBrowserModelConfig({baseUrl: root + '/chat/completions/', model: ' local '}),
    {baseUrl: root, model: 'local', apiKey: ''});
  for (const url of ['http://other.test/v1', 'file:///tmp/key', 'https://u:k@model.example/', 'https://model.example/?key=bad', 'https://model.example/#key']) {
    assert.throws(() => normalizeBrowserModelConfig({...config, baseUrl: url}));
  }
  assert.throws(() => normalizeBrowserModelConfig({...config, model: ' '}), /模型名称/);
});

test('直接访问指定模型，仅在请求头携带密钥，工具调用转化成待确认操作', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://model.example/v1/chat/completions');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.ok(!options.body.includes(config.apiKey));
    const {model, messages, tools} = JSON.parse(options.body);
    assert.equal(model, config.model);
    assert.ok(tools.some(tool => tool.function.name === 'select_weld'));
    assert.match(messages.at(-1).content, /W10001/);
    return reply({tool_calls: [{type: 'function', function: {name: 'select_weld', arguments: '{"weldId":"W10001"}'}}]});
  });
  const response = await askBrowserModel(config, {question: '请定位我选的焊缝', inventory: 'W10001'});
  assert.deepEqual(response, {answer: '', actions: [{name: 'select_weld', arguments: {weldId: 'W10001'}}]});
});

test('工具不兼容时只重试文字问答，最小连通性检查不传工作区和工具', async t => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    assert.ok(!Object.hasOwn(options.headers, 'Authorization'));
    return body.tools ? new Response('不支持工具', {status: 400}) : reply({content: 'OK'});
  });
  const local = {model: 'test', baseUrl: 'http://localhost:11434/v1'};
  assert.deepEqual(await askBrowserModel(local, {question: '如何排查气孔？'}), {answer: 'OK', actions: []});
  assert.deepEqual(await testBrowserModel(local), {ok: true});
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2].tools, undefined);
  assert.deepEqual(bodies[2].messages, [{role: 'user', content: '仅回复 OK'}]);
});

test('拒绝整个包含错误操作的回复，鉴权失败不重试且不暴露服务响应', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => reply({tool_calls: [
    {function: {name: 'select_weld', arguments: '{"weldId":"W10001"}'}},
    {function: {name: 'missing', arguments: '{}'}},
  ]}));
  await assert.rejects(askBrowserModel(config, {question: '规划任务'}), /无效的操作/);
  fetchMock.mock.mockImplementation(async () => new Response('test-secret', {status: 401}));
  await assert.rejects(testBrowserModel(config), error => /密钥/.test(error.message) && !error.message.includes(config.apiKey));
  assert.equal(fetchMock.mock.callCount(), 2);
});
