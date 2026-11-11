/**
 * 诊断智云课堂 CAS 登录链路：打印每一跳的状态与最终页面特征（不含凭据）。
 */
import { CookieJar, request } from '../src/http.js';
import { ZJUAM, encryptPassword } from '../src/zjuam.js';
import { resolveCredentials } from '../src/session.js';

const c = resolveCredentials({});
const jar = new CookieJar();

const log = (label, res, extra = '') => {
  const loc = res.res.headers.get('location');
  console.log(`${label}: HTTP ${res.res.status}${loc ? ` → ${loc.slice(0, 160)}` : ''}${extra ? ` | ${extra}` : ''}`);
};

// 1. 入口
const landing = await request(jar, 'https://tgmedia.cmc.zju.edu.cn/', {}, { follow: true, timeoutMs: 25000 });
log('① GET tgmedia', landing, `final=${landing.url.slice(0, 120)}`);
const html = await landing.text();
console.log('   含 execution:', /name="execution"/i.test(html), '| 含验证码:', /验证码|captcha|authcode.*img/i.test(html));

const execution = /name="execution"[^>]*value="([^"]*)"/i.exec(html)?.[1];
console.log('   execution 长度:', execution ? execution.length : 0);

// 2. 公钥
const keyRes = await request(jar, `${ZJUAM}/cas/v2/getPubKey`, { headers: { Accept: 'application/json' } }, { follow: false, timeoutMs: 25000 });
log('② getPubKey', keyRes);
const key = await keyRes.res.json();

// 3. 提交
const form = new URLSearchParams({
  username: c.username,
  password: encryptPassword(c.password, key.modulus, key.exponent),
  authcode: '',
  execution: execution || '',
  _eventId: 'submit',
});
const action = /<form[^>]*id="fm1"[^>]*action="([^"]*)"/i.exec(html)?.[1] || landing.url;
const postUrl = new URL(action.replace(/&amp;/g, '&'), landing.url).toString();
console.log('③ POST →', postUrl.slice(0, 120));

const posted = await request(jar, postUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: landing.url, Origin: ZJUAM },
  body: form.toString(),
}, { follow: true, timeoutMs: 25000 });
log('④ 提交结果', posted, `final=${posted.url.slice(0, 160)}`);

const page = await posted.text();
const title = /<title>([\s\S]*?)<\/title>/i.exec(page)?.[1]?.trim() || '(无标题)';
console.log('   页面标题:', title);
console.log('   仍含登录表单:', /name="execution"/i.test(page), '| 含错误提示:', /用户名或密码错误|密码错误|账号或密码/.test(page));
console.log('   含 JWTUser cookie:', jar.value('JWTUser') ? '是' : '否');
