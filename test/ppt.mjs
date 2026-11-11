/**
 * 课件接口解析（parseSlides）与时间轴工具的单元测试，不联网。
 */
import { parseSlides } from '../src/cmc.js';
import { replaceSlidePlaceholders } from '../index.js';
import {
  bucketSegments,
  formatNoteSaved,
  formatNotesMaterials,
  formatNotesList,
  formatObsidianStatus,
} from '../src/format.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// 1. parseSlides：content 是 JSON 字符串、乱序、缺图片、重点页
const json = {
  list: [
    { created_sec: 300, content: JSON.stringify({ pptimgurl: 'http://video.cmc.zju.edu.cn/b.jpg', is_key: true, detecttype: 'ppt' }) },
    { created_sec: 10, content: '{"pptimgurl":"http://video.cmc.zju.edu.cn/a.jpg","is_key":false}' },
    { created_sec: 20, content: '{}' },
    { created_sec: 30, content: { pptimgurl: 'http://video.cmc.zju.edu.cn/c.png' } },
  ],
};
const slides = parseSlides(json);
check('课件数量（跳过无图）', slides.length === 3, String(slides.length));
check('按时间排序', slides.map((s) => s.at).join(',') === '10,30,300', slides.map((s) => s.at).join(','));
check('重新编号', slides.map((s) => s.index).join(',') === '1,2,3');
check('重点页标记', slides[2].key === true && slides[0].key === false);
check('兼容 result.list', parseSlides({ result: { list: json.list } }).length === 3);
check('空输入', parseSlides(null).length === 0 && parseSlides({ list: 'x' }).length === 0);

// 2. 转录分桶
const segments = [
  { begin: 0, text: '第一段' },
  { begin: 120, text: '第二段' },
  { begin: 301, text: '第三段' },
  { begin: 640, text: '第四段' },
];
const buckets = bucketSegments(segments, 5, slides);
check('5 分钟分桶', buckets.length === 3, String(buckets.length));
check('分桶起点', buckets.map((b) => b.start).join(',') === '0,300,600', buckets.map((b) => b.start).join(','));
check('分桶文本合并', buckets[0].text === '第一段 第二段');

// 3. 材料格式
const materials = formatNotesMaterials({
  subId: '1234501',
  lesson: { title: '示例课程A', teacher: '张老师', date: '2026-10-23', time: '07:56-09:35', statusLabel: '回放' },
  segments,
  slides,
  slideDir: 'D:/tmp/_附件/1234501',
});
check('材料含标题', materials.includes('课堂材料（节次 1234501）'));
check('材料含本段课件页', materials.includes('本段课件页（共 3 页'));
check('材料含课件图路径', materials.includes('ppt-001.jpg') && materials.includes('课件图目录'));
check('材料含转录分桶', materials.includes('[00:00 - 05:00]'));
check('材料含占位符说明', materials.includes('{{slide:12}}'));
check('材料含下一步', materials.includes('zju_save_note'));
check('分桶绑定课件页', buckets.some((b) => b.slides && b.slides.length > 0));

// 4. 笔记列表
const listText = formatNotesList([
  { subId: '1234501', date: '2026-10-23', title: '示例课程A', course: '示例课程A', exists: true, path: 'D:/x.md' },
]);
check('列表含课程', listText.includes('示例课程A') && listText.includes('1234501'));

// 5. Obsidian 状态
const status = formatObsidianStatus({
  effective: { enabled: true, vault: 'D:/Obsidian/Vault', folder: '智云课堂', source: 'panel' },
  vaults: [{ path: 'D:/Obsidian/Vault', open: true }],
  notes: { count: 3, dir: 'D:/notes' },
});
check('状态含库路径', status.includes('D:/Obsidian/Vault') && status.includes('智云课堂'));
check('状态含笔记数', status.includes('3 篇'));

// 6. formatNoteSaved：占位符没替换要单独回报
const savedBase = { result: { record: { subId: '1234507' }, path: 'D:/x.md', mirrored: null } };
const savedOk = formatNoteSaved({ ...savedBase, slideCount: 34, inlineSlides: 29, missingSlides: 0, obsidian: { enabled: false } });
check('保存结果含混排数', savedOk.includes('29 张'));
check('保存结果无缺失行', !savedOk.includes('未替换的占位符'));
const savedMissing = formatNoteSaved({ ...savedBase, slideCount: 0, inlineSlides: 0, missingSlides: 29, obsidian: { enabled: false } });
check('保存结果报缺失', savedMissing.includes('未替换的占位符：29 个'));

// 7. replaceSlidePlaceholders：说明里带 LaTeX 花括号也要能替换
const fakeSlides = [
  { index: 24, file: '_附件/1234506/ppt-024.jpg' },
  { index: 71, file: '_附件/1234506/ppt-071.jpg' },
];
const braceMd = '{{slide:24|f_Y(y)=∫_{|y|}^1 dx = 1-|y|}}\n\n{{slide:71|2e^{-2x} 与 3e^{-3y}}}\n\n{{slide:99|不存在}}';
const braceOut = replaceSlidePlaceholders(braceMd, fakeSlides, '1234506');
check('花括号说明被替换', braceOut.body.includes('![f_Y(y)=∫_{|y|}^1 dx = 1-|y|](_附件/1234506/ppt-024.jpg)'), braceOut.body.split('\n')[0]);
check('上标说明被替换', braceOut.body.includes('2e^{-2x} 与 3e^{-3y}'), '');
check('替换计数正确', braceOut.used === 2, String(braceOut.used));
check('缺失页计数正确', braceOut.missing === 1, String(braceOut.missing));
check('缺失页保留占位符', braceOut.body.includes('{{slide:99|不存在}}'), '');
const noCaption = replaceSlidePlaceholders('{{slide:24}}', fakeSlides, '1234506');
check('无说明用默认 alt', noCaption.body === '![第 24 页](_附件/1234506/ppt-024.jpg)', noCaption.body);
const bracketCaption = replaceSlidePlaceholders('{{slide:24|数组 a[0] 与 a[1]}}', fakeSlides, '1234506');
check('alt 里的方括号被清掉', !bracketCaption.body.includes('a[0]'), bracketCaption.body);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
