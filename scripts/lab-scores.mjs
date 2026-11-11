/**
 * 大物实验平台（10.203.16.55）只读查询：课程 + 成绩。
 * 用法：node scripts/lab-scores.mjs [path] [queryJSON]
 */
import { createHash } from 'node:crypto';
import { resolveIndependentAccount } from '../src/independent-accounts.js';

const BACKEND = 'http://10.203.16.55:8098/lab-course';
const SIGNING_KEY = Buffer.from(['fNR', '2q4Z', 'rSde', 'peIr', 'Z9H', 'iUlQ', '=', '='].join(''), 'base64').toString('hex');
const APP_KEY = Buffer.from(['==wn', 'D0g6', '6qYL7', 'qDSn3', 'ZOox4', '6'].join('').split('').reverse().join(''), 'base64').toString('hex');

function signedFields(path, data = {}) {
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  let source = SIGNING_KEY + path;
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value !== '' && value !== null && value !== undefined && typeof value !== 'object') source += key + value;
  }
  const sign = createHash('md5').update(source + timestamp + ' ' + SIGNING_KEY).digest('hex');
  return { app_key: APP_KEY, timestamp, sign, ...data };
}

function buildUrl(path, data) {
  const url = new URL(BACKEND + path);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(signedFields(path, data))) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  url.search = params.toString();
  return url;
}

const account = resolveIndependentAccount('physicsLab');
if (!account) {
  console.error('未配置大物实验账号');
  process.exit(1);
}

// 登录
const loginUrl = buildUrl('/api/login', { username: account.username.trim(), password: account.password.trim() });
const loginRes = await fetch(loginUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
  body: new URLSearchParams(signedFields('/api/login', { username: account.username.trim(), password: account.password.trim() })).toString(),
});
const loginText = await loginRes.text();
let loginJson;
try { loginJson = JSON.parse(loginText); } catch { console.error('登录返回非 JSON：', loginText.slice(0, 200)); process.exit(1); }
if (loginJson.code !== 200) { console.error('登录失败：', JSON.stringify(loginJson).slice(0, 300)); process.exit(1); }
const token = loginJson.data.token;
const auth = `${token.token_type} ${token.access_token}`;
const uid = loginJson.data.username;
console.error(`登录成功 uid=${uid}`);

const path = process.argv[2] || '/api/terms';
const query = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const url = buildUrl(path, { ...query, ...(path === '/api/terms' ? {} : { uid }) });
if (!('uid' in query) && !['/api/terms'].includes(path)) url.searchParams.set('uid', uid);

const res = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
const text = await res.text();
console.log(text.slice(0, 20000));
