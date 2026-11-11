/** 大物实验独立账号只读客户端。仅登录POST，其余接口固定GET；不保存会话。 */
import { createHash } from 'node:crypto';
import { resolveIndependentAccount } from './independent-accounts.js';

export const PHYSICS_LAB_BACKEND = 'http://10.203.16.55:8098/lab-course';
export const PHYSICS_LAB_FRONTEND = 'http://10.203.16.55:86/lab-course/login';
// 来自公开前端 NHnr 模块；P() 是 Base64 -> Hex（不是 UTF-8）。
const SIGNING_KEY = Buffer.from(['fNR', '2q4Z', 'rSde', 'peIr', 'Z9H', 'iUlQ', '=', '='].join(''), 'base64').toString('hex');
const APP_KEY = Buffer.from(['==wn', 'D0g6', '6qYL7', 'qDSn3', 'ZOox4', '6'].join('').split('').reverse().join(''), 'base64').toString('hex');
const READ_PATHS = new Set(['/api/terms', '/api/courses/uid', '/api/course/lab/students/full', '/api/courseLabTimes/date', '/api/course/wares', '/api/course/wares/export']);

/** 不包含响应正文、URL查询、凭据或身份信息的安全异常。 */
export class PhysicsLabError extends Error {
  constructor(code) {
    super(`大物实验只读客户端：${code}`);
    this.name = 'PhysicsLabError';
    this.code = code;
  }
}
const fail = code => { throw new PhysicsLabError(code); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value));

function signedFields(path, data) {
  // 对齐 Date.parse(new Date)：毫秒单位，但前端精度为整秒。
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  let source = SIGNING_KEY + path;
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value !== '' && value !== null && value !== undefined && typeof value !== 'object') source += key + value;
  }
  const sign = createHash('md5').update(source + timestamp + ' ' + SIGNING_KEY).digest('hex');
  return { app_key: APP_KEY, timestamp, sign, ...data };
}

export class PhysicsLabClient {
  #authorization = '';
  #uid = '';
  #timeoutMs;
  #fetch;
  #loginAttempted = false;

  constructor({ allowInsecureHttp = false, timeoutMs = 20000, fetchImpl = globalThis.fetch } = {}) {
    // 必须显式传本轮授权，不能意外因环境变量开启明文凭据传输。
    if (allowInsecureHttp !== true) fail('INSECURE_HTTP_NOT_AUTHORIZED');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) fail('INVALID_TIMEOUT');
    if (typeof fetchImpl !== 'function') fail('FETCH_UNAVAILABLE');
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  /** 默认只读取 physicsLab 的独立账号，绝不回退到统一认证账号。 */
  static async login(options = {}) {
    const client = new PhysicsLabClient(options);
    await client.login();
    return client;
  }

  /** 同一客户端最多尝试登录一次，包括失败；不会自动重试或切换角色。 */
  async login() {
    if (this.#loginAttempted) fail('LOGIN_ALREADY_ATTEMPTED');
    this.#loginAttempted = true;
    const account = resolveIndependentAccount('physicsLab');
    if (!account) fail('ACCOUNT_NOT_CONFIGURED');
    const username = account.username.trim();
    const password = account.password.trim();
    if (!username || !password) fail('ACCOUNT_NOT_CONFIGURED');
    const data = await this.#request('/api/login', { username, password }, true);
    if (!isObject(data)) fail('INVALID_LOGIN_RESPONSE');
    if (Array.isArray(data.roles) && data.roles.length > 1) fail('MULTIPLE_ROLES_REQUIRE_SELECTION');
    const token = data.token;
    if (!isObject(token) || typeof token.access_token !== 'string' || !token.access_token ||
        typeof token.token_type !== 'string' || !token.token_type ||
        /[\r\n]/.test(token.access_token + token.token_type)) fail('INVALID_LOGIN_TOKEN');
    this.#uid = typeof data.username === 'string' && data.username ? data.username : username;
    this.#authorization = token.token_type + ' ' + token.access_token;
    return this;
  }

  /** 组装签名 GET 地址（不发起请求）。 */
  #signedUrl(path, data = {}) {
    if (!READ_PATHS.has(path)) fail('ENDPOINT_NOT_ALLOWED');
    const url = new URL(PHYSICS_LAB_BACKEND + path);
    if (url.origin !== 'http://10.203.16.55:8098' || url.pathname !== '/lab-course' + path) fail('ENDPOINT_NOT_ALLOWED');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(signedFields(path, data))) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    url.search = params.toString();
    return url;
  }

  /** 下载二进制（课件），返回字节与响应类型。 */
  async #binary(path, data = {}) {
    if (!this.#authorization) fail('NOT_AUTHENTICATED');
    const url = this.#signedUrl(path, data);
    let response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: { Authorization: this.#authorization, Accept: '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(this.#timeoutMs, 60000)),
      });
    } catch (error) {
      fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
    if (response.status >= 300 && response.status < 400) fail('REDIRECT_BLOCKED');
    if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'AUTHORIZATION_FAILED' : 'HTTP_ERROR');
    const type = String(response.headers.get('content-type') || '');
    if (/application\/json/i.test(type)) {
      // 后端错误时返回 JSON 信封，不当成文件保存。
      const text = await response.text();
      if (text.length > 8192) fail('RESPONSE_TOO_LARGE');
      fail('DOWNLOAD_REJECTED');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) fail('EMPTY_DOWNLOAD');
    if (buffer.length > 200 * 1024 * 1024) fail('RESPONSE_TOO_LARGE');
    return { buffer, contentType: type };
  }

  async #request(path, data = {}, login = false) {
    // URL 和方法不接受调用方输入，既禁止跨源也禁止任何写端点。
    if (login ? path !== '/api/login' : !READ_PATHS.has(path)) fail('ENDPOINT_NOT_ALLOWED');
    if (!login && !this.#authorization) fail('NOT_AUTHENTICATED');
    const url = new URL(PHYSICS_LAB_BACKEND + path);
    if (url.origin !== 'http://10.203.16.55:8098' || url.pathname !== '/lab-course' + path) fail('ENDPOINT_NOT_ALLOWED');
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(signedFields(path, data))) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const headers = { Accept: 'application/json' };
    if (!login) headers.Authorization = this.#authorization;
    const init = { method: login ? 'POST' : 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(this.#timeoutMs) };
    if (login) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      init.body = params.toString();
    } else url.search = params.toString();
    let response;
    let body;
    try {
      response = await this.#fetch(url, init);
      if (response.status >= 300 && response.status < 400) fail('REDIRECT_BLOCKED');
      if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'AUTHORIZATION_FAILED' : 'HTTP_ERROR');
      body = await response.text();
    } catch (error) {
      if (error instanceof PhysicsLabError) throw error;
      fail(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
    if (body.length > 8 * 1024 * 1024) fail('RESPONSE_TOO_LARGE');
    let envelope;
    try { envelope = JSON.parse(body); } catch { fail('NON_JSON_RESPONSE'); }
    if (!isObject(envelope)) fail('INVALID_RESPONSE');
    if (envelope.code !== 200) {
      if (login) fail('LOGIN_REJECTED');
      fail(envelope.code === 401 || envelope.code === 408 ? 'SESSION_EXPIRED' : 'API_ERROR');
    }
    return envelope.data;
  }

  /** 仅返回学期字段，不透传后端对象。 */
  async terms() {
    const data = await this.#request('/api/terms');
    if (!isObject(data) || !Array.isArray(data.content)) fail('INVALID_TERMS_RESPONSE');
    return data.content.map(term => {
      if (!isObject(term) || !validId(term.id)) fail('INVALID_TERM');
      return { id: term.id, name: term.name || '', currentTerm: term.currentTerm };
    });
  }

  async courses(termId) {
    if (!validId(termId)) fail('INVALID_TERM_ID');
    const data = await this.#request('/api/courses/uid', { page: -1, size: -1, termId, uid: this.#uid });
    if (!Array.isArray(data)) fail('INVALID_COURSES_RESPONSE');
    return data.map(course => {
      if (!isObject(course) || !validId(course.id)) fail('INVALID_COURSE');
      return { id: course.id, courseName: course.courseName || '' };
    });
  }

  async lessons(termId, courseId) {
    if (!validId(termId) || !validId(courseId)) fail('INVALID_COURSE_OR_TERM_ID');
    const data = await this.#request('/api/course/lab/students/full', { termId, uid: this.#uid, courseId, page: -1, size: -1 });
    if (!isObject(data) || !Array.isArray(data.content)) fail('INVALID_LESSONS_RESPONSE');
    const dates = await this.#request('/api/courseLabTimes/date', { courseId });
    if (!isObject(dates)) fail('INVALID_DATES_RESPONSE');
    const fields = ['id', 'lab_name', 'address', 'counts', 'contain', 'select_week', 'times', 'teacher_id', 'teacher_name', 'choose_date', 'is_must'];
    return data.content.map(item => {
      if (!isObject(item) || !validId(item.id)) fail('INVALID_LESSON');
      const lesson = {};
      for (const field of fields) lesson[field] = item[field] ?? null;
      lesson.date = String(dates[item.id + '_' + item.select_week] ?? '').trim().split(/\s*\n\s*/).filter(Boolean).join('、');
      return lesson;
    });
  }

  /** 当前学期全部已选课程课表；无当前学期时明确报错而非猜测。 */
  async schedule({ termId } = {}) {
    const terms = await this.terms();
    const term = termId === undefined
      ? terms.find(item => String(item.currentTerm) === '1')
      : terms.find(item => String(item.id) === String(termId));
    if (!term) fail(termId === undefined ? 'CURRENT_TERM_NOT_FOUND' : 'TERM_NOT_FOUND');
    const courses = await this.courses(term.id);
    const result = [];
    for (const course of courses) result.push({ ...course, lessons: await this.lessons(term.id, course.id) });
    const lessons = result.flatMap(course => course.lessons.map(lesson => ({
      title: lesson.lab_name || course.courseName,
      date: lesson.date,
      time: lesson.times,
      teacher: lesson.teacher_name,
      room: lesson.address,
      url: 'http://10.203.16.55:86/lab-course/studentCourse',
    })));
    return { term, courses: result, lessons, warnings: [] };
  }

  /**
   * 某次实验的课件（指导书、演示文稿等）。
   * @param {string|number} courseLabId 实验 id（schedule() 里 lesson.id / course.lessons[].id）
   */
  async materials(courseLabId) {
    if (!validId(courseLabId)) fail('INVALID_COURSE_LAB_ID');
    const data = await this.#request('/api/course/wares', { courseLabId });
    const list = isObject(data) && Array.isArray(data.content) ? data.content : Array.isArray(data) ? data : null;
    if (!list) fail('INVALID_WARES_RESPONSE');
    return list.map((item) => {
      if (!isObject(item) || !validId(item.id)) fail('INVALID_WARE');
      const originalName = typeof item.fileOrginName === 'string' ? item.fileOrginName.trim() : '';
      // 扩展名在前端是取 url 最后一段的点后缀（fileOrginName 往往不带后缀）。
      const urlExt = typeof item.url === 'string' ? (item.url.split('.').pop() || '').toLowerCase() : '';
      const ext = /^[a-z0-9]{1,8}$/.test(urlExt) ? urlExt : '';
      const name = originalName || `课件-${item.id}`;
      const fullName = ext && !new RegExp(`\\.${ext}$`, 'i').test(name) ? `${name}.${ext}` : name;
      return {
        id: item.id,
        name: fullName,
        baseName: name,
        description: typeof item.content === 'string' ? item.content.slice(0, 200) : '',
        downloadTimes: Number.isFinite(item.downloadTimes) ? item.downloadTimes : null,
        ext,
      };
    });
  }

  /**
   * 下载一个课件，返回字节与建议文件名。
   * @param {string|number} courseWareId 课件 id（materials() 里的 id）
   * @param {string} [fallbackName] 用于推断扩展名的原始文件名
   */
  async downloadMaterial(courseWareId, fallbackName = '') {
    if (!validId(courseWareId)) fail('INVALID_WARE_ID');
    const { buffer, contentType } = await this.#binary('/api/course/wares/export', { courseWareId });
    return { buffer, contentType, suggestedName: typeof fallbackName === 'string' ? fallbackName : '' };
  }

  /** 仅清理内存，不调用后端注销或任何写接口。 */
  close() {
    this.#authorization = '';
    this.#uid = '';
  }
}

export const createPhysicsLabClient = options => PhysicsLabClient.login(options);
