// R9-1：tokens/status 路由搬出后，用假 deps 断言响应形状与状态码。
import { createRouter } from '../../src/console/http.js';
import { registerTokens } from '../../src/console/routes/tokens.js';

function mockRes() {
  const r = { code: 0, headers: {}, body: '' };
  r.writeHead = (code, headers) => { r.code = code; r.headers = headers || {}; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = String(b ?? ''); };
  return r;
}

const deps = {
  status: {
    root: '/r',
    cfg: { dsh: { baseUrl: 'http://127.0.0.1:3080' }, ownerQQ: 3160624852, allow: { groups: ['g1'], private: [] }, purpose: { enabled: false } },
    getMode: () => 'chat',
    readRoleState: () => ({ role: 'r1', mode: 'active' }),
    getDshReady: () => true,
    getSocialV2: () => ({ paused: false, conversations: new Map() }),
    getClosedAgentPreset: () => null,
    getOwnerAudit: () => ({ health: { ok: true } }),
    getPurposeState: () => ({}),
    summarizePurposeState: () => ({ state: 'off' }),
    closureConfigV2: () => ({ enabled: false }),
    assessClosureV2: () => null,
    getSocialV2State: () => ({}),
    closureStatus: () => ({}),
    snowlumaHealthSnapshot: () => ({ ok: true }),
    readActivityTail: () => [],
  },
  tokens: {
    ledger: {
      summary: ({ limit }) => ({ ok: true, limit }),
      stats: () => ({ entries: 1 }),
      series: () => ({ ok: true, series: [] }),
      conversation: () => null,
      recent: () => [],
    },
    dailyUsage: () => ({ qq: 1 }),
    budgetLimits: () => ({ qq: 8 }),
    evaluateBudget: () => ({ blocked: false, hits: [] }),
    localDayStart: () => 'D0',
    priceSymbol: '$',
  },
};

const router = createRouter({ log: () => {} });
registerTokens(router, deps);

async function call(path, headers = {}, method = 'GET') {
  const res = mockRes();
  const req = { method, url: path, headers, socket: { remoteAddress: '127.0.0.1' } };
  const matched = await router.handle(req, res);
  return { matched, res, body: res.body ? JSON.parse(res.body) : null };
}

const fails = [];
const check = (name, cond, extra) => { if (!cond) fails.push(name + (extra ? ' :: ' + JSON.stringify(extra).slice(0, 160) : '')); };

const st = await call('/api/status');
check('status 200', st.res.code === 200, st.res.code);
check('status mode', st.body?.mode === 'chat');
check('status root', st.body?.root === '/r');
check('status allowGroups', JSON.stringify(st.body?.allowGroups) === '["g1"]');
check('status purpose.enabled', st.body?.purpose?.enabled === false);
check('status closure.enabled', st.body?.closure?.enabled === false);

const stAgent = await call('/api/status', { 'x-agent-token': 't' });
check('agent status 200', stAgent.res.code === 200);
check('agent status 无管理字段', stAgent.body && stAgent.body.root === undefined && stAgent.body.ownerQQ === undefined, stAgent.body);
check('agent status 字段数=5', stAgent.body && Object.keys(stAgent.body).length === 5, stAgent.body && Object.keys(stAgent.body));

const daily = await call('/api/tokens/daily');
check('daily 200', daily.res.code === 200);
check('daily ok', daily.body?.ok === true);
check('daily cutoff', daily.body?.cutoff === 'D0');

const dailyAgent = await call('/api/tokens/daily', { 'x-agent-token': 't' });
check('daily agent 403', dailyAgent.res.code === 403, dailyAgent.res.code);
check('daily agent 文案', dailyAgent.body?.error === '该接口仅控制台可用', dailyAgent.body);

const turns = await call('/api/tokens/turns?key=x');
check('turns 404', turns.res.code === 404, turns.res.code);

const miss = await call('/api/nope');
check('未命中回落', miss.matched === false);

if (fails.length) {
  console.error('R9_TOKENS_FAIL\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('R9_TOKENS_OK routes=' + router.routes().length);
