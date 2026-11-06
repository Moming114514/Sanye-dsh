import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startBiliSync } from '../../src/ext/bili.js';
import { loadBiliAccount, resolveBiliPaths } from '../../src/bili-api.js';

const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };
const logs = [];
const log = (m) => logs.push(m);

// 1) 总开关关闭：什么都不启动
let r = startBiliSync({ cfg: { biliBridge: { enabled: false } }, log, platformStateDir: '/tmp', sendToQQ: async () => {}, deliverPrompt: () => {}, memory: {}, currentMode: () => 'chat', sendBiliCard: () => {}, isUnifiedEnabled: () => true });
assert(r.dynamics === null && r.share === null && logs.length === 0, 'disabled noop');

// 2) 群清单回落 allow.groups、两个 start 被调用
const seen = {};
const groups = [];
r = startBiliSync({
  cfg: {
    allow: { groups: ['111111'] },
    biliBridge: {
      enabled: true,
      memory: { enabled: false },
      dynamics: { enabled: true, groups: [], pollIntervalMs: 600000 },
      share: { enabled: true, groups: [], times: ['12:00'], gapMs: 0 },
    },
  },
  log,
  platformStateDir: '/tmp',
  sendToQQ: async () => {},
  deliverPrompt: () => {},
  memory: { refresh: () => {}, selfName: () => '她' },
  isSnowlumaReady: () => true,
  isDshReady: () => false,
  currentMode: () => 'reserved2',
  sendBiliCard: () => {},
  isUnifiedEnabled: () => true,
  createDynamics: (o) => { seen.dyn = o; return { start: () => { seen.dynStarted = true; } }; },
  createShare: (o) => { seen.share = o; return { start: () => { seen.shareStarted = true; } }; },
});
assert(seen.dyn && seen.share, 'factories called');
assert(JSON.stringify(seen.dyn.groups) === '["111111"]', 'dynamics groups fallback');
assert(seen.dyn.intervalMs === 600000 && seen.dyn.selfName === '她', 'dynamics options');
assert(seen.dynStarted && seen.shareStarted, 'start called');
assert(typeof seen.share.isEnabled === 'function' && seen.share.isEnabled() === true, 'share isEnabled');
assert(seen.share.isReady() === false, 'share isReady');

// 3) 白名单也为空：只打“未启动”日志
logs.length = 0;
r = startBiliSync({
  cfg: { allow: { groups: [] }, biliBridge: { enabled: true, memory: { enabled: false }, dynamics: { enabled: true, groups: [], pollIntervalMs: 1 }, share: { enabled: true, groups: [], times: [], gapMs: 0 } } },
  log, platformStateDir: '/tmp', sendToQQ: async () => {}, deliverPrompt: () => {}, memory: {}, currentMode: () => 'chat', sendBiliCard: () => {}, isUnifiedEnabled: () => true,
  createDynamics: () => { throw new Error('should not create'); },
  createShare: () => { throw new Error('should not create'); },
});
assert(r.dynamics === null && r.share === null, 'no groups → null');
assert(logs.some((m) => m.includes('[B站动态]')) && logs.some((m) => m.includes('[B站分享]')), 'no-group logs');

// 4) cookie / self.mid 兜底：cred 缺失时 hasCredentials=false、不回退；有 cred 时用 DedeUserID 兜底 mid
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'r7b-'));
let acc = loadBiliAccount({ home });
assert(acc.hasCredentials === false && acc.mid === '' && !acc.headers.cookie, 'missing credentials');
const p = resolveBiliPaths(home);
fs.mkdirSync(path.dirname(p.credentials), { recursive: true });
fs.writeFileSync(p.credentials, JSON.stringify({ sessdata: 'S', bili_jct: 'J', buvid3: 'B', dedeuserid: '42', DedeUserID: '42' }));
acc = loadBiliAccount({ home });
assert(acc.hasCredentials === true, 'has credentials');
assert(acc.mid === '42', 'mid fallback from dedeuserid');
assert(String(acc.headers.cookie).includes('SESSDATA=S') && String(acc.headers.cookie).includes('DedeUserID=42'), 'cookie assembled');

console.log('R7_BILI_OK');
