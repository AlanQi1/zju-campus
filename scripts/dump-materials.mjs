/**
 * 把一节课的全部笔记材料分段落盘，供子代理分块阅读。
 * 用法：node scripts/dump-materials.mjs <sub_id> [--force] [--out 目录]
 * 输出：<out>/mat-<sub_id>-p<N>.md（N 从 1 开始）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { apply } from '../index.js';

const args = process.argv.slice(2);
const subId = args.find((a) => /^\d+$/.test(a));
const outArg = args.indexOf('--out');
const outDir = resolve(outArg >= 0 && args[outArg + 1] ? args[outArg + 1] : '.cache');
if (!subId) {
  console.error('用法：node scripts/dump-materials.mjs <sub_id> [--force] [--out 目录]');
  process.exit(1);
}

const tools = new Map();
const ctx = {
  tools: {
    register: (definition) => {
      tools.set(definition.name, definition);
      return () => {};
    },
  },
  effect: (callback) => callback(),
  inject: () => {},
  logger: { info() {}, warn() {}, error() {}, debug() {} },
};

apply(ctx, { allowWriteOps: false });

const tool = tools.get('zju_notes');
if (!tool) {
  console.error('没拿到 zju_notes');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const force = args.includes('--force');
let part = 1;
let total = 1;
const written = [];
do {
  const text = String(await tool.execute({ sub_id: subId, part, force: force && part === 1 }, {}));
  const match = /第\s*\d+\s*\/\s*(\d+)\s*段/.exec(text);
  if (match) total = Number(match[1]) || 1;
  const file = join(outDir, `mat-${subId}-p${part}.md`);
  writeFileSync(file, text, 'utf8');
  written.push({ part, file, chars: text.length, lines: text.split('\n').length });
  part += 1;
} while (part <= total);

console.log(`共 ${written.length} 段材料：`);
for (const item of written) {
  console.log(`- 第 ${item.part} 段：${item.file}（${item.lines} 行 / ${item.chars} 字符）`);
}
