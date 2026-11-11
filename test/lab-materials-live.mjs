/**
 * 真实联调：列出某次实验的课件并下载一个，校验文件落盘。
 */
import { readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LabMaterials } from '../src/lab-materials.js';

const materials = new LabMaterials({ allowIndependentHttp: true, requestTimeoutMs: 25000 });
const dir = join(tmpdir(), `zju-lab-materials-${Date.now()}`);

try {
  const listed = await materials.list({ lab: '光的衍射' });
  console.log('匹配实验数：', listed.experiments.length);
  for (const experiment of listed.experiments) {
    console.log(`【${experiment.title}】labId=${experiment.labId} 课件 ${experiment.materials.length} 个`);
    for (const item of experiment.materials) console.log('   -', item.name, 'id=', item.id, 'ext=', item.ext);
  }

  const target = listed.experiments[0];
  if (!target || target.materials.length === 0) {
    console.log('没有课件可下载');
    process.exit(1);
  }

  const pdf = target.materials.find((item) => item.ext === 'pdf') || target.materials[0];
  const file = await materials.download({ lab: String(target.labId), coursewareId: pdf.id, saveDir: dir });
  const info = await stat(file.filePath);
  const head = await readFile(file.filePath, { encoding: null });
  const isPdf = head.subarray(0, 4).toString() === '%PDF';
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // pptx/docx 是 zip
  console.log('下载：', file.name, '字节', info.size, 'PDF头=', isPdf, 'ZIP头=', isZip);
  console.log('保存路径：', file.filePath);

  if (info.size !== file.bytes || (!isPdf && !isZip)) {
    console.log('FAIL 文件校验不通过');
    process.exit(1);
  }
  console.log('PASS 课件可列出、可下载、文件头正确');
} finally {
  materials.close();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
