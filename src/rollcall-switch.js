/**
 * 雷达点名「虚拟位置代签」运行开关。
 *
 * 配置里的 `allowRollcallSign` 是基础默认值；面板上的开关会把用户的选择
 * 写进 `$DSH_HOME/zju-campus/rollcall-switch.json`，运行时优先读它。
 * 这样面板可以即时开关，不需要改 profile 补丁或重启插件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome } from './session.js';

/** 默认开关文件。 */
export function defaultSwitchFile() {
  return join(dshHome(), 'zju-campus', 'rollcall-switch.json');
}

export class RollcallSwitch {
  /** @param {{ file?: string }} [options] */
  constructor(options = {}) {
    this.file = options.file || defaultSwitchFile();
  }

  /**
   * 读取面板开关。
   * enabled 为 null 表示没有面板覆盖，按配置走。
   */
  read() {
    if (!existsSync(this.file)) {
      return { enabled: null, source: 'config', updatedAt: null, error: null };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      const enabled = typeof parsed?.enabled === 'boolean' ? parsed.enabled : null;
      return {
        enabled,
        source: enabled === null ? 'config' : 'panel',
        updatedAt: parsed?.updatedAt || null,
        error: null,
      };
    } catch (error) {
      return {
        enabled: null,
        source: 'config',
        updatedAt: null,
        error: `开关文件读取失败：${error.message}`,
      };
    }
  }

  /**
   * 计算生效值：面板覆盖优先，否则用配置值。
   * @param {boolean} configValue
   */
  effective(configValue) {
    const state = this.read();
    return {
      enabled: state.enabled === null ? Boolean(configValue) : state.enabled,
      source: state.source,
      updatedAt: state.updatedAt,
      error: state.error,
    };
  }

  /**
   * 写入面板开关。
   * @param {boolean} enabled
   */
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
    return { enabled: value, source: 'panel', updatedAt, error: null };
  }
}
