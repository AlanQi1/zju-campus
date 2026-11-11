/**
 * 数字点名的材料采集：服务端 number_code、课堂转录、最新课件/白板截图 OCR。
 *
 * 采集本身只读——不提交任何签到码。猜码与判断逻辑在 `rollcall-number.js`。
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome } from './session.js';

/** 直播中最近的转录片段最多取多少段（回放课取尾部即可）。 */
const MAX_TRANSCRIPT_SEGMENTS = 80;

/** 抓几张最新课件图（白板上写的数字通常在最后几页）。 */
const MAX_SLIDES = 3;

/** 直播画面取样模式：黑板区 / 投影区各抓一帧。 */
const LIVE_MODES = ['board', 'slide'];

/** 上海时区今天。 */
function todayShanghai() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

/** 日期加减。 */
function shiftDate(dateString, delta) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** 「直播中」/「回放」这类标签里挑正在进行的课。 */
function preferLive(lessons) {
  const live = lessons.filter((lesson) => /直播/.test(String(lesson.statusLabel || '')));
  return live.length > 0 ? live : lessons;
}

/**
 * 在最近 N 天课表里挑和这次点名最匹配的一节课。
 *
 * 先按课程名匹配（平台两边课程名一致），同名多节时优先「直播中」，再看时间最近。
 */
export function pickLesson(lessons, rollcall, today = todayShanghai()) {
  const title = String(rollcall?.courseTitle || '').trim();
  const all = Array.isArray(lessons) ? lessons : [];
  let pool = all;
  if (title) {
    const matched = all.filter((lesson) => String(lesson.title || '').trim() === title);
    if (matched.length > 0) pool = matched;
  }
  if (pool.length === 0) return null;
  const sorted = pool
    .slice()
    .sort((a, b) => `${b.date || ''} ${b.endAt || ''}`.localeCompare(`${a.date || ''} ${a.endAt || ''}`));
  const live = preferLive(sorted);
  const todayLessons = live.filter((lesson) => lesson.date === today);
  const pick = todayLessons[0] || live[0] || null;
  return pick;
}

/** 课件图扩展名。 */
function slideExtension(url) {
  const match = /\.(png|webp|gif|jpg|jpeg)(?:\?|$)/i.exec(String(url || ''));
  if (!match) return 'jpg';
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

/**
 * 造一个 gather 回调给 NumberDetector。
 *
 * @param {{
 *   session: import('./session.js').ZjuSession,
 *   runCommand: (command: string, args: string[], options?: object) => Promise<{code:number, stdout:string, stderr:string}>,
 *   ocrScript: string,
 *   ocrPython?: string,
 *   live?: boolean,
 *   workDir?: string,
 *   logger?: object,
 *   timeoutMs?: number,
 * }} options
 */
export function createNumberGather(options = {}) {
  const { session, runCommand, ocrScript } = options;
  if (!session) throw new Error('createNumberGather 需要 session');
  const python = options.ocrPython || 'python';
  const live = options.live !== false;
  const workDir = options.workDir || join(dshHome(), 'zju-campus', 'number-shots');
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 180000;
  const logger = options.logger || null;
  const frameScript = options.frameScript || join(dirname(ocrScript), 'grab-frame.py');

  /** 服务端字段：数字点名进行中时 number_code 通常直接给。 */
  async function readServerCode(rollcall) {
    try {
      const detail = await session.withClient('courses', (client) => client.rollcallDetail(rollcall.id));
      const json = detail?.json || {};
      const code = json.number_code ?? json.numberCode ?? json.data?.number_code ?? null;
      const raw = code === null || code === undefined ? '' : String(code).trim();
      return /^\d{3,8}$/.test(raw) ? raw : '';
    } catch (error) {
      logger?.debug?.(`zju-campus: 读 number_code 失败 ${String(error?.message || error)}`);
      return '';
    }
  }

  /** 课表里找这一节。 */
  async function findLesson(rollcall) {
    const today = todayShanghai();
    const start = shiftDate(today, -13);
    try {
      const data = await session.withClient('cmc', (client) => client.schedule(start, today));
      const lesson = pickLesson(data?.lessons || [], rollcall, today);
      if (!lesson) {
        return { lesson: null, note: `近 14 天课表里没有「${rollcall?.courseTitle || '这门课'}」` };
      }
      return { lesson, note: '' };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 100);
      logger?.warn?.(`zju-campus: 拉课表失败 ${message}`);
      return { lesson: null, note: `拉课表失败：${message}` };
    }
  }

  /** 转录尾部若干段，转成 blocks。 */
  async function readTranscriptBlocks(lesson) {
    if (!lesson?.subId) return { blocks: [], note: '课表里没找到这节课' };
    try {
      const segments = await session.withClient('cmc', (client) => client.transcript(lesson.subId));
      if (!Array.isArray(segments) || segments.length === 0) {
        return { blocks: [], note: '这节课还没有转录（直播中通常要等回放才有）' };
      }
      const tail = segments.slice(-MAX_TRANSCRIPT_SEGMENTS);
      return {
        // begin 是这节课内的绝对秒数，直接换成毫秒时间戳（缓存里只用来算新旧）。
        blocks: tail.map((segment) => ({
          source: 'transcript',
          at: (Number(segment.begin) || 0) * 1000,
          text: String(segment.text || ''),
        })),
        note: `转录 ${segments.length} 段，取尾部 ${tail.length} 段`,
      };
    } catch (error) {
      return { blocks: [], note: `转录读取失败：${String(error?.message || error).slice(0, 100)}` };
    }
  }

  /** 最新课件/白板截图 OCR。 */
  async function readSlideBlocks(lesson) {
    if (!lesson?.subId || !lesson?.courseId) {
      return { blocks: [], note: '这节课缺少 course_id，取不到课件画面' };
    }
    try {
      const slides = await session.withClient('cmc', (client) => client.slides(lesson.subId, lesson.courseId));
      if (!Array.isArray(slides) || slides.length === 0) {
        return { blocks: [], note: '这节课还没有课件截图' };
      }
      const recent = slides.slice(-MAX_SLIDES);
      const dir = join(workDir, String(lesson.subId));
      mkdirSync(dir, { recursive: true });
      const blocks = [];
      const errors = [];
      const seen = new Set();
      for (const slide of recent) {
        const file = join(dir, `slide-${slide.index}.${slideExtension(slide.url)}`);
        try {
          const image = await session.withClient('cmc', (client) => client.downloadSlide(slide.url));
          writeFileSync(file, image.buffer);
          const run = await runCommand(python, [ocrScript, file], { timeoutMs });
          if (run.code !== 0) {
            errors.push(`第 ${slide.index} 页 OCR 退出码 ${run.code}`);
            continue;
          }
          const parsed = JSON.parse(run.stdout || '{}');
          const text = (parsed.lines || []).join(' ').trim();
          // 老师常在一页上停很久，PPT 时间轴里同一页会出现好几次：同样的文字只留第一份，
          // 否则同一个数字被重复计数，分数会被虚高。
          if (text && !seen.has(text)) {
            seen.add(text);
            blocks.push({ source: 'ocr', at: Number(slide.at) * 1000 || null, text });
          }
        } catch (error) {
          errors.push(`第 ${slide.index} 页：${String(error?.message || error).slice(0, 80)}`);
        } finally {
          try {
            rmSync(file, { force: true });
          } catch {
            /* 清理失败无所谓 */
          }
        }
      }
      return {
        blocks,
        note: blocks.length > 0
          ? `课件 OCR 取了最新 ${blocks.length} 页`
          : `课件 OCR 没取到文字${errors.length > 0 ? `（${errors[0]}）` : ''}`,
      };
    } catch (error) {
      return { blocks: [], note: `课件读取失败：${String(error?.message || error).slice(0, 100)}` };
    }
  }

  /**
   * 直播画面取样：老师写在黑板上的数字只能从摄像头上看。
   *
   * 智云的直播流是整间教室的全景摄像头，左黑板、右投影都在画面里。
   * 这里对每一路取景（黑板区 / 投影区）各抓一帧最新画面再 OCR：
   * 黑板区抠出来放大能认出粉笔字，投影区用来兜「老师把数字打在 PPT 上」的情况。
   */
  async function readLiveBlocks(lesson, rollcall) {
    if (live === false) {
      return { blocks: [], info: null, note: '' };
    }
    if (!lesson?.courseId) {
      return { blocks: [], info: null, note: '' };
    }
    let stream = null;
    try {
      stream = await session.withClient('cmc', (client) =>
        client.liveStream(lesson.courseId, lesson.subId || undefined),
      );
    } catch (error) {
      return {
        blocks: [],
        info: null,
        note: `直播流地址读取失败：${String(error?.message || error).slice(0, 80)}`,
      };
    }
    if (!stream?.videoUrl) {
      return { blocks: [], info: null, note: '' };
    }
    const dir = join(workDir, String(lesson.subId || rollcall?.id || 'live'));
    mkdirSync(dir, { recursive: true });
    const blocks = [];
    const shots = [];
    const errors = [];
    const now = Date.now();
    for (const mode of LIVE_MODES) {
      const file = join(dir, `live-${mode}.png`);
      try {
        const run = await runCommand(
          python,
          [frameScript, '--url', stream.videoUrl, '--out', file, '--mode', mode, '--drain', '2.5', '--enhance'],
          { timeoutMs },
        );
        if (run.code !== 0) {
          errors.push(`${mode} 抓帧退出码 ${run.code}`);
          continue;
        }
        const grabbed = JSON.parse(run.stdout || '{}');
        if (!grabbed.ok) {
          errors.push(`${mode} 抓帧失败：${grabbed.error || '未知原因'}`);
          continue;
        }
        // 图留给用户看：面板里直接把这一帧显示出来，认不出数字时也能自己扫一眼黑板
        shots.push({
          mode,
          file,
          width: grabbed.width || null,
          height: grabbed.height || null,
          frames: grabbed.frames || 0,
        });
        const ocr = await runCommand(python, [ocrScript, file], { timeoutMs });
        if (ocr.code !== 0) {
          errors.push(`${mode} OCR 退出码 ${ocr.code}`);
          continue;
        }
        const parsed = JSON.parse(ocr.stdout || '{}');
        let text = (parsed.lines || []).join(' ').trim();
        // 深色黑板上的白粉笔字对 OCR 不友好：再拿增强图（反相+CLAHE+锐化）认一遍补漏
        if (grabbed.enhanced) {
          try {
            const again = await runCommand(python, [ocrScript, grabbed.enhanced], { timeoutMs });
            if (again.code === 0) {
              const more = (JSON.parse(again.stdout || '{}').lines || []).join(' ').trim();
              if (more && more !== text) text = text ? `${text} ${more}` : more;
            }
          } catch {
            // 增强图这条路失败不影响已经认到的文字
          }
        }
        if (text) {
          blocks.push({ source: 'live', at: now, text, mode });
        }
      } catch (error) {
        errors.push(`${mode}：${String(error?.message || error).slice(0, 80)}`);
      }
    }
    const info = {
      subId: stream.subId,
      title: stream.title,
      room: stream.room,
      teacher: stream.teacher,
      at: now,
      modes: LIVE_MODES,
      shots,
    };
    return {
      blocks,
      info,
      note: blocks.length > 0
        ? `直播画面 OCR：${blocks.map((b) => (b.mode === 'board' ? '黑板' : '投影')).join('+')}`
        : `直播画面没认出文字${errors.length > 0 ? `（${errors[0]}）` : ''}`,
    };
  }

  return async function gather(rollcall) {
    const notes = [];
    const serverCode = await readServerCode(rollcall);
    if (serverCode) {
      return {
        serverCode,
        blocks: [],
        lesson: null,
        notes: ['课程平台已给出 number_code，直接采用'],
      };
    }
    const found = await findLesson(rollcall);
    const lesson = found.lesson;
    if (found.note) notes.push(found.note);
    const [transcript, ocr, live] = await Promise.all([
      readTranscriptBlocks(lesson),
      readSlideBlocks(lesson),
      readLiveBlocks(lesson, rollcall),
    ]);
    if (transcript.note) notes.push(transcript.note);
    if (ocr.note) notes.push(ocr.note);
    if (live.note) notes.push(live.note);
    return {
      serverCode: '',
      blocks: [...ocr.blocks, ...live.blocks, ...transcript.blocks],
      lesson: lesson ? { ...lesson, live: live.info || null } : null,
      notes,
    };
  };
}
