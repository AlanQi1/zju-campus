/**
 * 从课程页的 SPA 脚本里找「作业详情」的前端路由，确认点击跳转 URL 的形式。
 */
import { ZjuSession } from '../src/session.js';
import { request } from '../src/http.js';

const settings = {
  username: '', password: '', envFile: '', tenantId: '112',
  sessionTtlMs: 15 * 60 * 1000, requestTimeoutMs: 25000,
  allowWriteOps: false, noticeSources: ['qsxy'],
};

const session = new ZjuSession(settings);
const client = await session.coursesClient();

const page = await request(
  client.jar,
  'https://courses.zju.edu.cn/course/12301/learning-activity',
  {},
  { follow: true, timeoutMs: 25000 },
);
console.log('页面 HTTP', page.res.status, 'final', page.url.slice(0, 100));
const html = await page.text();
const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
console.log('脚本数:', scripts.length);
console.log(scripts.slice(0, 8).join('\n'));

// 在脚本里找 learning-activity / activity 路由
for (const src of scripts.slice(0, 6)) {
  try {
    const url = new URL(src, page.url).toString();
    const r = await request(client.jar, url, {}, { follow: true, timeoutMs: 25000 });
    const js = await r.text();
    const hits = [...js.matchAll(/learning-activity[^"'\s]{0,60}/g)].map((m) => m[0]).slice(0, 5);
    const hits2 = [...js.matchAll(/#\/activity[^"'\s]{0,40}/g)].map((m) => m[0]).slice(0, 5);
    if (hits.length || hits2.length) {
      console.log('\n>>>', src);
      console.log('  learning-activity:', hits.join(' | '));
      console.log('  #/activity:', hits2.join(' | '));
    }
  } catch (error) {
    console.log('读取失败', src, error.message);
  }
}
