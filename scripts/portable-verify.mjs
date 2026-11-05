#!/usr/bin/env node
// portable-verify.mjs — 校验迁移包能否在「新家」还原
// 用法: node scripts/portable-verify.mjs <包.tar.gz>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tarPath = process.argv[2];
if (!tarPath || !fs.existsSync(tarPath)) { console.error('用法: node scripts/portable-verify.mjs <包.tar.gz>'); process.exit(1); }
const dir = path.join(os.tmpdir(), 'portable-verify-' + process.pid);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const r = spawnSync('tar', ['-xzf', tarPath, '-C', dir], { encoding: 'utf8' });
if (r.status !== 0) { console.error('解包失败: ' + (r.stderr || '')); process.exit(1); }

const has = (rel) => fs.existsSync(path.join(dir, rel));
const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const jread = (rel) => JSON.parse(read(rel));
const countOf = (v) => {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') {
    for (const k of ['items', 'records', 'samples', 'list', 'entries']) if (Array.isArray(v[k])) return v[k].length;
    if (v.values && typeof v.values === 'object') return Object.keys(v.values).length;
  }
  return 0;
};
const rows = [];
function check(asset, file, fn) {
  if (!has(file)) { rows.push({ asset, file, ok: '✗', size: '缺', verdict: 'MISSING' }); return; }
  try {
    const out = fn();
    rows.push({ asset, file, ok: '✔', size: out, verdict: 'OK' });
  } catch (e) {
    rows.push({ asset, file, ok: '✗', size: String(e && e.message || e).slice(0, 30), verdict: 'BAD' });
  }
}

const charDir = (fs.existsSync(path.join(dir, 'characters')) ? fs.readdirSync(path.join(dir, 'characters')) : []).find((n) => n.startsWith('char-'));
const C = charDir ? 'characters/' + charDir : 'characters';
check('人格核心', C + '/persona.md', () => `${read(C + '/persona.md').length} 字`);
check('语气层', C + '/persona.tone.md', () => `${read(C + '/persona.tone.md').length} 字`);
check('场景', C + '/persona.scenes', () => {
  const n = fs.readdirSync(path.join(dir, C, 'persona.scenes')).filter((f) => f.endsWith('.md')).length;
  if (!n) throw new Error('没有场景文件');
  return n + ' 个';
});
check('记忆卡', C + '/memory/memory-card.json', () => countOf(jread(C + '/memory/memory-card.json')) + ' 条');
check('心情', 'state/mood.json', () => countOf(jread('state/mood.json')) + ' 键');
check('学样', 'state/style-samples.json', () => countOf(jread('state/style-samples.json')) + ' 条');
check('欠事', 'state/loops.json', () => countOf(jread('state/loops.json')) + ' 条');
check('印象', 'state/impressions.json', () => countOf(jread('state/impressions.json')) + ' 条');
check('技术笔记', 'state/tech-notes.json', () => countOf(jread('state/tech-notes.json')) + ' 条');
check('群策略', 'state/group-policy.json', () => {
  const j = jread('state/group-policy.json');
  return Object.keys(j.groups || {}).length + '+' + Object.keys(j.private || {}).length + ' 条';
});

// 额外：JSON 全量可解析
const badJson = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.json')) {
      try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch { badJson.push(path.relative(dir, p)); }
    }
  }
}
walk(dir);
// 额外：绝对路径写死
const absHits = [];
function walkText(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walkText(p); continue; }
    if (/\.(png|jpg|jpeg|gif|webp|zst|gz)$/i.test(e.name)) continue;
    let t = '';
    try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (t.includes('/home/dsh')) absHits.push(path.relative(dir, p));
  }
}
walkText(dir);

const w = rows.reduce((m, x) => Math.max(m, [...x.asset].length * 2, x.asset.length), 0);
console.log('| 资产 | 文件 | 可解析 | 条数/字数 | 结论 |');
console.log('| --- | --- | --- | --- | --- |');
for (const x of rows) console.log('| ' + x.asset + ' | ' + x.file + ' | ' + x.ok + ' | ' + x.size + ' | ' + x.verdict + ' |');
console.log('');
console.log('JSON 全量可解析: ' + (badJson.length ? '✗ ' + badJson.join(', ') : '✔'));
console.log('绝对路径 /home/dsh 命中: ' + (absHits.length ? absHits.join(', ') : '0 个'));
const files = (() => { let n = 0; (function c(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) c(p); else n += 1; } })(dir); return n; })();
console.log('还原到「新家」结构: ' + dir + '（' + files + ' 个文件）');
const bad = rows.filter((x) => x.verdict !== 'OK').length + badJson.length;
console.log(bad ? 'PORTABLE_VERIFY_FAIL ' + bad : 'PORTABLE_VERIFY_OK');
process.exit(bad ? 1 : 0);
