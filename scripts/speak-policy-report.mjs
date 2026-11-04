#!/usr/bin/env node
// 只读统计：[策略·预测] 与 [策略·实际] 的一致性
//
// 用法：
//   node scripts/speak-policy-report.mjs                 # 读 /var/log/surfcore-bridge.log
//   node scripts/speak-policy-report.mjs --file X.log
//   node scripts/speak-policy-report.mjs --json
//
// 配对规则：同一个 key，预测后 120 秒内的第一条「实际」算它的结果；
// 实际可能来自任意 return 分支，所以 allow 相同但 source 不同也算「不一致（仅标签）」。
import fs from 'node:fs';

const args = process.argv.slice(2);
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : '/var/log/surfcore-bridge.log';
const JSON_MODE = args.includes('--json');

const RE = /^(\d{2}:\d{2}:\d{2}) .*?\[策略(·预测|·实际)\]\s+(.*)$/;
const KV = /(\w+)=([^\s]*(?:\s(?!\w+=)[^\s]*)*)/g;

function parseKv(s) {
  const out = {};
  for (const m of s.matchAll(/(\w+)=(\S+)/g)) out[m[1]] = m[2];
  return out;
}

const lines = fs.readFileSync(FILE, 'utf8').split('\n');
const preds = [];
const actuals = [];
for (const line of lines) {
  const m = line.match(RE);
  if (!m) continue;
  const [, t, kind, rest] = m;
  const kv = parseKv(rest);
  const sec = t.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  const rec = { t, sec, key: kv.key || '', allow: kv.allow, source: kv.source || '', reason: kv.reason || '', note: kv.note || '' };
  (kind === '·预测' ? preds : actuals).push(rec);
}

const used = new Set();
const rows = [];
for (const p of preds) {
  const a = actuals.find((x, i) => !used.has(i) && x.key === p.key && x.sec >= p.sec && x.sec - p.sec <= 120);
  if (a) used.add(actuals.indexOf(a));
  const same = a ? (a.allow === p.allow && a.source === p.source) : false;
  const sameAllow = a ? a.allow === p.allow : false;
  rows.push({ time: p.t, key: p.key, pred: `${p.allow}/${p.source}`, act: a ? `${a.allow}/${a.source}` : '（缺失）', same, sameAllow, note: p.note || a?.reason || '' });
}
for (const [i, a] of actuals.entries()) {
  if (used.has(i)) continue;
  rows.push({ time: a.t, key: a.key, pred: '（无预测）', act: `${a.allow}/${a.source}`, same: false, sameAllow: false, note: a.reason || '' });
}
rows.sort((x, y) => x.time.localeCompare(y.time));

const mism = rows.filter((r) => !r.same);
const bySource = {};
for (const r of mism) {
  const src = (r.act.split('/')[1] || r.pred.split('/')[1] || 'unknown');
  bySource[src] = (bySource[src] || 0) + 1;
}

if (JSON_MODE) {
  console.log(JSON.stringify({ file: FILE, predicted: preds.length, actual: actuals.length, rows, mismatched: mism.length, bySource }, null, 2));
  process.exit(0);
}

console.log('| 时间 | 会话 | 预测 | 实际 | 是否一致 | 原因 |');
console.log('|---|---|---|---|---|---|');
for (const r of rows.slice(-40)) {
  console.log(`| ${r.time} | ${r.key} | ${r.pred} | ${r.act} | ${r.same ? '✅' : (r.sameAllow ? '△标签' : '❌')} | ${r.note.replace(/\|/g, '/')} |`);
}
console.log('');
console.log(`预测 ${preds.length} 条 / 实际 ${actuals.length} 条 / 一致 ${rows.filter((r) => r.same).length} 条 / 不一致 ${mism.length} 条`);
console.log('按 source：', Object.entries(bySource).map(([k, v]) => `${k}=${v}`).join(' · ') || '（无）');
