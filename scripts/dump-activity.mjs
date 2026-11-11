/**
 * 拉取某个 activity 的完整 JSON（作业题干、附件、截止时间）。
 * 用法：node scripts/dump-activity.mjs <activity_id> [--out 文件]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCredentials } from '../src/session.js';
import { casLogin } from '../src/zjuam.js';
import { CoursesClient, COURSES } from '../src/courses.js';

const args = process.argv.slice(2);
const activityId = args.find((a) => /^\d+$/.test(a));
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : null;
if (!activityId) {
  console.error('用法：node scripts/dump-activity.mjs <activity_id> [--out 文件]');
  process.exit(1);
}

const cred = resolveCredentials({});
if (!cred) {
  console.error('没有可用账号');
  process.exit(1);
}

const { jar } = await casLogin({
  landingUrl: `${COURSES}/login`,
  username: cred.username,
  password: cred.password,
  timeoutMs: 30000,
});

const client = new CoursesClient(jar, { timeoutMs: 30000 });
const detail = await client.json(`/api/activities/${activityId}`);
const text = JSON.stringify({ status: detail.status, activityId, json: detail.json }, null, 2);
if (outFile) {
  writeFileSync(outFile, text, 'utf8');
  console.log(`已写入 ${outFile}（${text.length} 字符）`);
} else {
  console.log(text);
}
