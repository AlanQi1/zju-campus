/**
 * 探查大物实验「课件」接口：列出某次实验的课件，并试下载一个，只打印数量/文件名/字节数。
 */
import { PhysicsLabClient } from '../src/physics-lab.js';

const client = await PhysicsLabClient.login({ allowInsecureHttp: true, timeoutMs: 25000 });
try {
  const data = await client.schedule();
  console.log('课程数', data.courses.length, '实验数', data.lessons.length);

  let total = 0;
  for (const course of data.courses) {
    for (const lesson of course.lessons) {
      if (lesson.id === null || lesson.id === undefined) continue;
      let list = [];
      try {
        list = await client.materials(lesson.id);
      } catch (error) {
        console.log(`实验 ${lesson.id} 列课件失败：`, error.code || error.message);
        continue;
      }
      total += list.length;
      if (list.length > 0) {
        console.log(`实验「${lesson.lab_name || lesson.id}」(id=${lesson.id}) 课件 ${list.length} 个：`);
        for (const item of list.slice(0, 5)) console.log(`   - ${item.name} [${item.ext}] id=${item.id} 下载次数=${item.downloadTimes}`);
      }
    }
  }
  console.log('课件总数', total);

  // 找一个可下载的试下
  outer: for (const course of data.courses) {
    for (const lesson of course.lessons) {
      if (lesson.id === null || lesson.id === undefined) continue;
      const list = await client.materials(lesson.id);
      if (list.length === 0) continue;
      const first = list[0];
      const file = await client.downloadMaterial(first.id, first.name);
      console.log('下载测试：', first.name, '字节', file.buffer.length, 'content-type', file.contentType);
      break outer;
    }
  }
} finally {
  client.close();
}
