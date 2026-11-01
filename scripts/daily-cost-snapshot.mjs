#!/usr/bin/env node
// 每日花费快照：把「这一天」的用量固化下来。
// 为什么要有：桥接的账本会淘汰旧采样（只保总量），超过 30 天的按天曲线就没了。
// 这个脚本每天 00:05 把昨天的合计写进 state/token-daily-history.json，长期曲线靠它。
import fs from 'node:fs';

const ROOT = '/home/dsh/apps/surfcore';
const OUT = '/home/dsh/.dsh/surfcore/state/token-daily-history.json';

const cfg = JSON.parse(fs.readFileSync(`${ROOT}/config.json`, 'utf8'));
const token = cfg.consoleToken || '';

const res = await fetch('http://127.0.0.1:3100/api/tokens/daily', { headers: { 'x-console-token': token } });
if (!res.ok) {
  console.error('取每日用量失败', res.status);
  process.exit(1);
}
const data = await res.json();
const usage = data?.usage || {};

const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date()).replace(/\//g, '-');
const pick = (x) => ({ cost: Number(x?.cost) || 0, tokens: Number(x?.tokens) || 0 });
const row = {
  day,
  qq: pick(usage.qq), bili: pick(usage.bili), other: pick(usage.other),
  total: pick(usage.total),
  at: Date.now(),
};

let hist = [];
try { hist = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { hist = []; }
if (!Array.isArray(hist)) hist = [];
hist = hist.filter((x) => x && x.day !== day);
hist.push(row);
hist.sort((a, b) => String(a.day).localeCompare(String(b.day)));
if (hist.length > 400) hist = hist.slice(-400);

const tmp = `${OUT}.${process.pid}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(hist, null, 1), { encoding: 'utf8', mode: 0o644 });
fs.renameSync(tmp, OUT);
console.log(`已记下 ${day}：${(row.total.cost || 0).toFixed(4)} 元 / ${(row.total.tokens || 0).toLocaleString()} tok（共 ${hist.length} 天）`);
