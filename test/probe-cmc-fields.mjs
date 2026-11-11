/**
 * 看智云课堂课表接口返回的课程对象有哪些字段，找可跳转的链接。
 */
import { CmcClient } from '../src/cmc.js';
import { request } from '../src/http.js';
import { resolveCredentials } from '../src/session.js';

const c = resolveCredentials({});
const cmc = await CmcClient.login({ username: c.username, password: c.password, timeoutMs: 25000 });
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const url =
  `https://yjapi.cmc.zju.edu.cn/courseapi/v2/schedule/get-week-schedules` +
  `?user_id=${encodeURIComponent(cmc.user.userId)}&tenant_id=112&start_at=${today}&end_at=${today}`;
const res = await request(cmc.jar, url, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: 25000 });
const json = JSON.parse(await res.text());
const course = json?.result?.list?.[0]?.course?.[0];
console.log('课程对象字段：', Object.keys(course || {}).join(', '));
for (const [key, value] of Object.entries(course || {})) {
  if (typeof value === 'string' && /^(https?:)?\/\//.test(value)) console.log('  链接字段', key, '=', value);
  else if (/url|link|share|id$/i.test(key)) console.log('  可疑字段', key, '=', String(value).slice(0, 80));
}
