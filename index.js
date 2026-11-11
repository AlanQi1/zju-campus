/**
 * 浙大校园助手（DSH Host 插件）
 *
 * 把 ZJUAM 统一身份认证、学在浙大、智云课堂和校园公开通知封装成一组工具。
 * 只用 Node 内置能力，不 import 任何 @deepseek-ai/* 运行时值，注册的是普通对象定义。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { ZjuSession, maskAccount, privateCredentialsFile, ensureCredentialTemplate } from './src/session.js';
import { ensureIndependentAccountsTemplate } from './src/independent-accounts.js';
import { createSummaryCache } from './src/panel.js';
import { LabMaterials, defaultMaterialsRoot } from './src/lab-materials.js';
import { allowDirectHosts } from './src/http.js';
import { fetchNotices, fetchNoticeDetail, SOURCES } from './src/notices.js';
import { RollcallLocations, defaultLocationsFile } from './src/rollcall-locations.js';
import { RollcallSwitch, defaultSwitchFile } from './src/rollcall-switch.js';
import { RollcallAuto, defaultAutoFile } from './src/rollcall-auto.js';
import { NumberDetector } from './src/rollcall-number.js';
import { createNumberGather } from './src/rollcall-number-source.js';
import {
  NotesStore,
  ObsidianSettings,
  defaultNotesDir,
  defaultObsidianFile,
  detectObsidianVaults,
  looksLikeVault,
} from './src/notes.js';
import { answerRadarRollcall } from './src/rollcall-answer.js';
import {
  formatCourses,
  formatHomework,
  formatMaterials,
  formatNoticeDetail,
  formatNotices,
  formatPlayback,
  formatRollcallAnswer,
  formatRollcallLocations,
  formatSchedule,
  formatStatus,
  formatTodos,
  formatTranscript,
  formatCachedNote,
  formatNotesMaterials,
  formatNoteSaved,
  formatNotesList,
  formatObsidianStatus,
} from './src/format.js';

export const name = 'zju-campus';
export const inject = ['tools'];

const DEFAULT_CONFIG = {
  username: '',
  password: '',
  envFile: '',
  tenantId: '112',
  sessionTtlMinutes: 15,
  requestTimeoutMs: 20000,
  allowWriteOps: false,
  allowIndependentHttp: false,
  noticeSources: ['qsxy', 'bksy', 'sis', 'opt'],
  allowRollcallSign: false,
  rollcallLocationsFile: '',
  rollcallSwitchFile: '',
  rollcallAutoFile: '',
  rollcallAuto: true,
  rollcallAutoIntervalMs: 60000,
  rollcallAutoMaxTries: 2,
  rollcallAutoRetryMs: 180000,
  rollcallNumber: true,
  rollcallNumberTtlMs: 90000,
  rollcallNumberLive: true,
  rollcallDefaultLocation: '',
  rollcallAccuracy: 68,
  rollcallMaxAttempts: 20,
  rollcallAttemptDelayMs: 800,
  notesDir: '',
  obsidianFile: '',
  obsidianVault: '',
  obsidianFolder: '智云课堂',
  notesDownloadSlides: true,
  ocrPython: 'python',
  labMaterialsRoot: '',
  labAliases: {},
};

/** 插件根目录（用于定位 scripts/ 下的辅助脚本）。 */
const pluginDir = dirname(fileURLToPath(import.meta.url));

/** 跑一个外部命令，收集 stdout/stderr，不抛错。 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd || pluginDir,
        timeout: options.timeoutMs || 120000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          stdout: stdout || '',
          stderr: stderr || (error && error.message) || '',
        });
      },
    );
  });
}

/** 归一化插件配置（YAML 里的值可能是字符串）。 */
function normalizeConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
  const ttlMinutes = Number(merged.sessionTtlMinutes);
  const timeoutMs = Number(merged.requestTimeoutMs);
  const sources = Array.isArray(merged.noticeSources)
    ? merged.noticeSources.filter((id) => Object.prototype.hasOwnProperty.call(SOURCES, id))
    : DEFAULT_CONFIG.noticeSources;
  const accuracy = Number(merged.rollcallAccuracy);
  const maxAttempts = Number(merged.rollcallMaxAttempts);
  const attemptDelay = Number(merged.rollcallAttemptDelayMs);
  return {
    username: String(merged.username || '').trim(),
    password: String(merged.password || ''),
    envFile: String(merged.envFile || '').trim(),
    tenantId: String(merged.tenantId || '112'),
    sessionTtlMs: (Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 15) * 60 * 1000,
    requestTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000,
    allowWriteOps: merged.allowWriteOps === true || merged.allowWriteOps === 'true',
    allowIndependentHttp: merged.allowIndependentHttp === true,
    enableEngineering: merged.enableEngineering === true,
    noticeSources: sources.length > 0 ? sources : DEFAULT_CONFIG.noticeSources,
    allowRollcallSign: merged.allowRollcallSign === true || merged.allowRollcallSign === 'true',
    rollcallLocationsFile: String(merged.rollcallLocationsFile || '').trim(),
    rollcallSwitchFile: String(merged.rollcallSwitchFile || '').trim(),
    rollcallAutoFile: String(merged.rollcallAutoFile || '').trim(),
    rollcallAuto: merged.rollcallAuto !== false && merged.rollcallAuto !== 'false',
    rollcallAutoIntervalMs: Number.isFinite(Number(merged.rollcallAutoIntervalMs))
      ? Math.min(Math.max(Number(merged.rollcallAutoIntervalMs), 15000), 600000)
      : 60000,
    rollcallAutoMaxTries: Number.isFinite(Number(merged.rollcallAutoMaxTries))
      ? Math.min(Math.max(Math.floor(Number(merged.rollcallAutoMaxTries)), 1), 5)
      : 2,
    rollcallAutoRetryMs: Number.isFinite(Number(merged.rollcallAutoRetryMs))
      ? Math.min(Math.max(Math.floor(Number(merged.rollcallAutoRetryMs)), 30000), 3600000)
      : 180000,
    rollcallNumber: merged.rollcallNumber !== false && merged.rollcallNumber !== 'false',
    rollcallNumberTtlMs: Number.isFinite(Number(merged.rollcallNumberTtlMs))
      ? Math.min(Math.max(Math.floor(Number(merged.rollcallNumberTtlMs)), 15000), 600000)
      : 90000,
    rollcallNumberLive: merged.rollcallNumberLive !== false && merged.rollcallNumberLive !== 'false',
    rollcallDefaultLocation: String(merged.rollcallDefaultLocation || '').trim(),
    rollcallAccuracy: Number.isFinite(accuracy) && accuracy > 0 ? Math.min(accuracy, 1000) : 68,
    rollcallMaxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.min(Math.floor(maxAttempts), 40) : 20,
    rollcallAttemptDelayMs:
      Number.isFinite(attemptDelay) && attemptDelay >= 0 ? Math.min(Math.floor(attemptDelay), 10000) : 800,
    notesDir: String(merged.notesDir || '').trim(),
    obsidianFile: String(merged.obsidianFile || '').trim(),
    obsidianVault: String(merged.obsidianVault || '').trim(),
    obsidianFolder: String(merged.obsidianFolder || '智云课堂').trim() || '智云课堂',
    notesDownloadSlides: merged.notesDownloadSlides !== false && merged.notesDownloadSlides !== 'false',
    ocrPython: String(merged.ocrPython || 'python').trim() || 'python',
    labMaterialsRoot: String(merged.labMaterialsRoot || '').trim(),
    labAliases:
      merged.labAliases && typeof merged.labAliases === 'object' && !Array.isArray(merged.labAliases)
        ? merged.labAliases
        : {},
  };
}

/** 上海时区的今天。 */
function todayShanghai() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** YYYY-MM-DD 加减天数（东八区自然日）。 */
function shiftDate(dateString, delta) {
  const base = Date.parse(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(base)) return dateString;
  const d = new Date(base + delta * 86400000 + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 秒 → mm:ss。 */
function clockText(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 最近一次拉到的课堂材料（转录 / 课件），供 zju_save_note 复用。 */
const materialsCache = new Map();
const MATERIALS_TTL_MS = 30 * 60 * 1000;

function cacheMaterials(subId, value) {
  materialsCache.set(String(subId), { at: Date.now(), ...value });
}

function readMaterials(subId) {
  const hit = materialsCache.get(String(subId));
  if (!hit) return null;
  if (Date.now() - hit.at > MATERIALS_TTL_MS) {
    materialsCache.delete(String(subId));
    return null;
  }
  return hit;
}

/** 在最近 N 天课表里找一节课（拿 course_id / 日期 / 老师）。 */
async function resolveLesson(session, subId, days = 14) {
  const today = todayShanghai();
  const start = shiftDate(today, -(Math.max(1, days) - 1));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const data = await session.withClient('cmc', (client) => client.schedule(start, today));
      const found = (data.lessons || []).find((lesson) => String(lesson.subId) === String(subId));
      if (found) return found;
      return null;
    } catch {
      if (attempt === 2) return null;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  return null;
}

/** 课件图片扩展名。 */
function slideExtension(url) {
  const match = /\.(png|webp|gif|jpg|jpeg)(?:\?|$)/i.exec(String(url || ''));
  if (!match) return 'jpg';
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

/** 笔记末尾的课件时间轴（图片用相对路径，缓存与 Obsidian 通用）。 */
function buildSlideSection(slides) {
  const items = (slides || []).filter((slide) => slide.file);
  if (items.length === 0) return '';
  const lines = ['', '## 课件时间轴', ''];
  for (const slide of items) {
    lines.push(`- [${clockText(slide.at)}] ![](${slide.file})`);
  }
  return lines.join('\n');
}

/** 统一成正斜杠，避免 Windows 路径混排。 */
function slashPath(value) {
  return String(value || '').split(String.fromCharCode(92)).join('/');
}

/** 读取课件 OCR 结果（scripts/slides-ocr.py 产出），失败返回空 Map。 */
function readSlideOcr(notes, subId) {
  const file = join(notes.attachmentDir(subId), 'ocr.json');
  if (!existsSync(file)) return new Map();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const map = new Map();
    for (const page of data.pages || []) {
      const lines = (page.lines || []).map((line) => String(line).trim()).filter(Boolean);
      if (lines.length > 0) map.set(String(page.file), lines);
    }
    return map;
  } catch {
    return new Map();
  }
}

/** 把 OCR 文字挂到对应的课件页上。 */
function attachSlideOcr(slides, ocrMap) {
  if (!ocrMap || ocrMap.size === 0) return slides || [];
  return (slides || []).map((slide) => {
    const name = String(slide.file || '').split('/').pop();
    const lines = ocrMap.get(name);
    return lines && lines.length > 0 ? { ...slide, text: lines } : slide;
  });
}

/**
 * 把课件图下载到笔记缓存目录，返回带相对路径与本地绝对路径的课件列表。
 * absPath 供 OCR 脚本与人工排查用；PPT 的文字内容走 zju_slides_ocr。
 */
async function ensureSlideFiles(session, notes, subId, slides) {
  const items = slides || [];
  if (items.length === 0) return [];
  const dir = notes.attachmentDir(subId);
  mkdirSync(dir, { recursive: true });
  return session.withClient('cmc', async (client) => {
    const out = [];
    for (const slide of items) {
      const file = `ppt-${String(slide.index).padStart(3, '0')}.${slideExtension(slide.url)}`;
      const target = join(dir, file);
      try {
        if (!existsSync(target)) {
          const image = await client.downloadSlide(slide.url);
          writeFileSync(target, image.buffer);
        }
        out.push({ ...slide, file: `_附件/${subId}/${file}`, absPath: slashPath(target) });
      } catch {
        // 单张失败就跳过，不阻塞整篇笔记
      }
    }
    return out;
  });
}

/**
 * 把正文里的 {{slide:N}} / {{slide:N|说明}} 占位符替换成真正的图片链接。
 * 让模型能写图文混排而不用记路径。
 */
export function replaceSlidePlaceholders(markdown, slides, subId) {
  const items = slides || [];
  const total = (String(markdown || '').match(/\{\{slide:\s*\d+/g) || []).length;
  if (items.length === 0) {
    // 课件没拉到：原样保留占位符，等下次保存（或手动补）再替换，绝不把正文写成警告。
    return { body: String(markdown || ''), used: 0, missing: total };
  }
  const byIndex = new Map(items.map((slide) => [Number(slide.index), slide]));
  let used = 0;
  let missing = 0;
  const body = String(markdown || '').replace(
    /\{\{slide:\s*(\d+)\s*(?:\|([\s\S]*?))?\}\}(?!\})/g,
    (match, rawIndex, caption) => {
      const slide = byIndex.get(Number(rawIndex));
      const alt =
        String(caption || '')
          .replace(/\s+/g, ' ')
          .replace(/[[\]]/g, ' ')
          .trim() || `第 ${rawIndex} 页`;
      if (!slide) {
        missing += 1;
        return match;
      }
      used += 1;
      const file = slide.file || `_附件/${subId}/ppt-${String(slide.index).padStart(3, '0')}.jpg`;
      return `![${alt}](${file})`;
    },
  );
  return { body, used, missing };
}

/**
 * 组装一个纯文本工具定义。
 * @param {{ name: string, description: string, parameters?: Record<string, any>, run: (args: any, exec: any) => Promise<string> }} spec
 */
function textTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: {
      type: 'object',
      properties: spec.parameters || {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      return spec.run(args || {}, exec);
    },
  };
}

/**
 * 读取一个 JSON 请求体（限制大小，避免本地接口被塞大包）。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [limit]
 */
function readJsonBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 雷达点名代签的核心实现。工具 `zju_rollcall_answer` 和面板按钮
 * （POST /dsh-zju/rollcall-sign）都走这一份，避免两处逻辑漂移。
 *
 * @param {{
 *   session: ZjuSession,
 *   settings: ReturnType<typeof normalizeConfig>,
 *   locations: import('./src/rollcall-locations.js').RollcallLocations,
 *   rollcallSwitch: import('./src/rollcall-switch.js').RollcallSwitch,
 *   args: {
 *     rollcall_id?: string|number,
 *     location?: string,
 *     strategy?: 'single'|'fallback',
 *     max_attempts?: number,
 *     save_estimate?: boolean,
 *     dry_run?: boolean,
 *     confirm?: boolean,
 *   },
 * }} options
 */
async function signRadarRollcall({ session, settings, locations, rollcallSwitch, args }) {
  const dryRun = args.dry_run === true;
  const signState = rollcallSwitch.effective(settings.allowRollcallSign);
  if (!dryRun && !signState.enabled) {
    throw new Error(
      '虚拟位置代签未开启。可以在面板「签到」区打开「虚拟位置代签」开关，或把 profile 补丁里 zju-campus 行的 config.allowRollcallSign 改成 true。',
    );
  }
  if (!dryRun && args.confirm !== true) {
    throw new Error('这是真实签到写操作：确认后请带 confirm: true 重新调用；想先看尝试顺序可带 dry_run: true。');
  }
  if (args.rollcall_id === undefined || args.rollcall_id === null || args.rollcall_id === '') {
    throw new Error('缺少 rollcall_id：先用 zju_rollcall 查看进行中的点名');
  }

  let explicit = null;
  if (args.location) {
    const resolved = locations.resolve(args.location);
    if (!resolved.location) {
      throw new Error(
        resolved.candidates.length > 0
          ? `「${args.location}」匹配到多个点位：${resolved.candidates.map((item) => item.name).join('、')}`
          : `找不到点位「${args.location}」，可先用 zju_rollcall_location action=list 查看。`,
      );
    }
    explicit = resolved.location;
  }

  let defaultLocation = null;
  if (settings.rollcallDefaultLocation) {
    defaultLocation = locations.resolve(settings.rollcallDefaultLocation).location;
  }
  if (!defaultLocation) defaultLocation = locations.defaultLocation();

  const fallbackLocations = [...locations.custom(), ...locations.presets];
  const maxAttempts = Number(args.max_attempts) > 0 ? Number(args.max_attempts) : settings.rollcallMaxAttempts;

  const result = await session.withClient('courses', async (client) => {
    const list = await client.rollcalls();
    const rollcall = list.find((item) => String(item.id) === String(args.rollcall_id));
    if (!rollcall) {
      throw new Error(`找不到点名 #${args.rollcall_id}。它可能已经结束，先用 zju_rollcall 看看当前列表。`);
    }
    if (!rollcall.isRadar) {
      throw new Error(`点名 #${args.rollcall_id} 是「${rollcall.type}」，不是雷达点名，虚拟位置对它无效。`);
    }
    return answerRadarRollcall({
      client,
      rollcall,
      location: explicit,
      defaultLocation,
      fallbackLocations,
      strategy: args.strategy === 'single' ? 'single' : 'fallback',
      maxAttempts,
      delayMs: settings.rollcallAttemptDelayMs,
      accuracy: settings.rollcallAccuracy,
      dryRun,
    });
  });

  if (args.save_estimate === true && result.ok && result.estimated && result.usedEstimated) {
    try {
      result.savedLocation = locations.add({
        name: `推算点-${result.rollcall.id}`,
        lon: result.estimated.lon,
        lat: result.estimated.lat,
        note: `三点定位 RMS ${result.estimated.rms}m（点名 #${result.rollcall.id}）`,
        source: 'learned',
      });
    } catch (error) {
      result.saveError = error.message;
    }
  }

  return result;
}

/**
 * 构建全部工具定义。
 * @param {ZjuSession} session
 * @param {ReturnType<typeof normalizeConfig>} settings
 * @param {import('./src/lab-materials.js').LabMaterials} labMaterials
 * @param {import('./src/rollcall-locations.js').RollcallLocations} locations
 * @param {import('./src/rollcall-switch.js').RollcallSwitch} rollcallSwitch
 * @param {import('./src/notes.js').NotesStore} notes
 * @param {import('./src/notes.js').ObsidianSettings} obsidianSettings
 */
function buildTools(session, settings, labMaterials, locations, rollcallSwitch, notes, obsidianSettings) {
  const requireWrite = () => {
    if (!settings.allowWriteOps) {
      throw new Error(
        '写操作未开启。若确实要提交/撤回作业，请把 profile 补丁里 zju-campus 行的 config.allowWriteOps 改成 true，然后重载插件。',
      );
    }
  };

  return [
    textTool({
      name: 'zju_status',
      description:
        '查看浙大校园助手的认证状态：是否已配置学号密码、学在浙大与智云课堂的会话是否有效、会话有效期、写操作开关和通知来源。不访问学校站点，只读本地状态。',
      run: async () =>
        formatStatus(session.status(), settings, {
          rollcallSign: rollcallSwitch.effective(settings.allowRollcallSign),
          notes: notes.summary(),
          obsidian: obsidianSettings.effective(),
        }),
    }),

    textTool({
      name: 'zju_login',
      description:
        '主动用已配置的账号登录 ZJUAM，并分别建立学在浙大与智云课堂的会话。通常不需要手动调用：其他工具会在需要时自动登录。用于登录失败后重试，或切换账号后刷新。',
      run: async () => {
        const credentials = session.credentials();
        if (!credentials) {
          throw new Error(
            `未配置浙大账号。请在 ${privateCredentialsFile()} 写入 ZJU_USER 与 ZJU_PASSWORD。`,
          );
        }
        await session.coursesClient(true);
        let cmcLine = '智云课堂：登录成功';
        try {
          const cmc = await session.cmcClient(true);
          cmcLine = `智云课堂：登录成功${cmc.user.realname ? `（${cmc.user.realname}）` : ''}`;
        } catch (error) {
          cmcLine = `智云课堂：登录失败 —— ${error.message}`;
        }
        return [
          `ZJUAM 认证成功：${maskAccount(credentials.username)}（凭据来源：${credentials.source}）`,
          '学在浙大：登录成功',
          cmcLine,
        ].join('\n');
      },
    }),

    textTool({
      name: 'zju_logout',
      description: '清除本插件内存中的学在浙大与智云课堂会话 Cookie。不会删除已配置的账号密码。',
      run: async () => {
        session.logout();
        return '已清除内存中的校园会话。下次调用需要时会重新登录。';
      },
    }),

    textTool({
      name: 'zju_todos',
      description:
        '列出「学在浙大」当前未完成的待办（作业、考试、测验、问卷），含课程名、类型、东八区截止日期和待办 id。只含未完成项；要看某门课的全部作业（含已提交）请用 zju_homework。',
      parameters: {
        type: {
          type: 'string',
          enum: ['homework', 'exam', 'quiz', 'survey'],
          description: '只看某一类待办：homework 作业 / exam 考试 / quiz 测验 / survey 问卷；省略则全部',
        },
        days: {
          type: 'number',
          description: '只看未来 N 天内截止的待办；省略则不限',
        },
        urgent_only: {
          type: 'boolean',
          description: '是否只看紧迫待办（7 天内截止或已过期），默认 false',
        },
      },
      run: async (args) => {
        const todos = await session.withClient('courses', (client) => client.todos());
        let list = todos;
        if (args.type) list = list.filter((item) => item.typeRaw === args.type);
        if (args.urgent_only) {
          const limit = Date.now() + 7 * 86400000;
          list = list.filter((item) => {
            const at = item.endTime ? Date.parse(item.endTime) : Number.NaN;
            return Number.isNaN(at) ? true : at <= limit;
          });
        } else if (Number.isFinite(Number(args.days)) && Number(args.days) > 0) {
          const limit = Date.now() + Number(args.days) * 86400000;
          list = list.filter((item) => {
            const at = item.endTime ? Date.parse(item.endTime) : Number.NaN;
            return Number.isNaN(at) ? true : at <= limit;
          });
        }
        list = [...list].sort((a, b) => String(a.deadlineAt || a.deadline || '9999').localeCompare(String(b.deadlineAt || b.deadline || '9999')));
        return formatTodos(list, { type: args.type, days: args.urgent_only ? 7 : args.days });
      },
    }),

    textTool({
      name: 'zju_courses',
      description:
        '列出「学在浙大」我的课程，含课程 id、名称、课程代码、学年学期、开课学院、授课教师、学习进度。返回的 id 可直接传给 zju_homework。',
      parameters: {
        keyword: { type: 'string', description: '按课程名或课程代码模糊过滤' },
        status: {
          type: 'array',
          items: { type: 'string', enum: ['ongoing', 'notStarted', 'ended'] },
          description: '课程状态过滤：ongoing 进行中 / notStarted 未开始 / ended 已结束；省略则全部',
        },
      },
      run: async (args) => {
        const courses = await session.withClient('courses', (client) =>
          client.courses({ keyword: args.keyword, status: args.status }),
        );
        return formatCourses(courses);
      },
    }),

    textTool({
      name: 'zju_homework',
      description:
        '列出某门课程下的全部作业（已提交、未提交、已结束都在内），含截止时间、提交状态、得分、老师评语和 activity_id。activity_id 可传给 zju_submit_homework / zju_retract_homework。需要 course_id（来自 zju_courses）。',
      parameters: {
        course_id: { type: ['string', 'number'], description: '课程 id，例如 97960' },
        include_submission: {
          type: 'boolean',
          description: '是否附带「我的提交」详情（文件名、是否草稿、能否撤回、得分、评语），默认 true',
        },
      },
      run: async (args) => {
        if (args.course_id === undefined || args.course_id === null || args.course_id === '') {
          throw new Error('缺少 course_id：先用 zju_courses 拿到课程 id');
        }
        const data = await session.withClient('courses', (client) =>
          client.homework(args.course_id, { includeSubmission: args.include_submission !== false }),
        );
        return formatHomework(data);
      },
    }),

    textTool({
      name: 'zju_materials',
      description:
        '查询「学在浙大」某门课程的课件、讲义与参考资料（含附件文件名、大小与 activity_id）。需要 course_id（来自 zju_courses），可用 keyword 过滤。',
      parameters: {
        course_id: { type: ['string', 'number'], description: '课程 id，例如 97960（来自 zju_courses）' },
        keyword: { type: 'string', description: '按课件或资料标题关键词过滤' },
      },
      run: async (args) => {
        if (!args.course_id) throw new Error('缺少 course_id：先用 zju_courses 拿到课程 id');
        const materials = await session.withClient('courses', (client) =>
          client.materials(args.course_id, { keyword: args.keyword }),
        );
        return formatMaterials(materials, args.course_id);
      },
    }),

    textTool({
      name: 'zju_schedule',
      description:
        '查询「智云课堂」某天或某个日期区间的课表，含每节课的 sub_id、课程名、老师、教室、上课时间与状态（「回放」表示转录已生成）。sub_id 可传给 zju_transcript。',
      parameters: {
        date: { type: 'string', description: '起始日期 YYYY-MM-DD（东八区）；省略为今天' },
        end_date: { type: 'string', description: '结束日期 YYYY-MM-DD；省略等于 date' },
      },
      run: async (args) => {
        const start = args.date || todayShanghai();
        const end = args.end_date || start;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
          throw new Error('date / end_date 需要 YYYY-MM-DD 格式');
        }
        const data = await session.withClient('cmc', (client) => client.schedule(start, end));
        return formatSchedule(data);
      },
    }),

    textTool({
      name: 'zju_transcript',
      description:
        '拉取「智云课堂」某节课的语音识别转录（带时间戳的中文逐段文本）。需要 sub_id（来自 zju_schedule）。只有「回放」状态的课有转录。',
      parameters: {
        sub_id: { type: ['string', 'number'], description: '课程节次 id（zju_schedule 返回的 sub_id）' },
        max_segments: { type: 'number', description: '最多返回多少段，防止过长；省略则全部返回' },
        with_translation: { type: 'boolean', description: '是否附带英文翻译行，默认 false' },
      },
      run: async (args) => {
        if (args.sub_id === undefined || args.sub_id === null || args.sub_id === '') {
          throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
        }
        const segments = await session.withClient('cmc', (client) => client.transcript(args.sub_id));
        return formatTranscript({
          subId: args.sub_id,
          segments,
          maxSegments: args.max_segments,
          withTranslation: args.with_translation === true,
        });
      },
    }),

    textTool({
      name: 'zju_playback',
      description:
        '获取「智云课堂」某节课的视频回放直达链接（livingroom 播放地址）。需要 sub_id（来自 zju_schedule），可选传 course_id。',
      parameters: {
        sub_id: { type: ['string', 'number'], description: '课程节次 id（zju_schedule 返回的 sub_id）' },
        course_id: { type: ['string', 'number'], description: '可选：课程 id' },
      },
      run: async (args) => {
        if (!args.sub_id) throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
        const playback = await session.withClient('cmc', (client) =>
          client.playback(args.sub_id, args.course_id),
        );
        return formatPlayback(playback);
      },
    }),

    textTool({
      name: 'zju_slides_ocr',
      description:
        '把某节课的课件截图批量 OCR 成文字并缓存（_附件/<sub_id>/ocr.json）。做完之后 zju_notes 的材料里就会带上每一页 PPT 的文字，笔记能把课件内容真正整理进去。需要本机 python 与 rapidocr-onnxruntime。',
      parameters: {
        sub_id: { type: ['string', 'number'], description: '课程节次 id（来自 zju_schedule）' },
        force: { type: 'boolean', description: '已有 OCR 结果时也重新识别，默认 false' },
      },
      run: async (args) => {
        const subId = String(args.sub_id || '').trim();
        if (!subId) throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
        const dir = notes.attachmentDir(subId);
        const outFile = join(dir, 'ocr.json');
        if (args.force !== true && existsSync(outFile)) {
          const cached = readSlideOcr(notes, subId);
          return `课件 OCR 已有缓存：${cached.size} 页（${slashPath(outFile)}）。要重新识别请传 force: true。`;
        }
        if (!existsSync(dir)) throw new Error('还没下载课件图：先调用 zju_notes 拉一次材料（会自动下载课件）');

        const script = join(pluginDir, 'scripts', 'slides-ocr.py');
        if (!existsSync(script)) throw new Error(`找不到 OCR 脚本：${script}`);
        const python = settings.ocrPython || 'python';
        const result = await runCommand(python, [script, dir, outFile], { timeoutMs: 1800000 });
        if (result.code !== 0) {
          throw new Error(`OCR 失败（退出码 ${result.code}）：${(result.stderr || result.stdout || '').slice(-500)}`);
        }
        const ocr = readSlideOcr(notes, subId);
        return [
          `课件 OCR 完成：${ocr.size} 页有文字。`,
          `文件：${slashPath(outFile)}`,
          '接下来重新调用 zju_notes（传 force: true）拉材料，就能拿到每页 PPT 的文字了。',
        ].join('\n');
      },
    }),

    textTool({
      name: 'zju_notes',
      description:
        '读取/准备「智云课堂」一节课的笔记材料：已有缓存笔记时直接返回 Markdown；没有缓存时返回「按时间段绑定的转录 + 对应课件页 + 课件图本地路径」，供模型读图并生成图文混排笔记，再用 zju_save_note 保存。转录长时会自动分段，用 part 逐段读完。需要 sub_id（来自 zju_schedule）。',
      parameters: {
        sub_id: { type: ['string', 'number'], description: '课程节次 id（zju_schedule 返回的 sub_id）' },
        force: { type: 'boolean', description: '忽略已有缓存笔记与材料，重新拉取，默认 false' },
        include_slides: { type: 'boolean', description: '是否包含课件（PPT），默认 true' },
        part: { type: 'number', description: '第几段材料（1 起，默认 1）；材料头会告诉你总共几段' },
      },
      run: async (args) => {
        if (!args.sub_id) throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
        const subId = String(args.sub_id);
        const part = Math.max(1, Number(args.part) || 1);
        if (args.force !== true && part === 1) {
          const cached = notes.read(subId);
          if (cached) return formatCachedNote(cached);
        }
        const cachedMaterials = args.force === true ? null : readMaterials(subId);
        let lesson = cachedMaterials?.lesson || null;
        let segments = cachedMaterials?.transcript || null;
        let slides = cachedMaterials?.slides || null;
        let slidesError = '';
        if (!lesson || !segments || !slides) {
          lesson = lesson || (await resolveLesson(session, subId).catch(() => null));
          segments = segments || (await session.withClient('cmc', (client) => client.transcript(subId)));
          if (slides) {
            // 已有课件缓存
          } else if (args.include_slides !== false) {
            if (lesson?.courseId) {
              try {
                slides = await session.withClient('cmc', (client) => client.slides(subId, lesson.courseId));
              } catch (error) {
                slides = [];
                slidesError = error.message;
              }
            } else {
              slides = [];
              slidesError = '没有 course_id，无法定位课件';
            }
          } else {
            slides = [];
          }
          cacheMaterials(subId, { lesson, transcript: segments, slides });
        }
        let slideFiles = [];
        if (args.include_slides !== false && slides && slides.length > 0) {
          slideFiles = await ensureSlideFiles(session, notes, subId, slides);
        }
        const ocrMap = readSlideOcr(notes, subId);
        const withText = attachSlideOcr(slideFiles.length > 0 ? slideFiles : slides, ocrMap);
        return formatNotesMaterials({
          subId,
          lesson,
          segments,
          slides: withText,
          slidesError,
          slideDir: slashPath(notes.attachmentDir(subId)),
          ocrReady: ocrMap.size > 0,
          part,
        });
      },
    }),

    textTool({
      name: 'zju_save_note',
      description:
        '保存一节「智云课堂」的结构化笔记：写入本地缓存（$DSH_HOME/zju-campus/notes），配置了 Obsidian 时同步到库内，并自动下载课件图片。正文里可以用 {{slide:N}} 或 {{slide:N|说明}} 占位符就地插图，保存时会替换成正确的图片链接；若正文没有占位符，则在末尾追加一份「课件时间轴」。',
      parameters: {
        sub_id: { type: ['string', 'number'], description: '课程节次 id（zju_schedule / zju_notes 返回的 sub_id）' },
        markdown: { type: 'string', description: '结构化笔记正文；插图用 {{slide:N}} 占位符（N 为课件页码）' },
        course_id: { type: ['string', 'number'], description: '可选：课程 id，用于拉课件；不传会自动从近 14 天课表里找' },
        title: { type: 'string', description: '可选：课程名，默认用课表里的名称' },
        course: { type: 'string', description: '可选：笔记归属的课程名（用于 Obsidian 课程索引）' },
        date: { type: 'string', description: '可选：上课日期 YYYY-MM-DD，默认用课表里的日期' },
        teacher: { type: 'string', description: '可选：老师' },
        time: { type: 'string', description: '可选：上课时间，如 07:56-09:35' },
        download_slides: { type: 'boolean', description: '是否下载课件图片，默认 true' },
      },
      run: async (args) => {
        const subId = String(args.sub_id || '').trim();
        const markdown = String(args.markdown || '').trim();
        if (!subId) throw new Error('缺少 sub_id：先用 zju_schedule / zju_notes 拿到课程的 sub_id');
        if (!markdown) throw new Error('缺少 markdown：请先根据 zju_notes 的材料生成结构化笔记');
        if (markdown.length > 200000) throw new Error('markdown 过长（上限 200KB）');

        const cachedMaterials = readMaterials(subId);
        let lesson = cachedMaterials?.lesson || null;
        if (!lesson || (!lesson.courseId && !args.course_id)) {
          const found = await resolveLesson(session, subId).catch(() => null);
          lesson = { ...(lesson || {}), ...(found || {}) };
        }
        const meta = {
          subId,
          courseId: args.course_id || lesson?.courseId || '',
          title: args.title || lesson?.title || `课程 ${subId}`,
          course: args.course || lesson?.title || '',
          date: args.date || lesson?.date || '',
          teacher: args.teacher || lesson?.teacher || '',
          time: args.time || (lesson?.startAt && lesson?.endAt ? `${lesson.startAt}-${lesson.endAt}` : ''),
          url: lesson?.url || '',
        };

        let slides = cachedMaterials?.slides || [];
        const hasPlaceholders = /\{\{slide:\s*\d+/.test(markdown);
        const wantSlides =
          (args.download_slides !== false || hasPlaceholders) && settings.notesDownloadSlides !== false;
        if (wantSlides && slides.length === 0 && meta.courseId) {
          try {
            slides = await session.withClient('cmc', (client) => client.slides(subId, meta.courseId));
          } catch {
            slides = [];
          }
        }

        let slideCount = 0;
        if (wantSlides && slides.length > 0) {
          const downloaded = await ensureSlideFiles(session, notes, subId, slides);
          slides = downloaded;
          slideCount = downloaded.length;
        }

        const { body: inlineBody, used: inlineUsed, missing: inlineMissing } = replaceSlidePlaceholders(
          markdown,
          slides,
          subId,
        );
        const slideSection = inlineUsed > 0 ? '' : buildSlideSection(slides);
        const body =
          slideSection && !inlineBody.includes('## 课件时间轴') ? `${inlineBody}\n${slideSection}` : inlineBody;
        const result = notes.write({ subId, markdown: body, meta });
        return formatNoteSaved({
          result,
          slideCount,
          inlineSlides: inlineUsed,
          missingSlides: inlineMissing,
          obsidian: notes.obsidianState(),
        });
      },
    }),

    textTool({
      name: 'zju_notes_list',
      description: '列出已缓存的「智云课堂」课堂笔记（按日期倒序），可按课程名或关键词过滤。',
      parameters: {
        keyword: { type: 'string', description: '按课程名/标题过滤' },
        limit: { type: 'number', description: '最多返回多少条，默认 50' },
      },
      run: async (args) => {
        const items = notes
          .list({ keyword: args.keyword, limit: args.limit })
          .map((item) => ({ ...item, path: join(notes.dir, item.file) }));
        return formatNotesList(items, { keyword: args.keyword });
      },
    }),

    textTool({
      name: 'zju_obsidian',
      description:
        '查看或设置课堂笔记的 Obsidian 同步：status 查看状态与检测到的库；detect 列出本机 Obsidian 库；use 指定库路径（写入后立即生效）；disable 关闭同步。',
      parameters: {
        action: { type: 'string', enum: ['status', 'detect', 'use', 'disable'], description: '默认 status' },
        vault: { type: 'string', description: 'Obsidian 库的绝对路径，例如 D:/Obsidian/Vault' },
        folder: { type: 'string', description: '库内子目录，默认「智云课堂」' },
      },
      run: async (args) => {
        const action = args.action || 'status';
        if (action === 'detect') {
          const vaults = detectObsidianVaults();
          if (vaults.length === 0) {
            return '没有检测到 Obsidian 库（读取 %APPDATA%\\obsidian\\obsidian.json 失败）。可以直接用 zju_obsidian action=use vault="D:/你的库" 指定。';
          }
          return [
            `检测到 ${vaults.length} 个 Obsidian 库：`,
            ...vaults.map((vault, index) => `${index + 1}. ${vault.path}${vault.open ? '（当前打开）' : ''}`),
          ].join('\n');
        }
        if (action === 'use') {
          const vault = String(args.vault || '').trim();
          if (!vault) throw new Error('缺少 vault：请传 Obsidian 库的绝对路径，例如 D:/Obsidian/Vault');
          if (!existsSync(vault)) throw new Error(`路径不存在：${vault}`);
          obsidianSettings.set({ vault, folder: args.folder, enabled: true });
          const note = looksLikeVault(vault) ? '' : '\n（提示：该目录没有 .obsidian，可能不是 Obsidian 库根目录）';
          return `${formatObsidianStatus({
            effective: obsidianSettings.effective(),
            vaults: detectObsidianVaults(),
            notes: notes.summary(),
          })}${note}`;
        }
        if (action === 'disable') {
          obsidianSettings.set({ enabled: false });
        }
        return formatObsidianStatus({
          effective: obsidianSettings.effective(),
          vaults: detectObsidianVaults(),
          notes: notes.summary(),
        });
      },
    }),

    textTool({
      name: 'zju_notices',
      description:
        '抓取浙江大学公开通知（外国语学院、光电学院、求是学院、本科生院），返回标题、日期和原文链接。不需要校园账号。可用 source 只查一个来源，或用 keyword 过滤标题。',
      parameters: {
        source: {
          type: 'string',
          enum: Object.keys(SOURCES),
          description: '只查一个来源：sis 外国语学院 / opt 光电学院 / qsxy 求是学院 / bksy 本科生院；省略则查全部已启用来源',
        },
        limit: { type: 'number', description: '每个来源最多返回多少条，默认 10' },
        keyword: { type: 'string', description: '按标题关键词过滤' },
      },
      run: async (args) => {
        const limit = Number(args.limit) > 0 ? Math.min(Number(args.limit), 50) : 10;
        const ids = args.source ? [args.source] : settings.noticeSources;
        const blocks = [];
        for (const id of ids) {
          try {
            const result = await fetchNotices(id, { timeoutMs: settings.requestTimeoutMs, limit });
            let items = result.items;
            if (args.keyword) {
              const needle = String(args.keyword).toLowerCase();
              items = items.filter((item) => item.title.toLowerCase().includes(needle));
            }
            blocks.push(formatNotices(result.source, items));
          } catch (error) {
            blocks.push(`${SOURCES[id]?.name || id}：抓取失败 —— ${error.message}`);
          }
        }
        return blocks.join('\n\n');
      },
    }),

    textTool({
      name: 'zju_notice_detail',
      description: '抓取一篇校园通知的正文、发布时间和附件链接。只接受 zju.edu.cn 域名下的地址。',
      parameters: {
        url: { type: 'string', description: '通知原文链接（来自 zju_notices）' },
      },
      run: async (args) => {
        if (!args.url) throw new Error('缺少 url');
        const detail = await fetchNoticeDetail(args.url, { timeoutMs: settings.requestTimeoutMs });
        return formatNoticeDetail(detail);
      },
    }),

    textTool({
      name: 'zju_lab_materials',
      description:
        `大物实验课件（指导书、讲义、演示文稿）：列出某次实验的课件，或把指定课件下载到本机并返回文件路径，供后续读取内容。下载会自动放到 ${slashPath(defaultMaterialsRoot(settings))}/<实验名>/ 下，文件夹不存在会自动新建。用 action 选择 list / download。实验名支持模糊匹配，例如「光的衍射」「示波器」。下载需要独立实验系统账号（$DSH_HOME/zju-campus/independent-accounts.env）。`,
      parameters: {
        action: {
          type: 'string',
          enum: ['list', 'download'],
          description: 'list 只列课件；download 下载课件到本地并返回路径',
        },
        lab: {
          type: 'string',
          description: '实验名称关键词或实验 id（labId）；省略则列出全部实验的课件',
        },
        courseware: {
          type: 'string',
          description: 'download 时按课件文件名关键词筛选；与 courseware_id 二选一',
        },
        courseware_id: {
          type: ['number', 'string'],
          description: 'download 时直接指定课件 id（来自 list 结果）',
        },
        save_dir: {
          type: 'string',
          description: `可选：下载根目录，默认 ${slashPath(defaultMaterialsRoot(settings))}；实验子文件夹会在其下自动创建`,
        },
      },
      run: async (args) => {
        const action = args.action || 'list';
        if (action === 'list') {
          const result = await labMaterials.list({ lab: args.lab });
          if (!result.experiments || result.experiments.length === 0) {
            return result.note || '没有找到实验';
          }
          const lines = [];
          for (const experiment of result.experiments) {
            lines.push(`【${experiment.title}】${experiment.course ? ` · ${experiment.course}` : ''}${experiment.date ? ` · ${experiment.date}` : ''}`);
            if (experiment.error) lines.push(`  课件读取失败：${experiment.error}`);
            else if (!experiment.materials || experiment.materials.length === 0) lines.push('  没有上传课件');
            else {
              for (const item of experiment.materials) {
                lines.push(`  - ${item.name}  [id=${item.id}${item.downloadTimes !== null ? `，下载 ${item.downloadTimes} 次` : ''}]`);
                if (item.description) lines.push(`      ${item.description}`);
              }
            }
            lines.push(`  实验 id：${experiment.labId}`);
          }
          lines.push('', '下载：action=download，lab 传实验名或 id，courseware 传文件名关键词或 courseware_id。');
          return lines.join('\n');
        }

        const file = await labMaterials.download({
          lab: args.lab,
          courseware: args.courseware,
          coursewareId: args.courseware_id,
          saveDir: args.save_dir,
        });
        const size = file.bytes >= 1024 * 1024 ? `${(file.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(file.bytes / 1024)} KB`;
        return [
          `已下载：${file.name}`,
          `所属实验：${file.lab}${file.course ? `（${file.course}）` : ''}`,
          `实验文件夹：${file.folder}`,
          `保存路径：${file.filePath}`,
          `大小：${size}`,
          '接下来可以直接读取该文件（PDF/PPTX 可用对应工具解析）。',
        ].join('\n');
      },
    }),

    textTool({
      name: 'zju_rollcall',
      description:
        '查看学在浙大当前有没有正在进行的点名/签到（雷达点名、数字点名、二维码签到等），以及自己是否已签。只读查询，默认不会替你签到；雷达点名可用 zju_rollcall_answer 配合虚拟位置代签（需开启 allowRollcallSign）。',
      run: async () => {
        const list = await session.withClient('courses', (client) => client.rollcalls());
        const active = list.filter((item) => item.active);
        const lines = [];
        if (active.length === 0) {
          const handled = list.filter((item) => item.handled);
          lines.push(
            handled.length > 0
              ? `当前没有待签到的点名（最近 ${handled.length} 条都已处理或已过期）。`
              : '当前没有正在进行的点名或签到。',
          );
        } else {
          lines.push(`发现 ${active.length} 个进行中的签到，请尽快处理：`);
          for (const item of active) {
            lines.push(
              `- 【${item.type}】${item.courseTitle}${item.title ? ` · ${item.title}` : ''}`,
              `  老师：${item.teacher || '未知'}${item.startedAt ? ` · 开始于 ${item.startedAt}` : ''}`,
              `  点名 id：${item.id}${item.isRadar ? '（雷达点名，可用 zju_rollcall_answer 代签）' : ''}`,
              item.url ? `  打开课程：${item.url}` : '',
            );
          }
        }

        // 虚拟位置库提示：读文件失败不影响点名本身。
        try {
          const snapshot = locations.snapshot();
          const signState = rollcallSwitch.effective(settings.allowRollcallSign);
          let defaultLocation = null;
          if (settings.rollcallDefaultLocation) {
            defaultLocation = locations.resolve(settings.rollcallDefaultLocation).location;
          }
          if (!defaultLocation) defaultLocation = snapshot.default;
          lines.push(
            '',
            `虚拟位置库：${snapshot.count} 个点位${defaultLocation ? `，默认「${defaultLocation.name}」· ${defaultLocation.lon},${defaultLocation.lat}` : '，未设置默认'}`,
            `雷达点名代签：${signState.enabled ? '已开启' : '已关闭'}（${signState.source === 'panel' ? '面板开关' : '插件配置'}） · 管理点位用 zju_rollcall_location`,
          );
        } catch (error) {
          lines.push('', `虚拟位置库读取失败：${error.message}`);
        }
        return lines.filter(Boolean).join('\n');
      },
    }),

    textTool({
      name: 'zju_rollcall_location',
      description:
        '管理雷达点名用的「虚拟位置」点位库：内置 12 个浙大常用点位（紫金港东一/西教/段永平、玉泉教一/四/七、之江、华家池等），可新增、修改、删除自定义点位并设置默认点。坐标格式为「经度,纬度」（WGS84），例如 120.089136,30.302331。',
      parameters: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'update', 'remove', 'default', 'resolve', 'import', 'export'],
          description: 'list 列表 / add 新增 / update 修改 / remove 删除 / default 设默认 / resolve 解析名称或坐标 / import 导入 / export 导出 JSON',
        },
        id: { type: 'string', description: '点位 id（update/remove/default 用；来自 list 结果）' },
        name: { type: 'string', description: '点位名称，例如「东一教学楼」；update 时表示新名称' },
        lon: { type: 'number', description: '经度，例如 120.089136' },
        lat: { type: 'number', description: '纬度，例如 30.302331' },
        campus: { type: 'string', description: '校区，例如「紫金港」「玉泉」' },
        aliases: { type: 'string', description: '别名，用逗号或顿号分隔，例如「东一,东1」' },
        note: { type: 'string', description: '备注' },
        set_default: { type: 'boolean', description: 'add 时是否顺便设为默认点位' },
        query: { type: 'string', description: 'list 时用来解析并高亮的名称/别名/坐标；resolve 时必填' },
        text: { type: 'string', description: 'import 的文本：JSON 或每行「名称,经度,纬度[,校区]」' },
        merge: { type: 'boolean', description: 'import 时是否合并（默认 true；false 会先清空自定义点位）' },
      },
      run: async (args) => {
        const action = args.action || 'list';
        const snapshot = () => locations.snapshot();
        const summary = (location, verb) =>
          [
            `${verb}：${location.name}${location.campus ? `（${location.campus}）` : ''} · ${location.lon},${location.lat}（id=${location.id}）`,
            '',
            formatRollcallLocations(snapshot()),
          ].join('\n');

        if (action === 'list') {
          return formatRollcallLocations(snapshot(), {
            query: args.query,
            resolution: args.query ? locations.resolve(args.query) : undefined,
          });
        }

        if (action === 'add') {
          if (!args.name) throw new Error('缺少 name（点位名称），例如「东一教学楼」');
          if (args.lon === undefined || args.lat === undefined) {
            throw new Error('缺少 lon / lat（经度、纬度），例如 lon=120.089136 lat=30.302331');
          }
          const location = locations.add({
            name: args.name,
            lon: args.lon,
            lat: args.lat,
            campus: args.campus,
            aliases: args.aliases,
            note: args.note,
            setDefault: args.set_default === true,
          });
          return summary(location, '已添加虚拟位置');
        }

        if (action === 'update') {
          if (!args.id) throw new Error('update 需要 id（先用 action=list 查看点位 id）');
          const patch = {};
          if (args.name !== undefined) patch.name = args.name;
          if (args.lon !== undefined || args.lat !== undefined) {
            patch.lon = args.lon;
            patch.lat = args.lat;
          }
          if (args.campus !== undefined) patch.campus = args.campus;
          if (args.aliases !== undefined) patch.aliases = args.aliases;
          if (args.note !== undefined) patch.note = args.note;
          const location = locations.update(args.id, patch);
          return summary(location, '已更新虚拟位置');
        }

        if (action === 'remove') {
          const key = args.id || args.name;
          if (!key) throw new Error('remove 需要 id 或 name');
          const removed = locations.remove(key);
          return summary(removed, '已删除虚拟位置');
        }

        if (action === 'default') {
          const key = args.id || args.name;
          if (!key) throw new Error('default 需要 id 或 name');
          const location = locations.setDefault(key);
          return [
            `默认虚拟位置已设为：${location.name}${location.campus ? `（${location.campus}）` : ''} · ${location.lon},${location.lat}`,
            '',
            formatRollcallLocations(snapshot()),
          ].join('\n');
        }

        if (action === 'resolve') {
          if (!args.query) throw new Error('resolve 需要 query（点位名称、别名或「经度,纬度」）');
          const resolved = locations.resolve(args.query);
          if (!resolved.location) {
            const hint =
              resolved.candidates.length > 0
                ? `匹配到多个点位：${resolved.candidates.map((item) => item.name).join('、')}，请写完整名称。`
                : `没有找到点位「${args.query}」。可以先 action=list 看看有哪些。`;
            throw new Error(hint);
          }
          return formatRollcallLocations(snapshot(), { query: args.query, resolution: resolved });
        }

        if (action === 'import') {
          if (!args.text) throw new Error('import 需要 text（JSON 或每行「名称,经度,纬度[,校区]」）');
          const imported = locations.importJson(args.text, { merge: args.merge !== false });
          return [
            `已导入 ${imported.length} 个点位：`,
            ...imported.map((item) => `- ${item.name}${item.campus ? `（${item.campus}）` : ''} · ${item.lon},${item.lat}`),
            '',
            formatRollcallLocations(snapshot()),
          ].join('\n');
        }

        if (action === 'export') {
          return locations.exportJson();
        }

        throw new Error(`未知 action：${action}`);
      },
    }),

    textTool({
      name: 'zju_rollcall_answer',
      description:
        '【写操作，会真实签到】用虚拟位置应答一次雷达点名。默认策略是「指定/默认点位 → 点位库全部点位 → 用服务端返回的距离做三点定位」，最多尝试 20 次。需要 rollcall_id（来自 zju_rollcall）、confirm: true，并在插件配置里开启 allowRollcallSign。可先用 dry_run: true 演练。',
      parameters: {
        rollcall_id: { type: ['string', 'number'], description: '点名 id（来自 zju_rollcall）' },
        location: { type: 'string', description: '可选：指定点位名称/id/别名，或直接写「经度,纬度」；省略则用默认点位' },
        strategy: {
          type: 'string',
          enum: ['single', 'fallback'],
          description: 'single 只试指定/默认点位；fallback（默认）失败后遍历点位库并做三点定位',
        },
        max_attempts: { type: 'number', description: '最多尝试次数，默认 20，上限 40' },
        save_estimate: { type: 'boolean', description: '三点定位成功时，是否把推算点自动存入点位库（默认 false）' },
        dry_run: { type: 'boolean', description: '只演练尝试顺序，不发送签到请求；不需要 confirm' },
        confirm: { type: 'boolean', description: '必须显式传 true，表示确认要真实签到' },
      },
      run: async (args) => {
        const result = await signRadarRollcall({ session, settings, locations, rollcallSwitch, args });
        return formatRollcallAnswer(result);
      },
    }),

    textTool({
      name: 'zju_submit_homework',
      description:
        '【写操作，会真实提交】把本地文件提交到「学在浙大」的指定作业。需要 activity_id（来自 zju_todos 或 zju_homework）和文件的绝对路径。提交前请先让用户确认文件与作业对应；提交后返回读回确认。需要在插件配置里开启 allowWriteOps。',
      parameters: {
        activity_id: { type: ['string', 'number'], description: '作业 id' },
        file_path: { type: 'string', description: '要提交的本地文件绝对路径' },
        comment: { type: 'string', description: '可选：提交附言' },
        confirm: { type: 'boolean', description: '必须显式传 true，表示已获得用户确认' },
      },
      run: async (args) => {
        requireWrite();
        if (args.confirm !== true) {
          throw new Error('这是写操作：确认要真实提交后，请带 confirm: true 重新调用。');
        }
        if (!args.activity_id) throw new Error('缺少 activity_id');
        if (!args.file_path) throw new Error('缺少 file_path（本地文件绝对路径）');
        const result = await session.withClient('courses', (client) =>
          client.submitHomework(args.activity_id, args.file_path, args.comment || ''),
        );
        return [
          `已提交：${result.fileName}`,
          `作业：${result.activityId}`,
          `服务端消息：${result.message}`,
          result.confirm
            ? `读回确认：submission_id=${result.confirm.id}，提交时间 ${result.confirm.submittedAt || '未知'}，文件 ${result.confirm.files.join('、') || '无'}`
            : '读回确认：未能读回提交记录，请到学在浙大页面核对。',
          '如需撤回改交，用 zju_retract_homework（需老师开启允许撤回）。',
        ].join('\n');
      },
    }),

    textTool({
      name: 'zju_retract_homework',
      description:
        '【写操作】撤回某作业已提交的版本，使其回到草稿态。需要 activity_id 与 confirm: true。仅当老师开启了允许撤回时可撤回。需要在插件配置里开启 allowWriteOps。',
      parameters: {
        activity_id: { type: ['string', 'number'], description: '作业 id' },
        confirm: { type: 'boolean', description: '必须显式传 true，表示已获得用户确认' },
      },
      run: async (args) => {
        requireWrite();
        if (args.confirm !== true) {
          throw new Error('这是写操作：确认要撤回后，请带 confirm: true 重新调用。');
        }
        if (!args.activity_id) throw new Error('缺少 activity_id');
        const result = await session.withClient('courses', (client) => client.retractHomework(args.activity_id));
        return result.ok
          ? `已撤回作业 ${result.activityId}（submission_id=${result.submissionId}）：${result.message}`
          : `未撤回：${result.message}`;
      },
    }),
  ];
}

/**
 * 插件入口。
 * @param {any} ctx cordis 上下文
 * @param {any} config 行配置
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  // 校园站点强制直连：用户那边的代理挂了/换端口也不该把插件一起带下水。
  allowDirectHosts();
  // 首次安装就把凭据模板铺好，用户打开填两行即可用。
  const credentialTemplate = ensureCredentialTemplate();
  if (credentialTemplate.created) {
    ctx.logger?.info?.(`zju-campus: 已生成账号模板 ${credentialTemplate.path}，填入 ZJU_USER / ZJU_PASSWORD 即可使用`);
  }
  ensureIndependentAccountsTemplate();
  const session = new ZjuSession(settings);
  const labMaterials = new LabMaterials(settings);
  const locations = new RollcallLocations({
    file: settings.rollcallLocationsFile || defaultLocationsFile(),
  });
  const rollcallSwitch = new RollcallSwitch({
    file: settings.rollcallSwitchFile || defaultSwitchFile(),
  });
  const obsidianSettings = new ObsidianSettings({
    file: settings.obsidianFile || defaultObsidianFile(),
    vault: settings.obsidianVault,
    folder: settings.obsidianFolder,
  });
  const notes = new NotesStore({
    dir: settings.notesDir || defaultNotesDir(),
    obsidian: () => obsidianSettings.effective(),
  });
  const tools = buildTools(session, settings, labMaterials, locations, rollcallSwitch, notes, obsidianSettings);
  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(definition), `zju-campus: ${definition.name}`);
  }
  ctx.effect(() => () => labMaterials.close(), 'zju-campus: lab materials session cleanup');
  const signAtStart = rollcallSwitch.effective(settings.allowRollcallSign);
  ctx.logger?.info?.(
    `zju-campus: 已注册 ${tools.length} 个工具（写操作${settings.allowWriteOps ? '开启' : '关闭'}，虚拟位置代签${signAtStart.enabled ? '开启' : '关闭'}，笔记缓存 ${notes.dir}）`,
  );

  // 侧边栏页面用的数据接口。webServer 是可选的：没有 Web 界面的 profile 里插件照常提供工具。
  const readSummary = createSummaryCache(session, settings, { notes });
  ctx.effect(() => () => readSummary.dispose(), 'zju-campus: independent session cleanup');

  // 自动签到：插件进程内的定时器，节奏和侧边栏「每 60 秒自动检查」一致。
  // 侧边栏的自动检查只刷新界面，这里补上真正会签到的那一半。
  const rollcallAuto = new RollcallAuto({
    file: settings.rollcallAutoFile || defaultAutoFile(),
    intervalMs: settings.rollcallAutoIntervalMs,
    maxTries: settings.rollcallAutoMaxTries,
    retryMs: settings.rollcallAutoRetryMs,
    logger: ctx.logger,
    isSignEnabled: () => rollcallSwitch.effective(settings.allowRollcallSign).enabled,
    listActive: async () => {
      const list = await session.withClient('courses', (client) => client.rollcalls());
      return Array.isArray(list) ? list : [];
    },
    signOne: (id) =>
      signRadarRollcall({
        session,
        settings,
        locations,
        rollcallSwitch,
        args: { rollcall_id: id, strategy: 'fallback', confirm: true },
      }),
  });
  if (settings.rollcallAuto && rollcallAuto.read().enabled) {
    rollcallAuto.start();
    ctx.logger?.info?.(
      `zju-campus: 自动签到已启动（每 ${Math.round(settings.rollcallAutoIntervalMs / 1000)} 秒检查一次，每个点名最多试 ${settings.rollcallAutoMaxTries} 次）`,
    );
  } else {
    ctx.logger?.info?.('zju-campus: 自动签到未启动（配置或面板开关是关的）');
  }
  ctx.effect(() => () => rollcallAuto.stop(), 'zju-campus: auto rollcall timer cleanup');

  // 数字点名：猜签到码。只在真的遇到数字点名时才去 OCR/读转录（有 TTL 缓存），
  // 平时不占资源；猜不出来就老实说猜不出来。
  const numberDetector = new NumberDetector({
    ttlMs: settings.rollcallNumberTtlMs,
    logger: ctx.logger,
    gather: createNumberGather({
      session,
      runCommand,
      ocrScript: join(pluginDir, 'scripts', 'ocr-image.py'),
      live: settings.rollcallNumberLive,
      logger: ctx.logger,
    }),
  });
  ctx.effect(() => () => numberDetector.forget(), 'zju-campus: number detector cleanup');

  ctx.inject(['webServer'], (webCtx) => {
    const route = {
      kind: 'exact',
      path: '/dsh-zju/summary',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET');
          res.end('Method Not Allowed');
          return;
        }
        try {
          const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
          const summary = await readSummary({ force: requestUrl.searchParams.get('refresh') === '1' });
          // 自动签到状态跟着快照一起下发，侧边栏不用多打一个请求。
          const withAuto = {
            ...summary,
            rollcallAuto: rollcallAuto.state(),
            rollcallNumber: settings.rollcallNumber ? numberDetector.state() : { enabled: false },
          };
          const body = JSON.stringify(withAuto);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: String(error?.message || error) }));
        }
      },
    };
    webCtx.effect(() => webCtx.webServer.register(route), 'zju-campus: sidebar summary route');
    ctx.logger?.info?.('zju-campus: 侧边栏数据接口已注册 /dsh-zju/summary');

    // 面板上的「虚拟位置代签」开关：GET 读状态，POST 写开关。
    const switchRoute = {
      kind: 'exact',
      path: '/dsh-zju/rollcall-switch',
      handler: async (req, res) => {
        const origin = String(req.headers.origin || '');
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Forbidden');
          return;
        }
        const sendJson = (statusCode, payload) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };
        if (req.method === 'GET' || req.method === 'HEAD') {
          const state = rollcallSwitch.effective(settings.allowRollcallSign);
          if (req.method === 'HEAD') {
            res.statusCode = 200;
            res.end();
            return;
          }
          sendJson(200, state);
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD, POST');
          res.end('Method Not Allowed');
          return;
        }
        try {
          const body = await readJsonBody(req);
          if (typeof body?.enabled !== 'boolean') {
            sendJson(400, { error: 'enabled 必须是 true 或 false' });
            return;
          }
          sendJson(200, rollcallSwitch.set(body.enabled));
        } catch (error) {
          sendJson(400, { error: String(error?.message || error) });
        }
      },
    };
    webCtx.effect(() => webCtx.webServer.register(switchRoute), 'zju-campus: rollcall switch route');
    ctx.logger?.info?.('zju-campus: 代签开关接口已注册 /dsh-zju/rollcall-switch');

    // 面板上的「签到」按钮：POST /dsh-zju/rollcall-sign
    // 不带 rollcall_id 时自动挑当前进行中的雷达点名；带 refresh=1 表示强制重新拉一次列表。
    const signRoute = {
      kind: 'exact',
      path: '/dsh-zju/rollcall-sign',
      handler: async (req, res) => {
        const origin = String(req.headers.origin || '');
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Forbidden');
          return;
        }
        const sendJson = (statusCode, payload) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };
        if (req.method === 'GET' || req.method === 'HEAD') {
          sendJson(200, { hint: 'POST { rollcall_id?, location? } 触发一次真实签到' });
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD, POST');
          res.end('Method Not Allowed');
          return;
        }
        try {
          const body = await readJsonBody(req);
          let rollcallId = body?.rollcall_id;
          const wantsAll = body?.all === true;
          if ((rollcallId === undefined || rollcallId === null || rollcallId === '') && !wantsAll) {
            // 没指定就自己找：挑当前进行中的雷达点名。
            const list = await session.withClient('courses', (client) => client.rollcalls());
            const active = list.filter((item) => item.active);
            const radar = active.filter((item) => item.isRadar);
            if (radar.length === 0) {
              sendJson(409, {
                ok: false,
                error:
                  active.length === 0
                    ? '当前没有进行中的点名，按钮没东西可签。'
                    : `当前有 ${active.length} 个点名，但没有雷达点名（${active.map((item) => item.type).join('、')}），虚拟位置对它无效。`,
                rollcalls: active,
              });
              return;
            }
            rollcallId = radar[0].id;
          }

          const targets = wantsAll ? null : [rollcallId];
          const runOne = async (id) => {
            const result = await signRadarRollcall({
              session,
              settings,
              locations,
              rollcallSwitch,
              args: {
                rollcall_id: id,
                location: body?.location || undefined,
                strategy: body?.strategy === 'single' ? 'single' : 'fallback',
                confirm: true,
              },
            });
            return {
              ok: Boolean(result.ok),
              skipped: Boolean(result.skipped),
              rollcallId: result.rollcall?.id ?? id,
              courseTitle: result.rollcall?.courseTitle || '',
              type: result.rollcall?.type || '',
              message: result.message || '',
              attempts: (result.attempts || []).map((attempt) => ({
                role: attempt.role,
                name: attempt.name,
                lon: attempt.lon,
                lat: attempt.lat,
                ok: Boolean(attempt.ok),
                distance: Number.isFinite(Number(attempt.distance)) ? Number(attempt.distance) : null,
                errorCode: attempt.errorCode || '',
              })),
              usedEstimated: Boolean(result.usedEstimated),
              estimated: result.estimated || null,
              text: formatRollcallAnswer(result),
            };
          };

          if (targets) {
            const one = await runOne(targets[0]);
            sendJson(one.ok || one.skipped ? 200 : 502, one);
            return;
          }

          const list = await session.withClient('courses', (client) => client.rollcalls());
          const radarIds = list.filter((item) => item.active && item.isRadar).map((item) => item.id);
          if (radarIds.length === 0) {
            sendJson(409, { ok: false, error: '当前没有进行中的雷达点名。', results: [] });
            return;
          }
          const results = [];
          for (const id of radarIds) {
            try {
              results.push(await runOne(id));
            } catch (error) {
              results.push({ ok: false, rollcallId: id, error: String(error?.message || error) });
            }
          }
          sendJson(results.some((item) => item.ok || item.skipped) ? 200 : 502, {
            ok: results.every((item) => item.ok || item.skipped),
            results,
          });
        } catch (error) {
          sendJson(400, { ok: false, error: String(error?.message || error) });
        }
      },
    };
    webCtx.effect(() => webCtx.webServer.register(signRoute), 'zju-campus: rollcall sign route');
    ctx.logger?.info?.('zju-campus: 一键签到接口已注册 /dsh-zju/rollcall-sign');

    // 自动签到开关 + 手动触发：GET 读状态，POST 写开关或立刻跑一轮。
    const autoRoute = {
      kind: 'exact',
      path: '/dsh-zju/rollcall-auto',
      handler: async (req, res) => {
        const origin = String(req.headers.origin || '');
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Forbidden');
          return;
        }
        const sendJson = (statusCode, payload) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (req.method === 'HEAD') {
            res.statusCode = 200;
            res.end();
            return;
          }
          sendJson(200, rollcallAuto.state());
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD, POST');
          res.end('Method Not Allowed');
          return;
        }
        try {
          const body = await readJsonBody(req);
          if (typeof body?.enabled === 'boolean') {
            const state = rollcallAuto.set(body.enabled);
            if (body.enabled) rollcallAuto.start();
            else rollcallAuto.stop();
            sendJson(200, { ...rollcallAuto.state(), ...state });
            return;
          }
          if (body?.run === true) {
            // 手动跑一轮：不用等定时器，方便点名刚开始时立刻补一次。
            const result = await rollcallAuto.tick('manual');
            sendJson(200, { ok: result.ok !== false, result, state: rollcallAuto.state() });
            return;
          }
          sendJson(400, { error: '传 { enabled: true|false } 开关自动签到，或 { run: true } 立刻检查一轮' });
        } catch (error) {
          sendJson(400, { error: String(error?.message || error) });
        }
      },
    };
    webCtx.effect(() => webCtx.webServer.register(autoRoute), 'zju-campus: rollcall auto route');
    ctx.logger?.info?.('zju-campus: 自动签到接口已注册 /dsh-zju/rollcall-auto');

    // 数字点名：GET 读/触发一次识别，POST 提交签到码。
    const numberRoute = {
      kind: 'exact',
      path: '/dsh-zju/rollcall-number',
      handler: async (req, res) => {
        const origin = String(req.headers.origin || '');
        if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Forbidden');
          return;
        }
        const sendJson = (statusCode, payload) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(payload));
        };
        if (!settings.rollcallNumber) {
          sendJson(200, { enabled: false, message: '配置里关掉了 rollcallNumber，数字点名识别没有开' });
          return;
        }
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        if (req.method === 'GET' || req.method === 'HEAD') {
          if (req.method === 'HEAD') {
            res.statusCode = 200;
            res.end();
            return;
          }
          const id = requestUrl.searchParams.get('rollcall_id');
          if (!id) {
            sendJson(200, { enabled: true, state: numberDetector.state() });
            return;
          }
          // ?frame=board|slide：直接把刚才抓到的直播画面回给侧边栏，用户能自己看黑板
          const frameMode = requestUrl.searchParams.get('frame');
          if (frameMode) {
            const cached = numberDetector.read(id);
            const shots = cached?.result?.lesson?.live?.shots || [];
            const shot = shots.find((item) => item.mode === frameMode) || shots[0];
            if (!shot?.file) {
              sendJson(404, { ok: false, error: '还没有抓到直播画面，先点一次「从课堂画面识别」' });
              return;
            }
            try {
              const buffer = readFileSync(shot.file);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'image/png');
              res.setHeader('Cache-Control', 'no-store');
              res.setHeader('Content-Length', String(buffer.length));
              res.end(buffer);
            } catch (error) {
              sendJson(404, { ok: false, error: `画面文件读不到了：${String(error?.message || error)}` });
            }
            return;
          }
          try {
            const list = await session.withClient('courses', (client) => client.rollcalls());
            const target = (Array.isArray(list) ? list : []).find((item) => String(item.id) === String(id));
            if (!target) {
              sendJson(404, { ok: false, error: `找不到点名 #${id}，它可能已经结束了` });
              return;
            }
            const result = await numberDetector.detect(target, {
              force: requestUrl.searchParams.get('force') === '1',
            });
            sendJson(200, { ok: true, result });
          } catch (error) {
            sendJson(502, { ok: false, error: String(error?.message || error) });
          }
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD, POST');
          res.end('Method Not Allowed');
          return;
        }
        try {
          const body = await readJsonBody(req);
          const rollcallId = body?.rollcall_id;
          const code = String(body?.number_code ?? '').trim();
          if (!rollcallId) {
            sendJson(400, { ok: false, error: '要提交签到码得带上 rollcall_id' });
            return;
          }
          if (!/^\d{3,8}$/.test(code)) {
            sendJson(400, { ok: false, error: `签到码应该是 3~8 位数字，收到「${code}」` });
            return;
          }
          // 提交签到码是真实写操作，跟雷达代签共用同一个放行开关。
          const gate = rollcallSwitch.effective(settings.allowRollcallSign);
          if (!gate.enabled) {
            sendJson(403, {
              ok: false,
              error: '「虚拟位置代签」开关是关的；这个开关同时管数字签到码的提交，先去面板打开它',
            });
            return;
          }
          const detail = await session.withClient('courses', (client) => client.answerNumber(rollcallId, code));
          const json = detail?.json || {};
          const ok = detail?.status === 200 || detail?.status === 201 || Boolean(json?.id);
          // 提交成功后旧的识别结论就过期了，清掉免得侧边栏还显示旧数字。
          if (ok) numberDetector.forget(rollcallId);
          sendJson(ok ? 200 : 400, {
            ok,
            status: detail?.status ?? null,
            errorCode: json?.error_code ?? null,
            numberCode: json?.number_code ?? code,
            detail: json,
          });
        } catch (error) {
          sendJson(400, { ok: false, error: String(error?.message || error) });
        }
      },
    };
    webCtx.effect(() => webCtx.webServer.register(numberRoute), 'zju-campus: rollcall number route');
    ctx.logger?.info?.('zju-campus: 数字点名接口已注册 /dsh-zju/rollcall-number');
  });
}
