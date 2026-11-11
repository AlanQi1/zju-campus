/**
 * 会话管理与凭据解析。
 *
 * 凭据来源（按优先级）：
 *   1. 插件 config 里的 username / password（不推荐，会留在 profile 补丁文件里）
 *   2. 进程环境变量 ZJU_USER / ZJU_PASS
 *   3. $DSH_HOME/.env（默认 C:\Users\<你>\.dsh\.env），只读解析 ZJU_USER / ZJU_PASS
 *
 * 密码只在登录那一刻进入内存，不落盘、不写日志、不进工具输出。
 * Cookie 只保存在内存，进程退出即失效。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { casLogin } from './zjuam.js';
import { COURSES, CoursesClient } from './courses.js';
import { CmcClient } from './cmc.js';

/** 解析一个 .env 文件里的 KEY=VALUE。 */
export function parseEnvFile(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return out;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** DSH 主目录。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/**
 * 插件私有的凭据文件。
 *
 * 刻意不放在 `$DSH_HOME/.env`：DSH 会把那个文件里的变量注入到子进程环境，
 * 而它的过滤规则只认名字里含 KEY/PASSWORD/SECRET/TOKEN 的变量，
 * 账号密码放那里会漏进每个 shell。这个文件只有本插件自己读。
 */
export function privateCredentialsFile() {
  return join(dshHome(), 'zju-campus', 'credentials.env');
}

const CREDENTIALS_TEMPLATE = `# 浙大校园助手 · 账号配置
# 把下面两行的等号后面填成你自己的，保存即生效，不用重启 DSH。
# 这个文件只被本插件读取，不会注入到任何子进程的环境变量里。
# 注意：等号两边不要加空格，也不要把这个文件发给别人。
ZJU_USER=
ZJU_PASSWORD=
`;

/**
 * 首次运行时铺一份凭据模板，让人打开就能填。
 *
 * 只在文件不存在时创建，绝不覆盖已有内容；写不进去（只读目录等）就安静跳过，
 * 不阻断插件加载。
 *
 * @returns {{ path: string, created: boolean }}
 */
export function ensureCredentialTemplate() {
  const file = privateCredentialsFile();
  try {
    if (existsSync(file)) return { path: file, created: false };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, CREDENTIALS_TEMPLATE, { encoding: 'utf8', mode: 0o600 });
    return { path: file, created: true };
  } catch {
    return { path: file, created: false };
  }
}

/** 从解析结果里取账号密码，兼容 ZJU_PASSWORD / ZJU_PASS 两种写法。 */
function pickCredentials(parsed, source) {
  const username = parsed.ZJU_USER || parsed.ZJU_USERNAME || '';
  const password = parsed.ZJU_PASSWORD || parsed.ZJU_PASS || '';
  if (!username || !password) return null;
  return { username, password, source };
}

/**
 * 找出可用的账号密码。
 * @param {{ username?: string, password?: string, envFile?: string }} config
 * @returns {{ username: string, password: string, source: string } | null}
 */
export function resolveCredentials(config = {}) {
  if (config.username && config.password) {
    return { username: String(config.username), password: String(config.password), source: '插件配置' };
  }
  const files = config.envFile
    ? [config.envFile]
    : [privateCredentialsFile(), join(dshHome(), '.env')];
  for (const file of files) {
    const found = pickCredentials(parseEnvFile(file), file);
    if (found) return found;
  }
  const envPassword = process.env.ZJU_PASSWORD || process.env.ZJU_PASS;
  if (process.env.ZJU_USER && envPassword) {
    return { username: process.env.ZJU_USER, password: envPassword, source: '环境变量' };
  }
  return null;
}

/** 学号脱敏：保留前 3 位与后 2 位。 */
export function maskAccount(username) {
  const value = String(username || '');
  if (value.length <= 5) return value ? `${value[0]}***` : '';
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

/**
 * 校园会话：缓存学在浙大与智云课堂两套登录态，失效时重登一次。
 */
export class ZjuSession {
  /**
   * @param {object} settings 已归一化的插件配置
   */
  constructor(settings) {
    this.settings = settings;
    this.courses = null; // { client, at }
    this.cmc = null; // { client, at }
    this.loggingIn = new Map();
  }

  /** 当前凭据（可能为 null）。 */
  credentials() {
    return resolveCredentials(this.settings);
  }

  /** 是否已配置账号。 */
  hasCredentials() {
    return this.credentials() !== null;
  }

  /** 会话是否还在 TTL 内。 */
  #fresh(entry) {
    return entry !== null && Date.now() - entry.at < this.settings.sessionTtlMs;
  }

  /** 串行化同一站点的登录，避免并发工具调用重复提交密码。 */
  async #once(key, factory) {
    if (this.loggingIn.has(key)) return this.loggingIn.get(key);
    const promise = (async () => factory())().finally(() => this.loggingIn.delete(key));
    this.loggingIn.set(key, promise);
    return promise;
  }

  /** 拿到学在浙大客户端（必要时登录）。 */
  async coursesClient(force = false) {
    if (!force && this.#fresh(this.courses)) return this.courses.client;
    return this.#once('courses', async () => {
      if (!force && this.#fresh(this.courses)) return this.courses.client;
      const credentials = this.credentials();
      if (!credentials) throw this.#missingCredentials();
      const { jar } = await casLogin({
        landingUrl: `${COURSES}/login`,
        username: credentials.username,
        password: credentials.password,
        timeoutMs: this.settings.requestTimeoutMs,
      });
      const client = new CoursesClient(jar, { timeoutMs: this.settings.requestTimeoutMs });
      // 用一次真实请求确认会话可用，避免把「CAS 成功但站点会话没建立」当成登录成功。
      await client.todos();
      this.courses = { client, at: Date.now(), account: credentials.username };
      return client;
    });
  }

  /** 拿到智云课堂客户端（必要时登录）。 */
  async cmcClient(force = false) {
    if (!force && this.#fresh(this.cmc)) return this.cmc.client;
    return this.#once('cmc', async () => {
      if (!force && this.#fresh(this.cmc)) return this.cmc.client;
      const credentials = this.credentials();
      if (!credentials) throw this.#missingCredentials();
      const client = await CmcClient.login({
        username: credentials.username,
        password: credentials.password,
        timeoutMs: this.settings.requestTimeoutMs,
        tenantId: this.settings.tenantId,
      });
      this.cmc = { client, at: Date.now(), account: credentials.username };
      return client;
    });
  }

  /**
   * 用缓存客户端执行一次请求；疑似会话失效时强制重登重试一次。
   * @param {'courses'|'cmc'} kind
   * @param {(client: any) => Promise<any>} run
   */
  async withClient(kind, run) {
    const getter = kind === 'courses' ? (f) => this.coursesClient(f) : (f) => this.cmcClient(f);
    const client = await getter(false);
    try {
      return await run(client);
    } catch (error) {
      const message = String(error?.message || error);
      if (/非 JSON|会话|401|403|token|JWTUser/i.test(message)) {
        const retried = await getter(true);
        return run(retried);
      }
      throw error;
    }
  }

  /** 清空内存会话。 */
  logout() {
    this.courses = null;
    this.cmc = null;
  }

  /** 会话状态（不含任何 Cookie 值）。 */
  status() {
    const credentials = this.credentials();
    return {
      configured: credentials !== null,
      account: credentials ? maskAccount(credentials.username) : '',
      source: credentials?.source || '',
      courses: this.courses
        ? { loggedIn: true, ageSeconds: Math.round((Date.now() - this.courses.at) / 1000), account: maskAccount(this.courses.account) }
        : { loggedIn: false },
      cmc: this.cmc
        ? {
            loggedIn: true,
            ageSeconds: Math.round((Date.now() - this.cmc.at) / 1000),
            realname: this.cmc.client.user.realname || '',
            userId: this.cmc.client.user.userId,
          }
        : { loggedIn: false },
      ttlSeconds: Math.round(this.settings.sessionTtlMs / 1000),
    };
  }

  #missingCredentials() {
    const file = privateCredentialsFile();
    ensureCredentialTemplate();
    return new Error(
      `未配置浙大账号。已经给你建好模板文件，打开填两行就行（推荐，DSH 不会加载它）：\n` +
        `  ${file}\n` +
        `  ZJU_USER=你的学号\n  ZJU_PASSWORD=你的密码\n` +
        '保存后无需重启，下一次调用会自动读取。也兼容环境变量 ZJU_USER / ZJU_PASSWORD。',
    );
  }
}
