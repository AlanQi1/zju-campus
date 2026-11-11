import { casLogin } from '../src/zjuam.js';
import { CoursesClient, COURSES } from '../src/courses.js';
import { resolveCredentials } from '../src/session.js';
const c = resolveCredentials({});
try {
  const { jar, finalUrl } = await casLogin({ landingUrl: `${COURSES}/login`, username: c.username, password: c.password, timeoutMs: 25000 });
  console.log('CAS 成功，finalUrl 主机：', new URL(finalUrl).host);
  const client = new CoursesClient(jar, { timeoutMs: 25000 });
  const todos = await client.todos();
  console.log('PASS 待办', todos.length, '条');
} catch (e) {
  console.log('FAIL', e.message);
}
