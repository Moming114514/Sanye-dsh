// R9-7 单测：voice-read 3 条 GET、缺依赖、异常 400
import { registerVoiceRead } from '../../src/console/routes/voice-read.js';

let failed = 0;
const ok = (n, c, e = '') => { if (!c) { failed += 1; console.error('FAIL', n, e); } else console.log('ok', n); };

function makeRouter() {
  const map = new Map();
  return {
    register(p, m, fn) { map.set(p, fn); },
    call(p, { query = {} } = {}) {
      const res = { code: 0, body: '', json: null };
      const ctx = { query: new URLSearchParams(query), json(code, obj) { res.code = code; res.body = JSON.stringify(obj); res.json = obj; } };
      return map.get(p)({ method: 'GET', headers: {} }, res, ctx).then(() => res);
    },
  };
}

const base = {
  list: async () => ({ ok: true, packs: [{ id: 'p1' }], active: 'p1' }),
  cloudStats: async (id) => ({ ok: true, id, files: 3, bytes: 1024 }),
  readCloudConfig: async (id) => ({ ok: true, id, configured: true }),
};
const router = makeRouter();
registerVoiceRead(router, { getVoicePacks: () => base });

const r1 = await router.call('/api/voice/packs');
ok('list shape', r1.code === 200 && r1.json.packs.length === 1);

const r2 = await router.call('/api/voice/packs/cloud-stats');
ok('cloud-stats default id', r2.code === 200 && r2.json.id === 'voice-cloud');

const r3 = await router.call('/api/voice/packs/cloud-config', { query: { id: 'custom' } });
ok('cloud-config id', r3.code === 200 && r3.json.id === 'custom');

const boom = { ...base, list: async () => { throw new Error('disk gone'); } };
const r4 = await (async () => {
  const rt = makeRouter();
  registerVoiceRead(rt, { getVoicePacks: () => boom });
  return rt.call('/api/voice/packs');
})();
ok('list error 400', r4.code === 400 && /disk gone/.test(r4.json.error));

// 字段缺失（packs 为空）也应是 200
const empty = { ...base, list: async () => ({ ok: true, packs: [] }) };
const r5 = await (async () => {
  const rt = makeRouter();
  registerVoiceRead(rt, { getVoicePacks: () => empty });
  return rt.call('/api/voice/packs');
})();
ok('empty packs 200', r5.code === 200 && r5.json.packs.length === 0);

let threw = false;
try { registerVoiceRead(makeRouter(), {}); } catch { threw = true; }
ok('missing dep throws', threw);

if (failed) { console.error('R9_VOICE_READ_FAIL ' + failed); process.exit(1); }
console.log('R9_VOICE_READ_OK routes=3');
