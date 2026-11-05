#!/usr/bin/env node
// portable-export.mjs — 把「她」打包成可迁移资产（只读源，只写 backups/portable 与 /tmp）
// 用法: node scripts/portable-export.mjs [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HOME = process.env.HOME || '/home/dsh';
const SRC = path.join(HOME, '.dsh', 'surfcore');
const OUT_DIR = path.join(HOME, 'backups', 'portable');
const DRY = process.argv.includes('--dry-run');

// 明确的「她」清单：人格四层 + 场景 + 记忆卡 + 状态里的长期资产
const FILES = [
  'characters/current.json',
  'state/mood.json',
  'state/loops.json',
  'state/people.json',
  'state/impressions.json',
  'state/tech-notes.json',
  'state/style-samples.json',
  'state/style-samples.md',
  'state/style-prefs.md',
  'state/group-policy.json',
  'state/muted-keys.json',
  'state/learn-mode.json',
  'state/group-rate.json',
  'state/human-marks.json',
  'state/bot-ids.json',
  'state/owner-teach.json',
  'state/safe-talk.json',
  'state/alerts.json',
  'state/economy.json',
  'state/bili-study.json',
  'state/utterance-marks.json',
  'state/active-window.json',
  'state/group-digest.json',
  'state/impression-notes.json',
];
const CHAR_GLOBS = [
  ['character.json', 1],
  ['persona.md', 1],
  ['persona.tone.md', 1],
  ['persona.daily.md', 1],
  ['memory/self.md', 1],
  ['memory/diary.md', 1],
  ['memory/memory-card.json', 1],
  ['memory/memory-card-full.jsonl', 1],
];
const EXCLUDE = [
  /\.bak/i, /media-cache/, /node_modules/, /\.log$/, /token/i,
  /session/i, /-prompt-/, /full-stats/, /snap\//, /decision\//,
];

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function walk(dir) {
  const out = [];
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const picked = new Map(); // rel -> abs
for (const rel of FILES) {
  const abs = path.join(SRC, rel);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) picked.set(rel, abs);
}
const charRoot = path.join(SRC, 'characters');
for (const name of fs.existsSync(charRoot) ? fs.readdirSync(charRoot) : []) {
  if (!name.startsWith('char-')) continue;
  for (const [rel, _] of CHAR_GLOBS) {
    const r = path.join('characters', name, rel);
    const abs = path.join(SRC, r);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) picked.set(r, abs);
  }
  const scenes = path.join(charRoot, name, 'persona.scenes');
  if (fs.existsSync(scenes)) {
    for (const f of fs.readdirSync(scenes)) {
      if (!f.endsWith('.md')) continue;
      const r = path.join('characters', name, 'persona.scenes', f);
      picked.set(r, path.join(SRC, r));
    }
  }
}
for (const rel of [...picked.keys()]) if (EXCLUDE.some((re) => re.test(rel))) picked.delete(rel);

const rows = [...picked.keys()].sort().map((rel) => ({ rel, size: fs.statSync(picked.get(rel)).size }));
const total = rows.reduce((a, r) => a + r.size, 0);
const byDir = {};
for (const r of rows) {
  const top = r.rel.includes('/') ? r.rel.split('/')[0] : '(root)';
  byDir[top] = byDir[top] || { n: 0, bytes: 0 };
  byDir[top].n += 1; byDir[top].bytes += r.size;
}

if (DRY) {
  console.log('将打包 ' + rows.length + ' 个文件，' + (total / 1048576).toFixed(2) + ' MB');
  for (const [k, v] of Object.entries(byDir).sort()) console.log('  ' + k.padEnd(12) + String(v.n).padStart(4) + ' 个  ' + (v.bytes / 1024).toFixed(1) + ' KB');
  for (const r of rows) console.log('    ' + r.rel + '  ' + r.size);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16).replace(/[-T:]/g, '');
const tarPath = path.join(OUT_DIR, 'sanye-' + stamp + '.tar.gz');
const manifestPath = tarPath.replace(/\.tar\.gz$/, '.manifest.json');
const tmpList = path.join(os.tmpdir(), 'portable-list-' + process.pid + '.txt');
fs.writeFileSync(tmpList, rows.map((r) => r.rel).join('\n') + '\n');
const r = spawnSync('tar', ['-czf', tarPath, '-C', SRC, '-T', tmpList], { encoding: 'utf8' });
fs.unlinkSync(tmpList);
if (r.status !== 0) { console.error('tar 失败: ' + (r.stderr || '')); process.exit(1); }

const manifest = {
  schema: 'portable/v1',
  createdAt: new Date().toISOString(),
  files: rows.length,
  bytes: total,
  tarBytes: fs.statSync(tarPath).size,
  dirs: {},
  sha256: {},
};
for (const [k, v] of Object.entries(byDir)) {
  const lines = rows.filter((x) => (x.rel.split('/')[0] === k || (k === '(root)' && !x.rel.includes('/'))))
    .map((x) => x.rel + '\t' + sha256(fs.readFileSync(picked.get(x.rel))));
  manifest.dirs[k] = { files: v.n, bytes: v.bytes };
  manifest.sha256[k] = sha256(lines.join('\n'));
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('打包完成: ' + tarPath);
console.log('清单: ' + manifestPath);
console.log('文件 ' + rows.length + ' 个，源 ' + (total / 1048576).toFixed(2) + ' MB，包 ' + (manifest.tarBytes / 1048576).toFixed(2) + ' MB');
