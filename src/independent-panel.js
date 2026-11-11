import { independentSitesStatus, resolveIndependentAccount } from './independent-accounts.js';

/** 每个独立系统单独缓存，错误冷却10分钟；不把登录请求当作每分钟轮询。 */
export function createIndependentPanel(settings, factories = {}, {
  accountResolver = resolveIndependentAccount,
  statusProvider = independentSitesStatus,
} = {}) {
  const entries = new Map();
  const ttl = 15 * 60 * 1000;
  const cooldown = 10 * 60 * 1000;

  async function readSite(site) {
    if (site.id === 'engineering' && settings.enableEngineering !== true) {
      return { ...site, status: '暂缓接入', records: [], note: '已按你的要求暂停；不自动登录或查询。可点击打开原站。' };
    }
    const account = accountResolver(site.id);
    if (!account) return { ...site, status: '未配置独立账号', records: [] };
    if (!settings.allowIndependentHttp && !account.allowInsecureHttp) {
      return { ...site, status: '待确认HTTP风险', records: [] };
    }
    let entry = entries.get(site.id);
    if (!entry) { entry = {}; entries.set(site.id, entry); }
    if (entry.inflight) return entry.inflight;
    if (entry.data && Date.now() - entry.at < ttl) return entry.data;
    if (entry.failureAt && Date.now() - entry.failureAt < cooldown) {
      return { ...site, status: '连接失败，冷却中', records: [], error: entry.error };
    }
    entry.inflight = (async () => {
      try {
        const factory = factories[site.id];
        if (!factory) return { ...site, status: '适配器尚待接入', records: [] };
        if (entry.client && entry.data && Date.now() - entry.at >= ttl) {
          entry.client.close?.(); entry.client = null;
        }
        if (!entry.client) entry.client = await factory({
          username: account.username, password: account.password,
          allowInsecureHttp: true, timeoutMs: settings.requestTimeoutMs || 20000,
        });
        const result = await entry.client.read();
        const data = { ...site, note: '仅查询自己的数据；HTTP连接不加密。打开原站时，浏览器可能需要另行登录。',
          status: result.structureKnown === false ? '已登录，作业解析待适配' : '已同步',
          records: result.records || [], warnings: result.warnings || [],
          updatedAt: new Date().toISOString() };
        entry.data = data; entry.at = Date.now(); entry.failureAt = 0;
        return data;
      } catch (error) {
        entry.client?.close?.();
        entry.client = null;
        entry.failureAt = Date.now();
        // 不把远端正文或任意异常字符串传给浏览器。
        entry.error = error?.code === 'AUTH_REJECTED' ? '登录未通过，请在官网核对密码或验证码。' : '连接或解析失败，请稍后重试；未修改任何远端数据。';
        return { ...site, status: '同步失败', records: [], error: entry.error };
      } finally { entry.inflight = null; }
    })();
    return entry.inflight;
  }

  const read = async () => Promise.all(statusProvider().map(readSite));
  read.dispose = () => {
    for (const entry of entries.values()) entry.client?.close?.();
    entries.clear();
  };
  return read;
}
