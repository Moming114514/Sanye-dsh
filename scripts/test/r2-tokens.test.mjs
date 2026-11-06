// R2：Token 守卫抽离后的行为对照测试。
// 期望值来自迁移前 main() 内同一段代码的常量与分支（cap 默认 8、ratio 默认 0.5、boost 叠加、budget 先于 enabled）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTokenGuard } from '../../src/lib/tokens.js';
import { writeDailyUsage, localDayKey } from '../../src/token-budget.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-tokens-'));
const stateDir = path.join(root, 'state');
const surfcoreDir = path.join(root, 'surfcore');
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(surfcoreDir, { recursive: true });

let nowValue = new Date(2026, 10, 6, 12, 0, 0).getTime();
const day = localDayKey(nowValue);
const logs = [];
const sent = [];
const limitEvents = [];
const cfg = {
  ownerQQ: '123456789',
  allow: { groups: ['1001', '1002'] },
  socialV2: {
    tokenGuard: {
      enabled: true,
      maxDailyCostCNY: 8,
      downgradeAtRatio: 0.5,
      maxWakesPerDay: 5,
      maxOutboundPerTurn: 2,
    },
  },
};

const guard = createTokenGuard({
  cfg,
  stateDir,
  surfcoreDir,
  log: (...a) => logs.push(a.join(' ')),
  now: () => nowValue,
  sendToQQ: async (key, text) => { sent.push({ key, text }); return { ok: true }; },
  refreshCfg: () => {},
  reportLimitEvent: (key, info) => limitEvents.push({ key, info }),
  ledger: { dailyUsage: () => ({ qq: { cost: 0, tokens: 0 }, other: { cost: 0, tokens: 0 } }) },
});

const assert = (cond, msg) => { if (!cond) { console.error('R2_FAIL: ' + msg); process.exit(1); } };

// 场景 1：普通花费（¥2，低于 8×0.5）
writeDailyUsage(surfcoreDir, { qq: { cost: 2, tokens: 0 }, bili: { cost: 0, tokens: 0 }, other: { cost: 0, tokens: 0 } }, { day, at: nowValue - 1000 });
let u = guard.bridgeDailyUsage();
assert(u.source === 'surfcore-plugin', 'fresh snapshot source');
assert(u.total.cost === 2, 'total cost 2');
let d = guard.tokenGuardDowngrade();
assert(d.on === false && d.cost === 2 && d.cap === 8 && d.ratio === 0.5, 'downgrade normal');

// 场景 2：超限 + 加油（¥5 达到 8×0.5；/加油 2 后额度 10，5 < 10×0.5 仍不降级 → 再涨到 6 才降）
nowValue += 61_000;
writeDailyUsage(surfcoreDir, { qq: { cost: 5, tokens: 0 }, bili: { cost: 0, tokens: 0 }, other: { cost: 0, tokens: 0 } }, { day, at: nowValue - 1000 });
const extra = guard.tokenBoostAdd(2);
assert(extra === 2, 'boost extra 2');
const boost = JSON.parse(fs.readFileSync(path.join(surfcoreDir, 'token-boost.json'), 'utf8'));
assert(boost.day === day && boost.extra === 2 && typeof boost.at === 'string', 'boost file shape');
d = guard.tokenGuardDowngrade();
assert(d.cap === 10 && d.extra === 2 && d.on === true && d.cost === 5, 'cap 8+2 => threshold 5, cost 5 => on');
guard.notifyDowngradeOnce(d);
const mark = JSON.parse(fs.readFileSync(path.join(stateDir, 'downgrade-notified.json'), 'utf8'));
assert(mark.day === day, 'downgrade mark day');
assert(sent.length === 3, 'owner + 2 groups notified, got ' + sent.length);
guard.notifyDowngradeOnce(d);
assert(sent.length === 3, 'notified once per day');

// 场景 3：额度到顶（¥9 > 8）→ wake 先被 budget 拦，即使防爆破关闭
nowValue += 61_000;
fs.writeFileSync(path.join(surfcoreDir, 'token-boost.json'), JSON.stringify({ day: '2000-01-01', extra: 0 }) + '\n');
writeDailyUsage(surfcoreDir, { qq: { cost: 9, tokens: 0 }, bili: { cost: 0, tokens: 0 }, other: { cost: 0, tokens: 0 } }, { day, at: nowValue - 1000 });
const wake = guard.tokenGuardWakeBlock('group:1001', { wakeTimes: [] }, { direct: false });
assert(wake && wake.reason === 'budget', 'budget blocks wake');
assert(String(wake.error).includes('Token 额度'), 'budget error text');
cfg.socialV2.tokenGuard.enabled = false;
const wake2 = guard.tokenGuardWakeBlock('group:1001', { wakeTimes: [] }, { direct: false });
assert(wake2 && wake2.reason === 'budget', 'budget independent of enabled');
cfg.socialV2.tokenGuard.enabled = true;

// 场景 4：单轮发送上限（2 条已发，再发 1 条被拦；额度先占后放）
const st = { tokenTurnSent: 2 };
const block = guard.tokenGuardSendBlock('group:1001', st, 1);
assert(block && block.code === 'TOKEN_GUARD_SEND_LIMIT', 'send block code');
assert(limitEvents.length === 1 && limitEvents[0].info.setting === 'socialV2.tokenGuard.maxOutboundPerTurn', 'limit event recorded');
assert(st.tokenTurnSent === 2, 'blocked does not consume');
guard.resetTokenTurn(st);
assert(st.tokenTurnSent === 0, 'reset');
const st2 = {};
assert(guard.tokenGuardSendBlock('group:1001', st2, 1) === null && st2.tokenTurnSent === 1, 'consume one');

// 账本文件未被这段代码改写（写 token-usage.jsonl 的是 token-ledger，不在迁移范围）
assert(!fs.existsSync(path.join(stateDir, 'token-usage.jsonl')), 'no ledger file written');

console.log('R2_OK', JSON.stringify({ day, boost: boost.extra, sent: sent.length, limit: limitEvents.length }));
