import { PhysicsLabClient } from './physics-lab.js';
import { createEngineeringClient } from './engineering.js';
import { shanghaiDateTime } from './courses.js';

export const independentFactories = {
  async physicsLab(options) {
    const client = await PhysicsLabClient.login(options);
    return {
      async read() {
        const data = await client.schedule();
        return { structureKnown: true, warnings: data.warnings || [], records: data.lessons.map(lesson => ({
          title: String(lesson.title || '实验课程'),
          date: typeof lesson.date === 'string' ? lesson.date : '',
          time: typeof lesson.time === 'string' || typeof lesson.time === 'number' ? String(lesson.time) : '',
          teacher: typeof lesson.teacher === 'string' ? lesson.teacher : '',
          room: typeof lesson.room === 'string' ? lesson.room : '',
          url: lesson.url,
        })).sort((a,b) => a.date.localeCompare(b.date)) };
      },
      close() { client.close(); },
    };
  },
  async engineering(options) {
    const client = createEngineeringClient(options);
    return {
      async read() {
        const data = await client.getAssignments();
        return { structureKnown: data.structureKnown, warnings: data.warnings || [], records: (data.assignments || []).map(item => ({
          title: item.title,
          deadlineAt: /^\d{4}-\d{2}-\d{2}$/.test(item.deadlineAt || '') ? item.deadlineAt : shanghaiDateTime(item.deadlineAt),
          url: item.entryUrl || item.url, status: item.status, course: item.course,
          kind: item.kind === 'preStudy' ? '课前预习' : '作业习题',
        })) };
      },
      close() { client.close(); },
    };
  },
};
