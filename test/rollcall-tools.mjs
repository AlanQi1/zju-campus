/**
 * 虚拟位置工具的端到端（本地）测试：不联网，只验证工具注册与点位库读写。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

const dir = mkdtempSync(join(tmpdir(), 'zju-rollcall-tools-'));
const file = join(dir, 'locations.json');

const registered = [];
const ctx = {
  tools: {
    register(definition) {
      registered.push(definition);
      return () => {};
    },
  },
  effect(callback) {
    return callback();
  },
  inject() {},
  logger: { info() {}, warn() {} },
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  apply(ctx, {
    allowWriteOps: false,
    allowRollcallSign: false,
    rollcallLocationsFile: file,
    rollcallSwitchFile: join(dir, 'switch.json'),
  });

  const tool = (name) => registered.find((item) => item.name === name);
  check('注册虚拟位置工具', Boolean(tool('zju_rollcall_location')));
  check('注册代签工具', Boolean(tool('zju_rollcall_answer')));

  const locations = tool('zju_rollcall_location');

  const listed = await locations.execute({ action: 'list' }, {});
  check(
    'list 含预设点',
    listed.includes('东一教学楼') && listed.includes('12 个预设') && listed.includes('预设点位（12）'),
    listed.split('\n')[0],
  );
  check('list 自定义为空', listed.includes('自定义点位（0）'));

  const added = await locations.execute(
    { action: 'add', name: '测试楼', lon: 120.1, lat: 30.3, campus: '紫金港', aliases: '测试,test', set_default: true },
    {},
  );
  check('add 成功', added.includes('已添加虚拟位置') && added.includes('测试楼'));
  check('add 设为默认', added.includes('★'));

  const resolved = await locations.execute({ action: 'resolve', query: 'test' }, {});
  check('resolve 别名', resolved.includes('测试楼') && resolved.includes('别名匹配'));

  const updated = await locations.execute({ action: 'update', id: resolved.match(/id=(loc-[0-9a-f]+)/)?.[1], name: '测试楼2' }, {});
  check('update 成功', updated.includes('测试楼2'));

  const defaulted = await locations.execute({ action: 'default', name: '西教学楼' }, {});
  check('default 预设点', defaulted.includes('默认虚拟位置已设为：西教学楼'));

  const exported = await locations.execute({ action: 'export' }, {});
  check('export JSON', JSON.parse(exported).locations.length === 1);

  const imported = await locations.execute({ action: 'import', text: '导入楼,120.11,30.31,紫金港' }, {});
  check('import 行文本', imported.includes('已导入 1 个点位') && imported.includes('导入楼'));

  const removed = await locations.execute({ action: 'remove', name: '测试楼2' }, {});
  check('remove 成功', removed.includes('已删除虚拟位置'));

  const status = await tool('zju_status').execute({}, {});
  check('status 显示虚拟位置代签开关', status.includes('虚拟位置代签（雷达点名）：已关闭'));

  let refused = false;
  try {
    await tool('zju_rollcall_answer').execute({ rollcall_id: 1, confirm: true }, {});
  } catch (error) {
    refused = /虚拟位置代签未开启/.test(error.message);
  }
  check('未开启时代签被拒绝', refused);

  let confirmRequired = false;
  // 开启开关后，confirm 检查应在任何网络请求之前生效。
  apply(ctx, { allowRollcallSign: true, rollcallLocationsFile: file, rollcallSwitchFile: join(dir, 'switch.json') });
  const answer = registered.filter((item) => item.name === 'zju_rollcall_answer').pop();
  try {
    await answer.execute({ rollcall_id: 1 }, {});
  } catch (error) {
    confirmRequired = /confirm: true/.test(error.message);
  }
  check('缺少 confirm 被拒绝', confirmRequired);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
