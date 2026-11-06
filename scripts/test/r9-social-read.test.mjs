// R9-3：social-read 7 条只读路由 + 未命中不写响应 + 未搬路由回落
import fs from 'node:fs';
import { createRouter } from '../../src/console/http.js';
import { registerSocialRead } from '../../src/console/routes/social-read.js';

function mockRes() {
  const r = { code: 0, body: '' };
  r.writeHead = (code) => { r.code = code; };
  r.setHeader = () => {};
  r.end = (b) => { r.body = String(b ?? ''); };
  return r;
}

const sendJson = (obj, code = 200) => {
  globalThis.__out = { code, obj };
};

const deps = {
  sendJson,
  getCfg: () => ({ ownerQQ: 3160624852, consoleToken: 'CT', biliBridge: { enabled: true, dynamics: { groups: ['g1'] }, share: { groups: [] } }, allow: { groups: ['g0'] } }),
  readToolLog: (limit) => [{ at: 1, tool: 'qq_status', limit }],
  ownerAudit: { readTail: (limit) => [{ at: 2, limit }], health: { ok: true }, path: '/tmp/audit.jsonl' },
  biliMemory: { status: () => ({ briefChars: 10 }) },
  getBiliDynamics: () => null,
  getBiliShare: () => ({ status: () => ({ enabled: true }) }),
  getSessionsMap: () => ({ 'private:3160624852': 's1', 'group:1': 's2' }),
  getPending: () => new Map([
    ['k1', { kind: 'approval', sessionId: 's1', toolName: 'bash', reason: 'r', approvalId: 'a1' }],
    ['k2', { kind: 'question', sessionId: 's2', questions: [{ q: '?' }] }],
  ]),
  getSocialV2: () => ({ conversations: new Map([['group:1', { wakeConfig: { noActionCount: 2 }, unread: [1, 2], recentMessages: [1], lastWakeReason: 'message', lastAiReplyAt: 99 }]]) }),
  buildPlugins: () => ({ ok: true, count: 37 }),
  isLiveAgentToken: () => false,
};

const router = createRouter({ log: () => {} });
registerSocialRead(router, deps);

async function call(path, headers = {}, method = 'GET') {
  const res = mockRes();
  const req = { method, url: path, headers, socket: { remoteAddress: '10.0.0.9' } };
  globalThis.__out = null;
  const matched = await router.handle(req, res);
  return { matched, res, out: globalThis.__out };
}

const fails = [];
const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 200) : '')); };

let r = await call('/api/socialV2/tool-log?limit=5');
check('tool-log 命中', r.matched === true);
check('tool-log 形状', r.out?.obj?.ok === true && r.out.obj.entries[0].limit === 5, r.out);

r = await call('/api/owner-audit?limit=3');
check('owner-audit 形状', r.out?.obj?.entries?.[0]?.limit === 3 && r.out.obj.path === '/tmp/audit.jsonl', r.out);

r = await call('/api/bili/status');
check('bili enabled', r.out?.obj?.enabled === true);
check('bili dynamics 缺省', JSON.stringify(r.out.obj.dynamics) === '{"enabled":false}', r.out.obj.dynamics);
check('bili share 正常', r.out.obj.share.enabled === true);
check('bili groups', JSON.stringify(r.out.obj.groups) === '{"allow":["g0"],"dynamics":["g1"],"share":[]}', r.out.obj.groups);

r = await call('/api/sessions');
check('sessions 两条', r.out?.obj?.sessions?.length === 2);
check('sessions owner 标记', r.out.obj.sessions.find((x) => x.key === 'private:3160624852')?.owner === true);

r = await call('/api/pending');
check('pending 两条', r.out?.obj?.pending?.length === 2);
check('pending approval 字段', r.out.obj.pending[0].toolName === 'bash' && r.out.obj.pending[0].approvalId === 'a1', r.out.obj.pending[0]);
check('pending question 字段', Array.isArray(r.out.obj.pending[1].questions) && r.out.obj.pending[1].toolName === undefined, r.out.obj.pending[1]);

r = await call('/api/socialV2/states');
check('states 一条', r.out?.obj?.conversations?.length === 1);
check('states 字段', JSON.stringify(r.out.obj.conversations[0]) === JSON.stringify({ key: 'group:1', wakeConfig: { noActionCount: 2 }, unreadCount: 2, recentCount: 1, lastWakeReason: 'message', lastAiReplyAt: 99, noActionCount: 2 }), r.out.obj.conversations[0]);

r = await call('/api/plugins', {});
check('plugins 未授权 403', r.out?.code === 403 && r.out.obj.error === 'agent token 无效', r.out);

const deps2 = { ...deps, isLiveAgentToken: () => true };
const router2 = createRouter({ log: () => {} });
registerSocialRead(router2, deps2);
const res2 = mockRes();
globalThis.__out = null;
await router2.handle({ method: 'GET', url: '/api/plugins', headers: {}, socket: { remoteAddress: '10.0.0.9' } }, res2);
check('plugins 授权 200', globalThis.__out?.obj?.count === 37, globalThis.__out);

// 未命中不写响应
const missRes = mockRes();
const missMatched = await router.handle({ method: 'GET', url: '/api/not-here', headers: {}, socket: {} }, missRes);
check('未命中回落', missMatched === false);
check('未命中不写响应', missRes.code === 0 && missRes.body === '', { code: missRes.code, body: missRes.body });

// 未搬走的 /api/socialV2/mood 必须落到原链（router 返回 false 且不写）
const moodRes = mockRes();
const moodMatched = await router.handle({ method: 'GET', url: '/api/socialV2/mood', headers: {}, socket: {} }, moodRes);
check('mood 走原链', moodMatched === false);
check('mood 响应未被写', moodRes.code === 0 && moodRes.body === '', { code: moodRes.code, body: moodRes.body });

// 静态：bridge 里 mood / style-list 分支仍在，plugins 分支已搬走
const br = fs.readFileSync('/home/dsh/apps/surfcore/src/bridge.js', 'utf8');
check('bridge 仍有 mood 分支', br.includes("url.pathname === '/api/socialV2/mood'"));
check('bridge 仍有 style-list 分支', br.includes("url.pathname === '/api/socialV2/style-list'"));
check('bridge 不再有 plugins 分支', !br.includes("url.pathname === '/api/plugins'"));
check('bridge 有 7 个 R9-3 marker', (br.match(/moved to src\/console\/routes\/social-read\.js \(R9-3\)/g) || []).length === 7, (br.match(/R9-3/g) || []).length);

if (fails.length) {
  console.error('R9_SOCIAL_READ_FAIL\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('R9_SOCIAL_READ_OK routes=' + router.routes().length);
