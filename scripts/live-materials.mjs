/**
 * 拉一节课的笔记材料并打印（不保存笔记），用来验证分段与课件页绑定。
 * 用法：node scripts/live-materials.mjs <sub_id> [part] [--head 60]
 */
import { apply } from '../index.js';

const args = process.argv.slice(2);
const nums = args.filter((a) => /^\d+$/.test(a));
const subId = nums[0];
const part = nums[1] ? Number(nums[1]) : 1;
const headArg = args.indexOf('--head');
const headLines = headArg >= 0 ? Number(args[headArg + 1]) || 60 : 60;
if (!subId) {
  console.error('用法：node scripts/live-materials.mjs <sub_id> [part] [--head N]');
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
const out = await tool.execute({ sub_id: subId, part, force: args.includes('--force') }, {});
const text = String(out);
const lines = text.split('\n');
console.log(lines.slice(0, headLines).join('\n'));
console.log(`\n--- 总行数 ${lines.length}，总字符 ${text.length} ---`);
