/**
 * 代签开关单元测试：配置默认值、面板覆盖、持久化、坏文件回退。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RollcallSwitch, defaultSwitchFile } from '../src/rollcall-switch.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check('默认开关文件路径', defaultSwitchFile().includes('rollcall-switch.json'), defaultSwitchFile());

const dir = mkdtempSync(join(tmpdir(), 'zju-rollcall-switch-'));
const file = join(dir, 'switch.json');
try {
  const controller = new RollcallSwitch({ file });

  // 没有面板文件时按配置走。
  const fromConfig = controller.effective(true);
  check('无覆盖时用配置 true', fromConfig.enabled === true && fromConfig.source === 'config');
  check('无覆盖时用配置 false', controller.effective(false).enabled === false);

  // 面板写入后优先于配置。
  const off = controller.set(false);
  check('写入关闭', off.enabled === false && off.source === 'panel');
  check('面板关闭覆盖配置 true', controller.effective(true).enabled === false);
  check('面板关闭来源', controller.effective(true).source === 'panel');

  const reloaded = new RollcallSwitch({ file });
  check('重新加载持久化', reloaded.effective(true).enabled === false);

  controller.set(true);
  check('再打开', controller.effective(false).enabled === true);

  // 坏文件回退到配置，并带 error。
  writeFileSync(file, '{not-json', 'utf8');
  const broken = controller.effective(true);
  check('坏文件回退配置', broken.enabled === true && broken.source === 'config');
  check('坏文件带错误信息', Boolean(broken.error), broken.error || '');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
