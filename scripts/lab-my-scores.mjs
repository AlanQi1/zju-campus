/**
 * 大物实验平台：本人本学期每次实验的百分制评分（/api/teacher/evaluates/studentfull）。
 * 只读：一次登录 POST + 只读 GET。
 * 用法：node scripts/lab-my-scores.mjs [--json]
 */
import { createHash } from 'node:crypto';
import { resolveIndependentAccount } from '../src/independent-accounts.js';

const B = 'http://10.203.16.55:8098/lab-course';
const SK = Buffer.from(['fNR', '2q4Z', 'rSde', 'peIr', 'Z9H', 'iUlQ', '=', '='].join(''), 'base64').toString('hex');
const AK = Buffer.from(['==wn', 'D0g6', '6qYL7', 'qDSn3', 'ZOox4', '6'].join('').split('').reverse().join(''), 'base64').toString('hex');

const sign = (path, data = {}) => {
  const ts = Math.floor(Date.now() / 1000) * 1000;
  let src = SK + path;
  for (const k of Object.keys(data).sort()) {
    const v = data[k];
    if (v !== '' && v !== null && v !== undefined && typeof v !== 'object') src += k + v;
  }
  return { app_key: AK, timestamp: ts, sign: createHash('md5').update(src + ts + ' ' + SK).digest('hex'), ...data };
};

const acc = resolveIndependentAccount('physicsLab');
const lr = await fetch(`${B}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
  body: new URLSearchParams(sign('/api/login', { username: acc.username.trim(), password: acc.password.trim() })).toString(),
});
const lj = JSON.parse(await lr.text());
if (lj.code !== 200) { console.error('登录失败'); process.exit(1); }
const auth = `${lj.data.token.token_type} ${lj.data.token.access_token}`;
const uid = lj.data.username;

const get = async (path, data = {}) => {
  const url = new URL(B + path);
  url.search = new URLSearchParams(sign(path, data)).toString();
  const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { code: r.status, raw: t.slice(0, 300) }; }
};

const terms = await get('/api/terms');
const term = terms.data.content.find(t => String(t.currentTerm) === '1');

const evals = (await get('/api/teacher/evaluates/studentfull', { termId: term.id, uid })).data || [];
const lessons = (await get('/api/course/lab/students/full', {
  termId: term.id, uid, courseId: 271, page: -1, size: -1,
})).data.content || [];

const byId = new Map(lessons.map(l => [String(l.id), l]));
const rows = evals.map(e => {
  const l = byId.get(String(e.id)) || {};
  return {
    labName: e.lab_name,
    date: l.dates || '',
    week: e.select_week,
    time: l.times || '',
    teacher: e.teacher_name,
    room: l.address || '',
    score: e.score === null || e.score === undefined ? null : Number(e.score),
    markedScore: l.final_score ?? null,
    reviewed: l.is_look === '1' || l.is_look === 1,
    evaluateId: e.teacher_evaluate_id,
  };
}).sort((a, b) => String(a.date).localeCompare(String(b.date)));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ term: term.name, rows }, null, 2));
} else {
  console.log(`学期：${term.name}\n`);
  for (const r of rows) {
    const s = r.score === null ? '未评分' : `${r.score} 分`;
    console.log(`${r.date || '—'}  ${r.labName}  →  ${s}`.replace(/\s+/g, ' '));
  }
}
