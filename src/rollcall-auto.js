/**
 * 自动签到守护进程。
 *
 * 侧边栏的「自动检查」只是每 60 秒拉一次 `/dsh-zju/summary` 刷新界面，
 * 本身不会签到（签到是真实写操作）。这里补上缺失的那一半：
 * 插件进程内起一个定时器，按同样的节奏检查有没有进行中的雷达点名，
 * 发现没签过的就自动调一次 `zju_rollcall_answer` 的同一份实现。
 *
 * 设计取舍：
 *   - 每个点名只自动尝试 1~2 次，失败后退避重试，避免把服务端打到发火；
 *   - 成功或「已签过」都记进 attempts，同一个点名不再重复提交；
 *   - 代签开关（RollcallSwitch）关着时一律不动，只记录跳过原因；
 *   - 定时器 unref，不阻止进程退出。
 *
 * 开关存在 `$DSH_HOME/zju-campus/rollcall-auto.json`，默认开启。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome } from './session.js';

/** 默认开关文件。 */
export function defaultAutoFile() {
  return join(dshHome(), 'zju-campus', 'rollcall-auto.json');
}

/** 历史记录条数上限。 */
const HISTORY_LIMIT = 20;

/** 一条签到记录保留多久（毫秒）。 */
const ATTEMPT_TTL_MS = 6 * 3600 * 1000;

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

export class RollcallAuto {
  /**
   * @param {{
   *   file?: string,
   *   intervalMs?: number,
   *   retryMs?: number,
   *   maxTries?: number,
   *   listActive?: () => Promise<object[]>,
   *   signOne?: (id: string|number) => Promise<object>,
   *   isSignEnabled?: () => boolean,
   *   logger?: { info?: Function, warn?: Function },
   * }} options
   */
  constructor(options = {}) {
    this.file = options.file || defaultAutoFile();
    this.intervalMs = clampNumber(options.intervalMs, 15000, 600000, 60000);
    this.retryMs = clampNumber(options.retryMs, 0, 3600000, 180000);
    this.maxTries = clampNumber(options.maxTries, 1, 5, 2);
    this.listActive = options.listActive;
    this.signOne = options.signOne;
    this.isSignEnabled = options.isSignEnabled || (() => true);
    this.logger = options.logger || null;

    /** @type {Map<string, {count:number, at:number, ok:boolean, message:string}>} */
    this.attempts = new Map();
    /** @type {object[]} */
    this.history = [];
    this.timer = null;
    this.running = false;
    this.lastCheck = null;
    this.lastError = '';
    this.startedAt = null;
    this.nextAt = null;
    this.ticks = 0;
  }

  /** 读开关；没有文件时默认开启。 */
  read() {
    if (!existsSync(this.file)) {
      return { enabled: true, source: 'default', updatedAt: null, intervalMs: this.intervalMs, error: null };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      return {
        enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : true,
        source: 'panel',
        updatedAt: parsed?.updatedAt || null,
        intervalMs: this.intervalMs,
        error: null,
      };
    } catch (error) {
      return {
        enabled: true,
        source: 'default',
        updatedAt: null,
        intervalMs: this.intervalMs,
        error: `自动签到开关读取失败：${error.message}`,
      };
    }
  }

  /** 写开关。 */
  set(enabled) {
    const value = Boolean(enabled);
    const updatedAt = new Date().toISOString();
    mkdirSync(dirname(this.file), { recursive: true });
    const body = `${JSON.stringify({ enabled: value, updatedAt }, null, 2)}\n`;
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, body, 'utf8');
    try {
      renameSync(temp, this.file);
    } catch {
      writeFileSync(this.file, body, 'utf8');
    }
    this.logger?.info?.(`zju-campus: 自动签到${value ? '开启' : '关闭'}`);
    return { ...this.read(), enabled: value, source: 'panel', updatedAt };
  }

  /** 面板和接口用的状态快照。 */
  state() {
    const settings = this.read();
    const now = Date.now();
    const pending = [];
    for (const [id, entry] of this.attempts) {
      if (now - entry.at > ATTEMPT_TTL_MS) {
        this.attempts.delete(id);
        continue;
      }
      pending.push({
        rollcallId: id,
        count: entry.count,
        ok: entry.ok,
        message: entry.message || '',
        at: new Date(entry.at).toISOString(),
      });
    }
    return {
      enabled: settings.enabled,
      source: settings.source,
      updatedAt: settings.updatedAt,
      error: settings.error,
      intervalMs: this.intervalMs,
      retryMs: this.retryMs,
      maxTries: this.maxTries,
      armed: this.timer !== null,
      running: this.running,
      ticks: this.ticks,
      startedAt: this.startedAt,
      nextAt: this.nextAt ? new Date(this.nextAt).toISOString() : null,
      lastCheck: this.lastCheck,
      lastError: this.lastError,
      attempts: pending,
      history: this.history.slice(0, 8),
    };
  }

  /** 起定时器（幂等）。 */
  start() {
    if (this.timer) return this.state();
    this.startedAt = new Date().toISOString();
    const tick = () => {
      this.nextAt = Date.now() + this.intervalMs;
      this.tick('interval').catch((error) => {
        this.lastError = String(error?.message || error);
      });
    };
    // 启动后先等 5 秒看一眼：冷启动那一刻往往正赶上课中间点名。
    const first = setTimeout(tick, 5000);
    first.unref?.();
    const interval = setInterval(tick, this.intervalMs);
    interval.unref?.();
    this.timer = { first, interval };
    this.nextAt = Date.now() + 5000;
    return this.state();
  }

  /** 停定时器。 */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer.first);
      clearInterval(this.timer.interval);
      this.timer = null;
    }
    this.nextAt = null;
  }

  /**
   * 跑一轮检查：找进行中的雷达点名，没签过的自动签。
   * @param {string} reason interval / manual / boot
   */
  async tick(reason = 'interval') {
    if (this.running) {
      return { ok: false, skipped: true, message: '上一轮检查还没结束，跳过这一轮。' };
    }
    this.running = true;
    this.ticks += 1;
    const settings = this.read();
    const check = {
      at: new Date().toISOString(),
      reason,
      rollcalls: 0,
      signed: [],
      failed: [],
      skipped: '',
      durationMs: 0,
    };
    const startedAt = Date.now();
    try {
      if (!settings.enabled) {
        check.skipped = '自动签到已关闭';
        this.lastCheck = check;
        return { ok: true, skipped: true, check };
      }
      if (!this.isSignEnabled()) {
        check.skipped = '虚拟位置代签开关是关的，自动签到不会动';
        this.lastCheck = check;
        return { ok: true, skipped: true, check };
      }

      const list = await this.listActive();
      const radar = (Array.isArray(list) ? list : []).filter((item) => item && item.active && item.isRadar);
      check.rollcalls = radar.length;
      if (radar.length === 0) {
        check.skipped = '当前没有进行中的雷达点名';
        this.lastCheck = check;
        return { ok: true, check };
      }

      for (const item of radar) {
        const key = String(item.id);
        const previous = this.attempts.get(key);
        if (previous?.ok) continue;
        if (previous) {
          if (previous.count >= this.maxTries) continue;
          if (Date.now() - previous.at < this.retryMs) continue;
        }
        const entry = {
          count: (previous?.count || 0) + 1,
          at: Date.now(),
          ok: false,
          message: '',
        };
        this.attempts.set(key, entry);
        try {
          const result = await this.signOne(item.id);
          const used = (result?.attempts || []).find((attempt) => attempt.ok);
          const signedOk = Boolean(result?.ok || result?.skipped);
          entry.ok = signedOk;
          entry.message =
            result?.message ||
            (signedOk ? '签到成功' : '签到未通过');
          const record = {
            at: new Date().toISOString(),
            rollcallId: key,
            courseTitle: result?.rollcall?.courseTitle || item.courseTitle || '',
            type: result?.rollcall?.type || item.type || '',
            ok: signedOk,
            skipped: Boolean(result?.skipped),
            message: entry.message,
            location: used?.name || '',
            distance: Number.isFinite(Number(used?.distance)) ? Number(used.distance) : null,
            usedEstimated: Boolean(result?.usedEstimated),
          };
          this.history.unshift(record);
          if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
          if (signedOk) check.signed.push(record);
          else check.failed.push(record);
          this.logger?.info?.(
            `zju-campus: 自动签到 ${signedOk ? '成功' : '失败'} #${key} ${record.courseTitle} — ${entry.message}`,
          );
        } catch (error) {
          entry.message = String(error?.message || error);
          const record = {
            at: new Date().toISOString(),
            rollcallId: key,
            courseTitle: item.courseTitle || '',
            ok: false,
            skipped: false,
            message: entry.message,
          };
          this.history.unshift(record);
          if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
          check.failed.push(record);
          this.logger?.warn?.(`zju-campus: 自动签到出错 #${key} — ${entry.message}`);
        }
      }
      check.durationMs = Date.now() - startedAt;
      this.lastCheck = check;
      return { ok: check.failed.length === 0, check };
    } catch (error) {
      this.lastError = String(error?.message || error);
      check.skipped = `检查失败：${this.lastError}`;
      check.durationMs = Date.now() - startedAt;
      this.lastCheck = check;
      return { ok: false, check };
    } finally {
      this.running = false;
      if (this.timer) this.nextAt = Date.now() + this.intervalMs;
    }
  }
}
