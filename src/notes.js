/**
 * 课堂笔记的本地缓存与 Obsidian 同步。
 *
 * 设计目标：
 *   - 每节课（sub_id）一篇 Markdown，文件名人类可读：`2026-10-23 示例课程A (1234501).md`；
 *   - 文件头带 YAML frontmatter（课程、日期、老师、sub_id、tags），Obsidian 可直接检索；
 *   - 缓存目录默认 `$DSH_HOME/zju-campus/notes`，`index.json` 维护 sub_id → 文件 的映射；
 *   - 配置了 Obsidian 库时，镜像写入 `<vault>/<folder>/`，并维护「课程索引」和「总索引」；
 *   - 课件图片放 `_附件/<sub_id>/ppt-001.jpg`，笔记里用相对路径引用，缓存与 Obsidian 两边都能显示。
 *
 * 只读写本地文件，不访问网络；不引入第三方依赖。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { dshHome } from './session.js';

/** 默认笔记缓存目录。 */
export function defaultNotesDir() {
  return join(dshHome(), 'zju-campus', 'notes');
}

/** 默认 Obsidian 设置文件（面板/工具写入，优先于插件配置）。 */
export function defaultObsidianFile() {
  return join(dshHome(), 'zju-campus', 'obsidian.json');
}

/** Obsidian 全局配置文件（含所有库的路径）。 */
export function obsidianConfigPath() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'obsidian', 'obsidian.json');
}

/** 把任意标题清洗成合法文件名（Windows 不允许 \\ / : * ? " < > |）。 */
export function safeFileName(value, fallback = '未命名') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

/** 一节课的笔记文件名。sub_id 放末尾，避免同一天同名课程互相覆盖。 */
export function noteFileName({ date, title, subId }) {
  const day = String(date || '0000-00-00').slice(0, 10);
  return `${day} ${safeFileName(title, '课堂')} (${String(subId)}).md`;
}

/** YAML 标量：统一用 JSON 双引号，中文与冒号都安全。 */
function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

/** 生成 frontmatter。数组用 JSON flow 序列（YAML 合法）。 */
export function serializeFrontmatter(meta) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** 解析本插件写出的 frontmatter（只支持 key: 标量 / JSON 数组）。 */
export function parseFrontmatter(text) {
  const raw = String(text || '');
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, body: raw };
  const head = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const meta = {};
  for (const line of head.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim();
    if (value.startsWith('"') || value.startsWith('[')) {
      try {
        meta[match[1]] = JSON.parse(value);
        continue;
      } catch {
        // 解析失败就按原文保留
      }
    }
    meta[match[1]] = value;
  }
  return { meta, body };
}

/**
 * 模型有时会自己在正文开头写一段 frontmatter。这里把它剥掉，只留下正文，
 * 并把其中的 tags 取出来合并到插件写出的 frontmatter 里，避免出现两段 `---`。
 */
export function stripFrontmatter(markdown) {
  const raw = String(markdown || '');
  const parsed = parseFrontmatter(raw);
  if (parsed.body === raw) return { body: raw.trim(), tags: [] };
  const rawTags = parsed.meta.tags;
  let tags = [];
  if (Array.isArray(rawTags)) tags = rawTags.map((item) => String(item).trim()).filter(Boolean);
  else if (typeof rawTags === 'string') {
    tags = rawTags.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
  }
  return { body: parsed.body.trim(), tags };
}

/** 原子写文件（先写临时文件再改名，避免 Obsidian 读到半个文件）。 */
function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, 'utf8');
  try {
    renameSync(temp, path);
  } catch {
    writeFileSync(path, text, 'utf8');
  }
}

/** 读取 Obsidian 全局配置里登记的库。 */
export function detectObsidianVaults() {
  try {
    const json = JSON.parse(readFileSync(obsidianConfigPath(), 'utf8'));
    const vaults = json && typeof json.vaults === 'object' ? json.vaults : {};
    return Object.entries(vaults).map(([id, info]) => ({
      id,
      name: basename(String(info?.path || '')) || id,
      path: String(info?.path || ''),
      open: Boolean(info?.open),
    }));
  } catch {
    return [];
  }
}

/**
 * Obsidian 同步设置：设置文件 > 插件配置 > 自动探测（仅当只有一个库时）。
 */
export class ObsidianSettings {
  constructor(options = {}) {
    this.file = options.file || defaultObsidianFile();
    this.configVault = String(options.vault || '').trim();
    this.configFolder = String(options.folder || '').trim();
    this.configEnabled = typeof options.enabled === 'boolean' ? options.enabled : null;
  }

  read() {
    if (!existsSync(this.file)) {
      return { vault: '', folder: '', enabled: null, updatedAt: null, error: null };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      return {
        vault: typeof parsed?.vault === 'string' ? parsed.vault : '',
        folder: typeof parsed?.folder === 'string' ? parsed.folder : '',
        enabled: typeof parsed?.enabled === 'boolean' ? parsed.enabled : null,
        updatedAt: parsed?.updatedAt || null,
        error: null,
      };
    } catch (error) {
      return { vault: '', folder: '', enabled: null, updatedAt: null, error: `设置文件读取失败：${error.message}` };
    }
  }

  effective() {
    const state = this.read();
    let vault = state.vault || this.configVault;
    let source = state.vault ? 'panel' : this.configVault ? 'config' : 'none';
    if (!vault) {
      const detected = detectObsidianVaults();
      if (detected.length === 1) {
        vault = detected[0].path;
        source = 'auto';
      }
    }
    const folder = state.folder || this.configFolder || '智云课堂';
    const enabled = state.enabled === null ? this.configEnabled === null ? Boolean(vault) : this.configEnabled : state.enabled;
    return {
      enabled: Boolean(enabled) && Boolean(vault),
      vault,
      folder,
      source,
      updatedAt: state.updatedAt,
      error: state.error,
    };
  }

  /** 写入设置；传 null 表示清除该项。 */
  set({ vault, folder, enabled } = {}) {
    const current = this.read();
    const next = {
      vault: vault === undefined ? current.vault : vault === null ? '' : String(vault).trim(),
      folder: folder === undefined ? current.folder : folder === null ? '' : String(folder).trim(),
      enabled: enabled === undefined ? current.enabled : enabled === null ? null : Boolean(enabled),
      updatedAt: new Date().toISOString(),
    };
    atomicWrite(this.file, `${JSON.stringify(next, null, 2)}\n`);
    return this.effective();
  }
}

/**
 * 笔记仓库。
 *
 * @param {{ dir?: string, obsidian?: object | (() => object) }} options
 *   obsidian 可以是固定对象，也可以是每次调用时求值的函数（这样面板改设置后立即生效）。
 */
export class NotesStore {
  constructor(options = {}) {
    this.dir = options.dir || defaultNotesDir();
    this._obsidian = options.obsidian || null;
  }

  /** 当前的 Obsidian 设置（支持动态求值）。 */
  obsidianState() {
    if (typeof this._obsidian === 'function') {
      try {
        return this._obsidian() || { enabled: false };
      } catch {
        return { enabled: false };
      }
    }
    return this._obsidian || { enabled: false };
  }

  get indexFile() {
    return join(this.dir, 'index.json');
  }

  /** 课件附件目录（缓存目录内）。 */
  attachmentDir(subId) {
    return join(this.dir, '_附件', String(subId));
  }

  loadIndex() {
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf8'));
      return { notes: parsed && typeof parsed.notes === 'object' && parsed.notes ? parsed.notes : {} };
    } catch {
      return { notes: {} };
    }
  }

  saveIndex(index) {
    atomicWrite(this.indexFile, `${JSON.stringify(index, null, 2)}\n`);
  }

  /** 读取一篇缓存笔记；不存在返回 null。 */
  read(subId) {
    const key = String(subId);
    const index = this.loadIndex();
    const record = index.notes[key];
    if (!record || !record.file) return null;
    const path = join(this.dir, record.file);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    const parsed = parseFrontmatter(text);
    return {
      subId: key,
      path,
      file: record.file,
      record,
      meta: parsed.meta,
      markdown: parsed.body.trim(),
      updatedAt: record.updatedAt || null,
    };
  }

  /** 列出缓存笔记，按日期倒序。 */
  list({ keyword, limit = 50 } = {}) {
    const index = this.loadIndex();
    const needle = String(keyword || '').trim().toLowerCase();
    return Object.values(index.notes)
      .filter((item) => {
        if (!item || !item.file) return false;
        if (!needle) return true;
        return `${item.title || ''} ${item.course || ''}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)))
      .map((item) => ({ ...item, exists: existsSync(join(this.dir, item.file)) }));
  }

  /**
   * 写入一篇笔记。
   * @param {{ subId: string|number, markdown: string, meta: Record<string, any> }} input
   */
  write({ subId, markdown, meta }) {
    const key = String(subId);
    const record = {
      subId: key,
      title: String(meta?.title || ''),
      course: String(meta?.course || meta?.title || ''),
      courseId: meta?.courseId ? String(meta.courseId) : '',
      date: String(meta?.date || '').slice(0, 10),
      teacher: String(meta?.teacher || ''),
      time: String(meta?.time || ''),
      url: String(meta?.url || ''),
    };
    const file = noteFileName(record);
    const path = join(this.dir, file);
    const cleaned = stripFrontmatter(markdown);
    const tags = ['智云课堂', record.course, ...cleaned.tags]
      .map((item) => String(item || '').trim())
      .filter((item, i, arr) => item && arr.indexOf(item) === i);
    const front = serializeFrontmatter({
      sub_id: record.subId,
      course_id: record.courseId,
      course: record.course,
      date: record.date,
      teacher: record.teacher,
      time: record.time,
      source: 'zju-campus',
      updated: new Date().toISOString(),
      tags,
    });
    const body = `${front}${cleaned.body}\n`;
    atomicWrite(path, body);

    const index = this.loadIndex();
    const previous = index.notes[key];
    index.notes[key] = { ...record, file, updatedAt: new Date().toISOString() };
    this.saveIndex(index);

    // 标题/日期变化导致文件名变化时，清掉旧文件
    if (previous?.file && previous.file !== file) {
      try {
        const old = join(this.dir, previous.file);
        if (existsSync(old)) writeFileSync(old, '', 'utf8');
      } catch {
        // 忽略
      }
    }

    const mirrored = this.mirror(record, file, body);
    return { path, file, record, mirrored };
  }

  /** 镜像到 Obsidian 库：笔记 + 附件 + 课程索引 + 总索引。 */
  mirror(record, file, body) {
    const obsidian = this.obsidianState();
    if (!obsidian || !obsidian.enabled || !obsidian.vault) return null;
    const root = join(obsidian.vault, obsidian.folder || '智云课堂');
    mkdirSync(join(root, '_课程'), { recursive: true });

    const target = join(root, file);
    atomicWrite(target, body);

    // 课件附件
    const sourceAttachments = this.attachmentDir(record.subId);
    if (existsSync(sourceAttachments)) {
      try {
        cpSync(sourceAttachments, join(root, '_附件', record.subId), { recursive: true });
      } catch {
        // 附件复制失败不影响笔记本身
      }
    }

    const link = file.replace(/\.md$/i, '');
    const courseName = record.course || '未分课程';
    const mocPath = join(root, '_课程', `${safeFileName(courseName)}.md`);
    const mocHeader = [
      '---',
      'type: 课程索引',
      `course: ${JSON.stringify(courseName)}`,
      '---',
      '',
      `# ${courseName}`,
      '',
      '## 课堂笔记',
    ].join('\n');
    let moc = '';
    try {
      moc = readFileSync(mocPath, 'utf8');
    } catch {
      moc = '';
    }
    if (!moc) moc = `${mocHeader}\n`;
    if (!moc.includes(`[[${link}]]`)) {
      moc = `${moc.trimEnd()}\n- [[${link}]]\n`;
      atomicWrite(mocPath, moc);
    }

    const indexPath = join(root, '_索引.md');
    // 整表重建（按日期倒序），避免追加顺序＝保存顺序导致表格乱序。
    const rows = Object.values(this.loadIndex().notes)
      .filter((item) => item && item.file)
      .sort(
        (a, b) =>
          String(b.date || '').localeCompare(String(a.date || '')) ||
          String(b.subId || '').localeCompare(String(a.subId || '')),
      )
      .map((item) => {
        const itemLink = String(item.file).replace(/\.md$/i, '');
        return `| ${item.date || ''} | ${item.course || ''} | [[${itemLink}]] |`;
      });
    const table = `# 智云课堂笔记索引\n\n| 日期 | 课程 | 笔记 |\n|---|---|---|\n${rows.join('\n')}\n`;
    let current = '';
    try {
      current = readFileSync(indexPath, 'utf8');
    } catch {
      current = '';
    }
    if (current !== table) atomicWrite(indexPath, table);

    return { root, note: target, moc: mocPath, index: indexPath };
  }

  /** 统计信息（面板用）。 */
  summary() {
    const list = this.list({ limit: 200 });
    const obsidian = this.obsidianState();
    return {
      count: list.length,
      dir: this.dir,
      subIds: list.map((item) => String(item.subId)),
      latest: list[0] || null,
      obsidian: {
        enabled: Boolean(obsidian?.enabled && obsidian?.vault),
        vault: obsidian?.vault || '',
        folder: obsidian?.folder || '',
      },
    };
  }
}

/** 判断一个路径看起来像 Obsidian 库（有 .obsidian 目录）。 */
export function looksLikeVault(path) {
  try {
    return existsSync(join(String(path), '.obsidian')) && statSync(String(path)).isDirectory();
  } catch {
    return false;
  }
}
