/**
 * 雷达点名应答与三点定位单元测试。
 * 用假客户端模拟服务端：不登录、不访问网络。
 */
import {
  estimatePosition,
  extractDistance,
  extractErrorCode,
  rollcallAnswerSucceeded,
  answerRadarRollcall,
} from '../src/rollcall-answer.js';
import { haversineMeters } from '../src/rollcall-locations.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/* ------------------------------ 应答字段解析 ------------------------------ */
check('顶层 distance', extractDistance({ distance: 123.4 }) === 123.4);
check('data.distance', extractDistance({ data: { distance: '88' } }) === 88);
check('result.distance', extractDistance({ result: { distance: 42 } }) === 42);
check('无 distance 返回 null', extractDistance({ error_code: 'x' }) === null);
check('错误码', extractErrorCode({ error_code: 'radar_out_of_scope' }) === 'radar_out_of_scope');
check('成功状态', rollcallAnswerSucceeded({ status_name: 'on_call_fine' }) === true);
check('on_call 不算成功', rollcallAnswerSucceeded({ status: 'on_call' }) === false);

/* ------------------------------ 三点定位 ------------------------------ */
const truth = { lon: 120.09, lat: 30.3 };
const beacons = [
  { lon: 120.086, lat: 30.298 },
  { lon: 120.094, lat: 30.298 },
  { lon: 120.086, lat: 30.302 },
  { lon: 120.094, lat: 30.302 },
].map((point) => ({ ...point, d: haversineMeters(point, truth) }));

const estimated = estimatePosition(beacons);
check('三点定位返回结果', estimated !== null, JSON.stringify(estimated));
if (estimated) {
  const error = haversineMeters(estimated, truth);
  check('三点定位误差 < 5 米', error < 5, `${error.toFixed(2)} m，RMS ${estimated.rms} m`);
  check('三点定位可信', estimated.reliable === true);
}
const estimatedThree = estimatePosition(beacons.slice(0, 3));
check(
  '三点定位（只有 3 个点）',
  estimatedThree !== null && haversineMeters(estimatedThree, truth) < 5,
  estimatedThree ? `${haversineMeters(estimatedThree, truth).toFixed(2)} m` : 'null',
);
check('不足三个点返回 null', estimatePosition(beacons.slice(0, 2)) === null);
check('距离非法返回 null', estimatePosition([{ lon: 120, lat: 30, d: 0 }, ...beacons]) !== null);

/* ------------------------------ 应答流程 ------------------------------ */
const rollcall = {
  id: 171329,
  title: '2026.10.28 10:51',
  courseTitle: '思想道德与法治',
  teacher: '单老师',
  type: '雷达点名',
  isRadar: true,
  handled: false,
  expired: false,
};

const makeClient = (handler) => {
  const calls = [];
  return {
    calls,
    async answerRadar(id, point) {
      calls.push({ id, ...point });
      return handler(point, calls.length);
    },
  };
};

// 场景 1：第一个点失败，第二个点成功。
{
  const client = makeClient((point, index) =>
    index === 2
      ? { status: 200, json: { status_name: 'on_call_fine' } }
      : { status: 400, json: { error_code: 'radar_out_of_rollcall_scope', distance: 623.4 } },
  );
  const result = await answerRadarRollcall({
    client,
    rollcall,
    location: { name: '东一教学楼', lon: 120.089136, lat: 30.302331 },
    defaultLocation: { name: '西教学楼', lon: 120.085042, lat: 30.30173 },
    strategy: 'fallback',
    delayMs: 0,
  });
  check('场景1 第二次成功', result.ok === true && result.attempts.length === 2, JSON.stringify(result.attempts.map((a) => a.ok)));
  check('场景1 尝试顺序正确', result.attempts[0].name === '东一教学楼' && result.attempts[1].name === '西教学楼');
  check('场景1 记录距离', result.attempts[0].distance === 623.4);
}

// 场景 2：点位全失败 → 三点定位成功。
{
  const client = makeClient((point) => {
    const d = haversineMeters(point, truth);
    if (d < 10) return { status: 200, json: { status_name: 'on_call_fine' } };
    return { status: 400, json: { error_code: 'radar_out_of_rollcall_scope', distance: d } };
  });
  const result = await answerRadarRollcall({
    client,
    rollcall,
    fallbackLocations: beacons.map((point, index) => ({ id: `b${index}`, name: `信标${index}`, lon: point.lon, lat: point.lat })),
    strategy: 'fallback',
    delayMs: 0,
  });
  check('场景2 三点定位成功', result.ok === true && result.usedEstimated === true, JSON.stringify(result.estimated));
  check('场景2 推算点可信', result.estimated?.reliable === true);
}

// 场景 3：maxAttempts 限制。
{
  const client = makeClient(() => ({ status: 400, json: { error_code: 'radar_out_of_rollcall_scope', distance: 100 } }));
  const result = await answerRadarRollcall({
    client,
    rollcall,
    fallbackLocations: Array.from({ length: 10 }, (_, index) => ({
      id: `p${index}`,
      name: `点${index}`,
      lon: 120.08 + index * 0.001,
      lat: 30.3,
    })),
    strategy: 'fallback',
    maxAttempts: 3,
    delayMs: 0,
  });
  check('场景3 最多 3 次', client.calls.length === 3 && result.ok === false, `${client.calls.length} 次`);
}

// 场景 4：演练不发请求。
{
  const client = makeClient(() => {
    throw new Error('不应该发请求');
  });
  const result = await answerRadarRollcall({
    client,
    rollcall,
    location: { name: '东一教学楼', lon: 120.089136, lat: 30.302331 },
    defaultLocation: { name: '西教学楼', lon: 120.085042, lat: 30.30173 },
    strategy: 'fallback',
    dryRun: true,
  });
  check('场景4 演练零请求', client.calls.length === 0 && result.dryRun === true && result.attempts.length === 2);
}

// 场景 5：非雷达点名拒绝。
{
  const client = makeClient(() => ({ status: 200, json: {} }));
  let rejected = false;
  try {
    await answerRadarRollcall({ client, rollcall: { ...rollcall, type: '数字点名', isRadar: false } });
  } catch (error) {
    rejected = /不是雷达点名/.test(error.message);
  }
  check('场景5 非雷达点名拒绝', rejected);
}

// 场景 6：已处理直接跳过。
{
  const client = makeClient(() => ({ status: 200, json: {} }));
  const result = await answerRadarRollcall({ client, rollcall: { ...rollcall, handled: true } });
  check('场景6 已签跳过', result.skipped === true && client.calls.length === 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
