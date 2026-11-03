#!/usr/bin/env node
// Daily snapshot of key metrics, pulled to local archive.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const ROOT = '/home/dsh/apps/surfcore';
const STATE = '/home/dsh/.dsh/surfcore/state';
const CHAR = '/home/dsh/.dsh/surfcore/characters/char-mvugwthv';
const OUTDIR = path.join(ROOT, 'state', 'daily-stats');

function j(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000 }).trim(); } catch { return ''; }
}
function httpJson(pathname) {
  return new Promise((resolve) => {
    try {
      const cfg = j(path.join(ROOT, 'config.json'), {}) || {};
      const req = http.request(
        { host: '127.0.0.1', port: 3100, path: pathname, method: 'GET', timeout: 6000,
          headers: { 'x-console-token': cfg.consoleToken || '' } },
        (res) => {
          let b = '';
          res.on('data', (c) => { b += c; });
          res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
        },
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch { resolve(null); }
  });
}

const today = process.argv[2] || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const out = { day: today, at: new Date().toISOString(), host: os.hostname() };

// cost: live endpoint returns { ok, usage: { qq, bili, other, total } }
const daily = await httpJson('/api/tokens/daily');
const u = (daily && daily.usage) || null;
if (u) {
  out.cost = {
    total: u.total || null,
    qq: u.qq || null,
    bili: u.bili || null,
    other: u.other || null,
    limits: daily.limits || null,
    source: 'live',
  };
} else {
  const hist = j(path.join(STATE, 'token-daily-history.json'), []) || [];
  const rec = (Array.isArray(hist) ? hist : []).find((x) => x && x.day === today) || null;
  out.cost = rec ? { qq: rec.qq, bili: rec.bili, other: rec.other, total: rec.total, source: 'history' } : null;
}

out.services = {};
for (const name of ['surfcore-bridge', 'dsh-web', 'asr-shim', 'her-console']) {
  out.services[name] = sh('systemctl', ['is-active', name]) || 'unknown';
}

const mem = sh('free', ['-m']).split('\n');
out.res = {
  disk: sh('df', ['-h', '/']).split('\n').pop(),
  memTotalMB: (mem[1] || '').split(/\s+/)[1] || null,
  memUsedMB: (mem[1] || '').split(/\s+/)[2] || null,
  load: os.loadavg().map((x) => Math.round(x * 100) / 100),
};

const memCard = j(path.join(CHAR, 'memory', 'memory-card.json'), null);
const recs = Array.isArray(memCard && memCard.records) ? memCard.records : (Array.isArray(memCard) ? memCard : []);
out.memory = {
  records: recs.length,
  pinned: recs.filter((r) => r && r.pinned).length,
  forgotten: recs.filter((r) => r && r.forgottenAt).length,
  displayOnly: recs.filter((r) => r && r.displayOnly).length,
};

const sl = ((j(path.join(STATE, 'style-samples.json'), { samples: [] }) || {}).samples) || [];
out.style = {
  total: sl.length,
  active: sl.filter((x) => x.status === 'active').length,
  candidate: sl.filter((x) => x.status === 'candidate').length,
  retired: sl.filter((x) => x.status === 'retired').length,
};
out.loops = { items: (((j(path.join(STATE, 'loops.json'), { items: [] }) || {}).items) || []).length };
out.impressions = { items: (((j(path.join(STATE, 'impressions.json'), { items: [] }) || {}).items) || []).length };
out.techNotes = { items: (((j(path.join(STATE, 'tech-notes.json'), { items: [] }) || {}).items) || []).length };
const st = j(path.join(STATE, 'stickers.json'), []);
out.stickers = { items: Array.isArray(st) ? st.length : 0 };
const mood = j(path.join(STATE, 'mood.json'), null);
out.mood = mood ? { current: mood.current || null, values: mood.values || null } : null;

// ERRMARK_PATCH：统计「自上次快照以来的新增报错」，不再把历史旧错算进来
try {
  const LOG = '/var/log/surfcore-bridge.log';
  const MARK = path.join(STATE, 'daily-stats-mark.json');
  const size = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0;
  let from = 0;
  try { from = Number((JSON.parse(fs.readFileSync(MARK, 'utf8')) || {}).offset) || 0; } catch { from = 0; }
  if (size < from) from = 0;
  let text = '';
  if (size > from) {
    const fd = fs.openSync(LOG, 'r');
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  }
  const lines = text.split('\n').filter((l) => /⚠️|处理出错|ReferenceError|TypeError|unhandled/.test(l) && !/\[学样\] 拒收/.test(l));
  out.errors = { sinceLast: true, count: lines.length, lastSample: (lines.slice(-1)[0] || '').slice(0, 160) };
  fs.writeFileSync(MARK, JSON.stringify({ offset: size, at: Date.now() }));
} catch (e) { out.errors = { count: null, error: String(e && e.message || e) }; }

fs.mkdirSync(OUTDIR, { recursive: true });
const file = path.join(OUTDIR, `${today}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');
console.log(`OK ${file} ${fs.statSync(file).size}B`);
console.log(JSON.stringify({
  day: out.day,
  cost: out.cost && out.cost.total ? out.cost.total.cost : null,
  records: out.memory.records,
  style: out.style,
  errors: out.errors.count,
  disk: out.res.disk,
}));
