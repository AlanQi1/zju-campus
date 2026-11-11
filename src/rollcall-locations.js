/**
 * 虚拟位置（签到地点）库。
 *
 * 背景：学在浙大的「雷达点名」要求提交 GPS 坐标，服务端以教学楼的信标点为圆心
 * 校验 500 米半径。参考项目 ZJU-live-better 的 `courses.zju/autosign.js` 把
 * 12 个常用点位硬编码在 `RadarInfo` 里，再用 `CONFIG.radarAt` 选一个。
 *
 * 这里把它做成可配置的：
 *   - 内置 12 个浙大常用点位（坐标来自参考项目，保留原始精度）；
 *   - 用户自定义点位持久化到 `$DSH_HOME/zju-campus/rollcall-locations.json`；
 *   - 支持按 id / 名称 / 别名 / 模糊词 / 直接坐标解析；
 *   - 自定义点与预设点重名时，自定义点优先（用于修正预设坐标）。
 *
 * 只依赖 Node 内置能力。
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome } from './session.js';

/** 地球平均半径（米），与参考项目一致。 */
export const EARTH_RADIUS_M = 6371008.8;

/** 浙大常用点位（来自 ZJU-live-better 的 RadarInfo，坐标为 WGS84 经纬度）。 */
export const PRESET_LOCATIONS = [
  {
    id: 'zjg-dong1',
    name: '东一教学楼',
    campus: '紫金港',
    lon: 120.089136,
    lat: 30.302331,
    aliases: ['东一', '东1', '东1教学楼', '紫金港东一'],
    note: '参考项目 RadarInfo.ZJGD1',
  },
  {
    id: 'zjg-xi',
    name: '西教学楼',
    campus: '紫金港',
    lon: 120.085042,
    lat: 30.30173,
    aliases: ['西教', '西1', '西一', '紫金港西教'],
    note: '参考项目 RadarInfo.ZJGX1',
  },
  {
    id: 'zjg-duanyongping',
    name: '段永平教学楼',
    campus: '紫金港',
    lon: 120.077135,
    lat: 30.305142,
    aliases: ['段永平', '段楼', '大西区教学楼'],
    note: '参考项目 RadarInfo.ZJGB1',
  },
  {
    id: 'yq-jiao4',
    name: '玉泉教四',
    campus: '玉泉',
    lon: 120.122176,
    lat: 30.261555,
    aliases: ['教四', '玉泉第四教学楼'],
    note: '参考项目 RadarInfo.YQ4',
  },
  {
    id: 'yq-jiao1',
    name: '玉泉教一',
    campus: '玉泉',
    lon: 120.123853,
    lat: 30.262544,
    aliases: ['教一', '玉泉第一教学楼'],
    note: '参考项目 RadarInfo.YQ1',
  },
  {
    id: 'yq-jiao7',
    name: '玉泉教七',
    campus: '玉泉',
    lon: 120.120344,
    lat: 30.263907,
    aliases: ['教七', '玉泉第七教学楼'],
    note: '参考项目 RadarInfo.YQ7',
  },
  {
    id: 'zj-campus1',
    name: '之江校区1',
    campus: '之江',
    lon: 120.126008,
    lat: 30.192908,
    aliases: ['之江1', '之江一'],
    note: '参考项目 RadarInfo.ZJ1',
  },
  {
    id: 'hjc-campus1',
    name: '华家池校区1',
    campus: '华家池',
    lon: 120.195939,
    lat: 30.272068,
    aliases: ['华家池1', '华家池一'],
    note: '参考项目 RadarInfo.HJC1',
  },
  {
    id: 'hjc-campus2',
    name: '华家池校区2',
    campus: '华家池',
    lon: 120.198193,
    lat: 30.270419,
    aliases: ['华家池2', '华家池二'],
    note: '参考项目 RadarInfo.HJC2',
  },
  {
    id: 'zj-campus2',
    name: '之江校区2',
    campus: '之江',
    lon: 120.124267,
    lat: 30.19139,
    aliases: ['之江2', '之江二'],
    note: '参考项目 RadarInfo.ZJ2（之江校区半径不足 500 米）',
  },
  {
    id: 'yq-sushe',
    name: '玉泉宿舍',
    campus: '玉泉',
    lon: 120.124001,
    lat: 30.265735,
    aliases: ['玉泉学生宿舍', '宿舍'],
    note: '参考项目 RadarInfo.YQSS（备用点位）',
  },
  {
    id: 'zjg-daxiqu',
    name: '紫金港大西区',
    campus: '紫金港',
    lon: 120.073427,
    lat: 30.299757,
    aliases: ['大西区', '紫金港西区'],
    note: '参考项目 RadarInfo.ZJG4',
  },
];

/** 默认点位文件。 */
export function defaultLocationsFile() {
  return join(dshHome(), 'zju-campus', 'rollcall-locations.json');
}

/** 保留 6 位小数（约 0.11 米），去掉多余的 0。 */
export function roundCoordinate(value) {
  return Number(Number(value).toFixed(6));
}

/** 把点位格式化成 `经度,纬度`。 */
export function formatPoint(point) {
  if (!point) return '';
  return `${roundCoordinate(point.lon)},${roundCoordinate(point.lat)}`;
}

/** 校验并归一化一个经纬度。 */
export function normalizePoint(lon, lat) {
  const lonNumber = Number(lon);
  const latNumber = Number(lat);
  if (!Number.isFinite(lonNumber) || !Number.isFinite(latNumber)) {
    throw new Error('经纬度必须是数字，例如 120.089136,30.302331');
  }
  if (lonNumber < -180 || lonNumber > 180) {
    throw new Error(`经度 ${lonNumber} 超出范围（-180 ~ 180）。格式是「经度,纬度」，别把两个值写反。`);
  }
  if (latNumber < -90 || latNumber > 90) {
    throw new Error(`纬度 ${latNumber} 超出范围（-90 ~ 90）。格式是「经度,纬度」，别把两个值写反。`);
  }
  return { lon: roundCoordinate(lonNumber), lat: roundCoordinate(latNumber) };
}

/**
 * 解析「经度,纬度」文本。
 *
 * 支持逗号、中文逗号或空格分隔。若第一个数大于 90、第二个数小于 90，视为
 * 纬度在前自动纠正；两个数都合法时按「经度,纬度」理解（国内常用写法）。
 */
export function parseCoordinateText(text) {
  const source = String(text ?? '').trim();
  if (!source) return null;
  const match = source.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,，\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  // 国内经度在 73~136 之间，纬度在 3~54 之间：第二个数大于 90 只可能是经度，
  // 说明用户写成了「纬度,经度」，交换回来。
  if (Math.abs(first) <= 90 && Math.abs(second) > 90) {
    return normalizePoint(second, first);
  }
  return normalizePoint(first, second);
}

/** 球面大圆距离（米）。 */
export function haversineMeters(a, b) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRad(Number(b.lon) - Number(a.lon));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 文本归一化：去空白、转小写。 */
function normalizeKey(value) {
  return String(value ?? '')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase();
}

/** 生成一个不会与现有点位冲突的 id。 */
function makeId(existing) {
  const used = new Set(existing.map((item) => item.id));
  for (;;) {
    const id = `loc-${randomBytes(4).toString('hex')}`;
    if (!used.has(id)) return id;
  }
}

/** 深拷贝一个点位（避免调用方改到内部状态）。 */
function cloneLocation(item) {
  return {
    ...item,
    aliases: Array.isArray(item.aliases) ? [...item.aliases] : [],
  };
}

/**
 * 虚拟位置库。
 *
 * 文件格式：
 * {
 *   "version": 1,
 *   "defaultId": "zjg-dong1",
 *   "locations": [
 *     { "id": "loc-1a2b3c4d", "name": "…", "campus": "…", "lon": 120.1, "lat": 30.3,
 *       "aliases": [], "note": "", "accuracy": 68, "source": "custom",
 *       "createdAt": "…", "updatedAt": "…" }
 *   ]
 * }
 */
export class RollcallLocations {
  /**
   * @param {{ file?: string, presets?: Array<object> }} [options]
   */
  constructor(options = {}) {
    this.file = options.file || defaultLocationsFile();
    this.presets = (options.presets || PRESET_LOCATIONS).map((item) => ({
      ...cloneLocation(item),
      source: 'preset',
    }));
    this.data = null;
  }

  /** 读取文件；不存在时返回空库。文件损坏时抛出可读错误。 */
  load() {
    if (!existsSync(this.file)) {
      this.data = { version: 1, defaultId: null, locations: [] };
      return this.data;
    }
    let text;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch (error) {
      throw new Error(`读不到虚拟位置文件 ${this.file}：${error.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`虚拟位置文件不是合法 JSON：${this.file}（${error.message}）`);
    }
    const locations = Array.isArray(parsed?.locations) ? parsed.locations : [];
    this.data = {
      version: 1,
      defaultId: parsed?.defaultId ? String(parsed.defaultId) : null,
      locations: locations
        .filter(
          (item) =>
            item &&
            item.name &&
            Number.isFinite(Number(item.lon)) &&
            Number.isFinite(Number(item.lat)),
        )
        .map((item) => ({
          id: String(item.id || makeId(locations)),
          name: String(item.name),
          campus: String(item.campus || ''),
          lon: roundCoordinate(item.lon),
          lat: roundCoordinate(item.lat),
          aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
          note: String(item.note || ''),
          accuracy: Number(item.accuracy) > 0 ? Number(item.accuracy) : 68,
          source: item.source === 'learned' ? 'learned' : 'custom',
          createdAt: item.createdAt || null,
          updatedAt: item.updatedAt || null,
        })),
    };
    return this.data;
  }

  /** 写回文件（临时文件 + rename，避免写一半）。 */
  save() {
    if (!this.data) this.load();
    mkdirSync(dirname(this.file), { recursive: true });
    const body = `${JSON.stringify(this.data, null, 2)}\n`;
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, body, 'utf8');
    try {
      renameSync(temp, this.file);
    } catch {
      writeFileSync(this.file, body, 'utf8');
    }
    return this.data;
  }

  /** 全部点位（自定义 + 预设）。 */
  all() {
    const data = this.data || this.load();
    return [...data.locations.map(cloneLocation), ...this.presets.map(cloneLocation)];
  }

  /** 自定义点位。 */
  custom() {
    const data = this.data || this.load();
    return data.locations.map(cloneLocation);
  }

  /** 当前默认点位（可能是预设）。 */
  defaultLocation() {
    const data = this.data || this.load();
    if (!data.defaultId) return null;
    return this.get(data.defaultId);
  }

  /** 按 id 精确取一个点位。 */
  get(id) {
    const key = normalizeKey(id);
    if (!key) return null;
    const data = this.data || this.load();
    return (
      data.locations.find((item) => normalizeKey(item.id) === key) ||
      this.presets.find((item) => normalizeKey(item.id) === key) ||
      null
    );
  }

  /**
   * 解析用户输入：id、名称、别名、模糊词或「经度,纬度」。
   * @returns {{ location: object|null, match: string|null, candidates: object[] }}
   */
  resolve(query) {
    const source = String(query ?? '').trim();
    if (!source) return { location: null, match: null, candidates: [] };

    const coordinates = parseCoordinateText(source);
    if (coordinates) {
      return {
        location: {
          id: 'coords',
          name: '自定义坐标',
          campus: '',
          lon: coordinates.lon,
          lat: coordinates.lat,
          aliases: [],
          note: '直接输入的经纬度',
          accuracy: 68,
          source: 'coords',
        },
        match: 'coords',
        candidates: [],
      };
    }

    const key = normalizeKey(source);
    const data = this.data || this.load();
    const pool = [...data.locations, ...this.presets];

    const byId = pool.find((item) => normalizeKey(item.id) === key);
    if (byId) return { location: cloneLocation(byId), match: 'id', candidates: [] };

    const byName = pool.find((item) => normalizeKey(item.name) === key);
    if (byName) return { location: cloneLocation(byName), match: 'name', candidates: [] };

    const byAlias = pool.find((item) => (item.aliases || []).some((alias) => normalizeKey(alias) === key));
    if (byAlias) return { location: cloneLocation(byAlias), match: 'alias', candidates: [] };

    const fuzzy = pool.filter((item) => {
      const name = normalizeKey(item.name);
      const campus = normalizeKey(item.campus);
      return (
        name.includes(key) ||
        key.includes(name) ||
        (item.aliases || []).some((alias) => normalizeKey(alias).includes(key)) ||
        (campus && `${campus}${name}`.includes(key))
      );
    });
    const unique = [];
    for (const item of fuzzy) {
      if (!unique.some((seen) => seen.id === item.id)) unique.push(cloneLocation(item));
    }
    if (unique.length === 1) return { location: unique[0], match: 'fuzzy', candidates: [] };
    if (unique.length > 1) {
      // 完全同名时自定义点优先（用于覆盖预设）。
      const sameName = unique.filter((item) => normalizeKey(item.name) === key);
      if (sameName.length === 1) return { location: sameName[0], match: 'name', candidates: [] };
      return { location: null, match: null, candidates: unique.slice(0, 8) };
    }
    return { location: null, match: null, candidates: [] };
  }

  /** 新增一个自定义点位。 */
  add(input = {}) {
    const data = this.data || this.load();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('缺少点位名称，例如「东一教学楼」');
    if (name.length > 60) throw new Error('点位名称过长（最多 60 个字符）');
    if (data.locations.some((item) => normalizeKey(item.name) === normalizeKey(name))) {
      throw new Error(`已存在同名自定义点位「${name}」，要改坐标请用 update。`);
    }
    const point = normalizePoint(input.lon, input.lat);
    const now = new Date().toISOString();
    const location = {
      id: makeId([...data.locations, ...this.presets]),
      name,
      campus: String(input.campus || '').trim(),
      lon: point.lon,
      lat: point.lat,
      aliases: Array.isArray(input.aliases)
        ? input.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : String(input.aliases || '')
            .split(/[,，、\s]+/)
            .map((alias) => alias.trim())
            .filter(Boolean),
      note: String(input.note || '').trim(),
      accuracy: Number(input.accuracy) > 0 ? Number(input.accuracy) : 68,
      source: input.source === 'learned' ? 'learned' : 'custom',
      createdAt: now,
      updatedAt: now,
    };
    data.locations.push(location);
    if (input.setDefault === true) data.defaultId = location.id;
    this.save();
    return cloneLocation(location);
  }

  /** 修改自定义点位。预设点不可改，可新增同名自定义点覆盖。 */
  update(idOrName, patch = {}) {
    const data = this.data || this.load();
    const key = normalizeKey(idOrName);
    const index = data.locations.findIndex(
      (item) => normalizeKey(item.id) === key || normalizeKey(item.name) === key,
    );
    if (index < 0) {
      const preset = this.presets.find(
        (item) => normalizeKey(item.id) === key || normalizeKey(item.name) === key,
      );
      if (preset) {
        throw new Error(
          `「${preset.name}」是内置预设点，不能直接修改。请用 add 新增一个同名点位（会覆盖预设），或换一个名字。`,
        );
      }
      throw new Error(`找不到自定义点位：${idOrName}`);
    }
    const current = data.locations[index];
    const next = { ...current };
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (!name) throw new Error('点位名称不能为空');
      if (data.locations.some((item, itemIndex) => itemIndex !== index && normalizeKey(item.name) === normalizeKey(name))) {
        throw new Error(`已存在同名自定义点位「${name}」`);
      }
      next.name = name;
    }
    if (patch.campus !== undefined) next.campus = String(patch.campus).trim();
    if (patch.note !== undefined) next.note = String(patch.note).trim();
    if (patch.aliases !== undefined) {
      next.aliases = Array.isArray(patch.aliases)
        ? patch.aliases.map((alias) => String(alias).trim()).filter(Boolean)
        : String(patch.aliases)
            .split(/[,，、\s]+/)
            .map((alias) => alias.trim())
            .filter(Boolean);
    }
    if (patch.accuracy !== undefined && Number(patch.accuracy) > 0) next.accuracy = Number(patch.accuracy);
    if (patch.lon !== undefined || patch.lat !== undefined) {
      const point = normalizePoint(
        patch.lon !== undefined ? patch.lon : current.lon,
        patch.lat !== undefined ? patch.lat : current.lat,
      );
      next.lon = point.lon;
      next.lat = point.lat;
    }
    next.updatedAt = new Date().toISOString();
    data.locations[index] = next;
    this.save();
    return cloneLocation(next);
  }

  /** 删除自定义点位。 */
  remove(idOrName) {
    const data = this.data || this.load();
    const key = normalizeKey(idOrName);
    const index = data.locations.findIndex(
      (item) => normalizeKey(item.id) === key || normalizeKey(item.name) === key,
    );
    if (index < 0) {
      const preset = this.presets.find(
        (item) => normalizeKey(item.id) === key || normalizeKey(item.name) === key,
      );
      if (preset) throw new Error(`「${preset.name}」是内置预设点，不能删除。`);
      throw new Error(`找不到自定义点位：${idOrName}`);
    }
    const [removed] = data.locations.splice(index, 1);
    if (data.defaultId === removed.id) data.defaultId = null;
    this.save();
    return cloneLocation(removed);
  }

  /** 设置默认点位（可以是预设）。 */
  setDefault(idOrName) {
    const resolved = this.resolve(idOrName);
    if (!resolved.location) {
      throw new Error(
        resolved.candidates.length > 0
          ? `「${idOrName}」匹配到多个点位：${resolved.candidates.map((item) => item.name).join('、')}，请写完整名称。`
          : `找不到点位：${idOrName}`,
      );
    }
    if (resolved.location.id === 'coords') {
      throw new Error('默认点位必须来自点位库，不能是临时坐标。请先 add 一个点位。');
    }
    const data = this.data || this.load();
    data.defaultId = resolved.location.id;
    this.save();
    return resolved.location;
  }

  /** 导出为 JSON 文本。 */
  exportJson() {
    const data = this.data || this.load();
    return JSON.stringify(
      {
        version: 1,
        defaultId: data.defaultId,
        locations: data.locations,
      },
      null,
      2,
    );
  }

  /**
   * 导入点位。支持 JSON（数组或本模块导出格式）和「名称,经度,纬度[,校区]」行文本。
   * @param {string} text
   * @param {{ merge?: boolean }} [options] merge=false 时先清空自定义点
   */
  importJson(text, { merge = true } = {}) {
    const source = String(text ?? '').trim();
    if (!source) throw new Error('导入内容为空');
    let entries = [];
    let defaultId = null;

    if (source.startsWith('{') || source.startsWith('[')) {
      let parsed;
      try {
        parsed = JSON.parse(source);
      } catch (error) {
        throw new Error(`导入内容不是合法 JSON：${error.message}`);
      }
      if (Array.isArray(parsed)) entries = parsed;
      else {
        entries = Array.isArray(parsed.locations) ? parsed.locations : [];
        defaultId = parsed.defaultId || null;
      }
    } else {
      entries = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim());
          if (parts.length < 3) throw new Error(`无法解析行：${line}`);
          return { name: parts[0], lon: parts[1], lat: parts[2], campus: parts[3] || '' };
        });
    }

    if (entries.length === 0) throw new Error('导入内容里没有点位');
    const data = this.data || this.load();
    if (!merge) {
      data.locations = [];
      data.defaultId = null;
    }
    const imported = [];
    for (const entry of entries) {
      const location = this.add({
        name: entry.name,
        lon: entry.lon,
        lat: entry.lat,
        campus: entry.campus,
        aliases: entry.aliases,
        note: entry.note,
        accuracy: entry.accuracy,
      });
      imported.push(location);
    }
    if (defaultId) {
      const match = imported.find((item) => normalizeKey(item.id) === normalizeKey(defaultId));
      if (match) {
        data.defaultId = match.id;
        this.save();
      }
    }
    return imported;
  }

  /** 供面板使用的只读快照。 */
  snapshot({ max = 100 } = {}) {
    const data = this.data || this.load();
    const defaultLocation = this.defaultLocation();
    const custom = data.locations.map((item) => ({
      ...cloneLocation(item),
      isDefault: item.id === data.defaultId,
    }));
    return {
      file: this.file,
      defaultId: data.defaultId,
      default: defaultLocation ? cloneLocation(defaultLocation) : null,
      count: custom.length + this.presets.length,
      customCount: custom.length,
      presetCount: this.presets.length,
      locations: [...custom, ...this.presets.map((item) => ({ ...cloneLocation(item), isDefault: item.id === data.defaultId }))].slice(
        0,
        max,
      ),
    };
  }
}
