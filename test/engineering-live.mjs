/**
 * 真实联调：工程训练只保留课前预习/作业习题，确认截止时间与答题入口。
 */
import { createEngineeringClient } from '../src/engineering.js';

const client = createEngineeringClient({ allowInsecureHttp: true, timeoutMs: 25000 });
try {
  if (!client.configured()) {
    console.log('未配置独立账号');
    process.exit(1);
  }
  const data = await client.getAssignments();
  console.log('认证：', data.authenticated, '| 结构已知：', data.structureKnown);
  console.log('任务数：', data.assignments.length);
  for (const item of data.assignments) {
    console.log(`- [${item.kind}] ${item.title}`);
    console.log(`    截止：${item.deadlineAt || '未标注'} | 状态：${item.status || '未知'}`);
    console.log(`    入口：${item.entryUrl ? '有（列表页）' : '无'} | testId=${item.testId || '无'}`);
  }
  console.log('统计：', JSON.stringify(data.diagnostics?.countsByKind));
  if (data.warnings?.length) console.log('警告：', data.warnings.join(' | '));
  console.log('PASS');
} finally {
  client.close();
}
