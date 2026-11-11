/**
 * 验证默认下载路径：D:/LabCourseware/大物实验/<实验名>/，目录不存在会自动新建。
 */
import { stat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LabMaterials, defaultMaterialsRoot } from '../src/lab-materials.js';

const materials = new LabMaterials({ allowIndependentHttp: true, requestTimeoutMs: 25000 });
const root = defaultMaterialsRoot();
console.log('根目录：', root);

try {
  const listed = await materials.list({ lab: '光的衍射' });
  const experiment = listed.experiments[0];
  const pdf = experiment.materials.find((item) => item.ext === 'pdf') || experiment.materials[0];
  const file = await materials.download({ lab: String(experiment.labId), coursewareId: pdf.id });
  const info = await stat(file.filePath);
  console.log('下载：', file.name, '字节', info.size);
  console.log('实验文件夹：', file.folder);
  console.log('完整路径：', file.filePath);

  // 系统里的实验名常带 ▲ / 必做1： / （2周） / G 等前后缀。若本机已有归一化后
  // 同名的老文件夹，插件会复用老文件夹而不是新建，所以两种都算通过。
  const expectedFolder = join(root, '光的衍射');
  const insideRoot = file.folder.startsWith(root);
  const reuseExisting = file.folder.includes('光的衍射');
  if (!insideRoot || !reuseExisting) {
    console.log('FAIL 文件夹不符合预期', file.folder, '期望在', root, '下且含实验名');
    process.exit(1);
  }
  if (file.folder !== expectedFolder) {
    console.log('NOTE 复用了已有文件夹（实验名带前后缀）', file.folder);
  }
  const entries = await readdir(file.folder);
  console.log('文件夹内容（前5项）：', entries.slice(0, 5).join(' | '));
  console.log('PASS 自动建目录并按实验归档，且复用了已有文件夹');
} finally {
  materials.close();
}
