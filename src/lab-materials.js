/**
 * 大物实验课件：给 agent 用的「按实验找课件 → 下载到本地 → 返回路径」能力。
 *
 * 只做两件事：列课件、下载课件。都是只读 GET；下载的文件落在本机目录，
 * 文件名做安全清洗，不会覆盖到目录之外。
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, extname, resolve, sep } from 'node:path';
import { PhysicsLabClient } from './physics-lab.js';

const CLIENT_TTL_MS = 15 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

/** 早期版本写死过的位置。只在它确实存在、且新默认目录还没建时兼容复用。 */
const LEGACY_MATERIALS_ROOT = 'D:/LabCourseware/大物实验';

/**
 * 默认下载根目录：每个实验一个子文件夹。
 *
 * 刻意不写死盘符——换台机器没有 D: 盘就写不进去。默认落在用户目录下的
 * `ZJU/大物实验`；老版本建在 `D:/LabCourseware/大物实验` 且目录还在，就继续用老的，
 * 免得已有的实验文件夹对不上。要换位置就配 `labMaterialsRoot`，或下载时传 `saveDir`。
 */
export function defaultMaterialsRoot(settings) {
  const configured = String(settings?.labMaterialsRoot || '').trim();
  if (configured) return configured;
  const current = join(homedir(), 'ZJU', '大物实验');
  if (existsSync(current)) return current;
  if (existsSync(LEGACY_MATERIALS_ROOT)) return LEGACY_MATERIALS_ROOT;
  return current;
}

/** 去掉路径分隔符和 Windows 非法字符，避免写到目录外。 */
export function safeFileName(name, fallback = 'courseware') {
  const raw = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.+$/, '').trim();
  const base = basename(raw).slice(0, 120) || fallback;
  return base === '.' || base === '..' ? fallback : base;
}

/** 实验文件夹名：去掉 Windows 非法字符，保留中文和括号。 */
export function labFolderName(title, fallback = '未命名实验') {
  const cleaned = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * 把系统里的实验名压成可比较的键，用于自动对上你已有的本地文件夹。
 * 例：「必做1：▲示波器的使用+组装整流器（2周）」→「示波器的使用+组装整流器」
 *     「▲光的衍射G」→「光的衍射」
 */
export function normalizeLabKey(title) {
  return String(title || '')
    .replace(/^必做\s*\d+\s*[：:]\s*/u, '')
    .replace(/[▲△]/gu, '')
    .replace(/[（(]\s*\d+\s*周\s*[）)]/gu, '')
    .replace(/\s+/gu, '')
    .replace(/[Gg]$/u, '')
    .trim();
}

/**
 * 决定这次实验该落到哪个文件夹：
 *   1. 配置里显式写的别名；
 *   2. 根目录下已有同名文件夹；
 *   3. 根目录下已有「归一化后同名」的文件夹（自动别名）；
 *   4. 都没有就新建，用系统里的实验名。
 * @param {string} root 根目录
 * @param {string} title 实验名
 * @param {string[]} existing 根目录下已有的文件夹名
 * @param {Record<string,string>} [aliases] 显式别名：实验名或关键词 → 文件夹名
 */
export function resolveLabFolder(root, title, existing = [], aliases = {}) {
  const safeTitle = labFolderName(title);
  for (const [key, target] of Object.entries(aliases || {})) {
    if (!target) continue;
    if (title === key || title.includes(key) || normalizeLabKey(title) === normalizeLabKey(key)) {
      return { folder: labFolderName(target), matchedBy: 'alias' };
    }
  }
  // 归一化匹配优先：系统名常带「必做1：」「▲」「（2周）」「G」，要能对上你已有的目录。
  const key = normalizeLabKey(title);
  if (key) {
    const loose = existing.find((name) => normalizeLabKey(name) === key);
    if (loose) return { folder: loose, matchedBy: 'normalized' };
  }
  const exact = existing.find((name) => name === safeTitle);
  if (exact) return { folder: exact, matchedBy: 'exact' };
  if (key) {
    // 再放宽一点：已有文件夹名包含在实验名里（或反之），且长度足够避免误配
    const contained = existing.find((name) => {
      const n = normalizeLabKey(name);
      return n.length >= 2 && (key.includes(n) || n.includes(key));
    });
    if (contained) return { folder: contained, matchedBy: 'contains' };
  }
  return { folder: safeTitle, matchedBy: 'new' };
}

/**
 * 课件服务：缓存一个已登录客户端，过期或会话失效时重建一次。
 */
export class LabMaterials {
  constructor(settings = {}) {
    this.settings = settings;
    this.client = null;
    this.createdAt = 0;
  }

  async #getClient(force = false) {
    if (!force && this.client && Date.now() - this.createdAt < CLIENT_TTL_MS) return this.client;
    if (this.client) {
      try { this.client.close(); } catch { /* 忽略 */ }
      this.client = null;
    }
    const client = await PhysicsLabClient.login({
      allowInsecureHttp: this.settings.allowIndependentHttp === true,
      timeoutMs: this.settings.requestTimeoutMs || 25000,
    });
    this.client = client;
    this.createdAt = Date.now();
    return client;
  }

  /** 会话过期时重建一次再试。 */
  async #withClient(run) {
    try {
      return await run(await this.#getClient());
    } catch (error) {
      if (error?.code === 'SESSION_EXPIRED' || error?.code === 'AUTHORIZATION_FAILED') {
        return run(await this.#getClient(true));
      }
      throw error;
    }
  }

  /** 当前学期的全部实验（含所属课程）。 */
  async experiments() {
    const data = await this.#withClient((client) => client.schedule());
    const out = [];
    for (const course of data.courses || []) {
      for (const lesson of course.lessons || []) {
        out.push({
          labId: lesson.id,
          title: lesson.lab_name || course.courseName || `实验 ${lesson.id}`,
          course: course.courseName || '',
          date: lesson.date || '',
          time: lesson.times ?? '',
          teacher: lesson.teacher_name || '',
          room: lesson.address || '',
        });
      }
    }
    return out;
  }

  /**
   * 列出课件。lab 可以是实验 id、或名称关键词；不传则列出所有实验及其课件。
   * 只对匹配到的实验逐个请求课件，避免一次打 12 个接口。
   */
  async list({ lab } = {}) {
    const all = await this.experiments();
    const keyword = String(lab ?? '').trim();
    let targets = all;
    if (keyword) {
      const byId = all.filter((item) => String(item.labId) === keyword);
      targets = byId.length > 0 ? byId : all.filter((item) => item.title.includes(keyword) || item.course.includes(keyword));
    }
    if (targets.length === 0) return { experiments: [], note: `没有匹配「${keyword}」的实验` };

    const experiments = [];
    for (const target of targets.slice(0, 12)) {
      if (target.labId === null || target.labId === undefined) {
        experiments.push({ ...target, materials: [], error: '该实验没有可用的实验 id' });
        continue;
      }
      try {
        const materials = await this.#withClient((client) => client.materials(target.labId));
        experiments.push({ ...target, materials });
      } catch (error) {
        experiments.push({ ...target, materials: [], error: error?.code || '课件列表读取失败' });
      }
    }
    return { experiments };
  }

  /**
   * 下载课件。
   * @param {{ lab?: string, courseware?: string, coursewareId?: number, saveDir?: string }} options
   */
  async download({ lab, courseware, coursewareId, saveDir } = {}) {
    const listed = await this.list({ lab });
    const candidates = [];
    for (const experiment of listed.experiments || []) {
      for (const item of experiment.materials || []) candidates.push({ experiment, item });
    }
    if (candidates.length === 0) throw new Error('没有找到可下载的课件：先确认实验名称，或该实验没有上传课件');

    let picked;
    if (coursewareId !== undefined && coursewareId !== null && coursewareId !== '') {
      picked = candidates.find((entry) => String(entry.item.id) === String(coursewareId));
      if (!picked) throw new Error(`在匹配的实验里找不到课件 id=${coursewareId}`);
    } else {
      const needle = String(courseware ?? '').trim();
      const matched = needle ? candidates.filter((entry) => entry.item.name.includes(needle)) : candidates;
      if (matched.length === 0) throw new Error(`没有匹配「${needle}」的课件`);
      if (matched.length > 1) {
        const names = matched.slice(0, 8).map((entry) => `${entry.item.name}（id=${entry.item.id}）`).join('；');
        throw new Error(`匹配到多个课件，请指定 courseware_id 或更精确的 courseware：${names}`);
      }
      picked = matched[0];
    }

    const file = await this.#withClient((client) =>
      client.downloadMaterial(picked.item.id, picked.item.baseName || picked.item.name),
    );
    if (file.buffer.length > MAX_DOWNLOAD_BYTES) throw new Error('课件超过 200MB，拒绝保存');

    // 根目录（默认 <用户目录>/ZJU/大物实验，可用 labMaterialsRoot 覆盖），每个实验一个子文件夹，没有就新建。
    // 已有同名/归一化同名的文件夹优先复用，这样能对上你本地整理好的目录。
    const root = resolve(saveDir ? String(saveDir) : defaultMaterialsRoot(this.settings));
    let existing = [];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      existing = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name);
    } catch { /* 根目录还不存在，按新文件夹处理 */ }

    const resolved = resolveLabFolder(root, picked.experiment.title, existing, this.settings.labAliases || {});
    const dir = resolve(root, resolved.folder);
    if (dir !== root && !dir.startsWith(root + sep)) throw new Error('实验文件夹路径越界，已拒绝写入');

    await mkdir(dir, { recursive: true });
    let fileName = safeFileName(picked.item.name, `courseware-${picked.item.id}`);
    if (!extname(fileName) && picked.item.ext) fileName += `.${picked.item.ext}`;
    const filePath = resolve(dir, fileName);
    if (!filePath.startsWith(dir + sep)) throw new Error('课件文件名越界，已拒绝写入');
    await writeFile(filePath, file.buffer);

    return {
      filePath,
      folder: dir,
      folderName: resolved.folder,
      matchedBy: resolved.matchedBy,
      bytes: file.buffer.length,
      contentType: file.contentType,
      name: picked.item.name,
      lab: picked.experiment.title,
      course: picked.experiment.course,
      coursewareId: picked.item.id,
    };
  }

  close() {
    try { this.client?.close(); } catch { /* 忽略 */ }
    this.client = null;
  }
}
