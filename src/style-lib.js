// 表达样本库（STYLE_PATCH / STYLE_GATE_PATCH）
// 只记「说法」不记人设。分三态：candidate（候选，不注入）→ active（转正，注入）→ retired（丢弃）。
// 转正靠客观信号：同一句式在群里被 ≥2 个不同的人用过（14 天内），不是她自说自话。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const STATE = process.env.STYLE_STATE_DIR || path.join(HOME, '.dsh', 'surfcore', 'state');
const JSON_FILE = path.join(STATE, 'style-samples.json');
const MD_FILE = path.join(STATE, 'style-samples.md');

// 梗 / 口头禅词表：出现即降级成 quote，不进提示词
const MEME_WORDS = ['破防', '绝绝子', '绷不住', 'yyds', 'emo', '无语子', '拴q', '栓q', '666', '233', 'awsl', '芭比q', '蚌埠住', '笑死', '哈哈哈', '草', '卧槽', 'nmsl', '寄了', '乐死', '好家伙', '离谱', '逆天', '绷'];
const NOISE_RE = /https?:\/\/|qq\.com|@\d{5,}|\d{6,}|\[图片\]|\[表情\]|\[动画表情\]|\[语音\]/;

function ensureDir() { try { fs.mkdirSync(STATE, { recursive: true }); } catch {} }

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\[[^\]]{1,8}\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(s) {
  const t = norm(s);
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

function similarity(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export function classifySample(text) {
  const t = String(text || '').trim();
  const n = norm(t);
  if (NOISE_RE.test(t)) return { kind: 'junk', reason: '链接/@/表情/数字噪声' };
  if (n.length < 8) return { kind: 'junk', reason: '太短，只是语气词' };
  if (n.length > 80) return { kind: 'quote', reason: '太长，像整段复述' };
  if (MEME_WORDS.some((w) => n.includes(w.toLowerCase()))) return { kind: 'quote', reason: '梗/口头禅' };
  return { kind: 'framework', reason: '' };
}

let _cache = { key: '', store: null };
function loadStore() {
  // 缓存：群消息每条都会比对一次，别每次都读盘
  try {
    const st = fs.statSync(JSON_FILE);
    const key = String(st.mtimeMs) + ':' + String(st.size);
    if (_cache.key === key && _cache.store) return _cache.store;
  } catch {}
  let store = { samples: [] };
  try {
    const j = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    if (Array.isArray(j?.samples)) store = { samples: j.samples };
  } catch {}
  // 迁移：老样本没有 status/kind，视为已转正的框架样本
  let changed = false;
  for (const s of store.samples) {
    if (!s.id) { s.id = 'sty-' + Math.random().toString(36).slice(2, 12); changed = true; }
    if (!s.status) { s.status = 'active'; s.kind = s.kind || 'framework'; s.decidedBy = 'migrate'; changed = true; }
  }
  if (changed) { try { saveStore(store); } catch {} }
  try { const st2 = fs.statSync(JSON_FILE); _cache = { key: String(st2.mtimeMs) + ':' + String(st2.size), store }; } catch {}
  return store;
}

function saveStore(store) {
  _cache = { key: '', store: null };
  ensureDir();
  const samples = (store.samples || []).slice(-800);
  fs.writeFileSync(JSON_FILE, JSON.stringify({ samples }, null, 1));
  try {
    const active = samples.filter((s) => s.status === 'active');
    const cand = samples.filter((s) => s.status === 'candidate');
    const lines = [];
    lines.push('# 说话方式样本\n');
    lines.push(`> 正式（会进提示词）：${active.length} 条 · 候选（等验证）：${cand.length} 条\n`);
    for (const s of active) lines.push(`- ${String(s.at).slice(0, 10)} ｜ ${s.from || '某人'}：${s.text}${s.why ? ` ｜ 好在：${s.why}` : ''}`);
    if (cand.length) {
      lines.push('\n## 候选（还没验证，不进提示词）');
      for (const s of cand) lines.push(`- ${String(s.at).slice(0, 10)} ｜ ${s.from || '某人'}：${s.text}（${s.kind}）`);
    }
    fs.writeFileSync(MD_FILE, lines.join('\n') + '\n');
  } catch {}
}

export function styleConfig(raw) {
  const c = raw?.socialV2?.styleLearn ?? {};
  return {
    enabled: c.enabled !== false,
    hour: Number.isFinite(c.hour) ? c.hour : 20,
    minute: Number.isFinite(c.minute) ? c.minute : 30,
    groups: Array.isArray(c.groups) ? c.groups.map(String) : [],
    maxPerDay: Number.isFinite(c.maxPerDay) ? c.maxPerDay : 3,
    maxSamples: Number.isFinite(c.maxSamples) ? c.maxSamples : 120,
    autoPromote: c.autoPromote !== false,
    promoteDistinct: Math.max(1, Number(c.promoteDistinct) || 2),
    candidateDays: Math.max(1, Number(c.candidateDays) || 14),
    injectMaxItems: Math.max(1, Number(c.injectMaxItems) || 6),
    injectMaxChars: Math.max(80, Number(c.injectMaxChars) || 520),
  };
}

export function readStyleSamples(limit = 30) {
  const list = loadStore().samples;
  return list.slice(-limit).reverse();
}

export function activeStyleSamples(limit = 20) {
  return loadStore().samples
    .filter((s) => s.status === 'active' && s.kind === 'framework')
    .sort((a, b) => String(b.lastHitAt || b.at).localeCompare(String(a.lastHitAt || a.at)))
    .slice(0, limit);
}

export function appendStyleSample({ from = '', text = '', why = '', source = '', uin = '' } = {}) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!clean) return { ok: false, error: 'text 不能为空' };
  const store = loadStore();
  if (!Array.isArray(store.samples)) store.samples = [];
  const dup = store.samples.find((s) => similarity(s.text, clean) >= 0.75);
  if (dup) {
    dup.hits = dup.hits || {};
    if (uin) dup.hits[String(uin)] = new Date().toISOString();
    saveStore(store);
    return { ok: true, duplicated: true, total: store.samples.length, status: dup.status };
  }
  const cls = classifySample(clean);
  // 面板手动录入直接转正；自动学的先进候选
  const status = source === 'panel' ? 'active' : (cls.kind === 'framework' ? 'candidate' : 'retired');
  const item = {
    id: 'sty-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    at: new Date().toISOString(),
    from: String(from || '').slice(0, 40),
    uin: String(uin || '').slice(0, 20),
    text: clean,
    why: String(why || '').slice(0, 160),
    source: String(source || '').slice(0, 60),
    kind: cls.kind,
    classifyReason: cls.reason,
    status,
    hits: {},
    decidedAt: status === 'retired' ? new Date().toISOString() : null,
    decidedBy: status === 'retired' ? 'auto:classify' : null,
  };
  store.samples.push(item);
  saveStore(store);
  return { ok: true, total: store.samples.length, status, kind: cls.kind, id: item.id };
}

// 观察群里的话：候选样本的句式被别人重复使用 → 记一次 hit
export function styleObserve(gid, uin, text, rawCfg) {
  try {
    const cfg = styleConfig(rawCfg || globalThis.__SURFCORE_CFG__ || {});
    if (!cfg.enabled) return;
    if (cfg.groups.length && !cfg.groups.includes(String(gid))) return;
    const t = String(text || '').trim();
    if (!t || t.length < 4) return;
    const store = loadStore();
    let changed = false;
    for (const s of store.samples) {
      if (s.status !== 'candidate') continue;
      if (String(s.uin || '') && String(s.uin) === String(uin)) continue; // 本人原话不算
      if (similarity(s.text, t) < 0.55) continue;
      s.hits = s.hits || {};
      if (!s.hits[String(uin)]) {
        s.hits[String(uin)] = new Date().toISOString();
        changed = true;
      }
      const distinct = Object.keys(s.hits).length;
      if (cfg.autoPromote && distinct >= cfg.promoteDistinct) {
        s.status = 'active';
        s.decidedAt = new Date().toISOString();
        s.decidedBy = 'auto:reuse';
        s.kind = 'framework';
        changed = true;
      }
    }
    if (changed) saveStore(store);
  } catch {}
}

// 过期丢弃：候选 14 天没被复用
export function styleTick(rawCfg) {
  try {
    const cfg = styleConfig(rawCfg || globalThis.__SURFCORE_CFG__ || {});
    const store = loadStore();
    const now = Date.now();
    let changed = false;
    for (const s of store.samples) {
      if (s.status !== 'candidate') continue;
      const age = now - new Date(s.at || 0).getTime();
      if (age > cfg.candidateDays * 86400000) {
        s.status = 'retired';
        s.decidedAt = new Date().toISOString();
        s.decidedBy = 'auto:expired';
        changed = true;
      }
    }
    if (changed) saveStore(store);
  } catch {}
}

export function styleCandidates() {
  const list = loadStore().samples;
  const pick = (st) => list.filter((s) => s.status === st).reverse();
  return {
    candidates: pick('candidate').slice(0, 50),
    active: pick('active').slice(0, 50),
    retired: pick('retired').slice(0, 20),
    counts: {
      candidate: list.filter((s) => s.status === 'candidate').length,
      active: list.filter((s) => s.status === 'active').length,
      retired: list.filter((s) => s.status === 'retired').length,
    },
  };
}

export function styleSetStatus(id, status) {
  const store = loadStore();
  const s = store.samples.find((x) => x.id === id);
  if (!s) return { ok: false, error: '没有这条样本' };
  if (!['candidate', 'active', 'retired'].includes(status)) return { ok: false, error: 'status 不合法' };
  s.status = status;
  s.decidedAt = new Date().toISOString();
  s.decidedBy = 'panel';
  saveStore(store);
  return { ok: true, id, status };
}

export function styleSamplesBlock(maxChars = 520, maxItems = 6) {
  const list = activeStyleSamples(maxItems);
  if (!list.length) return '';
  const lines = [];
  let used = 0;
  for (const s of list) {
    const txt = String(s.text || '').slice(0, 80);
    const line = `- 「${txt}」${s.why ? `（${s.why}）` : ''}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

export function styleStats() {
  const list = loadStore().samples;
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: list.length,
    today: list.filter((s) => String(s.at || '').startsWith(today)).length,
    active: list.filter((s) => s.status === 'active').length,
    candidate: list.filter((s) => s.status === 'candidate').length,
    retired: list.filter((s) => s.status === 'retired').length,
    lastAt: list[list.length - 1]?.at || null,
  };
}

export const __test = { similarity, norm, classifySample };
