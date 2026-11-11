/**
 * Public-front-end inspection only. No credential IO, login submissions, writes,
 * browser storage, disk cookie jar, or guessed student endpoints.
 */
export const CAMPUS_SITES = Object.freeze({
  labCourse: Object.freeze({
    id: 'labCourse', name: '浙江大学实验选课系统',
    origin: 'http://10.203.16.55:86', loginPath: '/lab-course/login',
  }),
  engineering: Object.freeze({
    id: 'engineering', name: '浙江大学工程训练中心办公自动化系统',
    origin: 'http://10.71.32.157', loginPath: '/Login.aspx',
  }),
});
export const INSECURE_HTTP_WARNING = '这两个校园站点使用明文 HTTP，账号、密码和会话可能被网络监听或篡改。仅在可信校园网络中使用；必须显式确认风险。本适配器不会提交登录。';
const ALLOWED_ORIGINS = new Set(Object.values(CAMPUS_SITES).map(s => s.origin));

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}
function siteById(id) {
  const site = Object.hasOwn(CAMPUS_SITES, id) ? CAMPUS_SITES[id] : null;
  if (!site) throw failure('UNKNOWN_SITE', '只支持两个明确授权的校园站点。');
  return site;
}
export function assertCampusSiteUrl(value, siteId) {
  let url;
  try { url = new URL(value); } catch { throw failure('INVALID_URL', '校园站点地址无效。'); }
  if (url.username || url.password || !ALLOWED_ORIGINS.has(url.origin)) {
    throw failure('ORIGIN_NOT_ALLOWED', '拒绝未授权站点或含凭据的地址。');
  }
  if (siteId && url.origin !== siteById(siteId).origin) {
    throw failure('CROSS_ORIGIN_REDIRECT', '拒绝跨站重定向，即使目标是另一授权站点。');
  }
  return url;
}

/** Evidence is static front-end source, NOT a successful authentication trace. */
export function getCampusLoginProtocol(siteId) {
  siteById(siteId);
  if (siteId === 'engineering') return {
    siteId, evidence: 'public-login-html', liveAuthenticationVerified: false,
    method: 'POST', url: 'http://10.71.32.157/ajax/ajax_do_login.ashx',
    contentType: 'application/x-www-form-urlencoded',
    fields: ['userId', 'password', 'act'], fixedStudentFields: { act: '1' },
    responseFields: ['status', 'target_url', 'message'],
    sessionCookieNamesObserved: ['AspxAutoDetectCookieSupport', 'ASP.NET_SessionId'],
    scheduleVerified: false, homeworkVerified: false,
    warning: INSECURE_HTTP_WARNING,
  };
  return {
    siteId, evidence: 'public-compiled-frontend', liveAuthenticationVerified: false,
    method: 'POST', apiPath: '/api/login',
    backendOriginAuthorized: false,
    blocker: '公开前端指向不同端口的后端；该 origin 未获授权，禁止请求。',
    contentType: 'application/x-www-form-urlencoded',
    fields: ['username', 'password', 'app_key', 'timestamp', 'sign'],
    responseFields: ['code', 'message', 'data.token.access_token', 'data.token.token_type', 'data.roles', 'data.menus', 'data.username', 'data.name', 'data.gender', 'data.phone', 'data.role'],
    successCode: 200, unauthorizedCodes: [401, 408],
    scheduleVerified: false, scheduleFrontendEvidence: true, homeworkVerified: false,
    warning: INSECURE_HTTP_WARNING,
  };
}

/** Pure classifier: never returns server messages, target URLs, tokens or raw JSON. */
export function summarizeCampusLoginResponse(siteId, payload) {
  siteById(siteId);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { siteId, state: 'unknown' };
  }
  if (siteId === 'engineering') {
    // Frontend uses JS truthiness; do not claim authentication for an undocumented type.
    if (payload.status !== true && payload.status !== false) return { siteId, state: 'unknown' };
    let targetAllowed = false;
    if (typeof payload.target_url === 'string') {
      try {
        assertCampusSiteUrl(new URL(payload.target_url, CAMPUS_SITES.engineering.origin).href, siteId);
        targetAllowed = true;
      } catch { /* Never expose the untrusted redirect. */ }
    }
    return { siteId, state: payload.status ? 'success-indicated' : 'rejected', targetAllowed };
  }
  if (payload.code !== 200) return {
    siteId, state: [401, 408].includes(payload.code) ? 'unauthorized' : 'unknown',
  };
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  return {
    siteId, state: 'success-indicated',
    hasAccessToken: typeof data.token?.access_token === 'string' && data.token.access_token.length > 0,
    hasTokenType: typeof data.token?.token_type === 'string' && data.token.token_type.length > 0,
    roleSelectionRequired: Array.isArray(data.roles) && data.roles.length > 1,
  };
}

async function readBoundedText(response, limit) {
  if (!response.body?.getReader) throw failure('INVALID_RESPONSE', '公开页面响应不可读取。');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw failure('RESPONSE_TOO_LARGE', '公开页面响应超出安全限制。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Fetch injection supports credential-free tests; default fetch never sends stored cookies. */
export function createCampusSitesAdapter({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof fetchImpl !== 'function') throw failure('FETCH_REQUIRED', '需要可用的 HTTP 请求实现。');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) {
    throw failure('INVALID_TIMEOUT', '超时必须在 1–60000 毫秒内。');
  }
  return Object.freeze({
    getLoginProtocol: getCampusLoginProtocol,
    async probePublicLogin(siteId, { allowInsecureHttp = false } = {}) {
      const site = siteById(siteId);
      if (allowInsecureHttp !== true) throw failure('INSECURE_HTTP_CONFIRMATION_REQUIRED', INSECURE_HTTP_WARNING);
      let url = new URL(site.loginPath, site.origin);
      // Scoped to this call only. No cookies ever returned, persisted or logged.
      const cookies = new Map();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        for (let step = 0; step < 5; step++) {
          assertCampusSiteUrl(url.href, siteId);
          if (url.pathname !== site.loginPath || [...url.searchParams.keys()].some(k => k !== 'AspxAutoDetectCookieSupport')) {
            throw failure('UNVERIFIED_REDIRECT_PATH', '拒绝跳转到未验证的公开路径。');
          }
          let response;
          try {
            response = await fetchImpl(url.href, {
              method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
              headers: cookies.size ? { Cookie: [...cookies.values()].join('; ') } : {},
            });
          } catch { throw failure('NETWORK_ERROR', '校园站点不可达或请求超时；未输出底层响应。'); }
          if (response.url) assertCampusSiteUrl(response.url, siteId);
          if (response.redirected) throw failure('AUTOMATIC_REDIRECT_REFUSED', '请求实现违反手动跳转策略。');
          for (const entry of response.headers.getSetCookie?.() || []) {
            const pair = entry.split(';', 1)[0];
            const equals = pair.indexOf('=');
            const name = pair.slice(0, equals);
            if (equals > 0 && ['AspxAutoDetectCookieSupport', 'ASP.NET_SessionId'].includes(name) && !/[\r\n]/.test(pair)) {
              cookies.set(name, pair);
            }
          }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw failure('INVALID_REDIRECT', '跳转响应缺少目标。');
            url = assertCampusSiteUrl(new URL(location, url).href, siteId);
            await response.body?.cancel();
            continue;
          }
          if (response.status !== 200) throw failure('HTTP_ERROR', '公开登录页面未返回成功状态。');
          const html = await readBoundedText(response, 256 * 1024);
          const recognized = siteId === 'engineering'
            ? html.includes('stu_userId') && html.includes('ajax/ajax_do_login.ashx')
            : html.includes('id=myApp') && html.includes('/lab-course/static/js/app.');
          return { siteId, reachable: true, recognized, httpStatus: 200, insecureHttp: true,
            authenticationAttempted: false, scheduleVerified: false, homeworkVerified: false };
        }
        throw failure('TOO_MANY_REDIRECTS', '公开登录页面跳转次数超出限制。');
      } finally { clearTimeout(timer); cookies.clear(); }
    },
    async readStudentSchedule(siteId) {
      siteById(siteId);
      throw failure('STUDENT_API_NOT_VERIFIED', siteId === 'labCourse'
        ? '课表接口仅有前端证据，其实际后端 origin 未授权；未发起请求。'
        : '尚无已验证的学生课表或作业接口；未发起请求。');
    },
  });
}
