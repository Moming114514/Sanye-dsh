// W5-C 第 3 步：speak-policy 与现状的差异对照。
// 不连 QQ、不碰真实状态：所有 ext 状态文件写在临时目录，模块通过 SURFCORE_STATE_DIR 指过去。
// 「现状」= 按真实顺序调用各 ext 的 wakeGate（mute 20 → learn 30 → economy 40 → rate 50 → attention 60 → safe 100）
//          + 鱼群冷却（只按 until 判断，不写状态）；「目标」= speak-policy.evaluate() 的纯函数结果。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-'));
const DAY = new Date().toISOString().slice(0, 10);
process.env.SURFCORE_STATE_DIR = TMP;
process.env.HOME = TMP;

const mute = await import('../src/ext/mute.js');
const learn = await import('../src/ext/learnmode.js');
const econ = await import('../src/ext/economy.js');
const rate = await import('../src/ext/group-rate.js');
const safe = await import('../src/ext/safe-talk.js');
const attentionMod = await import('../src/ext/attention.js');
const { evaluate } = await import('../src/ext/speak-policy.js');

const OWNER = '3160624852';
const GROUP = '1';
const KEY = 'group:' + GROUP;
const now = Date.now();

function write(name, obj) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 1));
}

function bumpMtime(i) {
  const t = new Date(1700000000000 + i * 1000);
  for (const f of ['muted-keys.json', 'learn-mode.json', 'economy.json', 'group-rate.json', 'safe-talk.json']) {
    const p = path.join(TMP, f);
    try { fs.utimesSync(p, t, t); } catch {}
  }
}

function setState({ muted = false, learnOn = false, ecoOn = false, replyAt = true, rateCount = 0, rateLastAt = 0, coolUntil = 0, n = 0 }) {
  write('muted-keys.json', { items: muted ? { [KEY]: { at: 'x' } } : {}, n });
  write('learn-mode.json', { groups: learnOn ? { [GROUP]: { at: 'x' } } : {}, n });
  write('economy.json', { mode: ecoOn ? 'on' : 'off', replyAt, groups: {}, n });
  write('group-rate.json', { day: DAY, groups: { [GROUP]: { level: 'normal', count: rateCount, lastAt: rateLastAt } }, n });
  write('safe-talk.json', { day: DAY, sessions: coolUntil ? { [KEY]: { coolUntil, hits: 3 } } : {}, n });
}

function cfgFor(sc) {
  return {
    ownerQQ: OWNER,
    socialV2: {
      attention: {
        enabled: true, minScore: 2, log: false,
        sample: sc.sample || {},
        replyOnly: sc.replyOnly ? { [GROUP]: sc.replyOnly } : {},
      },
      safeTalk: { enabled: true, mode: 'cool' },
    },
  };
}

function makeAttention(sc) {
  const att = attentionMod.default({ log: () => {} });
  if (sc.key.startsWith('group:')) {
    att.onGroupMessage({ key: sc.key, text: sc.text || '三叶在吗，帮我看看', uin: sc.uin || '10001', cfg: cfgFor(sc) });
  }
  return att;
}

function currentDecision(sc, att) {
  const cfg = cfgFor(sc);
  const args = { key: sc.key, reason: sc.reason, cfg, mode: 'all', economyOn: false };
  const order = [['mute', mute.default], ['learn', learn.default], ['economy', econ.default], ['rate', rate.default], ['attention', att], ['safe', safe.default]];
  for (const [name, mod] of order) {
    try {
      const r = mod.wakeGate(args);
      if (r && r.allow === false) return { allow: false, source: name, reason: r.reason };
    } catch (e) {
      return { allow: false, source: name, reason: 'throw:' + e.message };
    }
  }
  if (Number(sc.fishUntil || 0) > Date.now()) return { allow: false, source: 'fishGuard', reason: '[鱼群保护] 保护冷却中' };
  return { allow: true, source: 'pass', reason: '' };
}

function snapshot(sc, att) {
  const gid = sc.key.startsWith('group:') ? GROUP : '';
  const last = att.getLast(sc.key);
  const sp = gid ? learn.lastSpeakerAt(sc.key) : null;
  const rates = rate.groupRates().find((x) => x.gid === gid);
  return {
    muted: mute.isMuted(sc.key),
    learn: { on: gid ? learn.isLearnGroup(gid) : false, ownerSpoke: Boolean(sp && sp.uin === OWNER && Date.now() - sp.at < 600000) },
    economy: { on: gid ? econ.ecoForGroup(gid, false) : false, replyAt: econ.ecoState(false).replyAt !== false },
    rate: { count: rates?.count || 0, lastAt: rates?.lastAt || 0, custom: rates?.custom || null, level: rates?.level || 'normal' },
    attention: {
      score: last ? last.score : null, uin: last ? last.uin : '', at: last ? last.at : 0,
      minScore: 2, sample: sc.sample || {}, replyOnly: sc.replyOnly || null,
    },
    fish: { until: Number(sc.fishUntil || 0) },
    ownerOnly: { mode: 'all', groupAllowed: true },
    safe: { coolUntil: safe.coolUntil(sc.key) },
  };
}

const scenarios = [
  { name: '静音', state: { muted: true }, reason: 'atMention' },
  { name: '学习(非主人@)', state: { learnOn: true }, reason: 'atMention', speaker: '10001' },
  { name: '学习(主人@)', state: { learnOn: true }, reason: 'atMention', speaker: OWNER },
  { name: '只回别人', state: {}, reason: 'atMention', uin: '10001', replyOnly: ['20002'] },
  { name: '省钱', state: { ecoOn: true }, reason: 'proactiveCheck' },
  { name: '频率超限', state: { rateCount: 40 }, reason: 'atMention' },
  { name: '注意力不够', state: {}, reason: 'atMention', scoreText: '嗯' },
  { name: '抽样命中', state: {}, reason: 'proactiveCheck', scoreText: '嗯', sample: { [GROUP]: 100 } },
  { name: '鱼群冷却', state: {}, reason: 'atMention', fishUntil: now + 600000 },
  { name: '敏感降温', state: { coolUntil: now + 600000 }, reason: 'atMention' },
  { name: '私聊', state: {}, reason: 'private', key: 'private:10001' },
  { name: '全部通过', state: {}, reason: 'atMention' },
];

const rows = [];
let diff = 0;
let behaviorDiff = 0;
for (let i = 0; i < scenarios.length; i += 1) {
  const sc = { key: KEY, text: '三叶在吗，帮我看看这个', uin: '10001', ...scenarios[i] };
  if (sc.scoreText) sc.text = sc.scoreText;
  if (sc.speaker) learn.noteLearnSpeaker(sc.key, sc.speaker);
  setState({ ...sc.state, n: i });
  bumpMtime(i);
  const att = makeAttention(sc);
  const snap = snapshot(sc, att); // 先取快照：现状的 wakeGate 会写计数，不能污染对照
  const realRandom = Math.random;
  if (sc.sample) Math.random = () => 0; // 固定抽样源头，保证可重复
  const cur = currentDecision(sc, att);
  Math.random = realRandom;
  const tgt = evaluate({ key: sc.key, gid: sc.key.startsWith('group:') ? GROUP : '', reason: sc.reason, text: sc.text, at: Date.now(), mode: 'all', state: snap, rng: () => 0 });
  const same = cur.allow === tgt.allow && cur.source === tgt.source;
  if (!same) diff += 1;
  if (cur.allow !== tgt.allow) behaviorDiff += 1;
  rows.push({ name: sc.name, cur, tgt, same });
}

console.log('| 场景 | 现状 (allow/source) | 目标 (allow/source) | 是否一致 |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.cur.allow} / ${r.cur.source} | ${r.tgt.allow} / ${r.tgt.source} | ${r.same ? '一致' : '**不一致**'} |`);
}
console.log('');
console.log(`差异 ${diff} 条，其中会导致行为不同（allow 不同）的 ${behaviorDiff} 条。`);
for (const r of rows.filter((x) => !x.same)) {
  console.log(`- ${r.name}: 现状=${r.cur.source} → 目标=${r.tgt.source}${r.cur.allow === r.tgt.allow ? '（判断结果相同，仅来源标签/时机不同）' : '（行为不同）'}`);
}

// ---------- 补充探针（不计入 12 组，专门找“行为不同”） ----------
console.log('\n补充探针（不计入 12 组）：');
{
  // P1：分数过期（>10 分钟）但 replyOnly 名单还在 —— 现状跳过 replyOnly 直接放行，目标仍按名单拦
  setState({ n: 91 });
  bumpMtime(91);
  const cfgOn = { ownerQQ: OWNER, socialV2: { attention: { enabled: true, minScore: 2, log: false, sample: {}, replyOnly: { [GROUP]: ['20002'] } } } };
  const attP1 = attentionMod.default({ log: () => {} });
  attP1.onGroupMessage({ key: KEY, text: '三叶在吗', uin: '10001', cfg: cfgOn });
  const realNow = Date.now;
  const shifted = realNow() + 11 * 60 * 1000;
  Date.now = () => shifted; // 让现状的「10 分钟过期」判定命中
  const curP1 = attP1.wakeGate({ key: KEY, reason: 'atMention', cfg: cfgOn, mode: 'all' });
  Date.now = realNow;
  const scP1 = { key: KEY, reason: 'atMention', uin: '10001', replyOnly: ['20002'], sample: {}, text: '三叶在吗' };
  const tgtP1 = evaluate({ key: KEY, gid: GROUP, reason: 'atMention', text: '三叶在吗', at: shifted, mode: 'all', state: snapshot(scP1, attP1), rng: () => 0 });
  const curOk = !(curP1 && curP1.allow === false);
  console.log(`- P1 分数过期 + replyOnly 名单：现状 allow=${curOk}（分数过期直接放行） / 目标 allow=${tgtP1.allow} source=${tgtP1.source} → ${curOk === tgtP1.allow ? '一致' : '**行为不同**'}`);
}
{
  // P2：频率闸门放行时会 bump —— 现状第二次同群唤醒会被 minGap 拦，目标只读不受影响
  setState({ n: 92 });
  bumpMtime(92);
  const scP2 = { key: KEY, reason: 'atMention', text: '三叶在吗，帮我看看', uin: '10001', sample: {} };
  const attP2 = makeAttention(scP2);
  const snapP2 = snapshot(scP2, attP2);
  const c1 = currentDecision(scP2, attP2);
  const c2 = currentDecision(scP2, attP2);
  const t1 = evaluate({ key: KEY, gid: GROUP, reason: 'atMention', text: scP2.text, at: Date.now(), mode: 'all', state: snapP2, rng: () => 0 });
  const t2 = evaluate({ key: KEY, gid: GROUP, reason: 'atMention', text: scP2.text, at: Date.now(), mode: 'all', state: snapP2, rng: () => 0 });
  const sameP2 = c1.allow === t1.allow && c2.allow === t2.allow;
  console.log(`- P2 同一分钟连判两次：现状 \\[${c1.allow}/${c1.source}, ${c2.allow}/${c2.source}\\] / 目标 \\[${t1.allow}/${t1.source}, ${t2.allow}/${t2.source}\\] → ${sameP2 ? '一致' : '**行为不同**（现状会 bump 消耗额度，目标只读）'}`);
}
fs.rmSync(TMP, { recursive: true, force: true });
