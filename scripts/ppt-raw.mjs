/** 打印 search-ppt 接口的原始字段，确认 content 里除图片外还有没有文本。 */
import { ZjuSession } from '../src/session.js';
import { CMC_PPT } from '../src/cmc.js';
import { request } from '../src/http.js';

const subId = process.argv[2] || '1234507';
const courseId = process.argv[3] || '12302';

const session = new ZjuSession({});
const out = await session.withClient('cmc', async (client) => {
  const url = `${CMC_PPT}?course_id=${encodeURIComponent(courseId)}&sub_id=${encodeURIComponent(subId)}`;
  const res = await request(client.jar, url, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: 20000 });
  return await res.text();
});
const json = JSON.parse(out);
const list = json.list || json.result?.list || [];
console.log('items:', list.length);
console.log('item keys:', Object.keys(list[0] || {}));
let c = list[0]?.content;
try { c = JSON.parse(c); } catch {}
console.log('content keys:', Object.keys(c || {}));
console.log(JSON.stringify(c, null, 1).slice(0, 2000));
