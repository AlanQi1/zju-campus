/**
 * 验证侧边栏数据接口：真实账号拉一次快照，检查三个节都有内容。
 */
import { ZjuSession } from '../src/session.js';
import { buildSummary } from '../src/panel.js';

const settings = {
  username: '',
  password: '',
  envFile: '',
  tenantId: '112',
  sessionTtlMs: 15 * 60 * 1000,
  requestTimeoutMs: 25000,
  allowWriteOps: false,
  noticeSources: ['qsxy', 'bksy', 'sis', 'opt'],
};

const session = new ZjuSession(settings);
const started = Date.now();
const summary = await buildSummary(session, settings);

console.log('耗时', ((Date.now() - started) / 1000).toFixed(1) + 's');
console.log('已配置:', summary.configured, '| 账号:', summary.account);
console.log('待办:', summary.todos.length, summary.todos[0] ? `| ${summary.todos[0].title.slice(0, 24)} ${summary.todos[0].deadline}` : '');
console.log('课表:', summary.lessons.length, summary.lessons[0] ? `| ${summary.lessons[0].title} ${summary.lessons[0].time}` : '');
console.log('通知:', summary.notices.length, summary.notices[0] ? `| [${summary.notices[0].source}] ${summary.notices[0].title.slice(0, 24)}` : '');
if (summary.errors.length) console.log('错误:', summary.errors);

const ok = summary.configured && summary.todos.length > 0 && summary.notices.length > 0;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
