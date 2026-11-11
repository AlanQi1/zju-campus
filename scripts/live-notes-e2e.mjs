/**
 * 真实账号端到端验证（不在自动测试里跑，手动执行）：
 *   1. 从近 7 天课表里找一节有转录的课
 *   2. 调 zju_notes 拉材料（转录 + 课件时间轴）
 *   3. 用材料拼一份示例 markdown，调 zju_save_note 保存
 *   4. 校验本地缓存、Obsidian 笔记 / _课程 / _索引 / _附件
 *
 * 用法：node scripts/live-notes-e2e.mjs [--vault D:/Obsidian/Vault] [--keep]
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const vault = flag('vault');
const keep = args.includes('--keep');

const root = mkdtempSync(join(tmpdir(), 'zju-live-'));
const notesDir = join(root, 'notes');
const obsidianFile = join(root, 'obsidian.json');

const tools = new Map();
const ctx = {
  tools: { register: (definition) => { tools.set(definition.name, definition); return () => {}; } },
  effect: (callback) => { const dispose = callback(); return dispose; },
  inject: () => {},
  logger: { info() {}, warn() {} },
};

apply(ctx, {
  allowWriteOps: false,
  rollcallSwitchFile: join(root, 'switch.json'),
  rollcallLocationsFile: join(root, 'locations.json'),
  notesDir,
  obsidianFile,
  obsidianVault: vault || '',
  obsidianFolder: '智云课堂',
});

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  // 0. 找一节有转录的课
  const subIdArg = flag('sub-id');
  const dateArg = flag('date') || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const week = await tools.get('zju_schedule').execute({ date: dateArg });
  const subIdMatch = String(week).match(/sub_id=(\d+)/);
  console.log('课表片段：', String(week).slice(0, 600));
  check('课表能返回 sub_id', Boolean(subIdMatch), subIdMatch?.[1]);
  const subId = subIdArg || subIdMatch?.[1];

  if (subId) {
    // 1. 材料
    const materials = await tools.get('zju_notes').execute({ sub_id: subId });
    console.log('\n--- zju_notes 返回（前 1500 字）---\n' + String(materials).slice(0, 1500) + '\n---\n');
    check('材料含转录或课件', /转录|课件时间轴/.test(String(materials)));

    // 2. 保存笔记
    const markdown = [
      '## 本节要点',
      '- 这是一条端到端测试笔记，用来验证缓存与 Obsidian 同步。',
      '',
      '## 知识点',
      '- 测试要点一',
      '',
      '## 待复习',
      '- [ ] 复习测试要点一',
    ].join('\n');
    const saved = await tools.get('zju_save_note').execute({ sub_id: subId, markdown, title: '端到端测试课' });
    console.log('\n--- zju_save_note 返回 ---\n' + String(saved) + '\n');
    check('保存返回成功', /已保存|缓存/.test(String(saved)));

    // 3. 缓存文件
    const files = existsSync(notesDir) ? readdirSync(notesDir) : [];
    check('缓存目录有笔记', files.some((f) => f.endsWith('.md')), files.join(','));
    const noteFile = files.find((f) => f.endsWith('.md'));
    if (noteFile) {
      const text = readFileSync(join(notesDir, noteFile), 'utf8');
      check('缓存含 frontmatter', text.startsWith('---'));
      check('缓存含正文', text.includes('端到端测试笔记'));
    }

    // 4. 重新读取应命中缓存
    const cached = await tools.get('zju_notes').execute({ sub_id: subId });
    check('二次调用命中缓存', String(cached).includes('缓存') || String(cached).includes('本节要点'));

    // 5. 列表
    const list = await tools.get('zju_notes_list').execute({});
    check('笔记列表可见', String(list).includes(subId), String(list).slice(0, 200));

    // 6. Obsidian
    if (vault) {
      const vroot = join(vault, '智云课堂');
      check('Obsidian 目录已建', existsSync(vroot));
      if (existsSync(vroot)) {
        const entries = readdirSync(vroot);
        console.log('Obsidian 智云课堂/：', entries.join(', '));
        check('Obsidian 有笔记', entries.some((f) => f.endsWith('.md')));
        check('Obsidian 有课程索引', existsSync(join(vroot, '_课程')));
        check('Obsidian 有总索引', existsSync(join(vroot, '_索引.md')));
        check('Obsidian 有附件目录', existsSync(join(vroot, '_附件')));
        const att = existsSync(join(vroot, '_附件', subId)) ? readdirSync(join(vroot, '_附件', subId)) : [];
        console.log(`附件 ${att.length} 个：`, att.slice(0, 5).join(', '));
      }
    }
  }
} finally {
  if (!keep) rmSync(root, { recursive: true, force: true });
  else console.log(`\n保留临时目录：${root}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
