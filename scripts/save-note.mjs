#!/usr/bin/env node
/**
 * 用文件里的 markdown 调 zju_save_note，避免把长文本塞进对话。
 *
 * 用法：
 *   node scripts/save-note.mjs <sub_id> <markdown 文件> [选项]
 *
 * 选项：
 *   --title 标题   --course 课程名   --teacher 老师
 *   --date YYYY-MM-DD   --time 07:56-09:35   --no-slides
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apply } from '../index.js';

const argv = process.argv.slice(2);
const positional = argv.filter((item) => !item.startsWith('--'));
const flag = (name, fallback = '') => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};

const subId = positional[0];
const mdPath = positional[1];
if (!subId || !mdPath) {
  console.error('用法：node scripts/save-note.mjs <sub_id> <markdown 文件> [--title ..] [--course ..] [--teacher ..] [--date ..] [--time ..]');
  process.exit(1);
}

const markdown = readFileSync(resolve(mdPath), 'utf8');
const tools = new Map();
const ctx = {
  tools: { register: (tool) => tools.set(tool.name, tool) },
  effect: (callback) => callback(),
  inject: () => {},
};

await apply(ctx, { allowWriteOps: false });

const tool = tools.get('zju_save_note');
if (!tool) throw new Error('zju_save_note 未注册');

const result = await tool.execute({
  sub_id: subId,
  markdown,
  title: flag('title', '') || flag('course', ''),
  course: flag('course', ''),
  teacher: flag('teacher', ''),
  date: flag('date', ''),
  time: flag('time', ''),
  download_slides: argv.includes('--no-slides') ? false : true,
});

console.log(result);
