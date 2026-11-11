/**
 * 验证 Host 侧注册了 /dsh-zju/summary 与 /dsh-zju/rollcall-switch 路由，
 * 并用假 req/res 走一遍（开关写入用临时文件，不碰真实配置）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../index.js';

const dir = mkdtempSync(join(tmpdir(), 'zju-route-'));
const switchFile = join(dir, 'switch.json');
const locationsFile = join(dir, 'locations.json');

const registered = [];
const routes = [];

const ctx = {
  tools: { register: (definition) => { registered.push(definition.name); return () => {}; } },
  effect: (callback) => { const dispose = callback(); return dispose; },
  inject: (deps, callback) => {
    if (deps.includes('webServer')) {
      callback({
        webServer: { register: (route) => { routes.push(route); return () => {}; } },
        effect: (fn) => fn(),
      });
    }
  },
  logger: { info() {}, warn() {} },
};

apply(ctx, { allowWriteOps: false, rollcallSwitchFile: switchFile, rollcallLocationsFile: locationsFile });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** 假响应对象。 */
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(chunk) { this.body = chunk || ''; },
  };
}

/** 假请求对象：Readable 兼容 handler 里的 req.on('data'/'end')。 */
function fakeReq(method, url, { body, bodyText, headers } = {}) {
  const chunks = bodyText !== undefined
    ? [Buffer.from(bodyText)]
    : body !== undefined
      ? [Buffer.from(JSON.stringify(body))]
      : [];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  return req;
}

try {
  check('工具数量', registered.length === 23, `${registered.length}`);
  check('路由数量', routes.length === 2, routes.map((r) => r.path).join(','));

  const summaryRoute = routes.find((r) => r.path === '/dsh-zju/summary');
  const switchRoute = routes.find((r) => r.path === '/dsh-zju/rollcall-switch');
  check('summary 路由', summaryRoute?.kind === 'exact', summaryRoute?.path);
  check('switch 路由', switchRoute?.kind === 'exact', switchRoute?.path);

  // summary：非 GET 应 405
  const res405 = fakeRes();
  await summaryRoute.handler(fakeReq('POST', '/dsh-zju/summary'), res405);
  check('summary POST 返回 405', res405.statusCode === 405, String(res405.statusCode));

  // summary：GET 应返回 JSON（账号已配置，会真实拉数据；只检查结构）
  const res = fakeRes();
  const started = Date.now();
  await summaryRoute.handler(fakeReq('GET', '/dsh-zju/summary'), res);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  check('summary GET 200', res.statusCode === 200, String(res.statusCode));
  check('summary Content-Type', String(res.headers['Content-Type']).includes('application/json'), res.headers['Content-Type']);
  let payload = null;
  try { payload = JSON.parse(res.body); } catch { payload = null; }
  check('summary 返回 JSON', payload !== null);
  if (payload) {
    check('summary 包含各节', ['configured', 'todos', 'lessons', 'notices', 'errors'].every((k) => k in payload), Object.keys(payload).join(','));
    check('summary 包含近 7 天课表', payload.week?.days?.length === 7 && payload.week?.end === payload.date, JSON.stringify({ start: payload.week?.start, end: payload.week?.end, days: payload.week?.days?.length }));
    check('summary 包含开关状态', payload.rollcallSign && typeof payload.rollcallSign.enabled === 'boolean');
    check('summary 包含笔记缓存', payload.notes && typeof payload.notes.count === 'number' && Array.isArray(payload.notes.subIds), JSON.stringify(payload.notes?.count));
    check('summary 包含 Obsidian 状态', payload.notes?.obsidian && typeof payload.notes.obsidian.enabled === 'boolean', JSON.stringify(payload.notes?.obsidian));
    console.log(`   配置=${payload.configured} 待办=${payload.todos.length} 课表=${payload.lessons.length} 近7天=${payload.week?.days?.reduce((n, d) => n + (d.lessons?.length || 0), 0) ?? '?'} 通知=${payload.notices.length} 耗时=${elapsed}s`);
    if (payload.errors.length) console.log('   错误：', payload.errors.join(' | '));
  }

  // switch：默认跟随配置（false）
  const swGet = fakeRes();
  await switchRoute.handler(fakeReq('GET', '/dsh-zju/rollcall-switch', { headers: { origin: 'http://127.0.0.1:43120' } }), swGet);
  check('switch GET 200', swGet.statusCode === 200, String(swGet.statusCode));
  let swState = null;
  try { swState = JSON.parse(swGet.body); } catch { swState = null; }
  check('switch 默认跟随配置', swState?.enabled === false && swState?.source === 'config', JSON.stringify(swState));

  // switch：POST 打开
  const swPost = fakeRes();
  await switchRoute.handler(
    fakeReq('POST', '/dsh-zju/rollcall-switch', { body: { enabled: true }, headers: { origin: 'http://127.0.0.1:43120' } }),
    swPost,
  );
  check('switch POST 200', swPost.statusCode === 200, String(swPost.statusCode));
  let swOn = null;
  try { swOn = JSON.parse(swPost.body); } catch { swOn = null; }
  check('switch POST 写入', swOn?.enabled === true && swOn?.source === 'panel', JSON.stringify(swOn));

  // switch：再次 GET 应读到打开
  const swGet2 = fakeRes();
  await switchRoute.handler(fakeReq('GET', '/dsh-zju/rollcall-switch', { headers: { origin: 'http://127.0.0.1:43120' } }), swGet2);
  const swState2 = JSON.parse(swGet2.body);
  check('switch 持久化', swState2.enabled === true && swState2.source === 'panel');

  // switch：非法值 400
  const swBad = fakeRes();
  await switchRoute.handler(
    fakeReq('POST', '/dsh-zju/rollcall-switch', { body: { enabled: 'yes' }, headers: { origin: 'http://127.0.0.1:43120' } }),
    swBad,
  );
  check('switch 非法值 400', swBad.statusCode === 400, String(swBad.statusCode));

  // switch：坏 JSON 400
  const swBadJson = fakeRes();
  await switchRoute.handler(
    fakeReq('POST', '/dsh-zju/rollcall-switch', { bodyText: '{', headers: { origin: 'http://127.0.0.1:43120' } }),
    swBadJson,
  );
  check('switch 坏 JSON 400', swBadJson.statusCode === 400, String(swBadJson.statusCode));

  // switch：外站 Origin 403
  const swForeign = fakeRes();
  await switchRoute.handler(
    fakeReq('POST', '/dsh-zju/rollcall-switch', { body: { enabled: true }, headers: { origin: 'http://evil.example' } }),
    swForeign,
  );
  check('switch 外站 Origin 403', swForeign.statusCode === 403, String(swForeign.statusCode));

  // switch：非 GET/POST 405
  const sw405 = fakeRes();
  await switchRoute.handler(fakeReq('PUT', '/dsh-zju/rollcall-switch', { headers: { origin: 'http://127.0.0.1:43120' } }), sw405);
  check('switch PUT 405', sw405.statusCode === 405, String(sw405.statusCode));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
