// R9-3 修复：http.js 的 handle() 契约四条断言
// 未命中=不写；命中正常=写一次并 return true；命中但 handler 抛错=只写一次 500 并 return true；
// 先写成功再抛错=保持第一次响应，不写第二遍。
import { createRouter } from '../../src/console/http.js';

function mockRes() {
  const r = { code: 0, body: '', writes: 0, headersSent: false, headers: {} };
  Object.defineProperty(r, 'statusCode', {
    get: () => r.code,
    set: (v) => { r.code = v; },
  });
  r.writeHead = (code, headers) => {
    r.code = code;
    r.headers = headers || {};
    r.headersSent = true;
  };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => {
    if (r.writes === 0) r.writes = 1; else r.writes += 1;
    r.body = String(b ?? '');
    r.headersSent = true;
  };
  return r;
}

const fails = [];
const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 200) : '')); };

const router = createRouter({ log: () => {} });
router.register('/api/ok', ['GET'], async (req, res, ctx) => {
  ctx.json(200, { ok: true });
});
router.register('/api/boom', ['GET'], async () => {
  throw new Error('boom');
});
router.register('/api/boom-after-write', ['GET'], async (req, res, ctx) => {
  ctx.json(200, { ok: true });
  throw new Error('after write');
});

// 1) 未命中：不写
{
  const res = mockRes();
  const matched = await router.handle({ method: 'GET', url: '/api/miss', headers: {}, socket: {} }, res);
  check('未命中返回 false', matched === false);
  check('未命中不写响应', res.writes === 0 && res.code === 0 && res.body === '', { writes: res.writes, code: res.code, body: res.body });
}

// 2) 命中且正常：写一次 200 并返回 true
{
  const res = mockRes();
  const matched = await router.handle({ method: 'GET', url: '/api/ok', headers: {}, socket: {} }, res);
  check('正常返回 true', matched === true);
  check('正常只写一次', res.writes === 1, res.writes);
  check('正常 200', res.code === 200, res.code);
}

// 3) 命中但 handler 抛错：只写一次 500，且 handle 返回 true（异常不冒泡）
{
  const res = mockRes();
  let threw = false;
  let matched = null;
  try {
    matched = await router.handle({ method: 'GET', url: '/api/boom', headers: {}, socket: {} }, res);
  } catch {
    threw = true;
  }
  check('抛错不冒泡', threw === false);
  check('抛错返回 true', matched === true);
  check('抛错只写一次', res.writes === 1, res.writes);
  check('抛错写 500', res.code === 500, res.code);
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch {}
  check('抛错是 JSON', parsed && parsed.ok === false, res.body);
}

// 4) handler 先写成功再抛错：不能写第二遍
{
  const res = mockRes();
  const matched = await router.handle({ method: 'GET', url: '/api/boom-after-write', headers: {}, socket: {} }, res);
  check('先写后抛 返回 true', matched === true);
  check('先写后抛 只写一次', res.writes === 1, res.writes);
  check('先写后抛 保留 200', res.code === 200, res.code);
}

if (fails.length) {
  console.error('R9_HTTP_CONTRACT_FAIL\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('R9_HTTP_CONTRACT_OK');
