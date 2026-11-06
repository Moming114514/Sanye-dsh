#!/usr/bin/env node
// 三叶面板 · 服务端（零依赖）
// - 静态页：<HER_CONSOLE_ROOT>/public
// - 接口：/api/*（只监听 127.0.0.1，经 SSH 隧道访问；所有写操作要 X-Her-Token）
// - 与终端共用同一份功能注册表 /opt/her/features.json，加功能只加一行
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFile, execSync } from 'node:child_process'; // HEALTH_PATCH
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HER_CONSOLE_ROOT || path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const FEAT_PATH = process.env.HER_FEAT_PATH || path.join(path.dirname(ROOT), 'her', 'features.json');
// 这些路径都可以用环境变量覆盖；默认值按 «服务账号的 home + apps/surfcore» 组织
const SURFCORE = process.env.SURFCORE_DIR || path.join(os.homedir(), 'apps', 'surfcore');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const CFG_PATH = path.join(SURFCORE, 'config.json');
const SOCIAL_PATH = path.join(SURFCORE, 'state', 'social-v2.json');
const BACKUP_DIR = process.env.HER_BACKUP_DIR || path.join(os.homedir(), 'backups', 'her');
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const SERVICE_USER = process.env.SURFCORE_USER || 'dsh';
const STATE = process.env.SURFCORE_STATE || path.join(DSH_HOME, 'surfcore', 'state');
const VIDEO_JSON = process.env.VIDEO_JSON || path.join(DSH_HOME, 'video.json');
const PORT = Number(process.env.HER_PORT || 7800);
const BRIDGE = 'http://127.0.0.1:3100';
const QQ_STATE = path.join(SURFCORE, 'state');
function qqModeGet() {
  try { if (JSON.parse(fs.readFileSync(QQ_STATE + '/qq-off.json', 'utf8') || '{}').off === true) return 'off'; } catch {}
  try { const m = JSON.parse(fs.readFileSync(QQ_STATE + '/qq-mode.json', 'utf8') || '{}').mode; if (m === 'owneronly' || m === 'privateonly') return m; } catch {}
  return 'open';
}
function qqModeSet(mode) {
  const now = new Date().toISOString();
  fs.mkdirSync(QQ_STATE, { recursive: true });
  if (mode === 'off') {
    fs.writeFileSync(QQ_STATE + '/qq-off.json', JSON.stringify({ off: true, by: 'panel', at: now }, null, 2));
  } else {
    fs.writeFileSync(QQ_STATE + '/qq-off.json', JSON.stringify({ off: false, by: 'panel', at: now }, null, 2));
    fs.writeFileSync(QQ_STATE + '/qq-mode.json', JSON.stringify({ mode: ['owneronly', 'privateonly'].includes(mode) ? mode : 'open', by: 'panel', at: now }, null, 2));
  }
  try { require('child_process').execSync(`chown dsh:dsh ${QQ_STATE}/qq-off.json ${QQ_STATE}/qq-mode.json 2>/dev/null || true`); } catch {}
  return qqModeGet();
}

const LOGS = {
  bridge: '/var/log/surfcore-bridge.log',
  asr: '/var/log/asr-shim.log',
  watch: '/var/log/surfcore-bridge-watch.log',
  curate: '/var/log/mem-curate.log',
  console: '/var/log/her-console.log',
};

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };

// PENDING_PATCH：对比「桥接启动时加载的配置」与「磁盘上的配置」，算出哪些改动还没生效
function deepDiff(a, b, prefix = '', out = []) {
  if (out.length >= 40) return out;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const path = prefix ? prefix + '.' + k : k;
      const av = a[k], bv = b[k];
      if (isObj(av) && isObj(bv)) deepDiff(av, bv, path, out);
      else if (JSON.stringify(av) !== JSON.stringify(bv)) out.push({ path, from: av, to: bv });
    }
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: prefix || '(根)', from: a, to: b });
  return out;
}

function personaInfo() {
  try {
    const home = path.join(DSH_HOME, 'surfcore');
    let id = 'char-1';
    try { const cur = JSON.parse(fs.readFileSync(path.join(home, 'characters', 'current.json'), 'utf8')); id = cur.id || cur.character || id; } catch {}
    const dir = path.join(home, 'characters', id);
    const files = [];
    for (const n of ['persona.md', 'persona.tone.md']) {
      try {
        const st = fs.statSync(path.join(dir, n));
        const txt = fs.readFileSync(path.join(dir, n), 'utf8');
        files.push({ name: n, bytes: st.size, lines: txt.split('\n').length, chars: [...txt].length });
      } catch {}
    }
    return { ok: true, id, files };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

function awaitingRestart() {
  const now = readJSON(CFG_PATH, null);
  if (!now) return { ok: false, count: 0, items: [], error: '读不到 config.json' };
  // 桥接写在 apps/surfcore/state（它的 STATE_DIR），不是面板的记忆目录
  const snap = readJSON(QQ_STATE + '/config-loaded.json', null) || readJSON(STATE + '/config-loaded.json', null);
  if (!snap || (!snap.raw && !snap.config)) return { ok: true, count: 0, items: [], at: null, note: '桥接还没记录过启动配置（下次重启后开始统计）' };
  // token 类的键不展示差异，避免把口令写进页面
  const scrub = (o) => {
    const c = JSON.parse(JSON.stringify(o || {}));
    for (const k of Object.keys(c)) if (/token|secret|password/i.test(k)) c[k] = '***';
    if (c.socialV2 && typeof c.socialV2 === 'object') for (const k of Object.keys(c.socialV2)) if (/token|secret/i.test(k)) c.socialV2[k] = '***';
    return c;
  };
  let base = snap.config || null;
  if (snap.raw) {
    try { base = JSON.parse(snap.raw); } catch { base = snap.config || null; }
  }
  const items = base ? deepDiff(base, now) : [];
  // HOT_KEYS：这些键桥接是热更新的（ALLOW_HOT_PATCH），改了立刻生效，不该再提示「重启后生效」
  const HOT_KEYS = /^(?:(?:allow|deny|allowAllWhenEmpty)(?:\.|$)|socialV2\.styleLearn\.enabled$|socialV2\.attention\.)/; // HOT_KEYS_FIX: attention 也是热更新
  const live = items.filter((x) => HOT_KEYS.test(String(x.path || '')));
  const pendingItems = items.filter((x) => !HOT_KEYS.test(String(x.path || '')));
  return { ok: true, count: pendingItems.length, items: pendingItems.slice(0, 20), appliedLive: live.length, at: snap.at };
}

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); let cur = o;
  for (let i = 0; i < ks.length - 1; i += 1) { if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {}; cur = cur[ks[i]]; }
  cur[ks[ks.length - 1]] = v;
}
const sh = (cmd, args, ms = 4000) => new Promise((res) => {
  execFile(cmd, args, { timeout: ms, maxBuffer: 4 << 20, encoding: 'utf8' }, (e, so, se) => res(String(so || '') + String(se || '')));
});
const cfgToken = () => readJSON(CFG_PATH, {})?.consoleToken || '';
const portUp = (port) => new Promise((res) => {
  const s = net.connect({ host: '127.0.0.1', port });
  const done = (v) => { try { s.destroy(); } catch {} res(v); };
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
  s.setTimeout(700, () => done(false));
});

function firstMemoryCard() {
  // 默认取 characters/<任一角色>/memory/memory-card.json（可用 HER_MEMCARD 覆盖）
  try {
    const base = path.join(DSH_HOME, 'surfcore', 'characters');
    const first = fs.readdirSync(base).filter((d) => d.startsWith('char-')).sort()[0];
    if (first) return path.join(base, first, 'memory', 'memory-card.json');
  } catch {}
  return path.join(DSH_HOME, 'surfcore', 'characters', 'char-1', 'memory', 'memory-card.json');
}

async function api(p, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: 3100, path: p, method, timeout: 8000,
      headers: { 'content-type': 'application/json', 'x-console-token': cfgToken(), ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) } },
    (res) => { let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({ ok: false, raw: s.slice(0, 300) }); } }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    if (data) req.write(data);
    req.end();
  });
}

// ---------- 鉴权 ----------
const TOKEN_FILE = path.join(ROOT, 'token.txt');
let HER_TOKEN = '';
function ensureToken() {
  if (fs.existsSync(TOKEN_FILE)) { HER_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); return; }
  HER_TOKEN = crypto.randomBytes(18).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, HER_TOKEN + '\n', { mode: 0o600 });
}
ensureToken();
const tokOk = (t) => typeof t === 'string' && t.length > 0 && crypto.timingSafeEqual(Buffer.from(t.padEnd(64, '\0')), Buffer.from(HER_TOKEN.padEnd(64, '\0')));

// ---------- 数据聚合 ----------
async function overview() {
  const cfg = readJSON(CFG_PATH, {}) || {};
  const [status, mood, daily, loops, style, series, guard] = await Promise.all([
    api('/api/status'), api('/api/socialV2/mood'), api('/api/tokens/daily'),
    api('/api/socialV2/loop', 'POST', { action: 'list' }), api('/api/socialV2/style-list', 'POST', {}),
    api('/api/tokens/series'), api('/api/debug/guard'),
  ]);
  const svc = {};
  for (const u of ['dsh-web', 'asr-shim', 'surfcore-bridge-watch.timer', 'snowluma']) svc[u] = (await sh('systemctl', ['is-active', u])).trim() || 'unknown';
  // ASR_SOCKET_HEALTH（2026-11-03）：socket 按需激活，socket 在监听就算正常
  if (svc['asr-shim'] !== 'active') {
    const _asrSock = (await sh('systemctl', ['is-active', 'asr-shim.socket'])).trim();
    if (_asrSock === 'active') svc['asr-shim'] = 'socket';
  }
  const ss = await sh('ss', ['-lnt']);
  const ports = {};
  for (const p of [3080, 3100, 3001, 6099, 8765, 7800]) ports[p] = ss.includes(':' + p + ' ');
  const napcat = (await sh('docker', ['ps', '--filter', 'name=napcat', '--format', '{{.Status}}'])).trim();
  const np = (await sh('bash', ['-c', 'ps -eo pid,args | grep "[b]ridge.js" | grep -v bash | awk "{print \\$1}"'])).trim().split(/\s+/).filter(Boolean);
  const sends = (await sh('docker', ['logs', '--tail', '300', 'napcat'])).replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n').filter((l) => l.includes('发送 ->')).slice(-8).reverse();
  const tg = (cfg.socialV2 || {}).tokenGuard || {};
  const capEff = guard?.cap ?? tg.maxDailyCostCNY;
  const baseCap = tg.maxDailyCostCNY;
  return {
    ok: true, at: Date.now(), cfgMeta: { ownerQQ: cfg.ownerQQ, mode: status?.mode, role: status?.role, paused: status?.socialV2Paused },
    status: { mode: status?.mode, role: status?.role, paused: !!status?.socialV2Paused, allowGroups: status?.allowGroups || [], allowPrivate: status?.allowPrivate || [] },
    health: { services: svc, ports, napcat, bridgePid: np },
    cost: {
      today: guard?.todayCost ?? daily?.usage?.total?.cost,
      cap: capEff,
      baseCap,
      extra: capEff != null && baseCap != null ? Math.max(0, Math.round((capEff - baseCap) * 100) / 100) : 0,
      ratio: guard?.ratio ?? tg.downgradeAtRatio,
      downgraded: !!guard?.downgraded,
      line: capEff != null && (guard?.ratio ?? tg.downgradeAtRatio) != null ? Math.round(capEff * (guard?.ratio ?? tg.downgradeAtRatio) * 100) / 100 : null,
      by: daily?.usage,
    },
    mood: mood?.values || {},
    loops: loops?.items || [],
    style: { total: style?.stats?.total ?? (style?.samples || []).length, samples: (style?.samples || []).slice(-6) },
    series: series,
    sends,
  };
}

function featuresDTO(live = {}) {
  const reg = readJSON(FEAT_PATH, { features: [] }).features || [];
  const cfg = readJSON(CFG_PATH, {}) || {};
  const video = readJSON(VIDEO_JSON, {}) || {};
  return reg.map((f) => {
    // PENDING_FIX：暂停状态在桥接内存/社交状态文件里，不在 config.json
    if (f.id === 'paused' && typeof live.paused === 'boolean') return { ...f, value: live.paused };
    let v;
    if (f.path.startsWith('@video:')) v = getPath(video, f.path.slice(7));
    else if (f.path.startsWith('@')) v = getPath(cfg, 'socialV2.report.' + 'hour') !== undefined ? '见排期' : '—';
    else v = getPath(cfg, f.path);
    return { ...f, value: v === undefined ? null : v };
  });
}

function memCardFile() {
  const home = path.join(DSH_HOME, 'surfcore');
  let cur = null;
  try { cur = readJSON(path.join(home, 'characters', 'current.json'), null); } catch {}
  const id = cur?.id || cur?.currentId || '';
  return path.join(home, 'characters', id, 'memory', 'memory-card.json');
}

function mutateMem(id, fn) {
  if (!id) return null;
  const f = memCardFile();
  const card = readJSON(f, null);
  if (!card || !Array.isArray(card.records)) return null;
  const rec = card.records.find((r) => r.id === id);
  if (!rec) return null;
  fn(rec);
  try { fs.copyFileSync(f, f + '.bak.her.' + Date.now()); } catch {}
  fs.writeFileSync(f, JSON.stringify(card, null, 2));
  try { fs.chownSync(f, 1000, 1000); } catch {}
  return rec;
}

function memoryMap() {
  const home = path.join(DSH_HOME, 'surfcore');
  let cur = null;
  try { cur = readJSON(path.join(home, 'characters', 'current.json'), null); } catch {}
  const id = cur?.id || cur?.currentId || '';
  const memDir = path.join(home, 'characters', id, 'memory');
  const card = readJSON(path.join(memDir, 'memory-card.json'), { records: [] }) || { records: [] };
  const recs = (card.records || []).map((r) => ({
    id: r.id,
    title: String(r.title || '').slice(0, 80),
    text: String(r.text || r.title || '').slice(0, 300),
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 6) : [],
    importance: Number(r.importance) || 0,
    clarity: r.clarity || '',
    recall: Number(r.recallCount) || 0,
    pinned: !!r.pinned,
    forgotten: !!r.forgottenAt,
    displayOnly: !!r.displayOnly,
    forgottenAt: r.forgottenAt || '',
    groupId: r.groupId || '',
    speaker: String(r.speaker || '').slice(0, 24),
    createdAt: r.createdAt || '',
    lastSeenAt: r.lastSeenAt || '',
  }));
  const sizes = {};
  for (const f of ['memory-card.md', 'memory-card-full.jsonl', 'memory-inbox.jsonl', 'diary.md']) {
    try { sizes[f] = fs.statSync(path.join(memDir, f)).size; } catch { sizes[f] = 0; }
  }
  const byClarity = {};
  const byTag = {};
  for (const r of recs) {
    byClarity[r.clarity || 'unknown'] = (byClarity[r.clarity || 'unknown'] || 0) + 1;
    for (const t of r.tags.length ? r.tags : ['untagged']) byTag[t] = (byTag[t] || 0) + 1;
  }

  // 周增长（最近 8 周）
  const weekOf = (iso) => {
    const t = Date.parse(iso || '');
    if (!t) return null;
    const d = new Date(t);
    const day = (d.getDay() + 6) % 7; // 周一=0
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return dayKey(d); // WEEKKEY_FIX：必须在本地时区取日期，toISOString 会跨时区差一天
  };
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // WEEKS_FIX：固定成「最近 8 个自然周（含本周）」的窗口，不再用「有数据的最后 8 周」——
  // 否则一条 2025 年的旧 B 站动态会把 8 周窗口整个往前拽，看起来像那时就在记东西。
  const weekMap = new Map();
  const thisMonday = new Date();
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
  for (let i = 7; i >= 0; i -= 1) {
    const d = new Date(thisMonday.getTime() - i * 7 * 864e5);
    const key = dayKey(d);
    weekMap.set(key, { week: key, added: 0, forgotten: 0 });
  }
  const oldestWeek = [...weekMap.keys()][0];
  let olderCount = 0;
  for (const r of recs) {
    const w = weekOf(r.createdAt);
    if (!w) continue;
    if (w < oldestWeek) { olderCount += 1; continue; }
    if (weekMap.has(w)) weekMap.get(w).added += 1;
  }
  for (const r of recs) {
    if (!r.forgotten) continue;
    const w = weekOf(r.forgottenAt);
    if (w && weekMap.has(w)) weekMap.get(w).forgotten += 1;
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week));

  // 相似记忆对（非钉住、未忘记；bigram 余弦 >= 0.62）
  const grams = (s) => {
    const t = String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
    const m = new Map();
    for (let i = 0; i < t.length - 1; i += 1) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
  };
  const cos = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k); }
    for (const [, v] of b) nb += v * v;
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  };
  const live = recs.filter((r) => !r.forgotten);
  const G = live.map((r) => ({ r, g: grams(r.title + r.text) }));
  const pairs = [];
  for (let i = 0; i < G.length && pairs.length < 40; i += 1) {
    for (let j = i + 1; j < G.length && pairs.length < 40; j += 1) {
      if (G[i].r.pinned || G[j].r.pinned) continue;
      if (G[i].r.groupId && G[j].r.groupId && G[i].r.groupId !== G[j].r.groupId) continue;
      const sim = cos(G[i].g, G[j].g);
      if (sim < 0.62) continue;
      pairs.push({ sim: Math.round(sim * 1000) / 1000, a: G[i].r, b: G[j].r });
    }
  }
  pairs.sort((x, y) => y.sim - x.sim);

  const cfgAll = readJSON(CFG_PATH, {}) || {};
  const mc = cfgAll.memoryCard || {};

  return {
    ok: true, at: Date.now(), character: id, total: recs.length,
    pinned: recs.filter((r) => r.pinned).length,
    forgotten: recs.filter((r) => r.forgotten).length,
    cap: { records: Number(mc.maxRecords) || 1500, pinned: Number(mc.maxPinned) || 20 },
    sizes, byClarity, byTag, weeks, older: olderCount, pairs, records: recs,
    // MOOD_IN_MEM_PATCH：心情存在 state/mood.json（桥接写的），面板以前没读，所以一直显示「没有数据」
    mood: (readJSON(path.join(STATE, 'mood.json'), {}) || {}).values || {},
    moodAt: (readJSON(path.join(STATE, 'mood.json'), {}) || {}).lastTickAt || null,
  };
}

function backupCfg() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(CFG_PATH, `${CFG_PATH}.bak.panel.${ts}`);
  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(CFG_PATH, path.join(dir, `config-${ts}.json`));
  const files = fs.readdirSync(dir).filter((n) => n.startsWith('config-')).sort();
  while (files.length > 30) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch {} }
}
// PENDING_FIX：原子写（tmp + rename）——半截 JSON 被桥接读到会「改了不生效」
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
  }
  fs.chmodSync(file, 0o600);
  try { fs.chownSync(file, 1000, 1000); } catch {}
}
// PENDING_FIX：写之前严格读，配置坏了就拒绝写，避免用 {} 覆盖整份配置
function readCfgStrict() {
  let text;
  try { text = fs.readFileSync(CFG_PATH, 'utf8'); } catch (e) { throw new Error('读不到 config.json：' + e.message); }
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { throw new Error('config.json 不是合法 JSON，已拒绝改写（先修好配置）：' + e.message); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('config.json 顶层不是对象，已拒绝改写');
  return cfg;
}
function writeCfg(cfg) {
  backupCfg();
  writeJsonAtomic(CFG_PATH, cfg);
}
function coerce(f, raw) {
  if (f.kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error('不是数字');
    if (f.min != null && n < f.min) throw new Error(`不能小于 ${f.min}`);
    if (f.max != null && n > f.max) throw new Error(`不能大于 ${f.max}`);
    return n;
  }
  if (f.kind === 'bool') return raw === true || raw === 'true' || raw === 1 || raw === '1';
  const s = String(raw ?? '');
  if (s.length > 200) throw new Error('太长了（最多 200 字）');
  return s;
}

const EFFECT_TEXT = { hot: '立刻生效', bridge: '需重启桥接', dsh: '需重启面板' };


// ---------- 消耗 / 资源总览（COST_PATCH） ----------
async function procTable() {
  const out = await sh('bash', ['-lc', "ps -eo pid,pcpu,rss,etime,args --no-headers | grep -E 'bridge\\.js|mcp-snowluma-safe|mcp-host-server|her-console/server\\.mjs|asr-shim|dsh-web' | grep -v grep"]);
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    const [_, pid, pcpu, rss, etime, args] = m;
    let name = '未知';
    if (args.includes('bridge.js')) name = 'QQ 桥接';
    else if (args.includes('mcp-snowluma-safe')) name = 'MCP QQ 工具';
    else if (args.includes('mcp-host-server')) name = 'MCP 宿主';
    else if (args.includes('her-console/server.mjs')) name = '面板服务';
    else if (args.includes('asr-shim')) name = '语音识别';
    else if (args.includes('dsh-web')) name = 'DSH Web';
    rows.push({ name, pid: Number(pid), cpu: Number(pcpu), rssMB: Math.round(Number(rss) / 1024), uptime: etime });
  }
  const nap = (await sh('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', 'napcat'])).trim();
  if (nap) {
    const [cpu, mem] = nap.split('|');
    rows.push({ name: 'NapCat（容器）', pid: 0, cpu: parseFloat(cpu) || 0, rssMB: mem || '-', uptime: (await sh('docker', ['ps', '--filter', 'name=napcat', '--format', '{{.Status}}'])).trim() });
  }
  // 去掉 shell 包装进程（rss 太小、args 里也带 bridge.js）
  return rows.filter((r) => !(r.name === 'QQ 桥接' && r.rssMB < 12));
}

async function storeStats() {
  const du = async (p) => Number((await sh('du', ['-sb', p])).trim().split(/\s+/)[0]) || 0;
  const sz = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const cnt = (p, pick) => { try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); return pick(v); } catch { return 0; } };
  const qqState = QQ_STATE;
  const memCard = process.env.HER_MEMCARD || firstMemoryCard();
  const [stApps, stHome, logs] = await Promise.all([
    du(qqState), du(path.join(DSH_HOME, 'surfcore')), du('/var/log'),
  ]);
  return {
    dirs: [
      { name: '桥接 state', bytes: stApps },
      { name: '她的记忆/角色包', bytes: stHome },
      { name: '/var/log 合计', bytes: logs },
    ],
    logs: Object.entries(LOGS).map(([name, p]) => ({ name, bytes: sz(p) })),
    counts: {
      memories: cnt(memCard, (v) => (v.records || v.items || []).length),
      stickers: cnt(qqState + '/stickers.json', (v) => (Array.isArray(v) ? v : (v.items || [])).length),
      styleSamples: cnt(STATE + '/style-samples.json', (v) => (Array.isArray(v) ? v : (v.items || v.samples || [])).length),
      impressions: cnt(STATE + '/impressions.json', (v) => (v.items || []).length),
      loops: cnt(STATE + '/loops.json', (v) => (v.items || []).length),
      people: cnt(STATE + '/people.json', (v) => (Array.isArray(v) ? v : (v.items || [])).length),
    },
  };
}

// HEALTH_PATCH：通道健康（DSH / 桥接 / OneBot / 看门狗 / 各服务）
function shOut(cmd, timeout = 4000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}
function httpCode(url) {
  return shOut("curl -s -o /dev/null -m 4 -w '%{http_code}' " + url) || '000';
}
function unitState(u) {
  return shOut('systemctl is-active ' + u) || 'unknown';
}
function healthInfo() {
  const dsh = httpCode('http://127.0.0.1:3080/');
  const bridge = httpCode('http://127.0.0.1:3100/api/status');
  const estab = shOut("ss -tnp 2>/dev/null | grep ':3001 ' | grep -c ESTAB") || '0';
  const wdLast = shOut('tail -n 1 /var/log/surfcore-bridge-watch.log');
  const wdTrigger = shOut("systemctl show -p LastTriggerUSec --value surfcore-bridge-watch.timer");
  const wdAt = shOut("stat -c %y /var/log/surfcore-bridge-watch.log 2>/dev/null | cut -d. -f1");
  return {
    at: new Date().toISOString(),
    dsh, bridge,
    onebot: Number(estab) > 0, estab: Number(estab),
    units: {
      web: unitState('dsh-web'),
      bridge: unitState('surfcore-bridge'),
      panel: unitState('her-console'),
      asr: unitState('asr-shim') === 'active' ? 'active' : (unitState('asr-shim.socket') === 'active' ? 'socket' : unitState('asr-shim')),
      snowluma: unitState('snowluma'),
      napcat: shOut("docker inspect napcat --format '{{.State.Status}}'") || 'unknown',
      wdTimer: unitState('surfcore-bridge-watch.timer'),
    },
    wdAt, wdLast, wdTrigger,
  };
}

async function costOverview() {
  const [daily, h24, d7, d30, recent, procs, store] = await Promise.all([
    api('/api/tokens/daily'),
    api('/api/tokens/series?hours=24&buckets=24'),
    api('/api/tokens/series?hours=168&buckets=7'),
    api('/api/tokens/series?hours=720&buckets=30'),
    api('/api/tokens/recent?limit=40'),
    procTable(),
    storeStats(),
  ]);
  const sum = (s) => {
    const b = s?.buckets || [];
    const t = { cost: 0, tokens: 0, turns: 0, steps: 0, cacheHit: 0, cacheMiss: 0, output: 0 };
    for (const x of b) { for (const k of Object.keys(t)) t[k] += Number(x[k]) || 0; }
    t.cacheRate = t.cacheHit + t.cacheMiss > 0 ? t.cacheHit / (t.cacheHit + t.cacheMiss) : 0;
    return t;
  };
  const b7 = d7?.buckets || [];
  const yday = b7.length >= 2 ? b7[b7.length - 2] : null;
  const wk = sum(d7);
  const hist = (() => { try { return JSON.parse(fs.readFileSync(STATE + '/token-daily-history.json', 'utf8')); } catch { return []; } })();
  return {
    ok: true, at: Date.now(), symbol: '¥',
    daily: daily?.usage || null, limits: daily?.limits || null,
    today: sum(h24), week: wk, month: sum(d30),
    yesterday: yday ? { cost: yday.cost || 0, tokens: yday.tokens || 0, turns: yday.turns || 0, t: yday.t } : null,
    avg7: wk.cost / Math.max(1, b7.filter((b) => (b.cost || 0) > 0).length || 1),
    series: { h24: h24?.buckets || [], d7: b7, d30: d30?.buckets || [] },
    recent: recent?.entries || [],
    history: Array.isArray(hist) ? hist.slice(-120) : [],
    limitCny: Number(daily?.limits?.qq?.cny ?? 0) || null,
    estimate: (() => {
      // 只取「已经过完的整天」，今天这一格是半天，混进来会把下限压到几分钱
      const days = (b7 || []).slice(0, -1).map((b) => Number(b.cost) || 0).filter((x) => x > 0.2).sort((a, b) => a - b);
      const turns7 = Number(wk.turns) || 0;
      const perTurn = turns7 > 0 ? wk.cost / turns7 : 0;
      const med = days.length ? days[Math.floor(days.length / 2)] : 0;
      const lo = days.length ? days[0] : 0;
      const hi = days.length ? days[days.length - 1] : 0;
      const items = [
        { name: '聊天（私聊 + 群）', note: '按近 7 天每轮均价 × 每天约 150 轮', cny: perTurn * 150 },
        { name: 'B 站学习（每天 4 条视频）', note: '每条约 3~5 千 token', cny: perTurn * 8 },
        { name: '学样（每天 2 轮）', note: '每轮约 2~3 千 token', cny: perTurn * 4 },
        { name: '定时唤醒 / 主动搭话', note: '每天约 20~30 次', cny: perTurn * 25 },
        { name: '表情描述 / 印象整理', note: '零散，按每轮均价折算', cny: perTurn * 3 },
      ];
      return {
        total: items.reduce((a, b) => a + b.cny, 0),
        perTurn,
        perTurnTokens: turns7 > 0 ? (Number(wk.tokens) || 0) / turns7 : 0,
        typical: med, low: lo, high: hi,
        turns7,
        items,
      };
    })(),
    procs, store,
  };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png' };

function send(res, code, obj, type = 'application/json; charset=utf-8') {
  const body = type.startsWith('application/json') ? JSON.stringify(obj) : obj;
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), MIME['.html']);
    }
    if (p.startsWith('/assets/')) {
      const f = path.join(PUBLIC, 'assets', path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { ok: false, error: 'not found' });
      return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
    }
    if (!p.startsWith('/api/')) return send(res, 404, { ok: false, error: 'not found' });

    // 只读接口：给页面自身用；写接口必须带 token
    if (p === '/api/ping') return send(res, 200, { ok: true, needToken: true });
    if (p === '/api/overview') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      return send(res, 200, await overview());
    }
    if (p === '/api/features') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      let live = {};
      try { const act = await api('/api/socialV2/activity'); if (act && typeof act.paused === 'boolean') live.paused = act.paused; } catch {}
      return send(res, 200, { ok: true, features: featuresDTO(live) });
    }
    if (p === '/api/plugins') { // P3-1：插件清单直通桥接（只读；桥接读 docs/generated/manifests.json + 实例补 routes）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const r = await api('/api/plugins');
      if (!r || r.ok === false) return send(res, 502, { ok: false, error: (r && r.error) || '桥接没返回清单' });
      // P2F_F2：桥接不返回 layer，面板从仓库里的 manifest 快照补上
      try {
        const gen = readJSON(path.join(SURFCORE, 'docs/generated/manifests.json'), { modules: [] });
        const byId = new Map((gen.modules || []).map((m) => [m.id, m]));
        for (const m of (r.modules || [])) {
          const g = byId.get(m.id);
          if (!m.layer) m.layer = (g && g.layer) || (m.kind === 'core' ? '运维' : '判断');
          // B1：manifest 里声明的 pages 透传给面板（内置 PAGES 优先，冲突由前端忽略）
          if (!Array.isArray(m.pages) && g && Array.isArray(g.pages)) m.pages = g.pages;
        }
      } catch {}
      return send(res, 200, r);
    }
    if (p === '/api/health') { // HEALTH_PATCH
      send(res, 200, { ok: true, ...healthInfo() });
      return;
    }
    if (p === '/api/cost') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      return send(res, 200, await costOverview());
    }
    if (p === '/api/diagnose') {
      // DIAG_PATCH：用最近的账本算一份「钱花在哪」的诊断，不额外调用模型
      try {
        const [rec, ser] = await Promise.all([
          api('/api/tokens/recent?limit=200'),
          api('/api/tokens/series?hours=24&buckets=24'),
        ]);
        const rows = (rec.entries || []).map((e) => ({
          key: String(e.key || ''), time: e.time, tier: e.tier, cost: Number(e.cost || 0),
          miss: Number(e.cacheMiss || 0), hit: Number(e.cacheHit || 0), out: Number(e.output || 0),
          turn: e.turn, step: e.step,
        }));
        const miss = rows.reduce((a, r) => a + r.miss, 0);
        const hit = rows.reduce((a, r) => a + r.hit, 0);
        const outTok = rows.reduce((a, r) => a + r.out, 0);
        const cost = rows.reduce((a, r) => a + r.cost, 0);
        const missCost = (miss / 1e6) * 1;
        const hitCost = (hit / 1e6) * 0.02;
        const outCost = (outTok / 1e6) * 4;
        const ifHit99 = missCost * 0.02 + hitCost + outCost;
        const byKey = {};
        for (const r of rows) {
          const k = (byKey[r.key] = byKey[r.key] || { key: r.key, steps: 0, cost: 0, miss: 0, hit: 0 });
          k.steps += 1; k.cost += r.cost; k.miss += r.miss; k.hit += r.hit;
        }
        const tot = { cost: 0, turns: 0 };
        for (const b of ser.buckets || []) {
          tot.cost += Number(b.cost || 0);
          tot.turns += Number(b.turns || 0);
        }
        const daily = tot.cost;
        const nowCost = missCost + hitCost + outCost;
        const saveDay = Math.max(0, nowCost - ifHit99) / Math.max(1e-9, cost) * daily;
        return send(res, 200, {
          ok: true,
          window: { steps: rows.length, cost: Number(cost.toFixed(4)), miss, hit, output: outTok },
          split: {
            missCost: Number(missCost.toFixed(4)),
            hitCost: Number(hitCost.toFixed(4)),
            outCost: Number(outCost.toFixed(4)),
            missShare: cost > 0 ? Number(((missCost / cost) * 100).toFixed(1)) : 0,
            hitRate: miss + hit > 0 ? Number(((hit / (hit + miss)) * 100).toFixed(2)) : 0,
          },
          saveIfHit99: Number(saveDay.toFixed(3)),
          top: rows.slice().sort((a, b) => b.cost - a.cost).slice(0, 5).map((r) => ({
            cost: Number(r.cost.toFixed(4)), key: r.key, miss: r.miss, hit: r.hit, turn: r.turn, step: r.step,
          })),
          byKey: Object.values(byKey).sort((a, b) => b.cost - a.cost).slice(0, 6).map((k) => ({
            key: k.key, steps: k.steps, cost: Number(k.cost.toFixed(4)), miss: k.miss, hit: k.hit,
          })),
          day: { cost: Number(daily.toFixed(2)), turns: tot.turns, perTurn: tot.turns ? Number((daily / tot.turns).toFixed(4)) : 0 },
        });
      } catch (e) {
        return send(res, 500, { ok: false, error: String((e && e.message) || e) });
      }
    }
    if (p === '/api/cost.csv') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const o = await costOverview();
      const rows = [['time', 'session', 'turn', 'step', 'model', 'tokens', 'cacheHit', 'cacheMiss', 'output', 'cost', 'tier']];
      for (const e of o.recent || []) {
        rows.push([new Date(e.time || 0).toISOString(), e.key || '', e.turn ?? '', e.step ?? '', e.model || '',
          e.tokens ?? '', e.cacheHit ?? '', e.cacheMiss ?? '', e.output ?? '', Number(e.cost || 0).toFixed(6), e.tier || '']);
      }
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="cost-${new Date().toISOString().slice(0, 10)}.csv"` });
      return res.end('\uFEFF' + rows.map((r) => r.join(',')).join('\n'));
    }
    if (p === '/api/impr') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody();
        const r = await api('/api/socialV2/impression', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/impression', 'POST', { action: 'list' });
      return send(res, 200, r || { ok: false });
    }
    if (p === '/api/mute') { // MUTE_PATCH：静音名单（不删白名单，随时恢复）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const r = await api('/api/socialV2/mute', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/mute', 'POST', { action: 'list' });
      return send(res, 200, r || { ok: false });
    }
    if (p === '/api/learn') { // LEARN_MODE_UI：学习模式（只看不聊）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const r = await api('/api/socialV2/learnmode', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/learnmode', 'POST', { action: 'list' });
      return send(res, 200, r || { ok: false });
    }

    if (p === '/api/decision-stats') { // P2-D：误判分析
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const DIR = path.join(QQ_STATE, 'decision');
      let marks = {}; try { marks = JSON.parse(fs.readFileSync(path.join(QQ_STATE, 'decision-marks.json'), 'utf8')) || {}; } catch {}
      let rows = [];
      try { rows = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)); } catch {}
      const by = {};
      const day = String(new URL(req.url, 'http://x').searchParams.get('day') || '').trim();
      for (const f of rows) {
        if (day && f !== day + '.jsonl') continue;
        let raw = ''; try { raw = fs.readFileSync(path.join(DIR, f), 'utf8'); } catch { continue; }
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          let r; try { r = JSON.parse(line); } catch { continue; }
          if (r.type !== 'decision') continue;
          const src = String(r.source || (r.allow ? 'ext' : 'unknown'));
          const b = (by[src] = by[src] || { source: src, total: 0, marked: 0, missed: 0, wrong: 0, off: 0 });
          b.total++;
          const m = marks[r.id];
          if (!m) continue;
          b.marked++;
          if (m === '该回没回') b.missed++;
          else if (m === '不该回却回') b.wrong++;
          else if (m === '答非所问') b.off++;
        }
      }
      const list = Object.values(by).map((b) => {
        const bad = b.missed + b.wrong + b.off;
        return { ...b, bad, rate: b.marked ? Math.round((bad / b.marked) * 100) : 0 };
      }).sort((a, b) => b.bad - a.bad || b.total - a.total);
      return send(res, 200, { ok: true, total: list.reduce((s, x) => s + x.total, 0), marked: list.reduce((s, x) => s + x.marked, 0), sources: list });
    }

    if (p === '/api/human-report') { // B3：人味周报（脚本生成的 JSON，只读）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const file = path.join(SURFCORE, 'docs/reports/human-report.json');
      try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        return send(res, 200, { ok: true, ...d, file });
      } catch {
        return send(res, 200, { ok: true, weeks: [], missing: true });
      }
    }
    if (p === '/api/human-stats') { // P2-D：人味指标
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      let social = { conversations: {} };
      try { social = JSON.parse(fs.readFileSync(path.join(QQ_STATE, 'social-v2.json'), 'utf8')) || social; } catch {}
      const NOW = Date.now(), W = 7 * 86400000;
      const STOP = new Set('的 了 是 在 我 你 他 她 它 们 这 那 有 和 就 都 也 不 吗 呢 啊 吧 呀 嘛 个 一 会 要 说 去 来 好 很 还 但 而 被 把 给 让 对 从 到 与 或 及 着 过 地 得 么 什么 怎么 因为 所以 如果 就是 可以 我们 你们'.split(' '));
      const bigrams = (s) => { const t = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ''); const out = new Set(); for (let i = 0; i + 2 <= t.length; i++) { const g = t.slice(i, i + 2); if (!STOP.has(g[0]) && !STOP.has(g[1])) out.add(g); } return out; };
      const pct = (n, d) => (d ? n / d : 0);
      const MARK = ['总的来说', '说到底', '其实', '需要注意的是', '可以理解', '换句话说', '简单说', '总之'];
      const bucket = () => ({ lens: { group: [], private: [] }, ov: [], punc: { '。': 0, '！': 0, '？': 0, '…': 0, other: 0 }, sum: 0, sentences: 0, n: 0 });
      const wk = { cur: bucket(), prev: bucket() };
      for (const [key, conv] of Object.entries(social.conversations || {})) {
        const isGroup = key.startsWith('group:');
        const msgs = Array.isArray(conv.recentMessages) ? conv.recentMessages : [];
        for (let i = 0; i < msgs.length; i++) {
          const m = msgs[i];
          if (!m || !m.isSelf) continue;
          const t = Number(m.time || 0);
          if (!t || NOW - t > 2 * W) continue;
          const b = t >= NOW - W ? wk.cur : (t >= NOW - 2 * W ? wk.prev : null);
          if (!b) continue;
          const text = String(m.plain || m.text || '').trim();
          if (!text) continue;
          b.n++;
          b.lens[isGroup ? 'group' : 'private'].push(text.length);
          for (const ch of '。！？…') b.punc[ch] += (text.split(ch).length - 1);
          b.punc.other += 0;
          for (const part of text.split(/[。！？\n]+/).filter((x) => x.trim())) {
            b.sentences++;
            if (MARK.some((w) => part.includes(w))) b.sum++;
          }
          let trig = null;
          for (let j = i - 1; j >= 0; j--) if (msgs[j] && !msgs[j].isSelf && String(msgs[j].plain || msgs[j].text || '').trim()) { trig = String(msgs[j].plain || msgs[j].text).trim(); break; }
          if (trig) {
            const A = bigrams(text), B2 = bigrams(trig);
            if (B2.size) b.ov.push(pct([...A].filter((g) => B2.has(g)).length, B2.size));
          }
        }
      }
      const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
      const sum = (b) => { const tot = Object.values(b.punc).reduce((x, y) => x + y, 0) || 1; return { n: b.n, lenG: med(b.lens.group), lenP: med(b.lens.private), ov: avg(b.ov), punc: Object.fromEntries(Object.entries(b.punc).map(([k, v]) => [k, Math.round((v / tot) * 100)])), sumRatio: b.sentences ? b.sum / b.sentences : 0 }; };
      return send(res, 200, { ok: true, cur: sum(wk.cur), prev: sum(wk.prev) });
    }

    if (p === '/api/attn-get') { // ATTNGET_PATCH
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const CFG = process.env.SURFCORE_CONFIG || '/home/dsh/apps/surfcore/config.json';
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch {}
      const at = (cfg.socialV2 && cfg.socialV2.attention) || {};
      return send(res, 200, { ok: true, replyOnly: at.replyOnly || {}, sample: at.sample || {}, maxPerDay: at.maxPerDay || 0 });
    }

    if (p === '/api/attn-set') { // ATTNSET_PATCH：转发到桥接；桥接还是旧版（404）时回退为本地写 config
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const gid = String(body.group || '').replace('group:', '');
      if (!gid) return send(res, 400, { ok: false, error: 'group 不能为空' });
      const fallback = () => {
        const CFG = process.env.SURFCORE_CONFIG || '/home/dsh/apps/surfcore/config.json';
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (e) { return send(res, 500, { ok: false, error: 'config 读取失败' }); }
        cfg.socialV2 = cfg.socialV2 || {};
        const at = (cfg.socialV2.attention = cfg.socialV2.attention || {});
        at.replyOnly = at.replyOnly || {};
        at.sample = at.sample || {};
        if (body.replyOnly !== undefined) {
          const list = String(body.replyOnly || '').split(/[,，\s]+/).filter(Boolean);
          if (list.length) at.replyOnly[gid] = list; else delete at.replyOnly[gid];
        }
        if (body.sample !== undefined) {
          const n = Math.max(0, Math.min(50, Number(body.sample) || 0));
          if (n > 0) at.sample[gid] = n; else delete at.sample[gid];
        }
        try {
          const tmp = CFG + '.tmp-attnset';
          fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
          fs.renameSync(tmp, CFG);
        } catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
        return send(res, 200, { ok: true, group: gid, replyOnly: at.replyOnly[gid] || [], sample: at.sample[gid] || 0, via: 'local' });
      };
      try {
        const r = await fetch('http://127.0.0.1:3100/api/socialV2/attn-set', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-console-token': cfgToken() },
          body: JSON.stringify({ group: gid, ...(body.replyOnly !== undefined ? { replyOnly: body.replyOnly } : {}), ...(body.sample !== undefined ? { sample: body.sample } : {}) }),
        });
        if (r.status === 404) return fallback();
        const j = await r.json().catch(() => ({ ok: false, error: '桥接返回非 JSON' }));
        return send(res, r.ok && j.ok !== false ? 200 : 502, j);
      } catch (e) { return fallback(); }
    }

    if (p === '/api/utts' || p === '/api/utts-mark') { // UTTS_PATCH：她说的话
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const SURF = process.env.SURFCORE_DIR || '/home/dsh/apps/surfcore';
      const convFile = path.join(SURF, 'state', 'social-v2.json');
      const markFile = path.join(STATE, 'utterance-marks.json');
      const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
      const marks = readJson(markFile, {});
      if (p === '/api/utts-mark') {
        const id = String(body.id || '');
        if (!id) return send(res, 400, { ok: false, error: 'id 不能为空' });
        const tag = String(body.tag || '').slice(0, 20);
        const note = String(body.note || '').slice(0, 200);
        if (!tag && !note) delete marks[id]; else marks[id] = { tag, note, at: Date.now() };
        try { fs.writeFileSync(markFile, JSON.stringify(marks)); } catch (e) { return send(res, 500, { ok: false, error: String(e.message || e) }); }
        return send(res, 200, { ok: true });
      }
      const conv = readJson(convFile, {});
      const convs = conv.conversations || {};
      const since = Date.now() - Math.max(1, Number(body.sinceHours) || 72) * 3600 * 1000;
      const wantKey = String(body.key || '');
      const wantTag = String(body.tag || '');
      const out = [];
      for (const [ck, c] of Object.entries(convs)) {
        if (wantKey && ck !== wantKey) continue;
        const ms = (c && (c.recentMessages || c.messages)) || [];
        for (const m of ms) {
          if (!m) continue;
          const sname = typeof m.sender === 'string' ? m.sender : String((m.sender && (m.sender.name || m.sender.nickname)) || '');
          const isSelf2 = m.isSelf === true || sname === '我' || sname === '三叶' || Number(m.userId || 0) === 3042876599;
          if (!isSelf2) continue;
          const t = Number(m.time || m.at || 0);
          if (t && t < since) continue;
          const id = String(m.messageId || m.id || m.seq || (ck + ':' + t));
          const mk = marks[id] || {};
          if (wantTag && (mk.tag || '') !== wantTag) continue;
          out.push({ id, key: ck, at: t, text: String(m.plain || m.text || ''), tag: mk.tag || '', note: mk.note || '' });
        }
      }
      out.sort((a, b) => b.at - a.at);
      const tags = {};
      out.forEach((x) => { if (x.tag) tags[x.tag] = (tags[x.tag] || 0) + 1; });
      return send(res, 200, { ok: true, total: out.length, tags, items: out.slice(0, Math.max(1, Math.min(500, Number(body.limit) || 200))) });
    }

    if (p === '/api/people') { // PEOPLE_PROXY
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const r = await api('/api/socialV2/people', 'POST', body);
      return send(res, r?.ok ? 200 : 400, r || { ok: false });
    }
    if (p === '/api/people-mark') { // PEOPLE_PROXY
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = await readBody(req);
      const r = await api('/api/socialV2/people-mark', 'POST', body);
      return send(res, r?.ok ? 200 : 400, r || { ok: false });
    }
    if (p === '/api/names') { // NAMES_PROXY：把号码翻成名字
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      // 先读本地 names.json（桥接查名偶尔返回空，本地缓存更可靠），再叠桥接结果
      const local = readJSON(path.join(QQ_STATE, 'names.json'), {}) || {};
      let r = null;
      try { r = await api('/api/socialV2/names', 'POST', body); } catch {}
      const normalize = (m) => {
        const out = {};
        for (const [k, v] of Object.entries(m || {})) {
          if (typeof v === 'string') out[k] = { name: v };
          else if (v && typeof v === 'object') out[k] = v;
        }
        return out;
      };
      const groups = { ...normalize(local.groups), ...normalize(r && r.groups) };
      const users = { ...normalize(local.users), ...normalize(r && r.users) };
      return send(res, 200, { ok: true, groups, users });
    }
    if (p === '/api/style-bulk') { // STYLE_BULK_UI
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = await readBody(req);
      const raw = String(body?.text || '');
      const lines = raw.split(/\r?\n/).map((x) => x.replace(/^\s*[-*\d.、)）]+\s*/, '').trim()).filter((x) => x.length >= 6 && x.length <= 120);
      if (!lines.length) return send(res, 400, { ok: false, error: '没识别到句子（每行一句，6~120 字）' });
      let added = 0, dup = 0, bad = 0;
      for (const t of lines.slice(0, 40)) {
        const r = await api('/api/socialV2/style-note', 'POST', { text: t, from: '亚托莉', why: '手动导入（我转的聊天记录）' });
        if (r && r.ok) { if (r.duplicated) dup++; else added++; } else bad++;
      }
      return send(res, 200, { ok: true, added, dup, bad, total: lines.length });
    }
    if (p === '/api/style-short') { // 从长句里拆一条能直接说的短句
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method !== 'POST') return send(res, 405, { ok: false });
      const body = await readBody(req);
      const id = String(body.id || '');
      const file = path.join(STATE, 'style-samples.json');
      const data = readJSON(file, { samples: [] });
      const item = (data.samples || []).find((x) => x.id === id);
      if (!item) return send(res, 404, { ok: false, error: '没有这条样本' });
      const parts = String(item.text || '')
        .split(/[，。！？；、…\n]+/)
        .map((x) => x.trim())
        .filter((x) => x.length >= 6 && x.length <= 24);
      const short = parts[0] || String(item.text || '').slice(0, 20);
      item.short = short;
      item.updatedAt = new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return send(res, 200, { ok: true, id, short });
    }
    if (p === '/api/style-now') { // STYLE_NOW_UI
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      try {
        fs.writeFileSync(path.join(QQ_STATE, 'style-learn-now.json'), JSON.stringify({ at: Date.now() }));
        return send(res, 200, { ok: true, hint: '一分钟内她会去群里翻一轮' });
      } catch (e) { return send(res, 500, { ok: false, error: String(e && e.message || e) }); }
    }
    if (p === '/api/style-add') { // STYLE_NOW_UI
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = await readBody(req);
      const text = String(body?.text || '').trim();
      if (!text) return send(res, 400, { ok: false, error: '写一句话' });
      const r = await api('/api/socialV2/style-note', 'POST', { text, from: '亚托莉', why: body?.why || '手动添加（我看上了）' });
      return send(res, r?.ok ? 200 : 400, r || { ok: false });
    }
    if (p === '/api/selfcheck') { // SELFCHECK_PATCH
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const f = path.join(STATE, 'selfcheck.json');
      const d = readJSON(f, null);
      return send(res, 200, d || { ok: null, items: [], error: '还没跑过自检' });
    }
    if (p === '/api/media-stats') { // TASK-INPUT #4：媒体观测（bridge 写 state/media-stats.json）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const d = readJSON(path.join(QQ_STATE, 'media-stats.json'), null);
      return send(res, 200, d || { day: '', withMedia: 0, looked: 0, failed: 0, reasons: {}, missing: true });
    }
    if (p === '/api/commands') { // 命令大全（静态表，与桥接里的 /帮助 保持一致）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const LIST = [
        ['常用', '/花费', '今天花了多少（额度、峰谷、各群）'],
        ['常用', '/花费', '/cost 同义'],
        ['常用', '/心情', '她现在的情绪'],
        ['常用', '/状态', '开关、今日花费、静音列表、桥接运行时长'],
        ['常用', '/静音 本群', '这个群不接话（在群里发，不用输号）'],
        ['常用', '/静音 群名', '按群名静音，如「/静音 学术部」'],
        ['常用', '/静音 QQ号', '这个人私聊不接话'],
        ['常用', '/恢复 本群', '取消静音'],
        ['常用', '/恢复 群名', '按群名恢复'],
        ['常用', '/静音列表', '看现在关了哪些'],
        ['常用', '/全开', '群里按规则回'],
        ['常用', '/只听主人', '群里只回你'],
        ['常用', '/关机', '彻底静默（5 分钟内再发一次确认）'],
        ['常用', '/开机', '从关机恢复'],
        ['群与人', '/好友', '看待处理的好友申请'],
        ['群与人', '/同意好友 QQ号', '通过好友'],
        ['群与人', '/拒绝好友 QQ号', '拒绝好友'],
        ['群与人', '/同意头像', '允许她换头像'],
        ['群与人', '/不同意头像', '拒绝换头像'],
        ['群与人', '/学', '现在就学一个技术视频'],
        ['群与人', '/学习', '今天的学习任务状态'],
        ['群与人', '/reset', '清空这个会话的上下文'],
        ['群与人', '/重启', '重启桥接（约 20 秒）'],
        ['其它', '/加油 N', '今天临时加 N 元额度'],
        ['其它', '/谷价', '今天整天按谷价算'],
        ['其它', '/谷价关', '取消今天的谷价'],
        ['其它', '/谷价表', '看人工谷价日'],
        ['其它', '/silent', '只回你、不回群友（旧版，等同 /只听主人）'],
        ['其它', '/active', '取消 /silent'],
        ['其它', '/帮助', '分页帮助（/帮助 2、/帮助 3、/帮助 开关）'],
        ['自然语言（私聊）', '今天花了多少', '直接回花费，不调模型'],
        ['自然语言（私聊）', '她什么状态', '直接回状态，不调模型'],
      ].map(([g, cmd, desc]) => ({ g, cmd, desc }));
      return send(res, 200, { ok: true, items: LIST });
    }

    if (p === '/api/gr') { // 群发言频率
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const r = await api('/api/socialV2/grouprate', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/grouprate', 'POST', { action: 'list' });
      return send(res, 200, r || { ok: false });
    }
    if (p === '/api/active-window') { // D-3：活跃期（只读）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      let items = [];
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(QQ_STATE, 'active-window.json'), 'utf8') || '{}');
        const now = Date.now();
        items = Object.keys(raw)
          .filter((k) => Number(raw[k] && raw[k].until) > now)
          .map((k) => ({ key: k, by: (raw[k] && raw[k].by) || 'owner', minutesLeft: Math.max(0, Math.ceil((Number(raw[k].until) - now) / 60000)) }));
      } catch {}
      return send(res, 200, { ok: true, items });
    }
    if (p === '/api/preset') { // E-3：三档总览（只写现有字段，不改判断逻辑）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const rdj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8') || 'null') || d; } catch { return d; } };
      const cfgNow = rdj(CFG_PATH, {});
      const at0 = (((cfgNow.socialV2 || {}).attention) || {});
      const sampleMap = at0.sample || {};
      const capCfg = ((cfgNow.socialV2 || {}).tokenGuard || {}).maxDailyCostCNY;
      if (req.method === 'GET') {
        const rates = await api('/api/socialV2/grouprate', 'POST', { action: 'list' });
        const muted = rdj(path.join(STATE, 'muted-keys.json'), {}).items || {};
        const learn = (rdj(path.join(STATE, 'learn-mode.json'), {}).groups) || {};
        let pm = null;
        try { pm = await import('file:///home/dsh/apps/surfcore/scripts/preset-mode.mjs'); } catch {}
        const groups = ((rates && rates.rates) || []).map((r) => {
          const key = 'group:' + r.gid;
          // F-2：与单测共用 scripts/preset-mode.mjs 的推导，避免两处各写一份
          const smp = Number(sampleMap[r.gid] || 0);
          const mode = pm ? pm.derivePresetMode({ learned: !!learn[r.gid], muted: !!muted[key] }) : (learn[r.gid] ? 'watch' : (muted[key] ? 'called' : 'normal'));
          const activity = pm ? pm.derivePresetActivity({ sample: smp, level: r.level }) : (smp >= 1 ? 'active' : (smp > 0 ? 'normal' : (r.level === 'active' ? 'active' : (r.level === 'quiet' ? 'quiet' : 'normal'))));
          return { gid: r.gid, mode, activity, level: r.level, sample: smp, count: r.count || 0, maxPerDay: r.maxPerDay, minGapMs: r.minGapMs, lastAt: r.lastAt || 0 };
        });
        return send(res, 200, { ok: true, groups, dailyLimit: capCfg ?? null });
      }
      const body = await readBody(req);
      const gid = String(body.group || '').replace('group:', '');
      if (!/^\d+$/.test(gid)) return send(res, 400, { ok: false, error: 'group 必须是群号' });
      const applied = {};
      if (body.mode === 'normal' || body.mode === 'called' || body.mode === 'watch') {
        const key = 'group:' + gid;
        await api('/api/socialV2/mute', 'POST', { action: body.mode === 'called' ? 'mute' : 'unmute', key });
        await api('/api/socialV2/learnmode', 'POST', { action: body.mode === 'watch' ? 'on' : 'off', group: gid });
        applied.mode = body.mode;
      }
      if (body.activity === 'quiet' || body.activity === 'normal' || body.activity === 'active') {
        await api('/api/socialV2/grouprate', 'POST', { action: 'set', group: gid, level: body.activity });
        const cfg2 = rdj(CFG_PATH, {});
        cfg2.socialV2 = cfg2.socialV2 || {};
        cfg2.socialV2.attention = cfg2.socialV2.attention || {};
        cfg2.socialV2.attention.sample = cfg2.socialV2.attention.sample || {};
        const pct = body.activity === 'active' ? 1 : (body.activity === 'normal' ? 0.3 : 0);
        if (pct > 0) cfg2.socialV2.attention.sample[gid] = pct; else delete cfg2.socialV2.attention.sample[gid];
        writeJsonAtomic(CFG_PATH, cfg2);
        applied.activity = body.activity;
      }
      return send(res, 200, { ok: true, group: gid, applied });
    }

    // ---------- P1 决策记录 ----------
    if (p === '/api/decisions') { // DECISION_UI
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const day = (url.searchParams.get('day') || '').trim() || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      const q = (k) => (url.searchParams.get(k) || '').trim();
      const file = path.join(QQ_STATE, 'decision', day + '.jsonl');
      const lines = (() => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; } })();
      const byId = new Map();
      for (const line of lines) {
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.type === 'outcome') { const b = byId.get(r.id); if (b) { b.replied = r.replied; b.outbound = r.outbound; b.latencyMs = r.latencyMs; if (r.reply) b.reply = r.reply; } continue; }
        byId.set(r.id, r);
      }
      let items = [...byId.values()];
      const allowQ = q('allow');
      if (allowQ === 'true' || allowQ === 'false') items = items.filter((x) => String(x.allow) === allowQ);
      if (q('key')) items = items.filter((x) => String(x.key || '').includes(q('key')));
      if (q('source')) items = items.filter((x) => String(x.source || '') === q('source'));
      const minS = q('minScore'); const maxS = q('maxScore');
      if (minS !== '') items = items.filter((x) => Number(x.score) >= Number(minS));
      if (maxS !== '') items = items.filter((x) => Number(x.score) <= Number(maxS));
      items.sort((a, b) => b.ts - a.ts);
      const marksPath = path.join(QQ_STATE, 'decision-marks.json');
      let marks = {}; try { marks = JSON.parse(fs.readFileSync(marksPath, 'utf8')) || {}; } catch {}
      const markOf = (id) => marks[id] || '';
      if (q('unmarked') === '1') items = items.filter((x) => !markOf(x.id));
      const total = byId.size;
      const allow = [...byId.values()].filter((x) => x.allow).length;
      const replied = [...byId.values()].filter((x) => x.replied === true).length;
      const marked = [...byId.values()].filter((x) => markOf(x.id)).length;
      const top = new Map();
      for (const x of byId.values()) { if (x.allow) continue; const k = x.source || 'unknown'; top.set(k, (top.get(k) || 0) + 1); }
      const topSources = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return send(res, 200, { ok: true, day, total: items.length, items: items.slice(0, 300), marks, stats: { total, allow, block: total - allow, replied, marked, topSources } });
    }
    if (p === '/api/decisions/mark') { // DECISION_MARK
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = await readBody(req);
      const id = String(body.id || '').trim();
      const mark = String(body.mark || '').trim();
      const ALLOWED = ['正常', '该回没回', '不该回却回', '答非所问', ''];
      if (!id || !ALLOWED.includes(mark)) return send(res, 400, { ok: false, error: 'id/mark 不合法' });
      const marksPath = path.join(QQ_STATE, 'decision-marks.json');
      let marks = {}; try { marks = JSON.parse(fs.readFileSync(marksPath, 'utf8')) || {}; } catch {}
      if (mark) marks[id] = mark; else delete marks[id];
      writeJsonAtomic(marksPath, marks);
      return send(res, 200, { ok: true, id, mark });
    }
    if (p === '/api/decisions/export') { // DECISION_CSV
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const day = (url.searchParams.get('day') || '').trim() || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      const file = path.join(QQ_STATE, 'decision', day + '.jsonl');
      const byId = new Map();
      try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
          let r; try { r = JSON.parse(line); } catch { continue; }
          if (r.type === 'outcome') { const b = byId.get(r.id); if (b) { b.replied = r.replied; b.latencyMs = r.latencyMs; if (r.reply) b.reply = r.reply; } continue; }
          byId.set(r.id, r);
        }
      } catch {}
      const marksPath = path.join(QQ_STATE, 'decision-marks.json');
      let marks = {}; try { marks = JSON.parse(fs.readFileSync(marksPath, 'utf8')) || {}; } catch {}
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const rows = ['时间,会话,消息摘要,分数,最终,拦截来源,是否回了,延迟ms,标注,经过层'];
      for (const x of [...byId.values()].sort((a, b) => a.ts - b.ts)) {
        rows.push([new Date(x.ts).toLocaleString('zh-CN'), x.key, x.text, x.score == null ? '' : x.score,
          x.allow ? '放行' : '拦截', x.source, x.replied === true ? '是' : (x.replied === false ? '否' : '未知'),
          x.latencyMs == null ? '' : x.latencyMs, marks[x.id] || '',
          (x.layers || []).map((l) => l.id + ':' + (l.allow ? 'pass' : 'block')).join(' ')].map(esc).join(','));
      }
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="decisions-' + day + '.csv"' });
      res.end('\ufeff' + rows.join('\r\n'));
      return;
    }
    if (p === '/api/persona') return sendJson(res, personaInfo());
  if (p === '/api/econ') { // 省钱模式（少说话，可按群）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const r = await api('/api/socialV2/economy', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/economy', 'POST', { action: 'list' });
      return send(res, 200, r || { ok: false });
    }
    if (p === '/api/safe') { // 敏感话题守门
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (body.action === 'setcfg') {
          const cfg = readCfgStrict();
          cfg.socialV2 = cfg.socialV2 || {};
          cfg.socialV2.safeTalk = cfg.socialV2.safeTalk || {};
          if (typeof body.mode === 'string') cfg.socialV2.safeTalk.mode = body.mode;
          if (body.hits != null) cfg.socialV2.safeTalk.hits = Math.max(1, Math.min(20, Number(body.hits) || 3));
          if (body.windowMin != null) cfg.socialV2.safeTalk.windowMin = Math.max(1, Math.min(1440, Number(body.windowMin) || 30));
          if (body.coolMin != null) cfg.socialV2.safeTalk.coolMin = Math.max(1, Math.min(1440, Number(body.coolMin) || 30));
          if (Array.isArray(body.words)) { // SAFEWORDS_PATCH：面板里直接编词表
            cfg.socialV2.safeTalk.words = body.words.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean).slice(0, 200);
          }
          writeCfg(cfg);
          return send(res, 200, { ok: true, note: '已写入 config.json，重启桥接后生效' });
        }
        const r = await api('/api/socialV2/safetalk', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/safetalk', 'POST', { action: 'list' });
      return send(res, 200, r || { ok: false });
    }
    if (p === '/api/mood/plus') { // MOODPLUS_PATCH：面板点气泡加心情
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const body = await readBody(req);
      const r = await api('/api/socialV2/mood', 'POST', { action: 'bump', key: body.key, delta: Number(body.delta) || 5 });
      return send(res, r?.ok ? 200 : 400, r || { ok: false });
    }
    if (p === '/api/mood/history') { // MOODHIST_PATCH：面板画情绪曲线
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const d = readJSON(path.join(STATE, 'mood.json'), {}) || {};
      return send(res, 200, { ok: true, history: Array.isArray(d.history) ? d.history.slice(-240) : [], current: d.current || '', values: d.values || {} });
    }
    if (p === '/api/pending') { // PENDING_PATCH
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      return send(res, 200, awaitingRestart());
    }
    if (p === '/api/style') { // STYLE_GATE_PATCH
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      if (req.method === 'POST') {
        const body = await readBody();
        if (body.action === 'setcfg') { // STYLECFG_PATCH：改「学谁 / 在哪学」
          const cfg = readCfgStrict();
          cfg.socialV2 = cfg.socialV2 || {};
          cfg.socialV2.styleLearn = cfg.socialV2.styleLearn || {};
          const qq = String(body.targetQQ || '').replace(/\D/g, '');
          if (qq) cfg.socialV2.styleLearn.targetQQ = qq;
          if (Array.isArray(body.groups)) {
            const gs = body.groups.map((x) => String(x).replace(/\D/g, '')).filter(Boolean);
            cfg.socialV2.styleLearn.groups = gs;
          }
          if (typeof body.exemptEconomy === 'boolean') cfg.socialV2.styleLearn.exemptEconomy = body.exemptEconomy; // STYLE_EXEMPT_PATCH
          writeCfg(cfg);
          return send(res, 200, { ok: true, note: '已写入 config.json，重启桥接后生效' });
        }
        const r = await api('/api/socialV2/style-candidate', 'POST', body);
        return send(res, r?.ok ? 200 : 400, r || { ok: false });
      }
      const r = await api('/api/socialV2/style-list');
      const cfgAll = readJSON(CFG_PATH, {}) || {}; // STYLECFG_PATCH：把「学谁 / 在哪学」一起给前端
      const sl = (cfgAll.socialV2 || {}).styleLearn || {};
      return send(res, 200, {
        ...(r || {}),
        cfg: {
          targetQQ: String(sl.targetQQ || ''),
          groups: (sl.groups || []).map(String),
          strictTarget: sl.strictTarget !== false,
          exemptEconomy: sl.exemptEconomy !== false,
          rounds: sl.rounds || [],
          perRound: sl.perRound ?? 2,
        },
      });
    }
    if (p === '/api/mem') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      return send(res, 200, memoryMap());
    }
    if (p === '/api/entry') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const items = [
        { name: 'DSH 主界面', port: 3080, hint: '跟她在 DSH 里对话 / 改插件设置' },
        { name: 'QQ 桥接控制台', port: 3100, hint: '人格卡、白名单、花费、测试发送' },
        { name: 'NapCat 面板', port: 6099, hint: '扫码登录、OneBot、好友请求' },
        { name: '花费面板（本机）', port: 7788, hint: '每次对话花了多少（跑在你自己电脑上，启动器会顺带开）', local: true },
      ];
      const out = [];
      for (const it of items) {
        const up = it.local ? null : await portUp(it.port);
        out.push({ ...it, up, url: `http://127.0.0.1:${it.port}/${it.port === 6099 ? 'webui/' : ''}` });
      }
      {
        // ENTRY_COST_SELF：原来指向本机 7788，已废
      }
      return send(res, 200, { ok: true, items: out, self: PORT });
    }
    if (p === '/api/access' && req.method === 'GET') { // ACCESS_METHOD_PATCH：不加方法判断会吞掉 POST（表现为「提示成功但没写进去」）
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const cfg = readJSON(CFG_PATH, {}) || {};
      const groups = [...new Set((cfg.allow?.groups || []).map(String))];
      const priv = [...new Set((cfg.allow?.private || []).map(String))];
      // 最近出现过的会话（来自 social-v2，比翻日志可靠）
      let seen = [];
      try {
        const social = readJSON(SOCIAL_PATH, {}) || {};
        const convs = social.conversations || {};
        seen = Object.keys(convs)
          .filter((k) => k.startsWith('group:'))
          .map((k) => k.slice(6))
          .filter((g) => !groups.includes(g))
          .slice(0, 12);
      } catch {}
      return send(res, 200, { ok: true, groups, private: priv, seen, allowAll: !!cfg.allowAllWhenEmpty });
    }
    if (p === '/api/why') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const key = String(url.searchParams.get('key') || '');
      const social = readJSON(SOCIAL_PATH, {}) || {};
      const conv = social.conversations?.[key] || social[key] || null;
      const gid = (key.match(/(\d{5,12})/) || [])[1] || '';
      let lines = [], reasons = [];
      try {
        const txt = fs.readFileSync(LOGS.bridge, 'utf8').split('\n');
        const touched = txt.filter((l) => gid && l.includes(gid));
        lines = touched.slice(-14).map((l) => l.replace(/^\S+\s+\S+\s+/, ''));
        reasons = txt.filter((l) => gid && l.includes(gid) && /跳过唤醒|鱼群保护|高峰|降级|次数/.test(l)).slice(-8)
          .map((l) => l.replace(/^\S+\s+\S+\s+/, ''));
      } catch {}
      return send(res, 200, { ok: true, key, conv, gid, lines, reasons });
    }
    if (p === '/api/backups') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      let items = [];
      try {
        items = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.tgz')).map((f) => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, size: st.size, at: st.mtimeMs };
        }).sort((a, b) => b.at - a.at).slice(0, 8);
      } catch {}
      return send(res, 200, { ok: true, items, dir: BACKUP_DIR });
    }
    if (p === '/api/qqmode' && req.method === 'GET') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      return send(res, 200, { ok: true, mode: qqModeGet(), get: 1 });
    }
    if (p === '/api/qq/stats') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const nap = (await sh('docker', ['logs', '--tail', '4000', 'napcat'])).replace(/\x1b\[[0-9;]*m/g, '');
      const d = new Date(); const today = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const groups = {}; const senders = {}; let privRecv = 0, privSend = 0;
      for (const line of nap.split('\n')) {
        if (!line.startsWith(today)) continue;
        let m = line.match(/接收 <- 群聊 \[([^\]]+)\] \[([^\]]+)\]/);
        if (m) {
          const g = m[1].match(/^(.*)\((\d+)\)$/); const gid = g ? g[2] : m[1]; const gname = g ? g[1] : '';
          groups[gid] = groups[gid] || { gid, name: gname, recv: 0, send: 0 };
          groups[gid].recv += 1;
          const sp = m[2].match(/^(.*)\((\d+)\)$/); if (sp) senders[sp[1]] = (senders[sp[1]] || 0) + 1;
          continue;
        }
        m = line.match(/发送 -> 群聊 \[([^\]]+)\]/);
        if (m) {
          const g = m[1].match(/^(.*)\((\d+)\)$/); const gid = g ? g[2] : m[1];
          groups[gid] = groups[gid] || { gid, name: g ? g[1] : '', recv: 0, send: 0 };
          groups[gid].send += 1;
          continue;
        }
        if (line.includes('接收 <- 私聊')) privRecv += 1;
        else if (line.includes('发送 -> 私聊')) privSend += 1;
      }
      const blog = (await sh('tail', ['-n', '2000', LOGS.bridge])).split('\n');
      const wakes = {};
      for (const line of blog) {
        const m = line.match(/(\d{2}:\d{2}:\d{2}).*唤醒 (group|private):(\d+)/);
        if (!m) continue;
        const k = `${m[2]}:${m[3]}`; wakes[k] = (wakes[k] || 0) + 1;
      }
      const gl = Object.values(groups).sort((a, b) => (b.recv + b.send) - (a.recv + a.send));
      const sl = Object.entries(senders).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ name, n }));
      return send(res, 200, { ok: true, mode: qqModeGet(), groups: gl, senders: sl, private: { recv: privRecv, send: privSend }, wakes });
    }
    if (p === '/api/friends') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      let pending = [];
      try { pending = JSON.parse(fs.readFileSync(QQ_STATE + '/friend-requests.json', 'utf8')) || []; } catch {}
      const lines = (await sh('tail', ['-n', '3000', LOGS.bridge])).split('\n')
        .filter((l) => /\[好友\]/.test(l)).slice(-12).map((l) => l.replace(/^\S+\s+\S+\s+/, ''));
      return send(res, 200, { ok: true, pending: Array.isArray(pending) ? pending : [], log: lines });
    }
    if (p === '/api/mem/item') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const id = String(url.searchParams.get('id') || '');
      const card = JSON.parse(fs.readFileSync(memCardFile(), 'utf8'));
      const rec = (card.records || []).find((r) => String(r.id) === id);
      if (!rec) return send(res, 404, { ok: false, error: '没找到这条记忆' });
      return send(res, 200, { ok: true, record: rec });
    }
    if (p === '/api/logs') {
      if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
      const name = String(url.searchParams.get('name') || 'bridge');
      const tail = Math.max(20, Math.min(400, Number(url.searchParams.get('tail') || 120)));
      const file = LOGS[name] || LOGS.bridge;
      const out = await sh('tail', ['-n', String(tail), file]);
      return send(res, 200, { ok: true, name, file, lines: out.replace(/\x1b\[[0-9;]*m/g, '').split('\n') });
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!tokOk(req.headers['x-her-token'] || body.token)) return send(res, 401, { ok: false, error: '需要口令' });

      if (p === '/api/feature') {
        const reg = readJSON(FEAT_PATH, { features: [] }).features || [];
        const items = [{ id: body.id, value: body.value }, ...(Array.isArray(body.also) ? body.also : [])];
        const cfg = readCfgStrict();
        const changed = [];
        const notes = [];
        const bp = path.join(QQ_STATE, 'paused-sample-backup.json');
        let mainValue = null;
        for (const it of items) {
          const f = reg.find((x) => x.id === it.id);
          if (!f) continue;
          if (f.id === 'paused') {
            const on = it.value === true || it.value === 'true';
            await api('/api/socialV2/activity', 'POST', { paused: on });
            if (!cfg.socialV2) cfg.socialV2 = {};
            if (!cfg.socialV2.attention) cfg.socialV2.attention = {};
            if (on) {
              try { fs.writeFileSync(bp, JSON.stringify({ at: Date.now(), sample: cfg.socialV2.attention.sample || {} }, null, 2)); } catch {}
              cfg.socialV2.attention.sample = {};
              notes.push('各群抽样已临时清零，取消暂停时还原');
            } else {
              try {
                const b = JSON.parse(fs.readFileSync(bp, 'utf8'));
                if (b && b.sample) { cfg.socialV2.attention.sample = b.sample; notes.push('抽样已恢复'); }
                fs.unlinkSync(bp);
              } catch {}
            }
            mainValue = on; changed.push(f.id); continue;
          }
          if (f.path.startsWith('@')) continue;
          const val = coerce(f, it.value);
          setPath(cfg, f.path, val);
          changed.push(f.id);
          if (mainValue === null) mainValue = val;
        }
        writeCfg(cfg);
        return send(res, 200, { ok: true, id: body.id, value: mainValue, changed, notes, effect: 'hot', effectText: '立刻生效' });
      }
      if (p === '/api/setting') {
        const reg = readJSON(FEAT_PATH, { features: [] }).features || [];
        const f = reg.find((x) => x.id === body.id);
        if (!f) return send(res, 400, { ok: false, error: '没有这个 id' });
        const val = coerce(f, body.value);
        if (f.path.startsWith('@video:')) {
          const v = readJSON(VIDEO_JSON, {}) || {};
          setPath(v, f.path.slice(7), val);
          writeJsonAtomic(VIDEO_JSON, v);
          return send(res, 200, { ok: true, value: val, effect: 'hot', effectText: '立刻生效' });
        }
        if (f.path.startsWith('@')) return send(res, 400, { ok: false, error: '这一项不能在这里改' });
        const cfg = readCfgStrict();
        setPath(cfg, f.path, val);
        writeCfg(cfg);
        return send(res, 200, { ok: true, value: val, effect: f.effect, effectText: EFFECT_TEXT[f.effect] });
      }
      if (p === '/api/bridge/restart') {
        try {
          await sh('bash', ['${SURFCORE}/scripts/restart-bridge.sh']);
          return send(res, 200, { ok: true, note: '已重启，约 10 秒后新配置生效' });
        } catch (e) {
          return send(res, 500, { ok: false, error: String(e?.message || e) });
        }
      }
      if (p === '/api/mem/add') {
        const text = String(body.text || '').trim().slice(0, 800);
        if (!text) return send(res, 400, { ok: false, error: '写点内容再教她' });
        const title = String(body.title || '').trim().slice(0, 60);
        const importance = Math.max(40, Math.min(100, Number(body.importance) || 85));
        const tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 5) : [];
        let via = '';
        let out = null;
        try {
          // 直接复用插件的记忆卡模块：写入后立刻重渲染提示词文件，她下一次唤醒就知道
          const mc = await import(`${SURFCORE}/src/memory-card.js`);
          const paths = mc.resolveMemoryCardPaths(path.dirname(memCardFile()));
          const card = mc.loadMemoryCard(paths);
          const cfgAll = readJSON(CFG_PATH, {}) || {};
          const cfg = mc.normalizeMemoryCardConfig(cfgAll.memoryCard || {});
          const rec = mc.addManualMemory(card, { text, title, importance, tags }, cfg);
          const saved = mc.saveMemoryCardOutputs(paths, card, cfg);
          for (const f of [paths.json, paths.markdown, paths.promptQq, paths.promptBili]) { try { fs.chownSync(f, 1000, 1000); } catch {} }
          const rid = (rec && (rec.id || (rec.record && rec.record.id))) || '';
          out = { id: rid, chars: saved && saved.status ? saved.status.chars : undefined, total: (saved && saved.status ? saved.status.total : undefined) };
          via = 'module';
        } catch (e) {
          // 退路：只写 json（提示词要等插件下次整理才更新）
          const f = memCardFile();
          const card = readJSON(f, { records: [] }) || { records: [] };
          card.records = Array.isArray(card.records) ? card.records : [];
          const iso = new Date().toISOString();
          const id = 'manual-' + Date.now().toString(36);
          card.records.push({
            id, title: title || ('手动记下：' + text.slice(0, 24)), text,
            tags: ['manual', ...tags], importance, clarity: 'clear', recallCount: 0,
            pinned: false, speaker: '主人', createdAt: iso, lastSeenAt: iso, source: 'manual',
          });
          try { fs.copyFileSync(f, f + '.bak.her.' + Date.now()); } catch {}
          fs.writeFileSync(f, JSON.stringify(card, null, 2));
          try { fs.chownSync(f, 1000, 1000); } catch {}
          out = { id };
          via = 'fallback: ' + String((e && e.message) || e);
        }
        return send(res, 200, { ok: true, via, added: out });
      }
      if (p === '/api/mem/pin') {
        const cfgAll = readJSON(CFG_PATH, {}) || {};
        const capP = Number((cfgAll.memoryCard || {}).maxPinned) || 20;
        if (body.pinned) {
          const card = readJSON(memCardFile(), { records: [] }) || { records: [] };
          const pinned = (card.records || []).filter((r) => r.pinned).length;
          if (pinned >= capP) return send(res, 400, { ok: false, error: `钉住最多 ${capP} 条，先取消一条再钉` });
        }
        const rec = mutateMem(String(body.id || ''), (r) => { r.pinned = !!body.pinned; r.pinnedAt = body.pinned ? new Date().toISOString() : undefined; });
        if (!rec) return send(res, 404, { ok: false, error: '没有这条记忆' });
        return send(res, 200, { ok: true, id: rec.id, pinned: !!rec.pinned });
      }
      if (p === '/api/mem/display-only') { // DISPLAYONLY_PATCH：只放进星图，不进提示词
        const rec = mutateMem(String(body.id || ''), (r) => {
          r.displayOnly = !!body.on;
          if (body.on) r.displayOnlyAt = new Date().toISOString();
          else delete r.displayOnlyAt;
        });
        if (!rec) return send(res, 404, { ok: false, error: '没有这条记忆' });
        return send(res, 200, { ok: true, id: rec.id, displayOnly: !!rec.displayOnly });
      }
      if (p === '/api/mem/merge-auto') {
        if (body.confirm !== true) return send(res, 400, { ok: false, error: '要合并记忆必须带 confirm: true（这个动作会改动记忆卡）' }); // MERGE_CONFIRM_PATCH
        const map = memoryMap();
        const want = Math.max(1, Math.min(5, Number(body.max) || 2));
        const picks = (map.pairs || []).filter((x) => x.sim >= 0.72).slice(0, want);
        if (!picks.length) return send(res, 200, { ok: true, merged: 0, msg: '没有足够相似的，先不用合' });
        let merged = 0;
        for (const pair of picks) {
          const keep = pair.a, drop = pair.b;
          const extra = String(drop.text || '').trim();
          if (extra && !String(keep.text || '').includes(extra)) {
            keep.text = (String(keep.text || '') + '\n（还记着一条相近的：' + extra.slice(0, 200) + '）').slice(0, 1200);
          }
          merged += 1;
          try { mutateMem(String(drop.id), (r) => { r.forgottenAt = new Date().toISOString(); r.clarity = 'faded'; r.mergedInto = keep.id; }); } catch {}
          try { mutateMem(String(keep.id), (r) => { r.text = keep.text; r.importance = Math.max(Number(r.importance) || 0, Number(drop.importance) || 0); }); } catch {}
        }
        return send(res, 200, { ok: true, merged });
      }
      if (p === '/api/mem/merge') {
        const f = memCardFile();
        const card = readJSON(f, null);
        if (!card || !Array.isArray(card.records)) return send(res, 500, { ok: false, error: '读不到记忆卡' });
        const a = card.records.find((r) => r.id === String(body.keep || ''));
        const b = card.records.find((r) => r.id === String(body.drop || ''));
        if (!a || !b) return send(res, 404, { ok: false, error: '找不到这两条记忆' });
        const extra = String(b.text || '').trim();
        if (extra && !String(a.text || '').includes(extra)) {
          a.text = (String(a.text || '') + '\n（还记着一条相近的：' + extra.slice(0, 200) + '）').slice(0, 1200);
        }
        a.importance = Math.max(Number(a.importance) || 0, Number(b.importance) || 0);
        a.recallCount = (Number(a.recallCount) || 0) + (Number(b.recallCount) || 0);
        a.tags = [...new Set([...(a.tags || []), ...(b.tags || [])])].slice(0, 8);
        b.forgottenAt = new Date().toISOString();
        b.clarity = 'faded';
        b.importance = Math.min(Number(b.importance) || 0, 10);
        b.mergedInto = a.id;
        try { fs.copyFileSync(f, f + '.bak.her.' + Date.now()); } catch {}
        fs.writeFileSync(f, JSON.stringify(card, null, 2));
        try { fs.chownSync(f, 1000, 1000); } catch {}
        return send(res, 200, { ok: true, keep: a.id, drop: b.id });
      }
      if (p === '/api/mem/forget') {
        const restore = !!body.restore;
        const rec = mutateMem(String(body.id || ''), (r) => {
          if (restore) { r.forgottenAt = undefined; r.clarity = 'fuzzy'; r.importance = Math.max(Number(r.importance) || 0, 30); }
          else { r.forgottenAt = new Date().toISOString(); r.clarity = 'faded'; r.importance = Math.min(Number(r.importance) || 0, 12); }
        });
        if (!rec) return send(res, 404, { ok: false, error: '没有这条记忆' });
        return send(res, 200, { ok: true, id: rec.id, forgotten: !restore });
      }
      if (p === '/api/qqmode') {
        if (!tokOk(req.headers['x-her-token'])) return send(res, 401, { ok: false, error: '需要口令' });
        const b = body;
        const mode = ['open', 'owneronly', 'privateonly', 'off'].includes(String(b.mode)) ? String(b.mode) : 'open';
        let out;
        try { out = qqModeSet(mode); } catch (e) { return send(res, 500, { ok: false, error: String(e && e.stack || e) }); }
        return send(res, 200, { ok: true, mode: out });
      }
      if (p === '/api/mem/purge') {
        // 彻底删除：传 id 删一条；传 olderThanDays 清理暂存超过 N 天的
        const pid = String(body.id || '');
        const days = Number(body.olderThanDays) || 0;
        const f = memCardFile();
        const card = readJSON(f, null);
        if (!card || !Array.isArray(card.records)) return send(res, 500, { ok: false, error: '读不到记忆卡' });
        const before = card.records.length;
        if (pid) card.records = card.records.filter((r) => r.id !== pid);
        else if (days > 0) {
          const cut = Date.now() - days * 86400000;
          card.records = card.records.filter((r) => !(r.forgotten && new Date(r.forgottenAt || 0).getTime() < cut));
        } else return send(res, 400, { ok: false, error: '要么给 id，要么给 olderThanDays' });
        const removed = before - card.records.length;
        if (!removed) return send(res, 200, { ok: true, removed: 0 });
        try { fs.copyFileSync(f, f + '.bak.her.' + Date.now()); } catch {}
        fs.writeFileSync(f, JSON.stringify(card, null, 2));
        try { fs.chownSync(f, 1000, 1000); } catch {}
        return send(res, 200, { ok: true, removed });
      }
      if (p === '/api/restart') {
        const target = String(body.target || 'bridge');
        if (target === 'bridge') {
          // 兜底重启（没有 systemd 脚本时用）：先杀、删锁、再拉起
          await sh('bash', ['-c', `for p in $(ps -eo pid,args | grep "[b]ridge.js" | grep -v bash | awk "{print $1}"); do kill $p; done; sleep 3; rm -f ${SURFCORE}/state/bridge.lock; runuser -l ${SERVICE_USER} -c "cd ${SURFCORE} && setsid nohup ${NODE_BIN} src/bridge.js >> /var/log/surfcore-bridge.log 2>&1 < /dev/null &"`], 30000);
          await new Promise((r) => setTimeout(r, 6000));
          return send(res, 200, { ok: true, msg: '桥接已重启' });
        }
        if (target === 'dsh') { await sh('systemctl', ['restart', 'dsh-web'], 60000); await new Promise((r) => setTimeout(r, 5000)); return send(res, 200, { ok: true, msg: 'DSH 已重启' }); }
        if (target === 'napcat') { await sh('docker', ['restart', 'napcat'], 90000); await new Promise((r) => setTimeout(r, 6000)); return send(res, 200, { ok: true, msg: 'NapCat 已重启（如需扫码去 6099 面板）' }); }
        if (target === 'asr') { await sh('systemctl', ['stop', 'asr-shim.service'], 30000); await sh('systemctl', ['restart', 'asr-shim.socket'], 30000); return send(res, 200, { ok: true, msg: 'ASR 已重启（socket 已重开，下次请求自动拉起）' }); }
        return send(res, 400, { ok: false, error: '未知目标' });
      }
      if (p === '/api/access') {
        const kind = String(body.kind || 'group');
        const id = String(body.id || '').replace(/\D/g, '');
        const action = String(body.action || 'add');
        if (!id) return send(res, 400, { ok: false, error: '号码不对' });
        const cfg = readCfgStrict();
        cfg.allow = cfg.allow || {};
        const field = kind === 'group' ? 'groups' : 'private';
        const list = new Set((cfg.allow[field] || []).map(String));
        if (action === 'add') list.add(id); else list.delete(id);
        cfg.allow[field] = [...list];
        writeCfg(cfg);
        return send(res, 200, { ok: true, kind, id, action, groups: cfg.allow.groups || [], private: cfg.allow.private || [], effectText: '立刻生效（下一条消息就按新白名单）' });
      }
      if (p === '/api/say') {
        const text = String(body.text || '').trim().slice(0, 500);
        if (!text) return send(res, 400, { ok: false, error: '先说点什么' });
        const who = String(body.who || readJSON(CFG_PATH, {})?.ownerQQ || '').trim();
        if (!who) return send(res, 400, { ok: false, error: '读不到 ownerQQ' });
        const r = await api('/api/debug/prompt?token=' + encodeURIComponent(cfgToken()), 'POST', { key: 'private:' + who, text });
        return send(res, 200, { ok: !!r?.ok, result: r, who });
      }
      if (p === '/api/backup') {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const out = path.join(BACKUP_DIR, `her-${ts}.tgz`);
        const r = await sh('bash', ['-c',
          `cd / && tar czf '${out}' --exclude='home/dsh/apps/surfcore/state/backups' --exclude='home/dsh/apps/surfcore/state/media-cache' --exclude='*.log.1' home/dsh/apps/surfcore/state home/dsh/apps/surfcore/config.json home/dsh/.dsh/surfcore/config.json home/dsh/.dsh/surfcore/bili.config.json home/dsh/.dsh/asr.json 2>/dev/null; true`], 60000);
        let size = 0; try { size = fs.statSync(out).size; } catch {}
        return send(res, 200, { ok: size > 0, file: out, size, msg: size ? '已备份' : '备份失败：' + r.slice(0, 200) });
      }
      if (p === '/api/note') {
        // 记一条备注（面板里的"改动日志"）
        const dir = path.join(ROOT, 'notes'); fs.mkdirSync(dir, { recursive: true });
        const line = JSON.stringify({ at: new Date().toISOString(), text: String(body.text || '').slice(0, 500) }) + '\n';
        fs.appendFileSync(path.join(dir, 'changes.jsonl'), line);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { ok: false, error: 'not found' });
    }
    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, process.env.HER_HOST || '0.0.0.0', () => console.log(`her-console on http://${process.env.HER_HOST || '0.0.0.0'}:${PORT}  token→ ${path.join(ROOT, 'token.txt')}`)); // PUBLIC_BIND_PATCH
