import { fetchNotices, fetchNoticeDetail } from '../src/notices.js';
import { encryptPassword } from '../src/zjuam.js';
import { resolveCredentials, maskAccount, parseEnvFile } from '../src/session.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** 跳过：站点自身不可达（TLS/网络），与本插件解析逻辑无关。 */
const skip = (name, reason) => {
  console.log(`SKIP ${name} — ${reason}`);
};

/** 判断错误是不是站点侧网络问题，而不是解析结果不符合预期。 */
const isNetworkError = (error) =>
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket|TLS|handshake|getaddrinfo|certificate/i.test(
    `${error?.message ?? ''} ${error?.cause?.message ?? ''} ${error?.cause?.code ?? ''}`,
  );

/** 判断页面是不是「仅校内 IP 可访问」的拦截页，而不是真的没有通知。 */
const isCampusOnlyBlock = async (url) => {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const html = await res.text();
    return /仅允许校内地址访问|并非校内地址|not in campus/i.test(html);
  } catch {
    return false;
  }
};

// 1. 通知解析（真实网络）
for (const id of ['sis', 'opt', 'qsxy', 'bksy']) {
  try {
    const result = await fetchNotices(id, { limit: 3 });
    const items = result.items;
    if (items.length === 0 && (await isCampusOnlyBlock(result.source.url))) {
      skip(`notices/${id}`, '仅校内 IP 可访问，校外网络下不校验');
      continue;
    }
    check(`notices/${id}`, items.length > 0, `解析到 ${items.length} 条；首条：${items[0]?.title?.slice(0, 30) ?? '无'}`);
    check(`notices/${id}/url`, items.every((i) => i.url.startsWith('http')), items[0]?.url ?? '');
    check(`notices/${id}/date`, items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.date)), items[0]?.date ?? '');
  } catch (error) {
    if (isNetworkError(error)) skip(`notices/${id}`, `站点不可达：${error.cause?.code ?? error.message}`);
    else check(`notices/${id}`, false, error.message);
  }
}

// 2. 正文抓取
try {
  const list = await fetchNotices('bksy', { limit: 1 });
  const detail = await fetchNoticeDetail(list.items[0].url);
  check('notice detail', detail.content.length > 50, `标题：${detail.title.slice(0, 30)}；正文 ${detail.content.length} 字`);
} catch (error) {
  check('notice detail', false, error.message);
}

// 3. RSA 加密：验证数值等价（cipher^d mod n == 明文）
const { generateKeyPairSync } = await import('node:crypto');
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });
const toHex = (b64url) => Buffer.from(b64url, 'base64url').toString('hex');
const modulus = toHex(publicJwk.n);
const exponent = toHex(publicJwk.e);
const cipherHex = encryptPassword('hello-浙大', modulus, exponent);
const n = BigInt('0x' + modulus);
const d = BigInt('0x' + toHex(privateJwk.d));
const modpow = (base, exp, mod) => {
  let r = 1n, b = base % mod, e = exp;
  while (e > 0n) { if (e & 1n) r = (r * b) % mod; e >>= 1n; b = (b * b) % mod; }
  return r;
};
const plain = modpow(BigInt('0x' + cipherHex), d, n).toString(16);
const expected = Buffer.from('hello-浙大', 'utf8').toString('hex').replace(/^0+/, '');
check('RSA 加密可逆', plain.replace(/^0+/, '') === expected, `${plain.slice(0, 16)}...`);

// 4. 凭据解析
const { fileURLToPath } = await import('node:url');
const fixturePath = fileURLToPath(new URL('./fixture.env', import.meta.url));
const env = parseEnvFile(fixturePath);
check('env 解析', env.ZJU_USER === '3200100001' && env.ZJU_PASS === 'p@ss=word', JSON.stringify(env));
const resolved = resolveCredentials({ envFile: fixturePath });
check('凭据解析', resolved?.username === '3200100001' && resolved.source.includes('fixture.env'));
check('账号脱敏', maskAccount('3200100001') === '320***01', maskAccount('3200100001'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
