/**
 * 把某节课的完整转录落盘成纯文本，方便分块阅读/交给子代理消化。
 * 用法：node scripts/dump-transcript.mjs <sub_id> [输出文件]
 * 默认输出到 .cache/transcript-<sub_id>.txt
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const subId = process.argv[2];
if (!subId) {
  console.error('用法：node scripts/dump-transcript.mjs <sub_id> [输出文件]');
  process.exit(2);
}
const out = process.argv[3] || join(here, '..', '.cache', `transcript-${subId}.txt`);

const tools = new Map();
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  effect: (callback) => callback(),
  inject: () => {},
  logger: { info() {}, warn() {} },
};
apply(ctx, { allowWriteOps: false });

const text = String(await tools.get('zju_transcript').execute({ sub_id: subId }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text, 'utf8');
console.log(`已写入 ${out}（${text.length} 字，${text.split('\n').length} 行）`);
