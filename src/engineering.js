/**
 * 工程训练独立账号只读客户端。凭据与 Cookie 仅在内存中使用；不记录响应。
 * HTTP 必须由调用方明确传入 allowInsecureHttp:true；不依赖配置文件授权位。
 */
import { resolveIndependentAccount } from './independent-accounts.js';

export const ENGINEERING_ORIGIN = 'http://10.71.32.157';
const LOGIN = `${ENGINEERING_ORIGIN}/Login.aspx`;
const LOGIN_POST = `${ENGINEERING_ORIGIN}/ajax/ajax_do_login.ashx`;
const MUTATION = /upload|submit|delete|remove|insert|update|save|logout|logoff|selectcourse|choosecourse|changepass|选课|提交|上传|删除|保存|退课|修改|注销/i;
const TASK = /作业|实验报告|实习报告|训练报告|homework|assignment/i;
const READ_NAV = /作业|课程|报告|练习|任务|项目|实习|实训|实验|homework|assignment|course|report|exercise/i;
const KNOWN_HEADINGS = /^(序号|课程(?:名称)?|项目(?:名称)?|训练项目|实验(?:名称)?|作业(?:名称|标题)?|任务(?:名称|标题)?|报告(?:名称)?|开始时间|发布时间|截止(?:时间|日期)?|结束(?:时间|日期)?|提交状态|完成状态|状态|操作|附件|成绩|分数|教师评语|学年|学期)$/;
const ERRORS = Object.freeze({
  config: '未配置工程训练独立账号', consent: '工程训练HTTP登录需要明确授权',
  login: '工程训练登录未通过', network: '工程训练请求失败',
  unsafe: '工程训练链接不在只读同源白名单内', format: '工程训练页面结构未知',
  limit: '工程训练读取达到安全限制', expired: '工程训练会话已失效',
});

function fail(code) { const e = new Error(ERRORS[code] || ERRORS.network); e.code = code; return e; }
function decode(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (key[0] !== '#') return entities[key.toLowerCase()] || all;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
function text(value) {
  return decode(String(value).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[1] ?? m[2] ?? m[3]) : '';
}
/** 仅接受本站普通只读 ASPX 页面；拒绝动作参数、凭据、脚本及跨域。 */
function readUrl(value, base = LOGIN, { login = false, target = false } = {}) {
  let url;
  try { url = new URL(decode(value), base); } catch { throw fail('unsafe'); }
  if (url.origin !== ENGINEERING_ORIGIN || url.username || url.password || url.hash || /[\\\x00-\x20]/.test(url.pathname)) throw fail('unsafe');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw fail('unsafe'); }
  if (MUTATION.test(pathname) || /\/(?:confirm_test|exam)\.aspx$/i.test(pathname) || !/\.aspx$/i.test(pathname)) throw fail('unsafe');
  if (!login && /\/login\.aspx$/i.test(pathname)) throw fail('expired');
  for (const [key, val] of url.searchParams) {
    if (login && key === 'AspxAutoDetectCookieSupport' && val === '1') continue;
    // Unknown query semantics are not safe to execute. Numeric identifiers/paging only.
    if (!/^(id|\w+id|page|pageindex|pageno|type|term|year)$/i.test(key) || !/^\d{1,12}$/.test(val)) throw fail('unsafe');
  }
  if (!login && !target && !/(?:student|stu|homework|assignment|work|task|report|menu|default|index)/i.test(pathname)) throw fail('unsafe');
  return url.href;
}
function links(html, base) {
  const out = [];
  const safeHtml = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const add = (value, label, frame = false) => {
    if (!value || (!frame && (!READ_NAV.test(label) || MUTATION.test(label)))) return;
    try {
      const url = readUrl(value, base, { target: true });
      if (/\/TestMarkedList\.aspx$/i.test(new URL(url).pathname)) return; // Graded examination history is not a current assignment list.
      out.push({ url, kind: TASK.test(label) ? 'homework' : 'navigation' });
    } catch { /* unsafe navigation is never executed */ }
  };
  for (const m of safeHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const label = text(m[2]);
    add(attr(m[1], 'href'), label);
    // Extract only literal ASPX strings from relevant tab navigation, never eval/call JavaScript.
    if (READ_NAV.test(label) && !MUTATION.test(label)) {
      const code = `${attr(m[1], 'onclick')} ${attr(m[1], 'href')}`;
      for (const literal of code.matchAll(/["']([^"'\r\n]+\.aspx(?:\?[^"'\r\n]*)?)["']/gi)) add(literal[1], label);
    }
  }
  for (const m of safeHtml.matchAll(/<(?:i?frame)\b([^>]*)>/gi)) {
    const src = attr(m[1], 'src');
    if (!/(?:top|announcement|news|banner)/i.test(src)) add(src, '', true);
  }
  // Static navigation objects/calls: examine a bounded single line; never execute scripts.
  for (const line of html.split(/\r?\n/)) {
    if (line.length > 1500 || !READ_NAV.test(line) || MUTATION.test(line)) continue;
    if (!/(?:addTab|openTab|href|url|location|nav|menu)/i.test(line)) continue;
    for (const literal of line.matchAll(/["']([^"'\r\n]+\.aspx(?:\?[^"'\r\n]*)?)["']/gi)) add(literal[1], line);
  }
  return out.sort((a, b) => (a.kind === 'homework' ? -1 : 0) - (b.kind === 'homework' ? -1 : 0));
}

function navigationSummary(html, url) {
  const labels = new Set();
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const label = text(m[1]);
    // A closed vocabulary prevents a user's name or arbitrary row content leaking into diagnostics.
    if (READ_NAV.test(label) && label.length <= 30 && /^(?:我的|学生|课程|工程训练|课后|实习|实训|训练|实验|在线|查看|学习|个人|列表|项目|报告|作业|练习|成绩|测验|考核|管理|信息|记录|中心|综合|及|与|和|通知|安排|教学|任务|数据|查询|评教|首页|系统|帮助|返回|选课|[ -])+$/.test(label)) labels.add(label);
  }
  const base = new URL(url).pathname.split('/').pop();
  return { page: /^[A-Za-z_][A-Za-z_.-]*\.aspx$/i.test(base) ? base : 'unknown.aspx',
    linkCount: [...html.matchAll(/<a\b/gi)].length, iframeCount: [...html.matchAll(/<i?frame\b/gi)].length,
    relatedNavigationLabels: [...labels], staticAspxReferenceCount: [...html.matchAll(/["'][^"'\r\n]+\.aspx(?:\?[^"'\r\n]*)?["']/gi)].length,
    navigationTargets: [...new Set(links(html, url).map(entry => new URL(entry.url).pathname.split('/').pop()).filter(name => /^[A-Za-z_][A-Za-z_.-]*\.aspx$/i.test(name)))],
    scripts: [...html.matchAll(/<script\b([^>]*)>/gi)].map(m => attr(m[1], 'src').split('?')[0].split('/').pop()).filter(name => /^[A-Za-z_][A-Za-z0-9_.-]*\.js$/i.test(name)),
    tableCount: [...html.matchAll(/<table\b/gi)].length, rowCount: [...html.matchAll(/<tr\b/gi)].length,
    rows: [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].slice(0, 12).map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(cell => {
      const value = text(cell[1]).replace(/\s+/g, '');
      return KNOWN_HEADINGS.test(value) || /^(作业名称|报告名称|报告作业|作业|在线作业|课程名称|实习名称|考试时间|开始时间|结束时间|试卷名称|题目|报告类型|报告状态|报告|查看|进入|暂无记录|暂无数据|作业列表|报告列表|未提交|已提交|序号|全选|选择|学年|学期|编号|班级名称|班级|实习名称|实习项目|实习批次|课程|试卷|试卷类型|作业要求|作业类型|作业状态|起止时间|作业开始时间|作业结束时间|考试开始时间|考试结束时间|考试状态|作业编号|报告编号|分值|总分|得分|限时|时长|考试时长|答题时间|允许次数|已考次数|测试名称|测试时间|实习时间|备注|说明|题数|次数|类型|考核方式|作业内容)$/.test(value) ? value : value ? '[数据]' : '[空]';
    })),
    inputNames: [...html.matchAll(/<input\b([^>]*)>/gi)].map(m => attr(m[1], 'name')).filter(name => /^[A-Za-z_$][A-Za-z0-9_$-]{0,80}$/.test(name)),
    endpointReferences: [...new Set([...html.matchAll(/["']([^"'\r\n]+\.(?:ashx|aspx)(?:\?[^"'\r\n]*)?)["']/gi)].map(m => m[1].split('?')[0].split('/').pop()).filter(name => /^[A-Za-z_][A-Za-z0-9_.-]*\.(?:ashx|aspx)$/i.test(name)))],
    networkCalls: [...new Set(html.match(/axios\.(?:get|post)|\$\.(?:get|post|ajax)|fetch\(/g) || [])],
    inlineFunctions: [...new Set([...html.matchAll(/(?:function\s+|\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map(m => m[1]))].filter(name => /test|exam|ajax|api|start|begin|load|search|confirm|post|get|axios/i.test(name)),
    networkMethods: [...new Set([...html.matchAll(/(?:method|type)\s*:\s*["'](GET|POST)["']/gi)].map(m => m[1].toUpperCase()))],
    fieldVocabulary: [...new Set(text(html).match(/作业(?:名称|标题|题目)?|报告(?:名称|标题|题目)?|试卷(?:名称)?|课程(?:名称)?|截止(?:时间|日期)?|开始时间|结束时间|发布时间|考试时间|提交状态|完成状态|暂无记录|暂无数据|没有数据|无记录|暂无作业|未提交|已提交|操作|序号/g) || [])] };

}

/** No inferred deadlines: a complete explicit date is required; timezone is the campus UTC+08:00. */
export function parseEngineeringDeadline(value) {
  const normalized = String(value || '').trim();
  const m = normalized.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, yy, mm, dd, hh, mi, ss] = m;
  const y = +yy, month = +mm, d = +dd;
  if (month < 1 || month > 12 || d < 1 || d > new Date(Date.UTC(y, month, 0)).getUTCDate() || +(hh || 0) > 23 || +(mi || 0) > 59 || +(ss || 0) > 59) return null;
  const date = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  // Date-only values stay date-only. Do not invent end-of-day times.
  return hh === undefined ? date : `${date}T${hh.padStart(2, '0')}:${mi}:${(ss || '00').padStart(2, '0')}+08:00`;
}

function leafTables(html) {
  const stack = [], tables = [];
  for (const tag of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    if (!/^<\//.test(tag[0])) {
      if (stack.length) stack[stack.length - 1].nested = true;
      stack.push({ start: tag.index + tag[0].length, nested: false });
    } else if (stack.length) {
      const open = stack.pop();
      if (!open.nested) tables.push(html.slice(open.start, tag.index));
    }
  }
  return tables;
}

/** Pure conservative parser. Returns assignment fields only, never full rows or HTML. */
export function parseEngineeringHomework(html, pageUrl = LOGIN) {
  if (typeof html !== 'string' || html.length > 2_000_000) throw fail('format');
  const items = [];
  const headersSeen = new Set();
  const recognizedKinds = new Set();
  let recognizedTables = 0;
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const table of leafTables(cleaned)) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|$)/gi)];
    let columns = null;
    for (const row of rows) {
      const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr\b|$)/gi)].map(m => m[1].replace(/<\/t[dh]\s*>\s*$/i, ''));
      const names = cells.map(text);
      const headerNames = names.map(name => name.replace(/\s+/g, ''));
      for (const n of headerNames) if (KNOWN_HEADINGS.test(n)) headersSeen.add(n);
      const titleIndex = headerNames.findIndex(n => /^(课前预习名称|作业(?:名称|标题|题目)?|任务(?:名称|标题)?|报告(?:名称|题目)|试卷名称|测试名称)$/.test(n));
      if (titleIndex >= 0) {
        columns = { title: titleIndex, deadline: headerNames.findIndex(n => /^(?:(?:(?:作业|报告|考试)?截止|(?:作业|报告|考试)?结束)(时间|日期)?|有效终止日期)$/.test(n)),
          kind: headerNames[titleIndex] === '课前预习名称' ? 'preStudy' : /报告/.test(headerNames[titleIndex]) ? 'report' : 'assignment',
          course: headerNames.findIndex(n => /^(课程|项目|训练项目|实验)(名称)?$/.test(n)),
          status: headerNames.findIndex(n => /^(提交状态|完成状态|作业状态|报告状态|状态)$/.test(n)) };
        recognizedTables++;
        recognizedKinds.add(columns.kind);
        continue;
      }
      if (!columns || !names[columns.title] || cells.some(c => /\b(?:colspan|rowspan)\s*=/i.test(c))) continue;
      const title = names[columns.title];
      if (title.length > 200 || /暂无|没有|无作业|无记录/.test(title)) continue;
      let url = null;
      // The source list is a safe jump destination; never expose start/confirm-exam actions.
      try { url = readUrl(pageUrl, LOGIN, { target: true }); } catch { /* unknown source stays null */ }
      // 行内可能带 showConfirmTest(123)/startTest(123)，只取编号用于标识，绝不调用。
      const rowHtml = row[1];
      const testIdMatch = /(?:showConfirmTest|startTest|confirmTest)\s*\(\s*['"]?(\d{1,12})/i.exec(rowHtml);
      const testId = testIdMatch ? testIdMatch[1] : null;
      const rawStatus = columns.status >= 0 ? names[columns.status] : '';
      const status = /^(未提交|已提交|未完成|已完成|已截止|已批改|待批改|进行中|未开始)$/.test(rawStatus) ? rawStatus : null;
      items.push({ title, course: columns.course >= 0 ? names[columns.course].slice(0, 200) || null : null,
        deadline: columns.deadline >= 0 ? parseEngineeringDeadline(names[columns.deadline]) : null,
        status, url, entryUrl: url, testId, kind: columns.kind, source: 'engineering' });
    }
  }
  return { items, recognizedTables, recognizedKinds: [...recognizedKinds], knownHeaders: [...headersSeen], structureKnown: recognizedTables > 0 };
}

export class EngineeringClient {
  #fetch; #resolve; #allow; #timeout; #cookies = new Map(); #loginPromise; #homeworkPromise; #loggedIn = false; #pages = new Map(); #closed = false;
  #stats = { requests: 0, getRequests: 0, loginAttempts: 0, pagesRead: 0, redirects: 0, mutationRequests: 0 };
  constructor({ username, password, allowInsecureHttp = false, timeoutMs = 15000, fetchImpl = globalThis.fetch, accountResolver } = {}) {
    this.#allow = allowInsecureHttp === true;
    this.#fetch = fetchImpl;
    this.#timeout = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(30000, timeoutMs)) : 15000;
    this.#resolve = username !== undefined || password !== undefined
      ? () => username && password ? { username, password } : null
      : accountResolver || (() => resolveIndependentAccount('engineering'));
  }
  configured() { try { return !!this.#resolve(); } catch { return false; } }
  get stats() { return { ...this.#stats }; }
  close() { this.#cookies.clear(); this.#pages.clear(); this.#resolve = () => null; this.#loginPromise = null; this.#homeworkPromise = null; this.#closed = true; this.#loggedIn = false; }
  async #request(url, { body, login = false, target = false } = {}) {
    if (this.#closed) throw fail('expired');
    if (this.#stats.requests >= 18) throw fail('limit');
    let current = body === undefined ? readUrl(url, LOGIN, { login, target }) : LOGIN_POST;
    if (body !== undefined && url !== LOGIN_POST) throw fail('unsafe');
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (this.#stats.requests >= 18) throw fail('limit');
      const headers = { Accept: body === undefined ? 'text/html' : 'application/json', Referer: LOGIN };
      if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (this.#cookies.size) headers.Cookie = [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      this.#stats.requests++;
      if (body === undefined) this.#stats.getRequests++;
      let response;
      try { response = await this.#fetch(current, { method: body === undefined ? 'GET' : 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.#timeout) }); }
      catch { throw fail('network'); }
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      for (const cookie of setCookies) {
        const m = cookie.match(/^([^=;\s]+)=([^;\r\n]*)/);
        if (m && !/\bsecure\b/i.test(cookie) && !/[\r\n]/.test(m[2])) {
          // Only host-only or this exact host cookies are accepted; jar never leaves this origin.
          const domain = cookie.match(/;\s*domain=([^;]+)/i);
          if (!domain || domain[1].trim().replace(/^\./, '') === '10.71.32.157') this.#cookies.set(m[1], m[2]);
        }
      }
      if (response.status >= 300 && response.status < 400) {
        if (body !== undefined) throw fail('login'); // Never replay credentials through redirects.
        const location = response.headers.get('location');
        if (!location) throw fail('network');
        current = readUrl(location, current, { login, target });
        this.#stats.redirects++;
        continue;
      }
      if (!response.ok) throw fail('network');
      if (+(response.headers.get('content-length') || 0) > 2_000_000) throw fail('limit');
      let result;
      try {
        // Bound streaming reads as well: content-length is not trusted.
        if (response.body?.getReader) {
          const reader = response.body.getReader(); const chunks = []; let bytes = 0;
          while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
            if (bytes > 2_000_000) { await reader.cancel(); throw fail('limit'); } chunks.push(part.value); }
          const joined = new Uint8Array(bytes); let offset = 0;
          for (const part of chunks) { joined.set(part, offset); offset += part.length; }
          result = new TextDecoder('utf-8').decode(joined);
        } else { result = await response.text(); if (result.length > 2_000_000) throw fail('limit'); }
      } catch { throw fail('network'); }
      return { html: result, url: current };
    }
    throw fail('limit');
  }
  /** Attempts login once per instance; all later calls share the same promise, including failures. */
  async login() {
    if (this.#closed) throw fail('expired');
    if (this.#loginPromise) return this.#loginPromise;
    this.#loginPromise = this.#login();
    return this.#loginPromise;
  }
  async #login() {
    let account;
    try { account = this.#resolve(); } catch { throw fail('config'); }
    if (!account?.username || !account?.password) throw fail('config');
    if (!this.#allow) throw fail('consent');
    try {
      await this.#request(LOGIN, { login: true });
      this.#stats.loginAttempts++;
      const body = new URLSearchParams({ userId: account.username, password: account.password, act: '1' }).toString();
      const response = await this.#request(LOGIN_POST, { body });
      account = null;
      let result;
      try { result = JSON.parse(response.html); } catch { throw fail('login'); }
      if (![1, '1', true].includes(result?.status) || typeof result.target_url !== 'string' || !result.target_url.trim()) throw fail('login');
      const targetUrl = readUrl(result.target_url, LOGIN, { target: true });
      const page = await this.#request(targetUrl, { target: true });
      if (/<input\b[^>]*type\s*=\s*["']password["']/i.test(page.html)) throw fail('expired');
      this.#pages.set(page.url, page.html); this.#stats.pagesRead++;
      this.#loggedIn = true;
      return { authenticated: true };
    } catch (error) {
      this.#cookies.clear(); this.#pages.clear();
      throw fail(Object.hasOwn(ERRORS, error?.code) ? error.code : 'network');
    }
  }
  /** Retrieves only explicitly linked student homework/menu pages, with no detail actions. */
  async getHomework() {
    if (this.#closed) throw fail('expired');
    if (!this.#homeworkPromise) this.#homeworkPromise = this.#readHomework();
    return this.#homeworkPromise;
  }
  async getAssignments() { return this.getHomework(); }
  async #readHomework() {
    await this.login();
    if (!this.#loggedIn || this.#closed) throw fail('expired');
    try {
      const queue = [...this.#pages].flatMap(([url, html]) => links(html, url));
      const seen = new Set(this.#pages.keys());
      for (let i = 0; i < queue.length && this.#stats.pagesRead < 5; i++) {
        const entry = queue[i];
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        const page = await this.#request(entry.url, { target: true });
        if (/<input\b[^>]*type\s*=\s*["']password["']/i.test(page.html)) throw fail('expired');
        this.#pages.set(page.url, page.html); this.#stats.pagesRead++;
        queue.push(...links(page.html, page.url));
        const pending = queue.splice(i + 1);
        pending.sort((a, b) => (a.kind === 'homework' ? -1 : 0) - (b.kind === 'homework' ? -1 : 0));
        queue.push(...pending);
      }
      const parsed = [...this.#pages].map(([url, html]) => parseEngineeringHomework(html, url));
      const unique = new Map();
      // 只保留「课前预习-作业习题」两类；报告作业按要求不记录。
      const KEEP_KINDS = new Set(['preStudy', 'assignment']);
      for (const item of parsed.flatMap(p => p.items)) {
        if (!KEEP_KINDS.has(item.kind)) continue;
        unique.set(JSON.stringify(item), item);
      }
      const structureKnown = parsed.some(p => p.structureKnown);
      const warning = structureKnown ? null : '已登录，作业解析待适配；不能确认是否存在作业或截止时间';
      const items = [...unique.values()];
      const assignments = items.map(({ title, deadline, url, entryUrl, testId, status, course, kind }) => ({
        title, deadlineAt: deadline, url, entryUrl, testId, status, course, kind,
      }));
      const countsByKind = Object.fromEntries([...new Set(parsed.flatMap(p => p.recognizedKinds))].map(kind => [kind, items.filter(item => item.kind === kind).length]));
      const warnings = warning ? [warning] : [];
      if (items.some(item => item.deadline === null)) warnings.push('部分作业截止时间未知');
      if (items.some(item => item.url === null)) warnings.push('部分作业跳转链接未知或不符合只读白名单');
      if (queue.some(entry => !seen.has(entry.url))) warnings.push('已达到页面读取限制，作业列表可能不完整');
      return { source: 'engineering', configured: true, authenticated: true, items, assignments,
        structureKnown, warning, warnings,
        diagnostics: { countsByKind, navigation: [...this.#pages].map(([url, html]) => navigationSummary(html, url)), knownHeaders: [...new Set(parsed.flatMap(p => p.knownHeaders))],
          homeworkLinks: queue.filter(q => q.kind === 'homework').length, recognizedTables: parsed.reduce((n, p) => n + p.recognizedTables, 0) },
        stats: this.stats };
    } catch (error) { throw fail(Object.hasOwn(ERRORS, error?.code) ? error.code : 'network'); }
  }
}

/** Cached-client integration: factory options accept independent username/password or resolve the private account file. */
export function createEngineeringClient(options = {}) { return new EngineeringClient(options); }

/** One-shot API; clears all session material before returning. */
export async function getEngineeringHomework(options = {}) {
  const client = new EngineeringClient(options);
  if (!client.configured()) { client.close(); return { source: 'engineering', configured: false, authenticated: false, structureKnown: false, items: [], assignments: [], warnings: [ERRORS.config], warning: ERRORS.config, stats: client.stats }; }
  try { return await client.getHomework(); }
  catch (error) { const message = ERRORS[error?.code] || ERRORS.network; return { source: 'engineering', configured: true, authenticated: false, structureKnown: false, items: [], assignments: [], warnings: [message], error: message, stats: client.stats }; }
  finally { client.close(); }
}
