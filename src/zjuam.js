/**
 * ZJUAM 统一身份认证（CAS）。
 *
 * 流程与两个参考项目一致：
 *   1. GET 目标站点的受保护地址，被 302 带到 zjuam.zju.edu.cn/cas/login?service=...
 *   2. 从登录页取 execution 与表单 action
 *   3. GET /cas/v2/getPubKey 取 RSA 公钥（modulus / exponent，十六进制）
 *   4. 用纯 BigInt 做 RSA 加密（等价于学校 security.js），只提交
 *      username / password / authcode / execution / _eventId 五个字段
 *   5. 检查最终地址是否仍停在 /cas/login
 *
 * 密码明文只出现在本文件的加密函数参数里，不写日志、不返回、不进工具输出。
 */
import { CookieJar, request } from './http.js';

export const ZJUAM = 'https://zjuam.zju.edu.cn';

/** 大数模幂（平方-乘）。 */
function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

/**
 * 用学校下发的 RSA 公钥加密密码，返回十六进制密文。
 * @param {string} password
 * @param {string} modulusHex
 * @param {string} exponentHex
 * @returns {string}
 */
export function encryptPassword(password, modulusHex, exponentHex) {
  const n = BigInt(`0x${modulusHex}`);
  const e = BigInt(`0x${exponentHex}`);
  const bytes = Buffer.from(password, 'utf8');
  if (bytes.length === 0) throw new Error('密码为空');
  const message = BigInt(`0x${bytes.toString('hex')}`);
  return modPow(message, e, n).toString(16);
}

/** 从 CAS 登录页里取 execution。 */
function parseExecution(html) {
  const patterns = [
    /name="execution"[^>]*value="([^"]*)"/i,
    /value="([^"]*)"[^>]*name="execution"/i,
    /name='execution'[^>]*value='([^']*)'/i,
  ];
  for (const re of patterns) {
    const match = re.exec(html);
    if (match) return match[1];
  }
  return null;
}

/** 从登录页里取表单提交地址。 */
function parseFormAction(html, landingUrl) {
  const patterns = [
    /<form[^>]*id="fm1"[^>]*action="([^"]*)"/i,
    /<form[^>]*action="([^"]*)"/i,
  ];
  for (const re of patterns) {
    const match = re.exec(html);
    if (match) {
      const raw = match[1].replace(/&amp;/g, '&');
      return new URL(raw, landingUrl).toString();
    }
  }
  return landingUrl;
}

/**
 * 完成一次 CAS 登录，返回带会话 Cookie 的 jar。
 *
 * @param {object} options
 * @param {string} options.landingUrl 受保护站点入口，会被重定向到 CAS
 * @param {string} options.username 学号
 * @param {string} options.password 密码
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ jar: CookieJar, finalUrl: string, landedOnCas: boolean }>}
 */
export async function casLogin({ landingUrl, username, password, timeoutMs = 20000 }) {
  if (!username || !password) {
    throw new Error('未配置浙大账号：请设置环境变量 ZJU_USER / ZJU_PASS，或写入 $DSH_HOME/.env');
  }

  const jar = new CookieJar();
  const landing = await request(jar, landingUrl, {}, { follow: true, timeoutMs });
  let html = await landing.text();
  let landingFinal = landing.url;

  // 已在登录态：没有落到 CAS 登录页就不用提交表单。
  if (!/\/cas\/login/i.test(landingFinal)) {
    return { jar, finalUrl: landingFinal, landedOnCas: false };
  }

  let execution = parseExecution(html);
  if (!execution) {
    // 有些入口会先给一个中间页，再跳 CAS；重试一次入口。
    const retry = await request(jar, landingUrl, {}, { follow: true, timeoutMs });
    html = await retry.text();
    landingFinal = retry.url;
    execution = parseExecution(html);
  }
  if (!execution) throw new Error('未能从 ZJUAM 登录页解析 execution（页面结构可能变化）');

  const keyRes = await request(jar, `${ZJUAM}/cas/v2/getPubKey`, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs });
  if (!keyRes.res.ok) throw new Error(`获取 ZJUAM 公钥失败（HTTP ${keyRes.res.status}）`);
  const key = await keyRes.res.json();
  if (!key?.modulus || !key?.exponent) throw new Error('ZJUAM 公钥响应缺少 modulus/exponent');

  const encrypted = encryptPassword(password, key.modulus, key.exponent);
  const form = new URLSearchParams({
    username,
    password: encrypted,
    authcode: '',
    execution,
    _eventId: 'submit',
  });

  const postUrl = parseFormAction(html, landingFinal);
  const posted = await request(
    jar,
    postUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: landingFinal,
        Origin: ZJUAM,
      },
      body: form.toString(),
    },
    { follow: true, timeoutMs },
  );

  if (/\/cas\/login/i.test(posted.url)) {
    throw new Error(
      '登录失败：ZJUAM 仍停在登录页。常见原因：① 账号或密码错误；② 短时间内重复登录触发了风控或验证码；③ 账号需要二次验证。' +
        '请先在浏览器里打开 https://zjuam.zju.edu.cn/cas/login 确认能正常登录；若提示验证码，处理完等几分钟再试。',
    );
  }

  return { jar, finalUrl: posted.url, landedOnCas: true };
}
