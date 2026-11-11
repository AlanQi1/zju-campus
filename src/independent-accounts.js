import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome, parseEnvFile } from './session.js';

export const independentAccountsFile = () => join(dshHome(), 'zju-campus', 'independent-accounts.env');
export const INDEPENDENT_SITES = Object.freeze([
  { id: 'physicsLab', name: '大物实验课表', url: 'http://10.203.16.55:86/lab-course/login', prefix: 'PHYSICS_LAB', backend: 'http://10.203.16.55:8098/lab-course', note: '独立实验账号；通过8098端口只读课表。课件（指导书/PPT）可在对话里用 zju_lab_materials 下载。' },
  { id: 'engineering', name: '工程训练作业', url: 'http://10.71.32.157/Login.aspx', prefix: 'ENGINEERING', note: '独立工程训练账号；只读报告作业。' },
]);

// 独立文件、独立字段；绝不回退到ZJU统一身份认证密码。
export function resolveIndependentAccount(id, file = independentAccountsFile()) {  const site = INDEPENDENT_SITES.find(s => s.id === id);
  if (!site) throw new Error('未知校园系统');
  const values = parseEnvFile(file);
  const username = values[`${site.prefix}_USER`] || '';
  const password = values[`${site.prefix}_PASSWORD`] || '';
  if (!username || !password) return null;
  return { username, password, allowInsecureHttp: values[`${site.prefix}_ALLOW_HTTP`] === 'true' };
}

// 只向浏览器提供状态和入口，绝不提供凭据或自动把密码拼接进URL。
export function independentSitesStatus(file = independentAccountsFile()) {
  return INDEPENDENT_SITES.map(site => {
    const account = resolveIndependentAccount(site.id, file);
    return { id: site.id, name: site.name, url: site.url,
      configured: !!account, status: account ? '已配置，待登录联调' : '未配置独立账号',
      note: site.note + ' 本站使用HTTP，传输不加密；勿在不可信网络输入密码。' };
  });
}

const INDEPENDENT_TEMPLATE = `# 浙大校园助手 · 独立校园系统账号（可选）
# 只有大物实验课件、工程训练作业这两块需要，不填也不影响其他功能。
# 这两站是校内 HTTP，和统一身份认证不是同一个密码。
# 大物实验（实验系统）
PHYSICS_LAB_USER=
PHYSICS_LAB_PASSWORD=
PHYSICS_LAB_ALLOW_HTTP=false
# 工程训练
ENGINEERING_USER=
ENGINEERING_PASSWORD=
ENGINEERING_ALLOW_HTTP=false
`;

/**
 * 首次运行时铺一份独立系统账号模板。只在文件不存在时创建，写不进去就安静跳过。
 * @returns {{ path: string, created: boolean }}
 */
export function ensureIndependentAccountsTemplate() {
  const file = independentAccountsFile();
  try {
    if (existsSync(file)) return { path: file, created: false };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, INDEPENDENT_TEMPLATE, { encoding: 'utf8', mode: 0o600 });
    return { path: file, created: true };
  } catch {
    return { path: file, created: false };
  }
}
