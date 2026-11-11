/**
 * 侧边栏页面的数据接口：把待办、今日课表、最新通知合成一份快照。
 *
 * 只读、只 GET。结果缓存 60 秒，避免面板轮询把学校站点打爆；
 * 单节失败不影响其它节，错误以文字形式带回前端。
 */
import { fetchNotices } from './notices.js';
import { maskAccount } from './session.js';
import { NotesStore, ObsidianSettings, defaultNotesDir, defaultObsidianFile } from './notes.js';
import { independentSitesStatus } from './independent-accounts.js';
import { createIndependentPanel } from './independent-panel.js';
import { independentFactories } from './independent-factories.js';
import { RollcallLocations, defaultLocationsFile } from './rollcall-locations.js';
import { RollcallSwitch, defaultSwitchFile } from './rollcall-switch.js';

/** 上海时区的今天。 */
function todayShanghai() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 面板「智云课堂」展示的天数：今天 + 往前 6 天。 */
const WEEK_DAYS = 7;
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** YYYY-MM-DD 加减天数（按东八区自然日）。 */
function shiftDate(dateString, delta) {
  const base = Date.parse(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(base)) return dateString;
  const d = new Date(base + delta * 86400000 + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 某天是星期几（东八区）。 */
function weekdayOf(dateString) {
  const base = Date.parse(`${dateString}T00:00:00+08:00`);
  if (Number.isNaN(base)) return '';
  return WEEKDAY_NAMES[new Date(base + 8 * 3600 * 1000).getUTCDay()];
}

/** 一节课 → 面板用的精简结构。 */
function mapLesson(lesson, date) {
  return {
    subId: lesson.subId,
    title: lesson.title,
    teacher: lesson.teacher,
    room: lesson.room,
    date,
    url: lesson.url,
    time: lesson.startAt && lesson.endAt ? `${lesson.startAt}-${lesson.endAt}` : '',
    startAt: lesson.startAt || '',
    endAt: lesson.endAt || '',
    statusLabel: lesson.statusLabel || '',
    hasTranscript: Boolean(lesson.hasTranscript),
  };
}

/**
 * 把 [start, end] 的每一天都展开成 `{ date, weekday, isToday, count, lessons }`。
 * 没有课的日子也保留（日期条要能点），最多展开 31 天防止异常参数死循环。
 */
function buildWeekDays(start, end, byDate, today) {
  const days = [];
  let cursor = start;
  for (let guard = 0; guard < 31; guard += 1) {
    const lessons = (byDate.get(cursor) || [])
      .slice()
      .sort((a, b) => String(a.startAt || '').localeCompare(String(b.startAt || '')));
    days.push({
      date: cursor,
      weekday: weekdayOf(cursor),
      isToday: cursor === today,
      count: lessons.length,
      lessons,
    });
    if (cursor >= end) break;
    cursor = shiftDate(cursor, 1);
  }
  return days;
}

/** 把秒数格式化成 HH:mm。 */
function clock(seconds) {
  if (!seconds) return '';
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`;
}

/** 读取虚拟位置库快照；读失败时返回空库，不影响面板其它分区。 */
function readRollcallLocations(settings) {
  const empty = { default: null, count: 0, customCount: 0, presetCount: 0, locations: [] };
  try {
    const store = new RollcallLocations({
      file: settings.rollcallLocationsFile || defaultLocationsFile(),
    });
    const snapshot = store.snapshot({ max: 60 });
    let defaultLocation = snapshot.default;
    if (settings.rollcallDefaultLocation) {
      defaultLocation = store.resolve(settings.rollcallDefaultLocation).location || defaultLocation;
    }
    return {
      default: defaultLocation,
      count: snapshot.count,
      customCount: snapshot.customCount,
      presetCount: snapshot.presetCount,
      locations: snapshot.locations.map((item) => ({
        id: item.id,
        name: item.name,
        campus: item.campus,
        lon: item.lon,
        lat: item.lat,
        source: item.source,
        isDefault: defaultLocation ? item.id === defaultLocation.id : false,
      })),
    };
  } catch (error) {
    return { ...empty, error: error.message };
  }
}

/** 读取代签开关；读失败时按配置值处理，不影响面板。 */
function readRollcallSwitch(settings) {
  try {
    const controller = new RollcallSwitch({
      file: settings.rollcallSwitchFile || defaultSwitchFile(),
    });
    return controller.effective(settings.allowRollcallSign);
  } catch (error) {
    return {
      enabled: Boolean(settings.allowRollcallSign),
      source: 'config',
      error: String(error?.message || error),
    };
  }
}

/**
 * 生成面板快照。
 * @param {import('./session.js').ZjuSession} session
 * @param {ReturnType<typeof import('../index.js').normalizeConfig>} settings
 */
export async function buildSummary(session, settings, { readIndependentSites, notes } = {}) {
  const today = todayShanghai();
  const weekStart = shiftDate(today, -(WEEK_DAYS - 1));
  const notesStore =
    notes ||
    new NotesStore({
      dir: settings.notesDir || defaultNotesDir(),
      obsidian: () =>
        new ObsidianSettings({
          file: settings.obsidianFile || defaultObsidianFile(),
          vault: settings.obsidianVault,
          folder: settings.obsidianFolder,
        }).effective(),
    });
  const summary = {
    configured: false,
    account: '',
    date: today,
    week: { start: weekStart, end: today, days: [] },
    notes: notesStore.summary(),
    todos: [],
    rollcalls: [],
    rollcallLocations: {
      default: null,
      count: 0,
      customCount: 0,
      presetCount: 0,
      locations: [],
    },
    rollcallSign: {
      enabled: false,
      source: 'config',
      error: null,
    },
    lessons: [],
    notices: [],
    errors: [],
    independentSites: independentSitesStatus(),
    updatedAt: new Date().toISOString(),
  };

  summary.rollcallLocations = readRollcallLocations(settings);
  summary.rollcallSign = readRollcallSwitch(settings);

  const credentials = session.credentials();
  summary.configured = credentials !== null;
  summary.account = credentials ? maskAccount(credentials.username) : '';

  const [todosResult, scheduleResult, noticesResult, independentResult, rollcallResult] = await Promise.allSettled([
    credentials ? session.withClient('courses', (client) => client.todos()) : Promise.resolve([]),
    credentials
      ? session.withClient('cmc', (client) => client.schedule(weekStart, today))
      : Promise.resolve({ lessons: [] }),
    loadNotices(settings),
    readIndependentSites ? readIndependentSites() : Promise.resolve(summary.independentSites),
    credentials ? session.withClient('courses', (client) => client.rollcalls()) : Promise.resolve([]),
  ]);
  if (independentResult.status === 'fulfilled') summary.independentSites = independentResult.value;
  if (rollcallResult.status === 'fulfilled') {
    summary.rollcalls = rollcallResult.value.filter((item) => item.active);
  } else {
    summary.errors.push(`签到：${rollcallResult.reason?.message || rollcallResult.reason}`);
  }

  if (todosResult.status === 'fulfilled') {
    summary.todos = todosResult.value
      .slice()
      .sort((a, b) => String(a.deadlineAt || a.deadline || '9999-99-99').localeCompare(String(b.deadlineAt || b.deadline || '9999-99-99')))
      .slice(0, 8)
      .map((todo) => ({
        id: todo.id,
        title: todo.title,
        type: todo.type,
        courseName: todo.courseName,
        deadline: todo.deadline,
        deadlineAt: todo.deadlineAt,
        endTime: todo.endTime,
        submissionUrl: todo.submissionUrl,
      }));
  } else {
    summary.errors.push(`待办：${todosResult.reason?.message || todosResult.reason}`);
  }

  if (scheduleResult.status === 'fulfilled') {
    const byDate = new Map();
    for (const lesson of scheduleResult.value.lessons || []) {
      // 兼容旧接口/旧 mock：没有 date 的课归到今天，至少不会丢。
      const date = lesson.date || today;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(mapLesson(lesson, date));
    }
    summary.week = { start: weekStart, end: today, days: buildWeekDays(weekStart, today, byDate, today) };
    summary.lessons = (summary.week.days.find((day) => day.date === today) || {}).lessons || [];
  } else {
    summary.week = {
      start: weekStart,
      end: today,
      days: buildWeekDays(weekStart, today, new Map(), today),
    };
    summary.errors.push(`课表：${scheduleResult.reason?.message || scheduleResult.reason}`);
  }

  if (noticesResult.status === 'fulfilled') {
    summary.notices = noticesResult.value;
  } else {
    summary.errors.push(`通知：${noticesResult.reason?.message || noticesResult.reason}`);
  }

  return summary;
}

/** 并行抓多个来源，按日期倒序取前 6 条。 */
async function loadNotices(settings) {
  const ids = settings.noticeSources || ['qsxy', 'bksy', 'sis', 'opt'];
  const results = await Promise.allSettled(
    ids.map((id) => fetchNotices(id, { timeoutMs: settings.requestTimeoutMs, limit: 3 })),
  );
  const merged = [];
  const names = { qsxy: '求是学院', bksy: '本科生院', sis: '外国语学院', opt: '光电学院' };
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value.items) {
      merged.push({
        title: item.title,
        url: item.url,
        date: item.date,
        source: names[result.value.source.id] || result.value.source.name,
      });
    }
  }
  merged.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return merged.slice(0, 12);
}

/**
 * 带 60 秒缓存与并发去重的快照读取器。
 * @param {import('./session.js').ZjuSession} session
 * @param {ReturnType<typeof import('../index.js').normalizeConfig>} settings
 */
export function createSummaryCache(session, settings, options = {}) {
  const readIndependentSites = createIndependentPanel(settings, independentFactories);
  const notes = options.notes;
  let cached = null;
  let cachedAt = 0;
  let inflight = null;
  const ttlMs = 60000;

  const readSummary = async function ({ force = false } = {}) {
    if (!force && cached && Date.now() - cachedAt < ttlMs) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const summary = await buildSummary(session, settings, { readIndependentSites, notes });
        cached = summary;
        cachedAt = Date.now();
        return summary;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
  readSummary.dispose = () => readIndependentSites.dispose();
  return readSummary;
}
