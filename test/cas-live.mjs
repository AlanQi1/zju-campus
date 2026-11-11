/**
 * 真实链路验证：走一遍 ZJUAM CAS 登录表单（用一个不存在的学号，验证解析/加密/提交/判定），
 * 预期结果是「停在登录页 → 判定失败」，这恰好证明前面每一步都成功了。
 * 不使用、也不索取任何真实账号。
 */
import { casLogin } from '../src/zjuam.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

try {
  const result = await casLogin({
    landingUrl: 'https://courses.zju.edu.cn/login',
    username: '0000000000',
    password: 'not-a-real-password',
    timeoutMs: 25000,
  });
  check('CAS 登录应被拒绝', false, `意外成功，finalUrl=${result.finalUrl}`);
} catch (error) {
  const message = String(error.message || error);
  // 只有「解析 execution / 取公钥 / 提交表单」都成功，才会走到这条判定
  check('CAS 链路走通并正确判定失败', /停在登录页|登录失败/.test(message), message);
}

// 智云课堂入口同样应落到 CAS
try {
  await casLogin({
    landingUrl: 'https://tgmedia.cmc.zju.edu.cn/',
    username: '0000000000',
    password: 'not-a-real-password',
    timeoutMs: 25000,
  });
  check('CMC 登录应被拒绝', false, '意外成功');
} catch (error) {
  const message = String(error.message || error);
  check('CMC CAS 链路走通', /停在登录页|登录失败|未取到 JWTUser/.test(message), message);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
