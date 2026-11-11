/**
 * 通过插件注册路径验证 zju_lab_materials 工具：列课件 + 下载。
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

const definitions = new Map();
const ctx = {
  tools: { register: (definition) => { definitions.set(definition.name, definition); return () => {}; } },
  effect: (callback) => callback(),
  inject: () => {},
  logger: { info() {}, warn() {} },
};

apply(ctx, { allowIndependentHttp: true, requestTimeoutMs: 25000 });

const tool = definitions.get('zju_lab_materials');
if (!tool) {
  console.log('FAIL 未注册 zju_lab_materials');
  process.exit(1);
}
console.log('PASS 工具已注册，参数：', Object.keys(tool.parameters.properties).join(','));

const listed = await tool.execute({ action: 'list', lab: '示波器' }, {});
console.log('--- list 输出 ---');
console.log(listed.split('\n').slice(0, 12).join('\n'));
if (!/\.(pptx?|pdf|docx?)/i.test(listed)) {
  console.log('FAIL list 输出异常');
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), 'zju-lab-tool-'));
try {
  const downloaded = await tool.execute({ action: 'download', lab: '示波器', courseware: '原理及应用', save_dir: dir }, {});
  console.log('--- download 输出 ---');
  console.log(downloaded);
  const match = /保存路径：(.+)/.exec(downloaded);
  if (!match) {
    console.log('FAIL 未返回保存路径');
    process.exit(1);
  }
  const info = await stat(match[1].trim());
  console.log('PASS 文件已落盘，字节', info.size);
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
