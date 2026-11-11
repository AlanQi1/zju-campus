/**
 * 大物实验平台通用只读 GET 探测（签名 + token），只发 GET。
 * 用法：node scripts/lab-get.mjs <path> '<queryJSON>'
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

const account = resolveIndependentAccount('physicsLab');
if (!account) { console.error('未配置账号'); process.exit(1); }
const username = account.username.trim();
const password = account.password.trim();

// login(POST)
{
  const lurl = new URL(BACKEND + '/api/login');
  const lp = new URLSearchParams(signedFields('/api/login', { username, password }));
  const r = await fetch(lurl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' }, body: lp.toString() });
  const t = await r.text();
  const j = JSON.parse(t);
  if (j.code !== 200) { console.error('登录失败', t.slice(0, 200)); process.exit(1); }
  globalThis.__auth = `${j.data.token.token_type} ${j.data.token.access_token}`;
  globalThis.__uid = j.data.username;
  console.error(`login ok uid=${globalThis.__uid}`);
}

const path = process.argv[2];
const query = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const url = new URL(BACKEND + path);
const params = new URLSearchParams(signedFields(path, query));
url.search = params.toString();

const res = await fetch(url, { headers: { Authorization: globalThis.__auth, Accept: 'application/json' } });
const body = await res.text();
console.log(`HTTP ${res.status} len=${body.length}`);
console.log(body.slice(0, Number(process.env.MAXLEN || 6000)));
