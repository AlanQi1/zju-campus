/**
 * 把多段笔记草稿合并成一篇完整笔记。
 *
 * 规则：
 *   - 按传入顺序读取草稿，按 `## ` 切节；
 *   - 标题命中 TAIL_PATTERNS（本节要点 / 待复习 / 易错点 / 知识地图 / 小结）的节，
 *     不参与正文编号，统一收到文末「易错点与待复习」；
 *   - 正文节按顺序重新编号为 `## 1. 标题`、`## 2. 标题`…（去掉原来的「一、」）；
 *   - 每段草稿里的 H1 标题与 YAML frontmatter 丢弃。
 *
 * 用法：
 *   node scripts/merge-note-drafts.mjs <输出文件> <草稿1> <草稿2> ...
 *   node scripts/merge-note-drafts.mjs --title "标题" <输出文件> <草稿...>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TAIL_PATTERNS = [/本节要点/, /待复习/, /易错点/, /知识地图/, /^小结/];
const NUMERAL = /^[一二三四五六七八九十百]+、\s*/;

const argv = process.argv.slice(2);
const titleIndex = argv.indexOf('--title');
const title = titleIndex >= 0 ? argv[titleIndex + 1] : '';
const rest = argv.filter((item, i) => item !== '--title' && i !== titleIndex + 1);
const [outFile, ...drafts] = rest;
if (!outFile || drafts.length === 0) {
  console.error('用法：node scripts/merge-note-drafts.mjs [--title 标题] <输出文件> <草稿1> [草稿2 ...]');
  process.exit(1);
}

/** 把一个文件切成 { head: 前置正文, sections: [{title, body}] } */
function splitSections(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const sections = [];
  const head = [];
  let current = null;
  let inFront = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFront = true;
      continue;
    }
    if (inFront) {
      if (line.trim() === '---') inFront = false;
      continue;
    }
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { title: match[1], body: [] };
      continue;
    }
    if (/^#\s+/.test(line)) continue;
    if (current) current.body.push(line);
    else head.push(line);
  }
  if (current) sections.push(current);
  return { head: head.join('\n').trim(), sections };
}

const isTail = (name) => TAIL_PATTERNS.some((pattern) => pattern.test(name));

const bodySections = [];
const tailChunks = [];
const orphanHeads = [];

for (const file of drafts) {
  const { head, sections } = splitSections(readFileSync(file, 'utf8'));
  if (head) orphanHeads.push(head);
  for (const section of sections) {
    const body = section.body.join('\n').trim();
    if (isTail(section.title)) {
      if (body) tailChunks.push({ title: section.title, body });
      continue;
    }
    bodySections.push({ title: section.title.replace(NUMERAL, ''), body });
  }
}

const out = [];
if (title) out.push(`# ${title}`, '');
if (orphanHeads.length > 0) out.push(orphanHeads.join('\n\n'), '');

bodySections.forEach((section, index) => {
  out.push(`## ${index + 1}. ${section.title}`, '');
  if (section.body) out.push(section.body, '');
});

if (tailChunks.length > 0) {
  out.push('## 易错点与待复习', '');
  for (const chunk of tailChunks) {
    const sub = chunk.title.replace(NUMERAL, '');
    out.push(`### ${sub}`, '');
    out.push(chunk.body, '');
  }
}

writeFileSync(outFile, `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`, 'utf8');

const chars = out.join('\n').length;
const cjk = (out.join('\n').match(/[\u4e00-\u9fa5]/g) || []).length;
const slides = (out.join('\n').match(/\{\{slide:\s*\d+/g) || []).length;
console.log(`已合并 ${drafts.length} 段草稿 → ${outFile}`);
console.log(`- 正文小节：${bodySections.length} 个`);
console.log(`- 文末汇总块：${tailChunks.length} 个`);
console.log(`- 总字符 ${chars}，中文字 ${cjk}，{{slide:N}} 占位符 ${slides} 个`);
