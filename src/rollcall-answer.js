/**
 * 雷达点名应答与三点定位。
 *
 * 参考 ZJU-live-better `courses.zju/autosign.js`：
 *   1. 先用配置好的点位提交；
 *   2. 失败就遍历所有信标点；
 *   3. 收集服务端返回的 distance，用球面最小二乘反推出真正的信标位置再试一次。
 *
 * 这里把第 3 步做成纯 JS 的平面近似 Gauss-Newton（校园尺度误差在厘米级），
 * 不依赖 decimal.js；并把每次尝试的结果结构化返回，方便工具层解释。
 */
import { EARTH_RADIUS_M, formatPoint, haversineMeters, roundCoordinate } from './rollcall-locations.js';

/** 最多保留多少个距离观测点参与定位。 */
const MAX_TRILATERATION_POINTS = 12;

/**
 * 从应答 JSON 里提取距离（米）。
 * 服务端在不同版本里可能放在顶层、data 或 result 下。
 */
export function extractDistance(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.distance,
    payload.data?.distance,
    payload.result?.distance,
    payload.rollcall?.distance,
    payload.distance_in_meters,
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

/** 从应答 JSON 里提取错误码。 */
export function extractErrorCode(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return String(
    payload.error_code ||
      payload.errorCode ||
      payload.data?.error_code ||
      payload.result?.error_code ||
      '',
  );
}

/** 判断一次雷达应答是否成功。 */
export function rollcallAnswerSucceeded(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const status = String(payload.status_name || payload.status || '');
  if (status === 'on_call_fine' || status === 'present') return true;
  if (payload.success === true) return true;
  return false;
}

/**
 * 三点定位（球面线性最小二乘）。
 *
 * 把每个信标点转成地心单位向量 u_i，目标点 u 满足 `u · u_i = cos(d_i / R)`；
 * 这是关于 u 的线性方程组，3 个以上信标即可求解，解出来归一化到单位球面。
 * 比局部平面近似更稳，远距离信标也不会产生几百米偏差。
 *
 * @param {Array<{lon:number, lat:number, d:number}>} rawPoints 已知点位与到目标点的距离（米）
 * @returns {{lon:number, lat:number, rms:number, points:number, reliable:boolean, method:string}|null}
 */
export function estimatePosition(rawPoints) {
  const points = (Array.isArray(rawPoints) ? rawPoints : [])
    .filter(
      (point) =>
        point &&
        Number.isFinite(Number(point.lon)) &&
        Number.isFinite(Number(point.lat)) &&
        Number.isFinite(Number(point.d)) &&
        Number(point.d) > 0,
    )
    .slice(0, MAX_TRILATERATION_POINTS)
    .map((point) => ({
      lon: Number(point.lon),
      lat: Number(point.lat),
      d: Number(point.d),
    }));
  if (points.length < 3) return null;

  const toVector = (lon, lat) => {
    const lambda = (lon * Math.PI) / 180;
    const phi = (lat * Math.PI) / 180;
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  };

  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const vector = [0, 0, 0];
  for (const point of points) {
    const unit = toVector(point.lon, point.lat);
    const cosine = Math.cos(point.d / EARTH_RADIUS_M);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        matrix[row][column] += unit[row] * unit[column];
      }
      vector[row] += unit[row] * cosine;
    }
  }

  const solved = solveLinear3(matrix, vector);
  if (!solved) return null;
  const norm = Math.hypot(solved[0], solved[1], solved[2]);
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  const unit = solved.map((value) => value / norm);
  const lat = (Math.asin(Math.max(-1, Math.min(1, unit[2]))) * 180) / Math.PI;
  const lon = (Math.atan2(unit[1], unit[0]) * 180) / Math.PI;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const rms = Math.sqrt(
    points.reduce((sum, point) => {
      const delta = point.d - haversineMeters({ lon, lat }, point);
      return sum + delta * delta;
    }, 0) / points.length,
  );

  const anchor = {
    lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  };
  const offset = haversineMeters(anchor, { lon, lat });
  // 单位向量长度偏离 1 太多，说明方程不相容；RMS 过大说明观测点本身有问题。
  const reliable = Math.abs(norm - 1) <= 0.2 && rms <= 150 && offset <= 50000;

  return {
    lon: roundCoordinate(lon),
    lat: roundCoordinate(lat),
    rms: Math.round(rms * 10) / 10,
    points: points.length,
    reliable,
    method: 'sphere-lsq',
  };
}

/** 解 3×3 线性方程组（高斯消元 + 部分主元）。 */
function solveLinear3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (!Number.isFinite(rows[pivot][column]) || Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let cell = column; cell < 4; cell += 1) rows[column][cell] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (!factor) continue;
      for (let cell = column; cell < 4; cell += 1) rows[row][cell] -= factor * rows[column][cell];
    }
  }
  return [rows[0][3], rows[1][3], rows[2][3]];
}

/** 简单睡眠。 */
function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 对一次雷达点名执行应答。
 *
 * @param {{
 *   client: { answerRadar: Function },
 *   rollcall: object,
 *   location?: object|null,
 *   defaultLocation?: object|null,
 *   fallbackLocations?: object[],
 *   strategy?: 'single'|'fallback',
 *   maxAttempts?: number,
 *   delayMs?: number,
 *   accuracy?: number,
 *   deviceId?: string,
 *   dryRun?: boolean,
 *   onAttempt?: (attempt: object) => void,
 * }} options
 */
export async function answerRadarRollcall(options) {
  const {
    client,
    rollcall,
    location = null,
    defaultLocation = null,
    fallbackLocations = [],
    strategy = 'fallback',
    maxAttempts = 20,
    delayMs = 800,
    accuracy = 68,
    deviceId,
    dryRun = false,
    onAttempt,
  } = options || {};

  if (!client || typeof client.answerRadar !== 'function') {
    throw new Error('内部错误：缺少 answerRadar 客户端');
  }
  if (!rollcall || rollcall.id === undefined || rollcall.id === null) {
    throw new Error('缺少 rollcall_id');
  }
  if (rollcall.isRadar === false || rollcall.type === '数字点名' || rollcall.type === '二维码签到') {
    throw new Error(`点名 #${rollcall.id} 不是雷达点名（类型：${rollcall.type || '未知'}），虚拟位置对它无效。`);
  }
  if (rollcall.handled || rollcall.expired) {
    return {
      ok: true,
      skipped: true,
      rollcall,
      attempts: [],
      estimated: null,
      usedEstimated: false,
      durationMs: 0,
      message: rollcall.handled ? '这次点名你已经签过了' : '这次点名已经结束',
    };
  }

  const startedAt = Date.now();
  const seen = new Set();
  const candidates = [];
  const pushCandidate = (item, role) => {
    if (!item || !Number.isFinite(Number(item.lon)) || !Number.isFinite(Number(item.lat))) return;
    const key = `${roundCoordinate(item.lon)},${roundCoordinate(item.lat)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...item, role });
  };

  pushCandidate(location, 'explicit');
  pushCandidate(defaultLocation, 'default');
  if (strategy === 'fallback') {
    for (const item of fallbackLocations) pushCandidate(item, 'fallback');
  }

  const limit = Math.max(1, Math.min(Number(maxAttempts) || 20, 40));
  if (candidates.length === 0) {
    throw new Error('没有可用的虚拟位置：先用 zju_rollcall_location 添加点位或设置默认点位。');
  }
  const planned = candidates.slice(0, limit);
  const attempts = [];
  const distances = [];

  const buildAttempt = (candidate) => ({
    role: candidate.role,
    id: candidate.id || '',
    name: candidate.name || formatPoint(candidate),
    campus: candidate.campus || '',
    lon: roundCoordinate(candidate.lon),
    lat: roundCoordinate(candidate.lat),
  });

  if (dryRun) {
    return {
      ok: false,
      dryRun: true,
      rollcall,
      strategy,
      attempts: planned.map((candidate) => ({ ...buildAttempt(candidate), planned: true })),
      estimated: null,
      usedEstimated: false,
      durationMs: 0,
      message: `演练：将依次尝试 ${planned.length} 个点位（不会发送签到请求）。`,
    };
  }

  const runAttempt = async (candidate) => {
    const attempt = buildAttempt(candidate);
    try {
      const response = await client.answerRadar(rollcall.id, {
        lon: attempt.lon,
        lat: attempt.lat,
        accuracy,
        deviceId,
      });
      const payload = response?.json ?? null;
      attempt.httpStatus = response?.status ?? null;
      attempt.ok = rollcallAnswerSucceeded(payload);
      attempt.status = String(payload?.status_name || payload?.status || '');
      attempt.errorCode = extractErrorCode(payload);
      attempt.distance = extractDistance(payload);
      attempt.message =
        payload?.message ||
        payload?.error ||
        (payload ? '' : String(response?.text || '').slice(0, 120));
      if (attempt.distance) {
        distances.push({ lon: attempt.lon, lat: attempt.lat, d: attempt.distance });
      }
      if (!attempt.ok && !attempt.message) {
        attempt.message = attempt.errorCode || `HTTP ${attempt.httpStatus}`;
      }
    } catch (error) {
      attempt.ok = false;
      attempt.error = String(error?.message || error);
      attempt.message = attempt.error;
    }
    attempts.push(attempt);
    if (onAttempt) onAttempt(attempt);
    return attempt;
  };

  let usedEstimated = false;
  let estimated = null;

  for (const candidate of planned) {
    const attempt = await runAttempt(candidate);
    if (attempt.ok) {
      return {
        ok: true,
        rollcall,
        strategy,
        attempts,
        estimated: null,
        usedEstimated: false,
        durationMs: Date.now() - startedAt,
        message: `已用「${attempt.name}」完成签到。`,
      };
    }
    await sleep(delayMs);
  }

  if (strategy === 'fallback' && distances.length >= 3 && attempts.length < limit) {
    estimated = estimatePosition(distances);
    if (estimated && estimated.reliable) {
      const candidate = {
        id: 'estimated',
        name: '三点定位推算点',
        campus: '',
        lon: estimated.lon,
        lat: estimated.lat,
        role: 'estimated',
      };
      const attempt = await runAttempt(candidate);
      if (attempt.ok) {
        usedEstimated = true;
        return {
          ok: true,
          rollcall,
          strategy,
          attempts,
          estimated,
          usedEstimated,
          durationMs: Date.now() - startedAt,
          message: `三点定位推算成功（RMS ${estimated.rms} m），已用推算坐标完成签到。`,
        };
      }
    }
  }

  return {
    ok: false,
    rollcall,
    strategy,
    attempts,
    estimated,
    usedEstimated,
    durationMs: Date.now() - startedAt,
    message: estimated
      ? estimated.reliable
        ? `已尝试 ${attempts.length} 个点位，三点定位推算点也未通过。`
        : `已尝试 ${attempts.length} 个点位；三点定位误差 ${estimated.rms} m，结果不可信，未尝试。`
      : `已尝试 ${attempts.length} 个点位，均未通过。`,
  };
}
