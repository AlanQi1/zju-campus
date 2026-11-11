/**
 * 探查学在浙大接口字段：截止时间格式、作业详情里有没有可用的提交页地址。
 */
import { ZjuSession } from '../src/session.js';
import { COURSES } from '../src/courses.js';

const settings = {
  username: '', password: '', envFile: '', tenantId: '112',
  sessionTtlMs: 15 * 60 * 1000, requestTimeoutMs: 25000,
  allowWriteOps: false, noticeSources: ['qsxy'],
};

const session = new ZjuSession(settings);
const client = await session.coursesClient();

const todos = await client.todos();
console.log('待办第一条：', JSON.stringify(todos[0], null, 2));

const first = todos[0];
const detail = await client.json(`/api/activities/${first.id}`);
console.log('\n作业详情顶层字段：', Object.keys(detail.json || {}).join(', '));
const j = detail.json || {};
for (const key of ['id', 'course_id', 'title', 'type', 'end_time', 'start_time', 'is_closed', 'data', 'url', 'link']) {
  if (j[key] !== undefined) {
    const v = j[key];
    console.log(`  ${key}:`, typeof v === 'object' ? JSON.stringify(v).slice(0, 220) : String(v).slice(0, 160));
  }
}

const courses = await client.courses({});
const course = courses.find((c) => c.id === j.course_id);
console.log('\n课程：', course ? `${course.name} id=${course.id}` : '(未找到)');
console.log('推测提交页：', `${COURSES}/course/${j.course_id}/learning-activity#/activity/${j.id}`);
