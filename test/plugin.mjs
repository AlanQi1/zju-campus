/**
 * 用模拟的 cordis ctx 验证插件注册：工具数量、定义合法性、output schema。
 */
import { apply, name, inject } from '../index.js';

const registered = [];
const disposers = [];
const ctx = {
  tools: {
    register(definition) {
      // 复刻 ToolRegistry.register 的校验点
      if (!definition.name) throw new Error('tool 缺少 name');
      if (!definition.output || typeof definition.output.render !== 'function') {
        throw new Error(`tool "${definition.name}" 缺少 output.render`);
      }
      const schema = definition.output.schema;
      if (!schema || typeof schema !== 'object' || !schema.type) {
        throw new Error(`tool "${definition.name}" 的 output.schema 非法`);
      }
      if (definition.name === 'run_code') throw new Error('run_code 是保留名');
      if (registered.some((item) => item.name === definition.name)) {
        throw new Error(`重复注册：${definition.name}`);
      }
      registered.push(definition);
      return () => {
        const index = registered.indexOf(definition);
        if (index >= 0) registered.splice(index, 1);
      };
    },
  },
  effect(callback, label) {
    const dispose = callback();
    disposers.push({ dispose, label });
    return dispose;
  },
  // 没有 webServer 的 profile：apply 里的可选注入不应被调用
  inject() {},
  logger: { info() {}, warn() {} },
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check('插件名', name === 'zju-campus', name);
check('inject', Array.isArray(inject) && inject.includes('tools'), JSON.stringify(inject));

apply(ctx, { allowWriteOps: false, sessionTtlMinutes: 15 });

const names = registered.map((item) => item.name).sort();
check('工具数量', registered.length === 23, `${registered.length} 个`);
check(
  '工具名',
  [
    'zju_courses',
    'zju_homework',
    'zju_lab_materials',
    'zju_login',
    'zju_logout',
    'zju_materials',
    'zju_notes',
    'zju_notes_list',
    'zju_notice_detail',
    'zju_notices',
    'zju_obsidian',
    'zju_playback',
    'zju_retract_homework',
    'zju_rollcall',
    'zju_rollcall_answer',
    'zju_rollcall_location',
    'zju_save_note',
    'zju_schedule',
    'zju_status',
    'zju_submit_homework',
    'zju_todos',
    'zju_transcript',
  ].every((tool) => names.includes(tool)),
  names.join(', '),
);

for (const tool of registered) {
  const schema = tool.parameters;
  check(
    `schema/${tool.name}`,
    schema.type === 'object' && typeof schema.properties === 'object' && schema.additionalProperties === false,
    Object.keys(schema.properties).join(',') || '(无参数)',
  );
  check(`description/${tool.name}`, typeof tool.description === 'string' && tool.description.length > 20);
}

// 无凭据时的状态输出不应抛错
const status = registered.find((tool) => tool.name === 'zju_status');
const statusText = await status.execute({}, {});
check('zju_status 可用', statusText.includes('浙大校园助手状态'), statusText.split('\n')[0]);

// 未开启写操作时应拒绝
const submit = registered.find((tool) => tool.name === 'zju_submit_homework');
let refused = false;
try {
  await submit.execute({ activity_id: 1, file_path: 'x', confirm: true }, {});
} catch (error) {
  refused = /写操作未开启/.test(error.message);
}
check('写操作默认关闭', refused);

// 卸载应清空注册
for (const item of disposers) item.dispose();
check('dispose 清空注册', registered.length === 0, `${registered.length} 个残留`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
