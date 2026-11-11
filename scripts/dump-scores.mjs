/**
 * 拉取某课程所有作业的「我的提交」原始 JSON，用于核对真实得分字段。
 * 用法：node scripts/dump-scores.mjs <course_id> [--out 文件]
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCredentials } from '../src/session.js';
import { casLogin } from '../src/zjuam.js';
import { CoursesClient, COURSES } from '../src/courses.js';

const args = process.argv.slice(2);
const courseId = args.find((a) => /^\d+$/.test(a));
if (!courseId) {
  console.error('用法：node scripts/dump-scores.mjs <course_id> [--out 文件]');
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
const userId = await client.userId(courseId);
console.error(`userId=${userId}`);

const activities = await client.paged(`/api/courses/${courseId}/homework-activities`, 'homework_activities', {
  pageSize: 50,
  max: 500,
});

const out = [];
for (const activity of activities) {
  const row = {
    activityId: activity.id,
    title: activity.title,
    submitted: Boolean(activity.submitted),
    scorePercentage: activity.score_percentage ?? null,
    endTime: activity.end_time ?? null,
  };
  try {
    const list = await client.json(`/api/activities/${activity.id}/students/${userId}/submission_list`);
    const sub = list.json?.list?.[0] || null;
    if (sub) {
      row.score = sub.score ?? null;
      row.finalScore = sub.final_score ?? null;
      row.scoreAt = sub.score_at ?? null;
      row.comment = sub.instructor_comment ?? '';
      row.submittedAt = sub.submitted_at ?? null;
      row.detail = JSON.parse(
        JSON.stringify(sub, (k, v) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v)),
      );
    }
  } catch (error) {
    row.error = String(error?.message || error);
  }
  out.push(row);
}

const text = JSON.stringify({ courseId, userId, activities: out }, null, 2);
const outIdx = args.indexOf('--out');
if (outIdx >= 0 && args[outIdx + 1]) {
  const file = resolve(args[outIdx + 1]);
  writeFileSync(file, text, 'utf8');
  console.error(`已写入 ${file}（${text.length} 字符）`);
} else {
  console.log(text);
}
