/** 数字点名解析与判定的单元测试。 */
import assert from 'node:assert';
import { collectCandidates, decideCode, findCodes, keywordWeight } from '../src/rollcall-number.js';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('ok  ', name);
  } catch (error) {
    fail += 1;
    console.log('FAIL', name, '→', String(error?.message || error));
  }
}

check('findCodes 只认独立 4 位数字', () => {
  const hits = findCodes('签到码 3157 请尽快，我的手机号 12345678901，面积 1234.5');
  const codes = hits.map((hit) => hit.code);
  assert.deepStrictEqual(codes, ['3157']);
});

check('findCodes 保留重复命中', () => {
  const hits = findCodes('2024 年先说 2024，再重复 2024');
  assert.strictEqual(hits.length, 3);
});

check('keywordWeight 强词更重', () => {
  assert.strictEqual(keywordWeight('签到码 3157'), 3);
  assert.strictEqual(keywordWeight('输入数字'), 1);
  assert.strictEqual(keywordWeight('一段普通话'), 0);
});

check('白板 OCR 高于口播', () => {
  const candidates = collectCandidates([
    { source: 'transcript', text: '我们这一章先讲 1234 的定义' },
    { source: 'ocr', text: '随机过程 1234' },
  ]);
  assert.strictEqual(candidates[0].code, '1234');
  assert.deepStrictEqual(candidates.length, 1);
});

check('签到码关键词让数字胜出', () => {
  const decided = decideCode(
    collectCandidates([
      { source: 'transcript', text: '签到码 8642 请在五分钟内提交' },
      { source: 'transcript', text: '这一页讲 1234 号定理' },
      { source: 'transcript', text: '方差是 5000 左右' },
    ]),
  );
  assert.strictEqual(decided.code, '8642');
  assert.ok(decided.confidence > 0.5, `置信度应大于 0.5，实际 ${decided.confidence}`);
});

check('多个同分候选拒绝瞎猜', () => {
  const decided = decideCode(
    collectCandidates([
      { source: 'transcript', text: '签到码 1234' },
      { source: 'transcript', text: '签到码 5678' },
    ]),
  );
  assert.strictEqual(decided.code, null);
  assert.ok(decided.reason.includes('分不清'), decided.reason);
});

check('黑板上分开写的数字也能认', () => {
  const hits = findCodes('Sign code: 4 7 2 9');
  assert.deepStrictEqual(hits.map((hit) => hit.code), ['4729']);
});

check('带分隔符的写法归一化成一个码', () => {
  const hits = findCodes('签到码 4-7-2-9，请尽快');
  assert.deepStrictEqual(hits.map((hit) => hit.code), ['4729']);
});

check('长数字串不会被拆成 4 位码', () => {
  const hits = findCodes('手机号 13812345678 和 12345 都不算');
  assert.deepStrictEqual(hits, []);
});

check('没有任何数字时给出明确原因', () => {
  const decided = decideCode(collectCandidates([{ source: 'transcript', text: '今天讲随机变量' }]));
  assert.strictEqual(decided.code, null);
  assert.ok(decided.reason.includes('没有'), decided.reason);
});

check('服务端直接给的码优先', () => {
  const decided = decideCode(
    collectCandidates([
      { source: 'server', text: 'number_code 3157' },
      { source: 'transcript', text: '签到 1234' },
    ]),
  );
  assert.strictEqual(decided.code, '3157');
  assert.ok(decided.confidence > 0.9);
});

check('过期片段扣分', () => {
  const now = Date.now();
  const decided = decideCode(
    collectCandidates(
      [
        { source: 'transcript', at: now - 60 * 60 * 1000, text: '旧内容 1234' },
        { source: 'transcript', at: now - 60 * 1000, text: '新内容 5678 签到码' },
      ],
      { now },
    ),
  );
  assert.strictEqual(decided.code, '5678');
});

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
