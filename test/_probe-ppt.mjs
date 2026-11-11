import { CmcClient } from '../src/cmc.js';
import { resolveCredentials } from '../src/session.js';
import { request } from '../src/http.js';

const c = resolveCredentials({});
const cmc = await CmcClient.login({ username: c.username, password: c.password, timeoutMs: 25000 });
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const back = new Date(Date.now() + 8 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
const s = await cmc.schedule(back, today);
const lesson = s.lessons.find((l) => l.hasTranscript && l.courseId);
console.log('lesson', lesson && { subId: lesson.subId, courseId: lesson.courseId, title: lesson.title, date: lesson.date });
if (!lesson) process.exit(0);

const url = `https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id=${lesson.courseId}&sub_id=${lesson.subId}`;
const res = await request(cmc.jar, url, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: 25000 });
const text = await res.text();
console.log('ppt status', res.res.status, 'len', text.length, 'head', text.slice(0, 200));
let json = null;
try { json = JSON.parse(text); } catch {}
if (json) {
  const list = json.list || json.result?.list || [];
  console.log('ppt count', list.length);
  const first = list[0];
  if (first) {
    console.log('first item keys', Object.keys(first));
    let content = first.content;
    try { content = typeof content === 'string' ? JSON.parse(content) : content; } catch {}
    console.log('first content', JSON.stringify(content).slice(0, 400));
    const img = content?.pptimgurl;
    if (img) {
      const r2 = await request(cmc.jar, img, {}, { follow: true, timeoutMs: 25000 });
      const buf = await r2.res.arrayBuffer();
      console.log('image status', r2.res.status, 'content-type', r2.res.headers.get('content-type'), 'bytes', buf.byteLength);
    }
  }
}
