// E-1：跨天重置必须重读磁盘，保留 level/custom，只清 count/lastAt
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-'));
process.env.SURFCORE_STATE_DIR = dir;
const FILE = path.join(dir, 'group-rate.json');
const yesterday = new Date(Date.now() + 8 * 3600e3 - 24 * 3600e3).toISOString().slice(0, 10);

const write = (obj) => fs.writeFileSync(FILE, JSON.stringify(obj));
let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };

write({ day: yesterday, groups: { 111: { level: 'active', count: 5, lastAt: 123, custom: { minGapMin: 3, perDay: 9 } } } });
const gr = await import('../../src/ext/group-rate.js');

let rates = gr.groupRates();
let r = rates.find((x) => x.gid === '111');
ok(!!r, '跨天后应仍有群 111');
ok(r.count === 0, 'count 应清零，实际 ' + r.count);
ok(Math.abs(r.minGapMs - 3 * 60000) < 1000, 'custom 间隔应保留（3 分钟），实际 ' + r.minGapMs);
ok(r.maxPerDay === 9, 'custom 上限应保留（9），实际 ' + r.maxPerDay);
ok(r.level === 'active', 'level 应保留，实际 ' + r.level);

let disk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
ok(disk.day !== yesterday, '磁盘 day 应已更新');
ok(disk.groups['111'].custom && disk.groups['111'].custom.perDay === 9, '磁盘 custom 不应被清空');

// 模拟：桥接缓存里已有「今天、无 custom」，面板随后把磁盘改成「昨天 + 新 custom」
fs.writeFileSync(FILE, JSON.stringify({ day: yesterday, groups: { 111: { level: 'normal', count: 40, lastAt: 9, custom: { minGapMin: 5, perDay: 20 } } } }));
rates = gr.groupRates();
r = rates.find((x) => x.gid === '111');
ok(r.maxPerDay === 20 && Math.abs(r.minGapMs - 5 * 60000) < 1000, '重置时应读磁盘最新 custom，实际 ' + JSON.stringify({ p: r.maxPerDay, g: r.minGapMs }));

fs.rmSync(dir, { recursive: true, force: true });
if (bad) { console.log('GROUP_RATE_DAY_FAIL ' + bad); process.exit(1); }
console.log('GROUP_RATE_DAY_OK');
