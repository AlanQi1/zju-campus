import assert from 'node:assert/strict';
import { CoursesClient, shanghaiDateTime, activityUrl } from '../src/courses.js';
import { CookieJar } from '../src/http.js';
import { SOURCES } from '../src/notices.js';
import { formatTodos, formatHomework } from '../src/format.js';
import { independentSitesStatus } from '../src/independent-accounts.js';

assert.equal(shanghaiDateTime('2026-10-27T03:35:00Z'), '2026-10-27 11:35');
assert.equal(shanghaiDateTime('2026-10-27T16:05:00Z'), '2026-10-28 00:05');
assert.equal(shanghaiDateTime('invalid'), null);
assert.equal(shanghaiDateTime(null), null);
assert.equal(activityUrl(12301, 910001), 'https://courses.zju.edu.cn/course/12301/learning-activity#/910001');
assert.equal(activityUrl('../bad', 1), null);
assert.deepEqual(Object.keys(SOURCES).sort(), ['bksy','opt','qsxy','sis']);
const client = new CoursesClient(new CookieJar());
client.json = async () => ({ status: 200, json: { todo_list: [
  { id: 910001, course_id: 12301, title: 'HW10', type: 'homework', end_time: '2026-10-27T03:35:00Z' },
  { id: 2, title: 'No deadline', type: 'homework' },
] } });
const todos = await client.todos();
assert.equal(todos[0].deadlineAt, '2026-10-27 11:35');
assert.equal(todos[0].submissionUrl, activityUrl(12301,910001));
assert.equal(todos[1].deadlineAt, null);
assert.equal(todos[1].submissionUrl, null);
assert.match(formatTodos(todos), /2026-10-27 11:35/);
assert.match(formatTodos(todos), /learning-activity#\/910001/);
client.paged = async () => [{ id: 1, title: 'Homework', type: 'homework', end_time: '2026-10-27T03:35:00Z' }];
const homework = await client.homework(12301, { includeSubmission: false });
assert.equal(homework.homeworks[0].deadlineAt, '2026-10-27 11:35');
assert.match(formatHomework(homework), /2026-10-27 11:35/);
const statuses = independentSitesStatus('nonexistent-independent-test.env');
assert.equal(statuses.length, 2);
assert(statuses.every(s => !s.configured));
assert(statuses.every(s => !('password' in s) && !('username' in s)));
console.log('PASS minute deadlines, date rollover, verified activity URLs, four notice sources, independent accounts isolation');
