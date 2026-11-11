/**
 * 真实账号端到端验证（在独立进程里跑，验证的是磁盘上的最新代码）。
 * 只打印统计与少量标题，不打印密码、Cookie、票据。
 */
import { ZjuSession } from '../src/session.js';
import { CmcClient } from '../src/cmc.js';
import { casLogin } from '../src/zjuam.js';
import { CoursesClient, COURSES } from '../src/courses.js';
import { resolveCredentials } from '../src/session.js';

const credentials = resolveCredentials({});
if (!credentials) {
  console.error('未找到凭据');
  process.exit(1);
}
console.log(`凭据来源：${credentials.source}，账号：${credentials.username.slice(0, 3)}***`);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ---- 学在浙大 ----
try {
  const { jar } = await casLogin({
    landingUrl: `${COURSES}/login`,
    username: credentials.username,
    password: credentials.password,
    timeoutMs: 25000,
  });
  const client = new CoursesClient(jar, { timeoutMs: 25000 });

  const todos = await client.todos();
  check('学在浙大登录 + 待办', Array.isArray(todos), `${todos.length} 条待办`);
  if (todos[0]) console.log(`   示例：${todos[0].title.slice(0, 30)} | 截止 ${todos[0].deadline} | ${todos[0].courseName}`);

  const courses = await client.courses({});
  check('课程列表', courses.length > 0, `${courses.length} 门课程`);
  if (courses[0]) console.log(`   示例：${courses[0].name}（${courses[0].code}）id=${courses[0].id}`);

  if (courses[0]) {
    const homework = await client.homework(courses[0].id, { includeSubmission: true });
    check('课程作业', homework.homeworks.length >= 0, `${homework.homeworks.length} 个作业`);
    const first = homework.homeworks[0];
    if (first) {
      console.log(`   示例：${first.title.slice(0, 30)} | 已提交=${first.submitted} | 得分=${first.score}`);
    }
  }
} catch (error) {
  check('学在浙大链路', false, error.message);
}

// ---- 智云课堂 ----
try {
  const cmc = await CmcClient.login({
    username: credentials.username,
    password: credentials.password,
    timeoutMs: 25000,
  });
  check('智云课堂登录', true, `user_id=${cmc.user.userId}${cmc.user.realname ? ` 姓名=${cmc.user.realname}` : ''}`);

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const schedule = await cmc.schedule(today, today);
  check('今日课表', Array.isArray(schedule.lessons), `${schedule.lessons.length} 节`);
  if (schedule.lessons[0]) {
    console.log(`   示例：${schedule.lessons[0].title} | ${schedule.lessons[0].statusLabel}`);
  }
} catch (error) {
  check('智云课堂链路', false, error.message);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
