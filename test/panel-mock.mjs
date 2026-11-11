/**
 * 不联网验证 buildSummary 的字段映射：用假 session 提供三个来源的数据。
 * 重点覆盖「近 7 天」：一次拉 7 天课表、按天分组、今天仍单独给一份 lessons。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSummary } from '../src/panel.js';
import { NotesStore } from '../src/notes.js';

const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const shift = (date, delta) => {
  const d = new Date(Date.parse(`${date}T00:00:00+08:00`) + delta * 86400000 + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
const weekStart = shift(today, -6);
const calls = [];

const fakeSession = {
  credentials: () => ({ username: '3200100001', password: 'x', source: 'test' }),
  withClient: async (kind, run) => {
    if (kind === 'courses') {
      return run({
        todos: async () => [
          { id: 2, title: '晚交的作业', type: '作业', courseName: 'B', deadline: '2026-10-30' },
          { id: 1, title: '早交的作业', type: '作业', courseName: 'A', deadline: '2026-10-27' },
        ],
      });
    }
    if (kind === 'cmc') {
      return run({
        schedule: async (start, end) => {
          calls.push({ start, end });
          return {
            start,
            end,
            lessons: [
              {
                subId: 9,
                title: '示例课程A',
                teacher: '张老师',
                room: '东1-101',
                date: today,
                startAt: '13:50',
                endAt: '15:25',
                statusLabel: '回放',
                hasTranscript: true,
              },
              {
                subId: 10,
                title: '体育',
                teacher: '',
                room: '操场',
                date: today,
                startAt: '08:00',
                endAt: '09:35',
                statusLabel: '回放',
                hasTranscript: false,
              },
              {
                subId: 8,
                title: '示例课程B',
                teacher: '鲁老师',
                room: '西2-204',
                date: shift(today, -2),
                startAt: '07:56',
                endAt: '09:35',
                statusLabel: '回放',
                hasTranscript: true,
              },
            ],
          };
        },
      });
    }
    throw new Error(`unexpected ${kind}`);
  },
};

const settings = {
  noticeSources: [],
  requestTimeoutMs: 2000,
};

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const notesRoot = mkdtempSync(join(tmpdir(), 'zju-panel-notes-'));
const notes = new NotesStore({ dir: join(notesRoot, 'notes') });
notes.write({ subId: '9', markdown: '## 要点\n- 测试', meta: { title: '示例课程A', course: '示例课程A', date: today } });

const summary = await buildSummary(fakeSession, settings, { notes });
check('账号脱敏', summary.account === '320***01', summary.account);
check('待办按截止排序', summary.todos[0]?.id === 1, summary.todos.map((t) => t.id).join(','));
check('课表按开始时间排序', summary.lessons[0]?.time === '08:00-09:35', summary.lessons.map((item) => item.time).join(','));
check('课表标记回放', summary.lessons.find((item) => item.subId === 9)?.hasTranscript === true);
check('通知节存在', Array.isArray(summary.notices));

// 近 7 天
check('一次请求 7 天区间', calls.length === 1 && calls[0].start === weekStart && calls[0].end === today, JSON.stringify(calls[0]));
check('week 有 7 天', summary.week?.days?.length === 7, String(summary.week?.days?.length));
check('week 覆盖今天', summary.week?.days?.[6]?.date === today && summary.week?.days?.[6]?.isToday === true);
check('今天有 2 节课', summary.week?.days?.[6]?.lessons?.length === 2, String(summary.week?.days?.[6]?.lessons?.length));
check('两天前有 1 节课', summary.week?.days?.[4]?.lessons?.length === 1, String(summary.week?.days?.[4]?.lessons?.length));
check('空的日子也保留', summary.week?.days?.[0]?.count === 0);
check('lesson 带 date', summary.week?.days?.[4]?.lessons?.[0]?.date === shift(today, -2));
check('lessons 仍是今天的课', summary.lessons.length === 2 && summary.lessons.every((item) => item.date === today));
check('notes 摘要', summary.notes?.count === 1 && summary.notes.subIds.includes('9'), JSON.stringify(summary.notes));

rmSync(notesRoot, { recursive: true, force: true });

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
