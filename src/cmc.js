/**
 * 智云课堂（*.cmc.zju.edu.cn）：课表与课堂语音转录。
 *
 * 登录同样走 ZJUAM CAS，入口是 tgmedia.cmc.zju.edu.cn/。
 * 登录后 JWTUser Cookie 是 URL 编码的 JSON（名字叫 JWT，实际不是 JWT），含 sub=user_id。
 */
import { request } from './http.js';
import { casLogin } from './zjuam.js';

export const CMC_LANDING = 'https://tgmedia.cmc.zju.edu.cn/';
export const CMC_YJAPI = 'https://yjapi.cmc.zju.edu.cn';
export const CMC_INTERACTIVE = 'https://interactivemeta.cmc.zju.edu.cn';
export const CMC_PPT = 'https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt';
export const CMC_TENANT = '112';

/** 从 Cookie 里解析当前用户信息。 */
function readUser(jar) {
  const raw = jar.value('JWTUser');
  if (!raw) return null;
  try {
    const info = JSON.parse(decodeURIComponent(raw));
    const userId = info?.sub ?? info?.user_id ?? info?.id ?? null;
    if (!userId) return null;
    return { userId: String(userId), realname: info?.realname || info?.name || '' };
  } catch {
    return null;
  }
}

/** 智云课堂客户端。 */
export class CmcClient {
  /**
   * @param {import('./http.js').CookieJar} jar
   * @param {{ userId: string, realname: string }} user
   * @param {{ timeoutMs?: number, tenantId?: string }} [options]
   */
  constructor(jar, user, options = {}) {
    this.jar = jar;
    this.user = user;
    this.timeoutMs = options.timeoutMs ?? 20000;
    this.tenantId = options.tenantId ?? CMC_TENANT;
  }

  /** 登录智云课堂。 */
  static async login({ username, password, timeoutMs = 20000, tenantId = CMC_TENANT }) {
    const { jar, landedOnCas } = await casLogin({
      landingUrl: CMC_LANDING,
      username,
      password,
      timeoutMs,
    });
    if (!landedOnCas) {
      // 已带登录态，直接复用
    }
    const user = readUser(jar);
    if (!user) {
      throw new Error('智云课堂登录后未取到 JWTUser/user_id，可能是 CAS 未把票据回传到 cmc 站点');
    }
    return new CmcClient(jar, user, { timeoutMs, tenantId });
  }

  /**
   * 某天/某区间的课表。
   *
   * 返回的每节课都带 `date`（YYYY-MM-DD），并按「日期 + 开始时间」排序；
   * 同时给出按天汇总的 `days`，方便面板画「近 7 天」日期条。
   * @param {string} start YYYY-MM-DD
   * @param {string} end YYYY-MM-DD
   */
  async schedule(start, end) {
    const url =
      `${CMC_YJAPI}/courseapi/v2/schedule/get-week-schedules` +
      `?user_id=${encodeURIComponent(this.user.userId)}` +
      `&tenant_id=${encodeURIComponent(this.tenantId)}` +
      `&start_at=${encodeURIComponent(start)}` +
      `&end_at=${encodeURIComponent(end)}`;
    const res = await request(this.jar, url, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: this.timeoutMs });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`课表接口返回非 JSON（HTTP ${res.res.status}），会话可能已失效：${text.slice(0, 120)}`);
    }
    const days = json?.result?.list || [];
    const lessons = [];
    const buckets = [];
    for (const day of days) {
      const date = normalizeDay(day?.day ?? day?.date);
      const dayLessons = [];
      for (const course of day?.course || []) {
        const hasTranscript = course.status_label === '回放';
        const lesson = {
          subId: course.id,
          courseId: course.course_id ?? null,
          date,
          title: course.course_title || '',
          teacher: course.teacher_name || '',
          room: course.room_name || '',
          statusLabel: course.status_label || '',
          hasTranscript,
          url: classroomUrl(course),
          startAt: course.start_at ? formatTime(course.start_at) : null,
          endAt: course.end_at ? formatTime(course.end_at) : null,
        };
        lessons.push(lesson);
        dayLessons.push(lesson);
      }
      buckets.push({ date, lessons: dayLessons });
    }
    lessons.sort((a, b) =>
      `${a.date || ''} ${a.startAt || ''}`.localeCompare(`${b.date || ''} ${b.startAt || ''}`),
    );
    return { start, end, lessons, days: buckets };
  }

  /**
   * 某节课的语音识别转录。
   * @param {string|number} subId
   */
  async transcript(subId) {
    if (subId === undefined || subId === null || subId === '') {
      throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
    }
    const url =
      `${CMC_INTERACTIVE}/courseapi/v3/web-socket/search-trans-result` +
      `?sub_id=${encodeURIComponent(subId)}&format=json`;
    const res = await request(this.jar, url, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: this.timeoutMs });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`转录接口返回非 JSON（HTTP ${res.res.status}），会话可能已失效：${text.slice(0, 120)}`);
    }
    const segments = json?.list?.[0]?.all_content || [];
    return segments.map((segment) => ({
      begin: Number(segment.BeginSec) || 0,
      text: segment.Text || '',
      translation: segment.TransText || '',
    }));
  }

  /**
   * 某节课的课件（PPT）时间轴。接口来自课堂前端 `pptnote/v1/schedule/search-ppt`。
   * 需要 course_id（课表接口会返回）。
   * @param {string|number} subId
   * @param {string|number} courseId
   */
  async slides(subId, courseId) {
    if (subId === undefined || subId === null || subId === '') {
      throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
    }
    if (courseId === undefined || courseId === null || courseId === '') {
      throw new Error('缺少 course_id：课件接口需要 course_id 与 sub_id');
    }
    const url =
      `${CMC_PPT}?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}`;
    const res = await request(this.jar, url, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: this.timeoutMs });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`课件接口返回非 JSON（HTTP ${res.res.status}），会话可能已失效：${text.slice(0, 120)}`);
    }
    return parseSlides(json);
  }

  /**
   * 下载一张课件图片。
   * @param {string} url
   * @returns {Promise<{ buffer: Buffer, contentType: string }>}
   */
  async downloadSlide(url) {
    if (!url) throw new Error('缺少课件图片地址');
    const res = await request(this.jar, url, {}, { follow: true, timeoutMs: this.timeoutMs });
    if (!res.res.ok) throw new Error(`课件图片下载失败（HTTP ${res.res.status}）`);
    const buffer = Buffer.from(await res.res.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) throw new Error('课件图片超过 8MB，已跳过');
    return { buffer, contentType: res.res.headers.get('content-type') || 'image/jpeg' };
  }

  /**
   * 某节课的回放直达链接与信息（借鉴 ZJU-live-better 的 getVideoURL）。
   * @param {string|number} subId
   * @param {string|number} [courseId]
   */
  playback(subId, courseId) {
    if (subId === undefined || subId === null || subId === '') {
      throw new Error('缺少 sub_id：先用 zju_schedule 拿到课程的 sub_id');
    }
    return {
      subId,
      courseId: courseId || null,
      url: classroomUrl({ id: subId, course_id: courseId }),
      platformUrl: 'https://classroom.zju.edu.cn/',
    };
  }

  /**
   * 正在直播的这节课的 HLS 直播流地址。
   *
   * 走的是课程目录接口 `courseapi/v2/course/catalogue`：status === '1' 表示直播中，
   * 该条目的 `video_url` 就是 `livepgc.cmc.zju.edu.cn/pgc/<id>.m3u8?auth_key=...`。
   * auth_key 带过期时间（实测约 6 小时），所以每次抓帧前重新取一次，不要缓存太久。
   *
   * 拿到的是**教室全景摄像头**画面：左边黑板、右边投影幕、讲台与讲者都在里面，
   * 老师手写在黑板上的数字可以从这一路画面里 OCR 出来。
   *
   * @param {string|number} courseId
   * @param {string|number} [subId] 指定课次；省略则返回该课程当前正在直播的课次
   * @returns {Promise<{subId: string, courseId: string, title: string, videoUrl: string, room: string,
   *   teacher: string, startedAt: number|null, poster: string, passes: object} | null>}
   */
  async liveStream(courseId, subId) {
    if (courseId === undefined || courseId === null || courseId === '') {
      throw new Error('缺少 course_id：直播流接口必须带 course_id');
    }
    const url =
      `${CMC_YJAPI}/courseapi/v2/course/catalogue?course_id=${encodeURIComponent(courseId)}`;
    const res = await request(this.jar, url, { headers: { Accept: 'application/json' } }, { follow: true, timeoutMs: this.timeoutMs });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`课程目录接口返回非 JSON（HTTP ${res.res.status}），会话可能已失效：${text.slice(0, 120)}`);
    }
    const list = json?.result?.data || [];
    const wantSub = subId === undefined || subId === null || subId === '' ? '' : String(subId);
    const live = list.filter((item) => {
      if (String(item?.status ?? '') !== '1') return false;
      if (wantSub) return String(item?.sub_id ?? '') === wantSub;
      return true;
    });
    const pick = live[0];
    if (!pick) return null;
    let content = pick.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        content = {};
      }
    }
    return {
      subId: String(pick.sub_id ?? ''),
      courseId: String(pick.course_id ?? courseId),
      title: String(pick.title || ''),
      videoUrl: String(pick.video_url || ''),
      poster: String(pick.pic || ''),
      room: String(pick.room || ''),
      teacher: String(pick.lecturer_name || ''),
      startedAt: Number(pick.start_at) > 0 ? Number(pick.start_at) : null,
      passes: content?.api_pass || {},
    };
  }
}

/**
 * 课堂页面地址：统一走 /livingroom（直播和回放都是这个页面）。
 * 参数来自课堂前端路由：course_id + sub_id + tenant_code。
 * 例：https://classroom.zju.edu.cn/livingroom?course_id=12303&sub_id=1234506&tenant_code=112
 */
export function classroomUrl(course) {
  const courseId = course?.course_id;
  const subId = course?.id;
  if (!courseId || !subId) return null;
  const params = new URLSearchParams({
    course_id: String(courseId),
    sub_id: String(subId),
    tenant_code: String(CMC_TENANT),
  });
  return `https://classroom.zju.edu.cn/livingroom?${params.toString()}`;
}

/** 智云课堂返回的「天」字段 → YYYY-MM-DD。 */
export function normalizeDay(value) {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match ? match[1] : '';
  }
  return '';
}

/**
 * 解析课件接口返回。
 * 每条 content 可能是 JSON 字符串，里面才有 pptimgurl；按 created_sec 升序排好。
 * @param {any} json
 */
export function parseSlides(json) {
  const list = json?.list || json?.result?.list || [];
  if (!Array.isArray(list)) return [];
  const slides = [];
  for (const item of list) {
    let content = item?.content;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        content = {};
      }
    }
    const url = content?.pptimgurl || content?.pptthumb || '';
    if (!url) continue;
    slides.push({
      at: Number(item?.created_sec ?? content?.created ?? 0) || 0,
      url: String(url),
      key: Boolean(content?.is_key),
      type: String(content?.detecttype || 'ppt'),
    });
  }
  slides.sort((a, b) => a.at - b.at);
  slides.forEach((slide, index) => {
    slide.index = index + 1;
  });
  return slides;
}

/** 时间 → 东八区 HH:mm。
 *
 * 智云课堂的 start_at / end_at 是 **Unix 时间戳（秒）**，不是当天秒数；
 * 这里同时兼容：已格式化的 "HH:mm[:ss]"、当天秒数（< 86400）、Unix 时间戳。
 */
export function formatTime(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && value.includes(':')) return value.slice(0, 5);
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';

  if (num >= 86400) {
    // Unix 时间戳（秒）→ 东八区
    const d = new Date(num * 1000 + 8 * 3600 * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  // 当天秒数
  const total = Math.floor(num);
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}`;
}
