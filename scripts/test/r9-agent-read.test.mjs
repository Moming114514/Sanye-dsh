// R9-6 单测：agent-read 7 条路由形状、403、副作用次数、依赖缺失
import { registerAgentRead } from '../../src/console/routes/agent-read.js';

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) { failed += 1; console.error('FAIL', name, extra); }
  else console.log('ok', name);
};

function makeRouter() {
  const map = new Map();
  return {
    register(path, methods, fn) { map.set(path, { methods, fn }); },
    call(path, { method = 'GET', query = {}, headers = {} } = {}) {
      const entry = map.get(path);
      if (!entry) throw new Error('route not found ' + path);
      const res = { code: 0, body: '', headersSent: false };
      const ctx = {
        query: new URLSearchParams(query),
        json(code, obj) { res.code = code; res.body = JSON.stringify(obj); res.json = obj; res.headersSent = true; },
      };
      return entry.fn({ method, headers }, res, ctx).then(() => res);
    },
  };
}

const conv = {
  recentMessages: [
    { seq: 1, text: 'a', isSelf: false },
    { seq: 2, text: 'b', isSelf: true },
    { seq: 3, text: 'c', isSelf: false },
  ],
  unread: [
    { seq: 4, text: 'u4' },
    { seq: 5, text: 'u5' },
  ],
  wakeConfig: {},
  closure: null,
};

const calls = { note: 0, read: 0, ensure: 0, build: 0, fetch: 0 };
const deps = {
  getCfg: () => ({ dsh: { provider: 'p', model: 'm', reasoningEffort: 'high' }, slang: { injectMax: 8 }, purpose: { enabled: true } }),
  getSocialV2State: () => conv,
  getMode: () => 'reserved2',
  agentTokenOk: (key, tok) => tok === 'good',
  v2SessionAllowed: () => true,
  v2ToolEnabled: () => true,
  noteModelMessagesV2: () => { calls.note += 1; return 99; },
  readThroughSeqV2: () => { calls.read += 1; return 42; },
  stickerMatchFor: () => ({ emoji: 'x' }),
  resolveReplyInfo: async () => ({ sender: 's', text: 'resolved', userId: '1' }),
  confirmedSlangListV2: () => [{ content: 'yyds', meaning: '永远的神', usage: 'u', example: 'e' }],
  getSlangEntries: () => [{ content: 'yyds' }],
  buildSlangContext: () => { calls.build += 1; return 'BLOCK'; },
  ensurePurposeDay: () => { calls.ensure += 1; },
  getPurposeState: () => ({ day: '2026-11-06' }),
  purposeOwnerId: () => '3160624852',
  adminIdentity: () => ({ displayName: '主人' }),
  summarizePurposeState: () => ({ ok: 1 }),
  getPurposeRun: () => null,
  fetchModelCatalog: async () => { calls.fetch += 1; return { groups: [{ id: 'p', models: [{ id: 'm', reasoning: { efforts: [{ id: 'high', name: '高' }], defaultEffort: 'high' } }] }] }; },
  withTimeout: (p) => p,
  unwrap: (v) => v,
  log: () => {},
  effortOptions: ['low', 'high', 'max'],
  effortDefault: 'high',
  getModelCatalogCache: () => cache,
};
const cache = { inflight: null, errors: new Set() };

const router = makeRouter();
registerAgentRead(router, deps);

// 1 recent（无 token：readThroughSeqV2；有 token：note 调用一次）
const r1 = await router.call('/api/socialV2/recent', { query: { key: 'group:1', limit: 2 } });
ok('recent shape', r1.code === 200 && r1.json.messages.length === 2 && r1.json.readThroughSeq === 42);
const r1b = await router.call('/api/socialV2/recent', { query: { key: 'group:1' }, headers: { 'x-agent-token': 'good' } });
ok('recent note once', r1b.code === 200 && calls.note === 1);

// 2 unread（afterSeq 过滤 + stickerMatch）
const r2 = await router.call('/api/socialV2/unread', { query: { key: 'group:1', afterSeq: '4' } });
ok('unread afterSeq', r2.code === 200 && r2.json.messages.length === 1 && r2.json.messages[0].seq === 5);
ok('unread sticker', r2.json.stickerMatch && r2.json.stickerMatch.emoji === 'x');

// 3 my-recent
const r3 = await router.call('/api/socialV2/my-recent', { query: { key: 'group:1' } });
ok('my-recent only self', r3.code === 200 && r3.json.messages.length === 1 && r3.json.messages[0].isSelf === true);

// 4 slang/query
const r4 = await router.call('/api/socialV2/slang/query', { query: { key: 'group:1', q: 'yyds' } });
ok('slang filter', r4.code === 200 && r4.json.total === 1 && r4.json.block === 'BLOCK' && calls.build === 1);

// 5 message-detail：本地 seq 命中且 messageId 不一致 → 走本地
conv.recentMessages[0].messageId = 'mid-1';
const r5 = await router.call('/api/socialV2/message-detail', { query: { key: 'group:1', messageId: '1' } });
ok('message-detail local', r5.code === 200 && r5.json.info && r5.json.info.messageId === 'mid-1');

// 6 purpose/status（ensurePurposeDay 每请求 1 次）
const r6 = await router.call('/api/purpose/status');
ok('purpose shape', r6.code === 200 && r6.json.ownerUin === '3160624852' && r6.json.running === false);
const r6b = await router.call('/api/purpose/status');
ok('purpose ensure per request', r6b.code === 200 && calls.ensure === 2);

// 7 dsh/model（catalog 命中 → dsh）
const before = calls.fetch;
const r7 = await router.call('/api/dsh/model');
ok('dsh model dsh', r7.code === 200 && r7.json.catalogSource === 'dsh' && r7.json.options[0] === 'high' && calls.fetch === before + 1);

// 8 403
const r8 = await router.call('/api/socialV2/recent', { query: { key: 'group:1' }, headers: { 'x-agent-token': 'bad' } });
ok('agent token 403', r8.code === 403);

// 9 依赖缺失
let threw = false;
try { registerAgentRead(makeRouter(), { ...deps, getCfg: undefined }); } catch { threw = true; }
ok('missing dep throws', threw);

if (failed) { console.error('R9_AGENT_READ_FAIL ' + failed); process.exit(1); }
console.log('R9_AGENT_READ_OK routes=7');
