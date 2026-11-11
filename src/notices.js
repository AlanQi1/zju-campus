/**
 * 校园公开通知聚合：求是学院、本科生院、外国语学院、光电学院。
 *
 * 都不需要校园账号；只用 GET，只读列表页与正文页。
 * ITC 需要 ZJUAM 站点会话，本插件暂不接入，避免把认证失败混进通知采集。
 */
import { CookieJar, absoluteUrl, decodeEntities, extractDivByClass, request, stripTags } from './http.js';

/** 通知来源定义。 */
export const SOURCES = {
  qsxy: {
    id: 'qsxy',
    name: '求是学院 · 重要通知',
    url: 'http://qsxy.zju.edu.cn/30845/list.psp',
    parser: 'webplus',
  },
  bksy: {
    id: 'bksy',
    name: '本科生院 · 通知公告',
    url: 'https://bksy.zju.edu.cn/28418/list.htm',
    parser: 'bksy',
  },
  sis: {
    id: 'sis',
    name: '外国语学院 · 学院新闻',
    url: 'http://www.sis.zju.edu.cn/sischinese/',
    parser: 'webplus',
  },
  opt: {
    id: 'opt',
    name: '光电学院 · 通知公告',
    url: 'http://opt.zju.edu.cn/main.htm',
    parser: 'webplus',
  },
};

/**
 * 解析 WebPlus 的 li.news 列表。
 *
 * 兼容几种常见变体：
 *   - 标准：<span class="news_title">标题</span><span class="news_meta">2026-10-24</span>
 *   - 标题在 a[title] 上（外国语学院等）
 *   - 日期被拆成 tsxw_ny（2026-10）+ tsxw_rq（26）
 */
function parseWebplus(html, base) {
  const items = [];
  const seen = new Set();
  const itemRe = /<li[^>]*class=["'][^"']*\bnews\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = itemRe.exec(html)) !== null) {
    const block = match[1];
    const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const attrs = anchor[1];
    const href = /href=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href || /^javascript:/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    // 标题优先级：span.news_title 文本 > a[title] > 整段文本
    const titleSpan = /class=["'][^"']*news_title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1];
    const titleAttr = /title=["']([^"']*)["']/i.exec(attrs)?.[1];
    const title = decodeEntities(titleAttr || stripTags(titleSpan || '') || stripTags(anchor[2])).trim();
    if (!title) continue;

    // 日期优先级：span.news_meta > tsxw_ny + tsxw_rq > 块内第一个日期
    const yearMonth = /class=["'][^"']*tsxw_ny[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1];
    const day = /class=["'][^"']*tsxw_rq[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1];
    let date = /class=["'][^"']*news_meta[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1];
    date = date ? stripTags(date).trim() : '';
    if (date && !/^\d{4}/.test(date) && yearMonth) {
      // 只有「10-23」这种月日时，用 tsxw_ny 的年份补全
      const year = /(20\d{2})/.exec(stripTags(yearMonth));
      if (year) date = `${year[1]}-${date}`;
    }
    if (date && !/^\d{4}/.test(date)) {
      // 最后兜底：WebPlus 的文章地址里带日期，如 /2026/1023/c...
      const fromUrl = /\/(20\d{2})\/(\d{2})(\d{2})\//.exec(href);
      if (fromUrl) date = `${fromUrl[1]}-${fromUrl[2]}-${fromUrl[3]}`;
    }
    if (!date && yearMonth && day) {
      date = `${stripTags(yearMonth).trim()}-${stripTags(day).trim().padStart(2, '0')}`;
    }
    if (!date) {
      const found = /(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/.exec(stripTags(block));
      if (found) date = `${found[1]}-${found[2].padStart(2, '0')}-${found[3].padStart(2, '0')}`;
    }
    // 年份无法从页面或文章URL证实时保留月日，不猜测当前年份。
    const datePrecision = /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'day' : (date ? 'month-day' : 'unknown');

    items.push({
      title,
      url: absoluteUrl(href, base),
      date,
      datePrecision,
    });
  }
  return items;
}

/** 解析本科生院的 li.right-list-item 列表。 */
function parseBksy(html, base) {
  const items = [];
  const itemRe = /<li[^>]*class=["'][^"']*\bright-list-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = itemRe.exec(html)) !== null) {
    const block = match[1];
    const href = /<a\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1];
    if (!href || /^javascript:/i.test(href)) continue;
    const titleHtml = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || '';
    const title = stripTags(titleHtml).trim();
    if (!title) continue;
    const date = /class=["'][^"']*\by\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1];
    items.push({
      title,
      url: absoluteUrl(href, base),
      date: date ? stripTags(date).trim() : '',
    });
  }
  return items;
}

/** 兜底解析：抓所有 article/page 链接与附近日期。 */
function parseFallback(html, base) {
  const items = [];
  const re = /<a\b[^>]*href=["']([^"']*\/(?:page|art)\.(?:htm|psp)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const title = stripTags(match[2]).trim();
    if (!title || title.length < 4) continue;
    const around = html.slice(Math.max(0, match.index - 300), match.index + 600);
    const date = /(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/.exec(around);
    items.push({
      title,
      url: absoluteUrl(match[1], base),
      date: date ? `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}` : '',
    });
  }
  return items;
}

/**
 * 抓取一个来源的列表。
 * @param {keyof typeof SOURCES} sourceId
 * @param {{ timeoutMs?: number, limit?: number }} [options]
 */
export async function fetchNotices(sourceId, options = {}) {
  const source = SOURCES[sourceId];
  if (!source) throw new Error(`未知通知来源：${sourceId}`);
  const jar = new CookieJar();
  const res = await request(jar, source.url, {}, { follow: true, timeoutMs: options.timeoutMs ?? 20000 });
  if (!res.res.ok) throw new Error(`${source.name} 列表返回 HTTP ${res.res.status}`);
  const html = await res.text();

  let items;
  if (source.parser === 'bksy') items = parseBksy(html, res.url);
  else items = parseWebplus(html, res.url);
  if (items.length === 0) items = parseFallback(html, res.url);

  const limit = Number(options.limit) > 0 ? Number(options.limit) : 20;
  return {
    source: { id: source.id, name: source.name, url: source.url },
    items: items.sort((a, b) => {
      const da = /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : '';
      const db = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : '';
      return db.localeCompare(da);
    }).slice(0, limit),
  };
}

/**
 * 抓取一篇通知正文。
 * @param {string} url
 * @param {{ timeoutMs?: number }} [options]
 */
export async function fetchNoticeDetail(url, options = {}) {
  const jar = new CookieJar();
  const res = await request(jar, url, {}, { follow: true, timeoutMs: options.timeoutMs ?? 20000 });
  if (!res.res.ok) throw new Error(`通知正文返回 HTTP ${res.res.status}`);
  const html = await res.text();

  const title =
    stripTags(/<h3[^>]*class=["'][^"']*article-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i.exec(html)?.[1] || '') ||
    stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '') ||
    decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim();

  const bodyHtml = extractDivByClass(html, 'wp_articlecontent') || extractDivByClass(html, 'article-content') || '';
  const content = stripTags(bodyHtml).slice(0, 8000);

  const attachments = [];
  const attRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = attRe.exec(bodyHtml || html)) !== null) {
    const name = stripTags(match[2]).trim();
    if (/_upload\/|\.(pdf|docx?|xlsx?|pptx?|zip|rar)\b/i.test(match[1]) && name) {
      attachments.push({ name, url: absoluteUrl(match[1], res.url) });
    }
  }

  return {
    url: res.url,
    title,
    publishedAt: /(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/.exec(stripTags(html).slice(0, 2000))?.[0] || '',
    content,
    attachments: attachments.slice(0, 10),
  };
}
