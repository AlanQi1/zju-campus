import { ZjuSession } from '../src/session.js';
const session = new ZjuSession({});
const today = (() => { const d = new Date(Date.now()+8*3600*1000); const p=n=>String(n).padStart(2,'0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}`; })();
const start = process.argv[2] || '2026-10-16';
const data = await session.withClient('cmc', (c) => c.schedule(start, today));
console.log('range', start, today, 'lessons', (data.lessons||[]).length);
for (const l of (data.lessons||[])) console.log(l.subId, l.courseId, l.date, l.title);
