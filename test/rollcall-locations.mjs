/**
 * 虚拟位置库单元测试：坐标解析、校验、增删改查、持久化、导入导出。
 * 不需要真实账号，不访问网络。
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RollcallLocations,
  PRESET_LOCATIONS,
  parseCoordinateText,
  normalizePoint,
  haversineMeters,
  formatPoint,
  defaultLocationsFile,
} from '../src/rollcall-locations.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/* ------------------------------ 纯函数 ------------------------------ */
check('预设点位数量', PRESET_LOCATIONS.length === 12, `${PRESET_LOCATIONS.length} 个`);
check(
  '预设点位字段完整',
  PRESET_LOCATIONS.every(
    (item) =>
      item.id &&
      item.name &&
      Number.isFinite(item.lon) &&
      Number.isFinite(item.lat) &&
      item.lon > 118 &&
      item.lon < 123 &&
      item.lat > 27 &&
      item.lat < 32,
  ),
);

const parsed = parseCoordinateText('120.089136,30.302331');
check('解析逗号坐标', parsed && parsed.lon === 120.089136 && parsed.lat === 30.302331, JSON.stringify(parsed));
const parsedSpace = parseCoordinateText('120.089136 30.302331');
check('解析空格坐标', parsedSpace && parsedSpace.lon === 120.089136, JSON.stringify(parsedSpace));
const parsedSwapped = parseCoordinateText('30.302331,120.089136');
check('自动纠正纬度在前', parsedSwapped && parsedSwapped.lon === 120.089136 && parsedSwapped.lat === 30.302331);
check('解析非法文本返回 null', parseCoordinateText('东一教学楼') === null);

let rejected = false;
try {
  normalizePoint(200, 30);
} catch (error) {
  rejected = /经度/.test(error.message);
}
check('经度越界被拒绝', rejected);

rejected = false;
try {
  normalizePoint(120, 91);
} catch (error) {
  rejected = /纬度/.test(error.message);
}
check('纬度越界被拒绝', rejected);

const distance = haversineMeters({ lon: 120.089136, lat: 30.302331 }, { lon: 120.085042, lat: 30.30173 });
check('紫金港东一→西教约 400 米', distance > 300 && distance < 500, `${distance.toFixed(1)} m`);
check('formatPoint 去尾零', formatPoint({ lon: 120.089136, lat: 30.3 }) === '120.089136,30.3');
check('默认文件路径包含 zju-campus', defaultLocationsFile().includes('zju-campus'), defaultLocationsFile());

/* ------------------------------ 持久化与 CRUD ------------------------------ */
const dir = mkdtempSync(join(tmpdir(), 'zju-rollcall-loc-'));
const file = join(dir, 'locations.json');
try {
  const store = new RollcallLocations({ file });
  check('空库快照', store.snapshot().count === 12 && store.snapshot().customCount === 0);

  const added = store.add({
    name: '东一教学楼',
    lon: 120.0892,
    lat: 30.3024,
    campus: '紫金港',
    aliases: '东一,东1',
    note: '测试点位',
    setDefault: true,
  });
  check('新增点位', added.id.startsWith('loc-') && added.aliases.length === 2, JSON.stringify(added));
  check('新增即默认', store.defaultLocation()?.name === '东一教学楼');
  check('文件已落盘', JSON.parse(readFileSync(file, 'utf8')).locations.length === 1);

  const byName = store.resolve('东一教学楼');
  check('按名称解析', byName.match === 'name' && byName.location.id === added.id);
  const byAlias = store.resolve('东1');
  check('按别名解析', byAlias.match === 'alias' && byAlias.location.id === added.id);
  const byId = store.resolve(added.id);
  check('按 id 解析', byId.match === 'id');
  const byCoords = store.resolve('120.0892,30.3024');
  check('按坐标解析', byCoords.match === 'coords' && byCoords.location.lon === 120.0892);

  const preset = store.resolve('西教学楼');
  check('解析预设点', preset.match === 'name' && preset.location.id === 'zjg-xi');

  const fuzzy = store.resolve('西教');
  check('模糊解析西教', fuzzy.location?.id === 'zjg-xi', JSON.stringify(fuzzy.location?.name));

  // 同名自定义点应覆盖预设（用于修正坐标）。
  const override = store.add({ name: '西教学楼', lon: 120.0851, lat: 30.3018, campus: '紫金港' });
  const resolvedOverride = store.resolve('西教学楼');
  check('同名自定义覆盖预设', resolvedOverride.location.id === override.id, resolvedOverride.location.id);

  const updated = store.update(added.id, { name: '东一教学楼（修正）', lon: 120.0893 });
  check('修改点位', updated.name === '东一教学楼（修正）' && updated.lon === 120.0893 && updated.lat === 30.3024);

  let presetEditRejected = false;
  try {
    store.update('zjg-xi', { lon: 120 });
  } catch (error) {
    presetEditRejected = /内置预设点/.test(error.message);
  }
  check('预设点不可直接修改', presetEditRejected);

  let duplicateRejected = false;
  try {
    store.add({ name: '西教学楼', lon: 120, lat: 30 });
  } catch (error) {
    duplicateRejected = /同名/.test(error.message);
  }
  check('同名自定义点被拒绝', duplicateRejected);

  const reloaded = new RollcallLocations({ file });
  check('重新加载持久化', reloaded.snapshot().customCount === 2, `${reloaded.snapshot().customCount} 个`);

  const exported = store.exportJson();
  check('导出 JSON', JSON.parse(exported).locations.length === 2);

  const imported = store.importJson('玉泉教四,120.122176,30.261555,玉泉\n之江校区1,120.126008,30.192908');
  check('导入行文本', imported.length === 2, imported.map((item) => item.name).join('、'));

  const removed = store.remove(imported[0].id);
  check('删除点位', removed.name === '玉泉教四' && store.snapshot().customCount === 3);

  let presetDeleteRejected = false;
  try {
    store.remove('zjg-xi');
  } catch (error) {
    presetDeleteRejected = /内置预设点/.test(error.message);
  }
  check('预设点不可删除', presetDeleteRejected);

  const defaulted = store.setDefault('zjg-xi');
  check('默认可设为预设点', defaulted.id === 'zjg-xi' && store.defaultLocation()?.id === 'zjg-xi');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
