#!/usr/bin/env node
// replay-hooks：行为金丝雀（W1-7）。
// 不连 QQ、不发消息、不进主链路：用临时 HOME + 固定 fixtures 调一遍各扩展的
// promptBlock / wakeGate，把输出排序后哈希，与 scripts/snap-base/hooks.json 比对。
// --save 只在首次生成基准时用一次；之后只允许 --diff。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(REPO, 'scripts', 'snap-base', 'hooks.json');
const ARGS = new Set(process.argv.slice(2));
const TMP = path.join(os.tmpdir(), 'replay-hooks-home');
const STATE = path.join(TMP, '.dsh', 'surfcore', 'state');

// 固定样本：同一份 fixtures 每次重建，保证输出可复现（不含真实群号/QQ）。
function makeFixtures() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(STATE, { recursive: true });
  const write = (name, data) => fs.writeFileSync(path.join(STATE, name), JSON.stringify(data, null, 1));
  // 与 group-rate.today() 同口径（东八区），否则 UTC 跨日会让 fixture 得失配
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  write('muted-keys.json', { items: { 'group:999999999': { at: '2026-01-01T00:00:00.000Z' } } });
  write('learn-mode.json', { groups: { '888888888': { at: '2026-01-01T00:00:00.000Z' } } });
  write('group-rate.json', { day, groups: { '777777777': { level: 'normal', count: 40, lastAt: 0 } } });
  write('safe-talk.json', { sessions: {} });
  write('impressions.json', { items: [{ text: '示例印象：他喜欢短句子', about: 'he', confidence: 'sure', at: 1 }] });
  write('style-samples.json', { samples: [{ text: '示例原话：这个我得想想', short: '这个我得想想', why: '起句', status: 'active', at: 1 }] });
  write('tech-notes.json', { items: [{ title: '示例技术笔记', at: 1 }] });
}
makeFixtures();
process.env.HOME = TMP;
process.env.SURFCORE_STATE_DIR = STATE;

const { extList } = await import(path.join(REPO, 'src', 'ext', 'index.js'));

// 配置样本：读取真实 config 会让 12 个模块的哈希随面板改动而红；金丝雀只看代码。
const CONFIG = {
  ownerQQ: '10000001',
  owner: { qq: '10000001' },
  socialV2: {
    attention: { enabled: true, minScore: 2, log: false },
    economy: { mode: 'auto', replyAt: true },
    safeTalk: { mode: 'record' },
    techNotes: { maxItems: 3 },
    impressions: { maxItems: 8, maxChars: 300 },
    styleLearn: { enabled: true, injectMaxChars: 520, injectMaxItems: 6 },
  },
};

// 12 条打样：覆盖 群/私聊、四种 reason、静音/学习/限额/模式 这几条会改写文案的分支。
const CASES = [
  { label: 'group-normal', key: 'group:700000001', reason: 'groupMessage', uin: '10000001' },
  { label: 'private-normal', key: 'private:10000001', reason: 'privateMessage', uin: '10000001' },
  { label: 'group-ratelimited', key: 'group:777777777', reason: 'groupMessage', uin: '20000002' },
  { label: 'group-learnmode', key: 'group:888888888', reason: 'groupMessage', uin: '20000002' },
  { label: 'group-muted', key: 'group:999999999', reason: 'groupMessage', uin: '20000002' },
  { label: 'group-at', key: 'group:700000002', reason: 'atMention', uin: '20000002' },
  { label: 'group-stylelearn', key: 'group:700000002', reason: 'style-learn', uin: '20000002' },
  { label: 'empty-key', key: '', reason: 'timer', uin: '' },
  { label: 'manual', key: 'group:700000003', reason: 'manual', uin: '10000001' },
  { label: 'admin', key: 'group:700000003', reason: 'admin', uin: '10000001' },
  { label: 'owneronly', key: 'group:700000004', reason: 'atMention', uin: '20000002', mode: 'owneronly' },
  { label: 'privateonly', key: 'group:700000005', reason: 'atMention', uin: '20000002', mode: 'privateonly' },
];

const stable = (v) => JSON.stringify(v, (_k, x) => (x === undefined ? null : x));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function runOne(ext, kind) {
  const rows = [];
  const nondet = [];
  const exec = (kind === 'promptBlock')
    ? () => { const t = ext.promptBlock(CONFIG); return t === undefined ? null : String(t); }
    : (c) => { const r = ext.wakeGate({ ...c, cfg: CONFIG }); return r === undefined ? null : r; };
  const inputs = kind === 'promptBlock' ? [null] : CASES;
  for (const c of inputs) {
    const label = kind === 'promptBlock' ? 'cfg' : c.label;
    // 有些闸门会写自己的 state（如 group-rate 记次数）；每次调用前重建 fixtures，才比得出代码差异。
    const probe = () => { makeFixtures(); return stable(exec(c)); };
    const a = probe();
    const b = probe();
    const id = `${kind}:${ext.id}`;
    if (a !== b) { nondet.push({ id, case: label, why: '同一进程两次调用结果不同' }); rows.push({ id, case: label, hash: sha(a), bytes: a.length }); continue; }
    rows.push({ id, case: label, hash: sha(a), bytes: a.length });
  }
  return { rows, nondet };
}

const results = [];
const nondet = [];
for (const ext of extList()) {
  for (const kind of ['promptBlock', 'wakeGate']) {
    if (typeof ext[kind] !== 'function') continue;
    const r = runOne(ext, kind);
    results.push(...r.rows);
    nondet.push(...r.nondet);
  }
}
results.sort((x, y) => `${x.id}\u0000${x.case}`.localeCompare(`${y.id}\u0000${y.case}`));
nondet.sort((x, y) => `${x.id}\u0000${x.case}`.localeCompare(`${y.id}\u0000${y.case}`));

const hooks = new Set(results.map((r) => r.id)).size; // 模块×钩子
const modules = new Set(results.map((r) => r.id.split(':')[1])).size;

if (ARGS.has('--save')) {
  if (fs.existsSync(BASE) && !ARGS.has('--force')) {
    console.error(`拒绝覆盖已有基准：${BASE}（基准只允许生成一次；确需重来加 --force，并在提交信息里说明原因）`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  fs.writeFileSync(BASE, JSON.stringify({ schema: 'replay-hooks/v1', at: new Date().toISOString(), hooks, modules, cases: results, nondet }, null, 1));
  console.log(`HOOKS_SAVED hooks=${hooks} cases=${results.length} nondet=${nondet.length} → ${path.relative(REPO, BASE)}`);
  process.exit(0);
}

if (!fs.existsSync(BASE)) {
  console.error(`没有基准：${path.relative(REPO, BASE)}（首次请跑 node scripts/replay-hooks.mjs --save，只此一次）`);
  process.exit(2);
}

const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const key = (r) => `${r.id}\u0000${r.case}`;
const baseMap = new Map(base.cases.map((r) => [key(r), r]));
const nowMap = new Map(results.map((r) => [key(r), r]));
const diffs = [];
for (const [k, r] of nowMap) {
  const b = baseMap.get(k);
  if (!b) { diffs.push(`+ 新增 ${r.id}/${r.case}`); continue; }
  if (b.hash !== r.hash && Math.abs(b.bytes - r.bytes) > 0) diffs.push(`~ 变化 ${r.id}/${r.case}（${b.bytes}→${r.bytes} 字节）`);
  else if (b.hash !== r.hash) diffs.push(`~ 变化 ${r.id}/${r.case}（同长度，内容变了）`);
}
for (const [k, b] of baseMap) if (!nowMap.has(k)) diffs.push(`- 消失 ${b.id}/${b.case}`);

console.log(`hooks=${hooks} diffs=${diffs.length} nondet=${nondet.length}`);
if (diffs.length) for (const d of diffs.slice(0, 40)) console.log('  ' + d);
for (const n of nondet) console.log(`  nd ${n.id}/${n.case}：${n.why}`);
if (diffs.length) { console.log('HOOKS_FAIL'); process.exit(1); }
console.log('HOOKS_OK');
