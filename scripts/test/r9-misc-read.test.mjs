// R9-5：misc-read 7 条只读路由，fixture 来自 config.json + state/slang.json
import fs from 'node:fs';
import { createRouter } from '../../src/console/http.js';
import { registerMiscRead } from '../../src/console/routes/misc-read.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/console-read-sample.json', import.meta.url), 'utf8'));
const P = fixture.present;

function mockRes() {
  const r = { code: 0, body: '', writes: 0, headersSent: false, headers: {} };
  r.writeHead = (code, headers) => { r.code = code; r.headers = headers || {}; r.headersSent = true; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.writes += 1; r.body = String(b ?? ''); r.headersSent = true; };
  return r;
}

function makeRouter(kind) {
  const present = kind === 'present';
  const cfg = present ? { allow: P.allow, deny: P.deny, ownerQQ: P.ownerQQ, security: P.security, socialV2: P.socialV2, social: P.social, slang: P.slang } : {};
  const social = present
    ? { pendingSummaries: new Map([['k1', { items: [1, 2] }]]), states: new Map([['k1', { phase: 'chat' }], ['k2', { phase: 'idle' }]]), recentMessages: new Map([['k2', []]]) }
    : {};
  const deps = {
    getCfg: () => cfg,
    getStateDirHardened: () => present,
    stateDir: '/tmp/state',
    manualDirCommand: (p) => 'icacls ' + p,
    getSocialV2Root: () => (present ? { paused: false } : {}),
    readFeedbackEntries: () => (present ? [{ id: 'f1', message: 'x' }] : []),
    getSlangEntries: () => (present ? P.slangEntries : []),
    getSlangWritable: () => true,
    getSocial: () => social,
  };
  const router = createRouter({ log: () => {} });
  registerMiscRead(router, deps);
  return router;
}

const R = { present: makeRouter('present'), missing: makeRouter('missing') };

async function call(router, path, headers = {}, method = 'GET') {
  const res = mockRes();
  const req = { method, url: path, headers, socket: { remoteAddress: '10.0.0.9' } };
  const matched = await router.handle(req, res);
  let body = null;
  try { body = res.body ? JSON.parse(res.body) : null; } catch {}
  return { matched, res, body };
}

const fails = [];
const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 200) : '')); };

// present
let r = await call(R.present, '/api/whitelist');
check('whitelist present', r.res.code === 200 && r.body.allow.groups.length === P.allow.groups.length && r.body.ownerQQ === P.ownerQQ, r.body);

r = await call(R.present, '/api/security');
check('security present', r.res.code === 200 && r.body.security.interceptNotify === P.security.interceptNotify && r.body.stateDir.hardened === true && /tmp\/state/.test(r.body.stateDir.path), r.body);

r = await call(R.present, '/api/socialV2/config');
check('config present', r.res.code === 200 && r.body.ok === true && typeof r.body.config === 'object', r.body);

r = await call(R.present, '/api/socialV2/activity');
check('activity present', r.res.code === 200 && r.body.paused === false, r.body);

r = await call(R.present, '/api/socialV2/feedback');
check('feedback present', r.res.code === 200 && r.body.entries.length === 1, r.body);

r = await call(R.present, '/api/slang');
check('slang present', r.res.code === 200 && r.body.entries.length === P.slangEntries.length && r.body.writable === true && r.body.config.enabled === P.slang.enabled, r.body);

r = await call(R.present, '/api/social');
check('social present', r.res.code === 200 && r.body.pendingSummaries.k1 === 2 && r.body.states.k1.phase === 'chat' && r.body.states.k2.phase === 'idle', r.body);

// missing（字段全缺，必须兜底不 500）
r = await call(R.missing, '/api/whitelist');
check('whitelist missing', r.res.code === 200 && Array.isArray(r.body.allow.groups) && r.body.ownerQQ === null, r.body);
r = await call(R.missing, '/api/security');
check('security missing', r.res.code === 200 && r.body.security.interceptNotify === true && r.body.stateDir.hardened === false, r.body);
r = await call(R.missing, '/api/socialV2/config');
check('config missing', r.res.code === 200 && JSON.stringify(r.body.config) === '{}', r.body);
r = await call(R.missing, '/api/socialV2/activity');
check('activity missing', r.res.code === 200 && r.body.paused === false, r.body);
r = await call(R.missing, '/api/socialV2/feedback');
check('feedback missing', r.res.code === 200 && Array.isArray(r.body.entries) && r.body.entries.length === 0, r.body);
r = await call(R.missing, '/api/slang?status=vivid');
check('slang missing', r.res.code === 200 && r.body.entries.length === 0, r.body);
r = await call(R.missing, '/api/social');
check('social missing', r.res.code === 200 && JSON.stringify(r.body.pendingSummaries) === '{}' && JSON.stringify(r.body.states) === '{}', r.body);

// 未命中不写
r = await call(R.present, '/api/socialV2/mood');
check('未命中不写', r.matched === false && r.res.code === 0 && r.res.body === '', { code: r.res.code, body: r.res.body });

// 依赖缺失注册期抛错
let threw = false;
try { registerMiscRead(createRouter({ log: () => {} }), { getCfg: () => ({}) }); } catch (e) { threw = /依赖缺失/.test(String(e.message)); }
check('依赖缺失抛错', threw);

// marker 与未搬分支
const src = fs.readFileSync(new URL('../../src/bridge.js', import.meta.url), 'utf8');
const markers = (src.match(/\/\/ moved to src\/console\/routes\/misc-read\.js \(R9-5\)/g) || []).length;
check('marker=7', markers === 7, markers);
check('purpose/status 已在 R9-6 搬走', !src.includes("url.pathname === '/api/purpose/status'"));
check('unread 已在 R9-6 搬走', !src.includes("url.pathname === '/api/socialV2/unread'"));

if (fails.length) {
  console.error('R9_MISC_READ_FAIL');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('R9_MISC_READ_OK routes=7');
