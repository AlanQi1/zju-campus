/**
 * 数字点名：从课堂转录与课件/白板画面里猜出签到码。
 *
 * 数字点名要求学生在课程平台输入 4 位数字，老师通常把它念出来，或者直接
 * 写在白板/PPT 上。所以这里把两个来源都过一遍：
 *
 *   1. 服务端 `student_rollcalls` 返回的 `number_code`（有就直接用，最准）；
 *   2. 智云课堂的语音转录（回放课有，直播中通常为空）；
 *   3. 智云课堂最新课件/白板截图，跑本地 OCR（直播中主要靠这条）。
 *
 * 判断不出唯一答案时不猜：返回 code=null 并给出候选，让用户自己去智云课堂确认。
 */

/** 4 位连写数字（前后不粘连其它数字）。 */
const CODE_RE = /(?<![\d.])(\d{4})(?!\d)(?!\.\d)/g;

/**
 * 老师手写在黑板上时常把数字分开写：「4 7 2 9」「4-7-2-9」「47 29」。
 * 这几种写法上面那条正则一个都抓不到，所以单独认一遍，归一化后当成同一个 4 位数。
 */
const SPACED_CODE_RE = /(?<![\d.])\d(?:[\s\-–—_./·]{1,3}\d){3}(?![\d.])/g;
const SEPARATOR_RE = /[\s\-–—_./·]/g;

/** 强提示词：出现这些词时，附近的数字大概率就是签到码。 */
const STRONG_WORDS = ['签到码', '签到数字', '签到口令', '数字签到', '签到', '口令', '验证码', '答案'];
const WEAK_WORDS = ['数字', '输入', '四位', '4位', 'answer', 'code', 'number'];

/** 一条命中记录的最大上下文长度。 */
const SNIPPET_PAD = 18;

/** 把文本切成记录：一行/一段算一条。 */
function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value);
}

/** 命中上下文里是否含提示词。 */
export function keywordWeight(snippet) {
  const text = normalizeText(snippet).toLowerCase();
  let weight = 0;
  for (const word of STRONG_WORDS) {
    if (text.includes(word)) weight = Math.max(weight, 3);
  }
  if (weight === 0) {
    for (const word of WEAK_WORDS) {
      if (text.includes(word)) weight = Math.max(weight, 1);
    }
  }
  return weight;
}

/**
 * 从一段文本里抽出 4 位数字候选。
 * @param {string} text
 * @returns {Array<{ code: string, snippet: string }>}
 */
export function findCodes(text) {
  const value = normalizeText(text);
  if (!value) return [];
  const out = [];
  const seen = new Set();
  const push = (code, index, span) => {
    const start = Math.max(0, index - SNIPPET_PAD);
    const end = Math.min(value.length, index + span + SNIPPET_PAD);
    const snippet = value.slice(start, end).replace(/\s+/g, ' ');
    const key = `${code}@${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ code, snippet, index });
  };
  CODE_RE.lastIndex = 0;
  let match = CODE_RE.exec(value);
  while (match !== null) {
    push(match[1], match.index, match[0].length);
    match = CODE_RE.exec(value);
  }
  // 分开写的数字：黑板上常写「4 7 2 9」，转录里也常被断成「4，7，2，9」
  SPACED_CODE_RE.lastIndex = 0;
  let spaced = SPACED_CODE_RE.exec(value);
  while (spaced !== null) {
    const code = spaced[0].replace(SEPARATOR_RE, '');
    if (code.length === 4) push(code, spaced.index, spaced[0].length);
    spaced = SPACED_CODE_RE.exec(value);
  }
  // 按在原文里出现的先后返回，调用方读日志/候选时顺序稳定
  return out.sort((a, b) => a.index - b.index).map(({ code, snippet }) => ({ code, snippet }));
}

/**
 * 把若干「文本块」汇总成带分数的候选。
 *
 * @param {Array<{ source: 'server'|'transcript'|'ocr', at?: number|null, text: string }>} blocks
 * @param {{ now?: number, recentMs?: number }} [options]
 */
export function collectCandidates(blocks, options = {}) {
  const now = Number(options.now) || Date.now();
  const recentMs = Number(options.recentMs) || 10 * 60 * 1000;
  const map = new Map();
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || !block.text) continue;
    const source = block.source === 'ocr' || block.source === 'server' || block.source === 'live'
      ? block.source
      : 'transcript';
    const at = Number(block.at);
    const ageMs = Number.isFinite(at) && at > 0 ? now - at : null;
    const fresh = ageMs !== null && ageMs >= 0 && ageMs <= recentMs;
    const stale = ageMs !== null && ageMs > recentMs;
    for (const hit of findCodes(block.text)) {
      const entry = map.get(hit.code) || { code: hit.code, score: 0, hits: [], sources: new Set() };
      let score = 1;
      if (source === 'ocr') score += 2; // 白板上的字比听错的口播可靠
      // 直播摄像头画面（老师手写在黑板上）：最贴近现场，手写数字 + 关键词时权重最高
      if (source === 'live') score += 3;
      if (source === 'server') score += 12;
      score += keywordWeight(hit.snippet);
      if (fresh) score += 2;
      if (stale) score -= 2;
      entry.score += score;
      entry.sources.add(source);
      entry.hits.push({
        source,
        at: Number.isFinite(at) && at > 0 ? at : null,
        fresh,
        snippet: hit.snippet,
      });
      map.set(hit.code, entry);
    }
  }
  return [...map.values()]
    .map((entry) => ({
      code: entry.code,
      score: Math.round(entry.score * 100) / 100,
      sources: [...entry.sources],
      hitCount: entry.hits.length,
      latestAt: entry.hits.reduce((max, hit) => (hit.at && (!max || hit.at > max) ? hit.at : max), null),
      sample: entry.hits[0]?.snippet || '',
    }))
    .sort((a, b) => b.score - a.score || b.hitCount - a.hitCount);
}

/** 置信度换算成 0~1，配合「唯一且领先」使用。 */
function confidenceOf(top, second) {
  const gap = top.score - (second ? second.score : 0);
  const base = Math.min(0.55, top.score / 24);
  const bonus = Math.min(0.4, gap / 16);
  return Math.round(Math.min(0.97, 0.35 + base + bonus) * 100) / 100;
}

/**
 * 决定最终答案。
 *
 * 只有「存在候选 + 最高分够高 + 明显领先第二名」才给答案；否则 code=null，
 * 让界面显示「无法判断，请打开智云课堂自行确认」。
 *
 * @param {Array<ReturnType<typeof collectCandidates>[number]>} candidates
 * @param {{ minScore?: number, minGap?: number, maxCandidates?: number }} [options]
 */
export function decideCode(candidates, options = {}) {
  const minScore = Number(options.minScore) > 0 ? Number(options.minScore) : 4;
  const minGap = Number(options.minGap) >= 0 ? Number(options.minGap) : 3;
  const maxCandidates = Number(options.maxCandidates) > 0 ? Number(options.maxCandidates) : 5;
  const list = Array.isArray(candidates) ? candidates.filter((item) => item && item.code) : [];
  const shortlist = list.slice(0, maxCandidates);
  if (list.length === 0) {
    return { code: null, confidence: 0, reason: '没有在转录或画面里找到 4 位数字', candidates: [] };
  }
  const [top, second] = list;
  const gap = top.score - (second ? second.score : 0);
  const serverHit = top.sources.includes('server');
  if (!serverHit && (top.score < minScore || gap < minGap)) {
    return {
      code: null,
      confidence: 0,
      reason:
        top.score < minScore
          ? `只看到 ${list.length} 个数字，线索太弱（最高分 ${top.score}）`
          : `同时出现多个可能数字（${shortlist.slice(0, 3).map((item) => item.code).join(' / ')}），分不清是哪一个`,
      candidates: shortlist,
    };
  }
  return {
    code: top.code,
    confidence: serverHit ? 0.99 : confidenceOf(top, second),
    reason: serverHit ? '课程平台直接给出了签到码' : `出现 ${top.hitCount} 次，领先第二名 ${gap.toFixed(1)} 分`,
    candidates: shortlist,
  };
}

/**
 * 数字点名检测器：带 TTL 缓存，避免每次刷新面板都去 OCR 一遍。
 */
export class NumberDetector {
  /**
   * @param {{
   *   gather: (rollcall: object) => Promise<{ serverCode?: string|null, blocks?: Array<{source: string, at?: number|null, text: string}>, lesson?: object|null, notes?: string[] }>,
   *   ttlMs?: number,
   *   logger?: { info?: Function, warn?: Function },
   * }} options
   */
  constructor(options = {}) {
    if (typeof options.gather !== 'function') throw new Error('NumberDetector 需要 gather 回调');
    this.gather = options.gather;
    this.ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : 90000;
    this.logger = options.logger || null;
    this.cache = new Map();
    this.lastError = null;
    this.runs = 0;
  }

  read(rollcallId) {
    const hit = this.cache.get(String(rollcallId));
    if (!hit) return null;
    if (Date.now() - hit.at > this.ttlMs) return null;
    return hit;
  }

  /** 清掉某个点名（或全部）的缓存。 */
  forget(rollcallId) {
    if (rollcallId === undefined || rollcallId === null) this.cache.clear();
    else this.cache.delete(String(rollcallId));
  }

  /**
   * 检测一次。带缓存；`force: true` 强制重算。
   * @param {{ id: string|number, courseTitle?: string, type?: string }} rollcall
   */
  async detect(rollcall, options = {}) {
    if (!rollcall || rollcall.id === undefined || rollcall.id === null) {
      throw new Error('缺少点名 id');
    }
    const key = String(rollcall.id);
    if (options.force !== true) {
      const cached = this.read(key);
      if (cached) return { ...cached.result, cached: true, detectedAt: cached.at };
    }
    const startedAt = Date.now();
    this.runs += 1;
    let payload;
    try {
      payload = await this.gather(rollcall);
    } catch (error) {
      this.lastError = String(error?.message || error);
      const fallback = {
        rollcallId: rollcall.id,
        courseTitle: rollcall.courseTitle || '',
        code: null,
        confidence: 0,
        reason: `读取课堂材料失败：${this.lastError}`,
        candidates: [],
        sources: [],
        notes: [],
        lesson: null,
        elapsedMs: Date.now() - startedAt,
      };
      this.cache.set(key, { at: Date.now(), result: fallback });
      return fallback;
    }

    const serverCode = String(payload?.serverCode || '').trim();
    const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
    if (serverCode && /^\d{3,8}$/.test(serverCode)) {
      const result = {
        rollcallId: rollcall.id,
        courseTitle: rollcall.courseTitle || '',
        code: serverCode,
        confidence: 0.99,
        reason: '课程平台直接给出了签到码',
        candidates: [{ code: serverCode, score: 99, sources: ['server'], hitCount: 1, latestAt: null, sample: 'number_code 字段' }],
        sources: ['server'],
        notes: payload?.notes || [],
        lesson: payload?.lesson || null,
        elapsedMs: Date.now() - startedAt,
      };
      this.cache.set(key, { at: Date.now(), result });
      return result;
    }

    const candidates = collectCandidates(blocks);
    const decided = decideCode(candidates);
    const result = {
      rollcallId: rollcall.id,
      courseTitle: rollcall.courseTitle || '',
      code: decided.code,
      confidence: decided.confidence,
      reason: decided.reason,
      candidates: decided.candidates,
      sources: [...new Set(blocks.map((block) => block.source))],
      notes: payload?.notes || [],
      lesson: payload?.lesson || null,
      elapsedMs: Date.now() - startedAt,
    };
    this.cache.set(key, { at: Date.now(), result });
    return result;
  }

  state() {
    return {
      ttlMs: this.ttlMs,
      runs: this.runs,
      lastError: this.lastError,
      cached: [...this.cache.entries()].map(([id, entry]) => ({
        rollcallId: id,
        at: entry.at,
        code: entry.result.code,
        confidence: entry.result.confidence,
      })),
    };
  }
}
