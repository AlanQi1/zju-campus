/**
 * 笔记缓存 + Obsidian 镜像的单元测试（全部在临时目录里，不碰真实库）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NotesStore,
  ObsidianSettings,
  parseFrontmatter,
  safeFileName,
  serializeFrontmatter,
  noteFileName,
  stripFrontmatter,
} from '../src/notes.js';

const root = mkdtempSync(join(tmpdir(), 'zju-notes-'));
const notesDir = join(root, 'notes');
const vault = join(root, 'vault');
mkdirSync(join(vault, '.obsidian'), { recursive: true });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  // 文件名清洗
  check('文件名清洗', safeFileName('示例课程/Ⅲ: 第1讲?') === '示例课程 Ⅲ 第1讲', safeFileName('示例课程/Ⅲ: 第1讲?'));
  check('文件名带日期与 sub_id', noteFileName({ date: '2026-10-23', title: '示例课程A', subId: 1234501 }) === '2026-10-23 示例课程A (1234501).md');

  // frontmatter 往返
  const front = serializeFrontmatter({ sub_id: '1234501', course: '示例课程A', tags: ['智云课堂', '示例课程A'] });
  const parsed = parseFrontmatter(`${front}正文`);
  check('frontmatter 解析', parsed.meta.sub_id === '1234501' && parsed.meta.course === '示例课程A');
  check('frontmatter tags', Array.isArray(parsed.meta.tags) && parsed.meta.tags.length === 2);
  check('frontmatter 正文', parsed.body.trim() === '正文');

  const store = new NotesStore({
    dir: notesDir,
    obsidian: () => new ObsidianSettings({ file: join(root, 'obsidian.json'), vault, folder: '智云课堂' }).effective(),
  });

  // 写入
  const result = store.write({
    subId: '1234501',
    markdown: '## 本节要点\n- 测试笔记',
    meta: { title: '示例课程A', course: '示例课程A', courseId: '12301', date: '2026-10-23', teacher: '张老师', time: '07:56-09:35' },
  });
  check('缓存文件已写入', existsSync(result.path), result.path);
  const text = readFileSync(result.path, 'utf8');
  check('frontmatter 含 sub_id', text.includes('sub_id: "1234501"'));
  check('frontmatter 含 tags', text.includes('tags: ["智云课堂","示例课程A"]'));
  check('正文已写入', text.includes('## 本节要点'));

  // 读取
  const cached = store.read('1234501');
  check('read 命中', cached !== null && cached.markdown.includes('测试笔记'));
  check('read 带文件路径', cached.path.endsWith('2026-10-23 示例课程A (1234501).md'));
  check('read 不存在的 sub_id', store.read('999') === null);

  // 列表
  const list = store.list({ limit: 10 });
  check('list 数量', list.length === 1, String(list.length));
  check('list 元数据', list[0].subId === '1234501' && list[0].course === '示例课程A');
  check('list 关键词过滤', store.list({ keyword: '示例' }).length === 1 && store.list({ keyword: '物理' }).length === 0);

  // Obsidian 镜像
  check('镜像返回路径', Boolean(result.mirrored?.note), JSON.stringify(result.mirrored));
  check('Obsidian 笔记存在', existsSync(join(vault, '智云课堂', '2026-10-23 示例课程A (1234501).md')));
  check('课程索引存在', existsSync(join(vault, '智云课堂', '_课程', '示例课程A.md')));
  const moc = readFileSync(join(vault, '智云课堂', '_课程', '示例课程A.md'), 'utf8');
  check('课程索引含双链', moc.includes('[[2026-10-23 示例课程A (1234501)]]'));
  const index = readFileSync(join(vault, '智云课堂', '_索引.md'), 'utf8');
  check('总索引含双链', index.includes('[[2026-10-23 示例课程A (1234501)]]'));

  // 附件复制
  const attDir = store.attachmentDir('1234501');
  mkdirSync(attDir, { recursive: true });
  writeFileSync(join(attDir, 'ppt-001.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  const result2 = store.write({
    subId: '1234501',
    markdown: '## 本节要点\n- 更新后的笔记',
    meta: { title: '示例课程A', course: '示例课程A', date: '2026-10-23' },
  });
  check('附件已镜像', existsSync(join(vault, '智云课堂', '_附件', '1234501', 'ppt-001.jpg')));
  check('重复写入覆盖同一篇', result2.file === result.file);

  // 关闭 Obsidian 后不再镜像
  const storeOff = new NotesStore({
    dir: join(root, 'notes2'),
    obsidian: () => new ObsidianSettings({ file: join(root, 'obsidian-off.json'), vault, folder: '智云课堂' }).set({ enabled: false }),
  });
  const off = storeOff.write({ subId: '1', markdown: 'x', meta: { title: '测试', date: '2026-10-24' } });
  check('关闭后不镜像', off.mirrored === null);

  // 摘要
  const summary = store.summary();
  check('summary 计数', summary.count === 1 && summary.subIds.includes('1234501'));
  check('summary Obsidian', summary.obsidian.enabled === true && summary.obsidian.vault === vault);

  // 正文自带 frontmatter 时不能出现两段 ---
  const dup = store.write({
    subId: '1234503',
    markdown: '---\ntags: [智云课堂, 线性代数]\n---\n\n# 标题\n\n正文',
    meta: { title: '线性代数', date: '2026-10-25' },
  });
  const dupText = readFileSync(dup.path, 'utf8');
  check('剥掉正文自带 frontmatter', (dupText.match(/^---$/gm) || []).length === 2);
  check('正文保留', dupText.includes('# 标题') && dupText.includes('正文'));
  const dupMeta = parseFrontmatter(dupText).meta;
  check('合并模型 tags', dupMeta.tags.includes('线性代数') && dupMeta.tags.includes('智云课堂'));
  check('stripFrontmatter 导出', stripFrontmatter('---\na: 1\n---\nbody').body === 'body');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
