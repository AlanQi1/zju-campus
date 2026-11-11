/**
 * 生成一张静态 HTML 预览：用真实账号拉一次快照，再把 client.js 的面板渲染成 HTML。
 * 目的：不用开 DSH 也能确认「签到 / 待办 / 智云课堂 / 通知」四个分区的排版。
 *
 * 用法：node test/preview-render.mjs [输出路径]
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outArg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const outPath = resolve(outArg || resolve(root, 'preview', 'panel-preview.html'));

/* ------------------------------ 1. 真实数据 ------------------------------ */
let summary = null;
let dataSource = '实时（真实账号）';
const cachePath = resolve(root, 'preview', 'summary.json');

/** 10 分钟内的快照直接复用：避免反复登录把 ZJUAM 风向控。 */
function readCache() {
  try {
    const stat = statSync(cachePath);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
    if (ageMinutes > 10) return null;
    return { data: JSON.parse(readFileSync(cachePath, 'utf8')), ageMinutes };
  } catch {
    return null;
  }
}

/* 旧缓存没有虚拟位置字段：补一份示例，保证预览能看到签到地点信息块。 */
const sampleLocations = [
  { id: 'zjg-dong1', name: '东一教学楼', campus: '紫金港', lon: 120.089136, lat: 30.302331, source: 'preset', isDefault: true },
  { id: 'zjg-xi', name: '西教学楼', campus: '紫金港', lon: 120.085042, lat: 30.30173, source: 'preset', isDefault: false },
  { id: 'yq-jiao4', name: '玉泉教四', campus: '玉泉', lon: 120.122176, lat: 30.261555, source: 'preset', isDefault: false },
];

const cached = readCache();
const forceDemo = process.argv.includes('--demo');
if (forceDemo) {
  summary = null;
  dataSource = '示例数据（--demo）';
} else if (cached) {
  summary = cached.data;
  dataSource = `缓存快照（${cached.ageMinutes.toFixed(0)} 分钟前）`;
} else {
  try {
    const { ZjuSession } = await import('../src/session.js');
    const { buildSummary } = await import('../src/panel.js');
    const settings = {
      username: '',
      password: '',
      envFile: '',
      tenantId: '112',
      sessionTtlMs: 15 * 60 * 1000,
      requestTimeoutMs: 25000,
      allowWriteOps: false,
      noticeSources: ['qsxy', 'bksy', 'sis', 'opt'],
    };
    summary = await buildSummary(new ZjuSession(settings), settings);
    if (!summary.errors?.length) {
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(summary, null, 2), 'utf8');
    }
  } catch (error) {
    console.warn('实时数据失败，改用示例数据：', error.message);
    dataSource = '示例数据（拉真实数据失败）';
    summary = fallbackSummary();
  }
}

/* --demo：示例数据（fallbackSummary 是函数声明，已提升）。 */
if (forceDemo) summary = fallbackSummary();

/* 旧快照没有 week：补一份单天结构，保证预览仍能看到日期条。 */
if (!summary.week || !Array.isArray(summary.week.days) || summary.week.days.length === 0) {
  const day = summary.date || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const lessons = (summary.lessons || []).map((lesson) => ({ ...lesson, date: lesson.date || day }));
  summary.week = {
    start: day,
    end: day,
    days: [{ date: day, weekday: '', isToday: true, count: lessons.length, lessons }],
  };
}

/* 可选：--with-rollcall 造一条“正在签到”，用来看签到区的告警排版（仅预览用）。 */
const withRollcall = process.argv.includes('--with-rollcall');
if (withRollcall) {
  summary.rollcalls = [
    {
      id: 90001,
      type: '雷达点名',
      courseTitle: '示例课程B',
      teacher: '王老师',
      startedAt: '2026-10-28 17:20',
      url: 'https://courses.zju.edu.cn/course/12302/learning-activity',
      active: true,
    },
  ];
  dataSource += ' · 含示例签到';
}

/* 旧缓存没有虚拟位置字段：补一份示例，保证预览能看到签到地点信息块。 */
if (!summary.rollcallLocations) {
  summary.rollcallLocations = {
    default: { id: 'zjg-dong1', name: '东一教学楼', campus: '紫金港', lon: 120.089136, lat: 30.302331 },
    count: 12,
    customCount: 0,
    presetCount: 12,
    locations: sampleLocations,
  };
} else if (withRollcall && !summary.rollcallLocations.default) {
  summary.rollcallLocations = {
    ...summary.rollcallLocations,
    default: { id: 'zjg-dong1', name: '东一教学楼', campus: '紫金港', lon: 120.089136, lat: 30.302331 },
    locations: sampleLocations,
  };
}
if (!summary.rollcallSign) {
  summary.rollcallSign = { enabled: true, source: 'panel', error: null };
}

function sampleWeek() {
  const mk = (date, weekday, isToday, lessons) => ({ date, weekday, isToday, count: lessons.length, lessons });
  const lesson = (subId, title, teacher, room, date, time, hasTranscript) => ({
    subId,
    title,
    teacher,
    room,
    date,
    time,
    hasTranscript,
    statusLabel: '回放',
    url: `https://classroom.zju.edu.cn/livingroom?course_id=12301&sub_id=${subId}&tenant_code=112`,
  });
  return {
    start: '2026-10-22',
    end: '2026-10-28',
    days: [
      mk('2026-10-22', '周四', false, []),
      mk('2026-10-23', '周五', false, [lesson(1234501, '示例课程A', '张老师', '东1-A101', '2026-10-23', '07:56-09:35', true)]),
      mk('2026-10-24', '周六', false, []),
      mk('2026-10-25', '周日', false, []),
      mk('2026-10-26', '周一', false, [lesson(1234502, '示例课程A', '张老师', '东1-A101', '2026-10-26', '13:50-15:25', true)]),
      mk('2026-10-27', '周二', false, [lesson(1234505, '示例课程B', '李老师', '西2-204', '2026-10-27', '07:56-09:35', true)]),
      mk('2026-10-28', '周三', true, [lesson(1234504, '示例课程A', '张老师', '东1-A101', '2026-10-28', '07:56-09:35', true)]),
    ],
  };
}

function fallbackSummary() {
  return {
    configured: true,
    account: '320***01',
    date: '2026-10-28',
    week: sampleWeek(),
    todos: [
      {
        id: 910002,
        title: 'HW11',
        type: '作业',
        courseName: '示例课程C',
        deadline: '2026-10-29',
        deadlineAt: '2026-10-29 11:35',
        endTime: null,
        submissionUrl: 'https://courses.zju.edu.cn/course/12301/learning-activity#/910002',
      },
    ],
    rollcalls: [],
    rollcallSign: { enabled: true, source: 'panel', error: null },
    rollcallLocations: {
      default: { id: 'zjg-dong1', name: '东一教学楼', campus: '紫金港', lon: 120.089136, lat: 30.302331 },
      count: 12,
      customCount: 0,
      presetCount: 12,
      locations: sampleLocations,
    },
    lessons: [
      {
        subId: 1234504,
        title: '示例课程A',
        teacher: '张老师',
        room: '东1-A101',
        date: '2026-10-28',
        time: '07:56-09:35',
        hasTranscript: true,
        statusLabel: '回放',
        url: 'https://classroom.zju.edu.cn/livingroom?course_id=12301&sub_id=1234504&tenant_code=112',
      },
    ],
    notices: [{ title: '示例通知', source: '外国语学院', date: '2026-10-28', url: 'https://example.zju.edu.cn/' }],
    notes: {
      count: 2,
      subIds: ['1234504'],
      dir: 'C:/Users/<你>/.dsh/zju-campus/notes',
      latest: { subId: '1234504', title: '示例课程A', course: '示例课程A', date: '2026-10-28', exists: true },
      obsidian: { enabled: true, vault: 'D:/Obsidian/Vault', folder: '智云课堂', source: 'settings' },
    },
    errors: [],
    independentSites: [],
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------ 2. 渲染 vnode ------------------------------ */
const source = readFileSync(resolve(root, 'client.js'), 'utf8');

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [
    initial && typeof initial === 'object' && 'status' in initial
      ? { status: 'ready', data: summary, error: null }
      : initial,
    () => {},
  ],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
};

let factoryResult = null;
const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load({ id, factory }) {
        factoryResult = { id, result: factory((name) => (name === 'react' ? ReactStub : {})) };
      },
    },
  },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  fetch: async () => ({ ok: true, json: async () => summary }),
  URL,
  Date,
  Math,
  JSON,
  Number,
  String,
  Object,
  Array,
  Promise,
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

const mod = factoryResult?.result;
if (!mod || typeof mod.apply !== 'function') throw new Error('client.js 没有导出 apply');

/* ------------------------------ 3. vnode → HTML ------------------------------ */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeText = (value) => String(value).replace(/[&<>"]/g, (ch) => ESCAPES[ch]);

const UNITLESS = new Set(['fontWeight', 'opacity', 'zIndex', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order']);
const cssName = (key) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
const cssValue = (key, value) => {
  if (typeof value === 'number' && !UNITLESS.has(key)) return `${value}px`;
  return String(value);
};
const styleText = (style) =>
  !style
    ? ''
    : Object.entries(style)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${cssName(key)}:${cssValue(key, value)}`)
        .join(';');

/** 把组件树摊平成可序列化的 HTML。 */
function toHtml(node) {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map(toHtml).join('');
  if (typeof node === 'string' || typeof node === 'number') return escapeText(node);
  if (typeof node !== 'object') return '';
  const { type, props: rawProps, children = [] } = node;
  const props = rawProps || {};
  if (typeof type === 'function') {
    const out = type({ ...props, children });
    return toHtml(out);
  }
  const tag = String(type);
  const attrs = [];
  const style = styleText(props.style);
  if (style) attrs.push(`style="${style}"`);
  for (const key of ['href', 'title', 'target', 'rel', 'role', 'type', 'disabled', 'aria-hidden', 'width', 'height', 'viewBox', 'fill']) {
    const value = props[key];
    if (value === undefined || value === null || value === false) continue;
    attrs.push(`${key}="${escapeText(value === true ? '' : value)}"`);
  }
  if (typeof props.onClick === 'function') attrs.push('data-clickable="1"');
  const inner = toHtml(children);
  const VOID = new Set(['img', 'br', 'hr', 'input']);
  if (VOID.has(tag)) return `<${tag} ${attrs.join(' ')}>`;
  return `<${tag} ${attrs.join(' ')}>${inner}</${tag}>`;
}

const registration = [];
const ctx = {
  locale: { register: () => () => {} },
  slots: {
    inject: (name, callback) => callback(),
    register: (options, component) => {
      registration.push({ name: options.name, key: options.key, component });
      return () => {};
    },
  },
  effect: (callback) => callback(),
};
mod.apply(ctx);
const main = registration.find((item) => item.name === 'main');
if (!main) throw new Error('没有注册 main 插槽');

const drawerHtml = toHtml(main.component({ mode: 'drawer' }));
const pageHtml = toHtml(main.component({}));

/* ------------------------------ 4. 拼页面 ------------------------------ */
const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
const count = (list) => (Array.isArray(list) ? list.length : 0);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>浙大校园助手 · 面板预览</title>
<style>
  :root {
    color-scheme: light dark;
    --dsw-alias-label-primary: #1f2329;
    --dsw-alias-label-secondary: #4e5969;
    --dsw-alias-label-tertiary: #86909c;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #f7f8fa;
    --dsw-alias-border-l2: #e5e6eb;
    --dsw-alias-brand-primary: #1664ff;
    --dsw-alias-brand-tertiary: #e8f3ff;
    --dsw-alias-danger-primary: #f53f3f;
    --dsw-alias-state-error-secondary: #ffece8;
    --dsw-alias-state-warn-primary: #ff7d00;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  body { margin: 0; padding: 28px; background: #eef0f4; }
  h1 { font-size: 16px; margin: 0 0 6px; }
  .sub { font-size: 12px; color: #6b7280; margin-bottom: 20px; line-height: 1.7; }
  .wrap { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
  .col > .cap { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
  .frame { background: #fff; border-radius: 12px; box-shadow: 0 6px 22px rgba(15, 23, 42, .10); overflow: hidden; }
  .drawer { width: 380px; height: 760px; overflow: auto; }
  .page { width: 720px; height: 760px; overflow: auto; }
  a { color: inherit; }
  [data-clickable="1"] { cursor: pointer; }
</style>
</head>
<body>
  <h1>浙大校园助手 · 面板静态预览</h1>
  <div class="sub">
    数据来源：${dataSource} ｜ 生成时间：${stamp}<br>
    签到 ${count(summary.rollcalls)} 条 · 待办 ${count(summary.todos)} 条 · 今日课 ${count(summary.lessons)} 节 · 近 7 天 ${count(summary.week?.days?.reduce((all, d) => all.concat(d.lessons || []), []))} 节 · 通知 ${count(summary.notices)} 条<br>
    分区顺序：签到 → 待办 → 智云课堂 → 最新通知 → 独立站点。智云课堂分区含「近 7 天」日期条，选中日期后该天的课次都可拉转录/笔记；标题右侧四个胶囊依次对应
    <b>zju_schedule / zju_playback / zju_transcript / zju_notes</b>。
  </div>
  <div class="wrap">
    <div class="col">
      <div class="cap">会话右侧抽屉（约 380px·mode=drawer）</div>
      <div class="frame drawer">${drawerHtml}</div>
    </div>
    <div class="col">
      <div class="cap">左侧全屏页（宽度自适应）</div>
      <div class="frame page">${pageHtml}</div>
    </div>
  </div>
</body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`已生成预览：${outPath}`);

/* ------------------------------ 5. 智云课堂分区特写 ------------------------------ */
// 只留「签到 + 智云课堂」两个分区，方便一屏看清四个入口的排版。
const fullSummary = summary;
summary = { ...summary, todos: [], notices: [], independentSites: [] };
const focusHtml = toHtml(main.component({ mode: 'drawer' }));
summary = fullSummary;

const focusPath = resolve(dirname(outPath), withRollcall ? 'cmc-focus-active.html' : 'cmc-focus.html');
writeFileSync(
  focusPath,
  `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>智云课堂分区</title>
<style>
  :root {
    --dsw-alias-label-primary: #1f2329;
    --dsw-alias-label-secondary: #4e5969;
    --dsw-alias-label-tertiary: #86909c;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #f7f8fa;
    --dsw-alias-border-l2: #e5e6eb;
    --dsw-alias-brand-primary: #1664ff;
    --dsw-alias-brand-tertiary: #e8f3ff;
    --dsw-alias-danger-primary: #f53f3f;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  body { margin: 0; padding: 16px; background: #eef0f4; }
  .frame { width: 396px; background: #fff; border-radius: 12px; box-shadow: 0 6px 22px rgba(15,23,42,.10); overflow: hidden; }
  a { color: inherit; }
  [data-clickable="1"] { cursor: pointer; }
</style></head>
<body><div class="frame">${focusHtml}</div></body></html>
`,
  'utf8',
);
console.log(`已生成分区特写：${focusPath}`);
console.log(`数据：签到 ${count(fullSummary.rollcalls)} / 待办 ${count(fullSummary.todos)} / 课 ${count(fullSummary.lessons)} / 通知 ${count(fullSummary.notices)}（${dataSource}）`);

