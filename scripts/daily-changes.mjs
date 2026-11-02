// scripts/daily-changes.mjs —— 按天汇总 git 提交，生成 docs/CHANGES-BY-DAY.md（给自己看 / 给别人展示）
// 用法：node scripts/daily-changes.mjs [天数=30]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const days = Number(process.argv[2] || 30);
const OUT = path.join(process.cwd(), 'docs', 'CHANGES-BY-DAY.md');

let raw = '';
try {
  raw = execSync(
    `git log -n 800 --date=short --pretty=format:'%ad|%h|%s' --abbrev-commit`,
    { cwd: process.cwd(), shell: '/bin/bash' }
  ).toString();
} catch (e) {
  console.error('读 git log 失败：' + e.message);
  process.exit(1);
}

const byDay = new Map();
for (const line of raw.split('\n')) {
  const [day, hash, ...rest] = line.split('|');
  if (!day || !hash) continue;
  const subject = rest.join('|').trim();
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push({ hash, subject });
}

const allDays = [...byDay.keys()].sort().reverse().slice(0, days);
const lines = ['# 改动日志（按天，自动生成）', ''];
lines.push('> 由 `node scripts/daily-changes.mjs` 生成；给人展示时直接看这一页。');
lines.push('');
lines.push(`共 ${allDays.length} 天、${allDays.reduce((n, d) => n + byDay.get(d).length, 0)} 次提交。`);
lines.push('');

for (const day of allDays) {
  const items = byDay.get(day);
  lines.push(`## ${day}（${items.length} 次）`);
  lines.push('');
  for (const it of items) lines.push(`- \`${it.hash}\` ${it.subject}`);
  lines.push('');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`CHANGES-BY-DAY 已生成：${OUT}（${allDays.length} 天）`);
