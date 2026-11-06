// R9-4 修复版：session-detail 7 条只读路由，fixture 用 state/social-v2.json 的真实 conversation
import fs from 'node:fs';
import { createRouter } from '../../src/console/http.js';
import { registerSessionDetail } from '../../src/console/routes/session-detail.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/social-v2-sample.json', import.meta.url), 'utf8'));
const FULL = fixture.full;
const MISSING = fixture.missingArrays;

function mockRes() {
  const r = { code: 0, body: '', writes: 0, headersSent: false, headers: {} };
  r.writeHead = (code, headers) => { r.code = code; r.headers = headers || {}; r.headersSent = true; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.writes += 1; r.body = String(b ?? ''); r.headersSent = true; };
  return r;
}

const deps = {
  getCfg: () => ({ socialV2: { snapshot: { unread: 3 } } }),
  getSocialV2: (key) => (String(key).includes('missing') ? MISSING : FULL),
  formatMemoryV2: (v) => 'MEM:' + (v.activeTopics ?? []).length,
  computeWakeSafetyV2: () => ({ guaranteed: false }),
  assessClosureV2: () => ({ verdict: 'continue', score: 3, reasons: ['r1'] }),
  closureStatus: (rec) => (rec && rec.at ? { at: rec.at, closed: false } : null),
  buildContextSnapshot: (a) => ({ ok: true, key: a.key, afterSeq: a.afterSeq, include: a.include }),
  biliMemory: { briefBlock: () => 'x'.repeat(10), recallBlock: (t) => ({ hit: t }) },
  currentRoleHint: () => 'ROLE',
  api: { agentPresets: { list: async () => ({ presets: [{ id: 'p1' }, { id: 'p2', trust: 'user' }] }) } },
  unwrap: (v) => v,
  knownPresetName: (x) => (x === 'v1' ? 'qq-chat' : null),
  presetNames: { v1: 'qq-chat' },
  listPresetBackups: (p) => [{ file: p + '.bak' }],
  agentTokenOk: (k, t) => t === 'good',
  v2SessionAllowed: () => true,
  v2ToolEnabled: () => true,
};

const router = createRouter({ log: () => {} });
registerSessionDetail(router, deps);

async function call(path, headers = {}, method = 'GET') {
  const res = mockRes();
  const req = { method, url: path, headers, socket: { remoteAddress: '10.0.0.9' } };
  const matched = await router.handle(req, res);
  let body = null;
  try { body = res.body ? JSON.parse(res.body) : null; } catch {}
  return { matched, res, body };
}

const fails = [];
const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 200) : '')); };

// 有 recentMessages/unread（真实数据）
let r = await call('/api/socialV2/active-members?key=group:680787260&limit=5');
check('active-members full 200', r.res.code === 200 && r.body?.ok === true, r.body);
check('active-members full 非空', Array.isArray(r.body?.members) && r.body.members.length > 0, r.body);

r = await call('/api/socialV2/state?key=group:680787260');
check('state full 200', r.res.code === 200 && r.body?.ok === true, r.body);
check('state full 计数', r.body?.unreadCount === FULL.unread.length && r.body?.recentCount === FULL.recentMessages.length, r.body);

// 缺 recentMessages/unread（同一对象摘掉两个字段）
r = await call('/api/socialV2/active-members?key=group:missing');
check('active-members missing 200', r.res.code === 200 && r.body?.ok === true, r.body);
check('active-members missing 空数组', Array.isArray(r.body?.members) && r.body.members.length === 0, r.body);

r = await call('/api/socialV2/state?key=group:missing');
check('state missing 200', r.res.code === 200 && r.body?.ok === true, r.body);
check('state missing 计数为 0', r.body?.unreadCount === 0 && r.body?.recentCount === 0, r.body);

r = await call('/api/socialV2/memory?key=group:missing');
check('memory missing 200', r.res.code === 200 && r.body?.ok === true, r.body);

r = await call('/api/socialV2/snapshot?key=group:missing&include=unread&afterSeq=2');
check('snapshot missing 200', r.res.code === 200 && r.body?.ok === true, r.body);

// 其余三条
r = await call('/api/bili/prompt-preview?text=hi');
check('bili preview', r.res.code === 200 && r.body?.briefChars === 10 && r.body.recall.hit === 'hi', r.body);
r = await call('/api/presets');
check('presets 形状', JSON.stringify(r.body?.presets) === '[{"id":"p1","trust":"system"},{"id":"p2","trust":"user"}]', r.body);
r = await call('/api/preset/sim-prompt/backups?preset=v1');
check('backups 形状', r.body?.ok === true && r.body.backups[0].file === 'qq-chat.bak', r.body);
r = await call('/api/preset/sim-prompt/backups?preset=nope');
check('backups 未知预设 400', r.res.code === 400 && r.body?.ok === false, r.body);

// agent token 三连
r = await call('/api/socialV2/state?key=group:680787260', { 'x-agent-token': 'bad' });
check('bad agent token 403', r.res.code === 403 && r.body?.error === 'agent token 无效', r.body);
r = await call('/api/socialV2/state?key=group:680787260', { 'x-agent-token': 'good' });
check('good agent token 200', r.res.code === 200 && r.body?.ok === true, r.body);

// 未命中不写
r = await call('/api/socialV2/mood');
check('未命中不写', r.matched === false && r.res.code === 0 && r.res.body === '', { code: r.res.code, body: r.res.body });

// 依赖缺失注册期抛错
let threw = false;
try { registerSessionDetail(createRouter({ log: () => {} }), { ...deps, getSocialV2: null }); } catch (e) { threw = /依赖缺失/.test(String(e.message)); }
check('依赖缺失抛错', threw);

// marker 与未搬分支
const src = fs.readFileSync(new URL('../../src/bridge.js', import.meta.url), 'utf8');
const markers = (src.match(/\/\/ moved to src\/console\/routes\/session-detail\.js \(R9-4\)/g) || []).length;
check('marker=7', markers === 7, markers);
check('mood 分支仍在', src.includes("url.pathname === '/api/socialV2/mood'"));
check('style-list 分支仍在', src.includes("url.pathname === '/api/socialV2/style-list'"));

if (fails.length) {
  console.error('R9_SESSION_DETAIL_FAIL');
  for (const f of fails) console.error(' - ' + f);
  process.exit(1);
}
console.log('R9_SESSION_DETAIL_OK routes=7');
