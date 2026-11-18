// 本机一次性配置：把模型服务的密钥写入项目根目录 .env.local（已被 .gitignore 忽略）。
// 用法：双击 设置AI密钥.cmd，或在项目目录运行 node scripts/set-assistant-key.mjs
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
const baseUrl = (process.env.WELDONE_AI_BASE_URL || '').trim() || 'https://api.deepseek.com/v1';
const model = (process.env.WELDONE_AI_MODEL || '').trim() || (baseUrl.includes('api.deepseek.com') ? 'deepseek-chat' : '');
const KEY = 'WELDONE_AI_API_KEY';

function ask(question) {
  const rl = createInterface({input: process.stdin, output: process.stdout});
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

const provided = process.argv.slice(2).find(arg => arg.startsWith('--key='))?.slice('--key='.length) ||
  process.env.WELDONE_AI_API_KEY_INPUT;
const typed = (provided ?? await ask('请粘贴 DeepSeek API Key（sk- 开头）后回车：')).trim();

if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(typed)) {
  console.error('密钥格式不正确：应以 sk- 开头，且只包含字母、数字、下划线或连字符。未写入任何文件。');
  process.exit(1);
}
if (!model) {
  console.error('已提供自定义服务地址但没有模型名。请同时设置环境变量 WELDONE_AI_MODEL。未写入任何文件。');
  process.exit(1);
}

let verify = '未检查';
try {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/models');
  const response = await fetch(url, {headers: {Authorization: `Bearer ${typed}`}, signal: AbortSignal.timeout(20_000)});
  if (response.ok) {
    const body = await response.json().catch(() => null);
    const names = Array.isArray(body?.data) ? body.data.map(item => item?.id).filter(Boolean) : [];
    verify = names.length ? `可用模型：${names.join('、')}` : '密钥校验通过';
  } else {
    verify = `密钥校验未通过（HTTP ${response.status}）。密钥已保存，可稍后重试。`;
  }
} catch (error) {
  verify = `暂时无法连接模型服务（${error?.name === 'TimeoutError' ? '超时' : '网络错误'}）。密钥已保存，可稍后重试。`;
}

const lines = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/) : [];
const kept = lines.filter(line => !new RegExp(`^\\s*${KEY}\\s*=`).test(line));
while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
kept.push(
  '# WeldOne AI 助手 · 本机密钥，请勿提交到仓库',
  `WELDONE_AI_BASE_URL=${baseUrl}`,
  `WELDONE_AI_MODEL=${model}`,
  `${KEY}=${typed}`,
);
writeFileSync(envFile, kept.join('\n') + '\n', {encoding: 'utf8'});

console.log('');
console.log(`已写入 ${envFile}`);
console.log(`${verify}`);
console.log('请关闭并重新运行「启动平台.cmd」，刷新页面后打开右上角「AI 助手」。');
