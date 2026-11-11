import { CmcClient } from '../src/cmc.js';
import { resolveCredentials } from '../src/session.js';
const c = resolveCredentials({});
const cmc = await CmcClient.login({ username: c.username, password: c.password, timeoutMs: 25000 });
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const back = new Date(Date.now() + 8 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
const s = await cmc.schedule(today, today);
const withTr = s.lessons.filter((l) => l.hasTranscript);
console.log('今日有转录的课：', withTr.length, '节');
if (withTr.length === 0) {
  // 往前找几天
  const s2 = await cmc.schedule(back, today);
  withTr.push(...s2.lessons.filter((l) => l.hasTranscript));
  console.log('近 7 天有转录的课：', withTr.length, '节');
  console.log('近 7 天分组：', s2.days?.length, '天；每节课带 date：', s2.lessons.every((l) => l.date), '；按日期排序：', s2.lessons.every((l, i) => i === 0 || String(s2.lessons[i - 1].date) <= String(l.date)));
}
if (withTr.length > 0) {
  const lesson = withTr[0];
  const segs = await cmc.transcript(lesson.subId);
  console.log('PASS 转录', lesson.title, '段数=', segs.length);
  if (segs[0]) console.log('   首段：', `[${segs[0].begin}s]`, segs[0].text.slice(0, 60));
} else {
  console.log('SKIP 近期没有可拉转录的课');
}
