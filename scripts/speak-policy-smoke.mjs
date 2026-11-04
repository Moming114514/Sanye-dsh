// speak-policy 冒烟：不连 QQ、不读写状态，只用假快照跑 10 条典型场景。
// 用法：node scripts/speak-policy-smoke.mjs
import { evaluate, SPEAK_PRIORITY } from '../src/ext/speak-policy.js';

const now = Date.now();
const base = () => ({
  muted: false,
  learn: { on: false, ownerSpoke: false },
  economy: { on: false, replyAt: true },
  rate: { count: 0, lastAt: 0, level: 'normal', custom: null },
  attention: { score: 5, uin: '10001', at: now - 1000, minScore: 2, sample: {}, replyOnly: null },
  fish: { until: 0 },
  ownerOnly: { mode: 'all', groupAllowed: true },
  safe: { coolUntil: 0 },
});

const cases = [
  ['私聊默认', { key: 'private:10001', reason: 'private' }, {}, 'attention', true],
  ['静音', { key: 'group:1', reason: 'atMention' }, { muted: true }, 'mute', false],
  ['学习模式（非主人@）', { key: 'group:1', reason: 'atMention' }, { learn: { on: true, ownerSpoke: false } }, 'learn', false],
  ['学习模式（主人@）', { key: 'group:1', reason: 'atMention' }, { learn: { on: true, ownerSpoke: true } }, 'attention', true],
  ['只回指定人', { key: 'group:1', reason: 'atMention' }, { attention: { ...base().attention, replyOnly: ['20002'] } }, 'replyOnly', false],
  ['省钱（非@）', { key: 'group:1', reason: 'proactiveCheck' }, { economy: { on: true, replyAt: true } }, 'economy', false],
  ['频率超限', { key: 'group:1', reason: 'atMention' }, { rate: { count: 40, lastAt: 0, level: 'normal', custom: null } }, 'rate', false],
  ['注意力不够', { key: 'group:1', reason: 'atMention' }, { attention: { ...base().attention, score: 1 } }, 'attention', false],
  ['抽样放行', { key: 'group:1', reason: 'proactiveCheck' }, { attention: { ...base().attention, score: 1, sample: { 1: 100, maxPerDay: 20 } } }, 'sample', true],
  ['鱼群保护', { key: 'group:1', reason: 'atMention' }, { fish: { until: now + 600000 } }, 'fishGuard', false],
  ['敏感降温', { key: 'group:1', reason: 'atMention' }, { safe: { coolUntil: now + 600000 } }, 'safe', false],
];

let bad = 0;
console.log('priority:', SPEAK_PRIORITY.join(' > '));
for (const [name, input, patch, wantSource, wantAllow] of cases) {
  const state = Object.assign(base(), patch);
  const r = evaluate({ key: input.key, reason: input.reason, text: '在吗', gid: (input.key.split(':')[1] || ''), at: now, mode: 'all', state, rng: () => 0 });
  const ok = r.source === wantSource && r.allow === wantAllow;
  if (!ok) bad += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} allow=${String(r.allow).padEnd(5)} source=${String(r.source).padEnd(10)} ${r.reason}`);
}
const sample = evaluate({ key: 'group:1', reason: 'atMention', gid: '1', at: now, mode: 'all', state: Object.assign(base(), { muted: true }), rng: () => 0 });
console.log(`SMOKE_LOG [策略] key=group:1 allow=${sample.allow} source=${sample.source} reason=${sample.reason}`);
console.log(bad === 0 ? 'SPEAK_POLICY_OK' : `SPEAK_POLICY_FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
