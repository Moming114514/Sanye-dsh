// R9-4：session-detail 7 条只读路由 + 未命中不写 + 依赖缺失 + marker 校验
import fs from 'node:fs';
import { createRouter } from '../../src/console/http.js';
import { registerSessionDetail } from '../../src/console/routes/session-detail.js';

function mockRes() {
  const r = { code: 0, body: '', writes: 0, headersSent: false, headers: {} };
  r.writeHead = (code, headers) => { r.code = code; r.headers = headers || {}; r.headersSent = true; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.writes += 1; r.body = String(b ?? ''); r.headersSent = true; };
  return r;
}

const st = {
  wakeConfig: { noActionCount: 1 },
  unread: [{ seq: 1 }, { seq: 2 }],
  recentMessages: [
    { userId: 11, sender: 'A', time: 5, isOwner: true },
    { userId: 22, sender: 'B', time: 6 },
    { isSelf: true, sender: '她' },
    { sender: 'C', time: 4 },
  ],
  activeTopics: [{ t: 1 }],
  pendingThoughts: [],
  memberImpressions: { 11: { x: 1 } },
  lastWakeReason: 'message',
  lastAiReplyAt: 99,
  closure: { noActionCount: 0 },
};

const deps = {
  getCfg: () => ({ socialV2: { snapshot: { unread: 3 } } }),
  getSocialV2: () => st,
  formatMemoryV2: (v) => 'MEM:' + v.activeTopics.length + ':' + Object.keys(v.memberImpressions).length,
  computeWakeSafetyV2: (wc) => ({ guaranteed: false, echo: wc }),
  assessClosureV2: () => ({ verdict: 'continue', score: 3, reasons: ['r1'] }),
  closureStatus: () => ({ closed: false }),
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

let r = await call('/api/socialV2/active-members?key=group:1&limit=2');
check('active-members 命中', r.matched === true);
check('active-members 形状', r.body?.ok === true && r.body.members.length === 2 && !r.body.members.some((m) => m.sender === '她'), r.body);

r = await call('/api/socialV2/memory?key=group:1');
check('memory 形状', r.body?.ok === true && r.body.formatted === 'MEM:1:1', r.body);

r = await call('/api/socialV2/state?key=group:1');
check('state 形状', r.body?.ok === true && r.body.unreadCount === 2 && r.body.recentCount === 4, r.body);
check('state closure', r.body?.closureAssessment?.verdict === 'continue' && r.body.closure?.closed === false, r.body);

r = await call('/api/socialV2/snapshot?key=group:1&include=unread,recent&afterSeq=7');
check('snapshot 形状', r.body?.ok === true && r.body.afterSeq === 7 && JSON.stringify(r.body.include) === '["unread","recent"]', r.body);

r = await call('/api/bili/prompt-preview?text=hi');
check('bili preview', r.body?.ok === true && r.body.briefChars === 10 && r.body.recall.hit === 'hi' && r.body.roleHint === 'ROLE', r.body);

r = await call('/api/presets');
check('presets 形状', JSON.stringify(r.body?.presets) === '[{"id":"p1","trust":"system"},{"id":"p2","trust":"user"}]', r.body);

r = await call('/api/preset/sim-prompt/backups?preset=v1');
check('backups 形状', r.body?.ok === true && r.body.backups[0].file === 'qq-chat.bak', r.body);
r = await call('/api/preset/sim-prompt/backups?preset=nope');
check('backups 未知预设 400', r.res.code === 400 && r.body?.ok === false, r.body);

// agent token 三连
r = await call('/api/socialV2/state?key=group:1', { 'x-agent-token': 'bad' });
check('bad agent token 403', r.res.code === 403 && r.body?.error === 'agent token 无效', r.body);
r = await call('/api/socialV2/state?key=group:1', { 'x-agent-token': 'good' });
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
