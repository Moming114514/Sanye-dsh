// 群规则唯一事实源（P2-1）。
// 目的：把「她在这个群说不说」合成一份 group-policy.json，其它 5 处老结构只作为派生视图。
// 安全阀：config.socialV2.groupPolicyFile.enabled（默认 false）。false 时本模块只读不写，
//         桥接完全走老逻辑，行为一字不变。
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/home/dsh';
const STATE = process.env.SURFCORE_STATE_DIR || path.join(HOME, '.dsh', 'surfcore', 'state');
export const POLICY_FILE = path.join(STATE, 'group-policy.json');
const CONFIG_FILE = path.join(process.env.SURFCORE_DIR || path.join(HOME, 'apps', 'surfcore'), 'config.json');

const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const atomic = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
};
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

let cache = { sig: '', data: null };

export function emptyPolicy() {
  return { version: 1, groups: {}, private: {} };
}

export function load() {
  let sig = '';
  try { const st = fs.statSync(POLICY_FILE); sig = `${st.mtimeMs}:${st.size}`; } catch {}
  if (sig && sig === cache.sig) return cache.data;
  const data = readJson(POLICY_FILE, null);
  const norm = data && data.groups ? data : emptyPolicy();
  for (const [gid, v] of Object.entries(norm.groups || {})) {
    norm.groups[gid] = {
      present: v.present !== false,
      mode: ['normal', 'mention', 'silent'].includes(v.mode) ? v.mode : 'normal',
      rate: v.rate && typeof v.rate === 'object' ? v.rate : { level: 'normal' },
      replyOnly: Array.isArray(v.replyOnly) ? v.replyOnly.map(String) : [],
      sample: Number(v.sample) || 0,
      updatedAt: Number(v.updatedAt) || 0,
    };
  }
  cache = { sig, data: norm };
  return norm;
}

export function get(gid) {
  return load().groups[String(gid)] || null;
}

export function set(gid, patch) {
  const p = load();
  const key = String(gid).replace(/\D/g, '');
  const cur = p.groups[key] || { present: false, mode: 'normal', rate: { level: 'normal' }, replyOnly: [], sample: 0 };
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  if (patch && patch.rate) next.rate = { ...cur.rate, ...patch.rate };
  if (patch && patch.replyOnly) next.replyOnly = patch.replyOnly.map(String);
  p.groups[key] = next;
  atomic(POLICY_FILE, p);
  cache = { sig: '', data: null };
  return next;
}

export function isEnabled(cfg) {
  return !!(cfg && cfg.socialV2 && cfg.socialV2.groupPolicyFile && cfg.socialV2.groupPolicyFile.enabled === true);
}

// 把策略投影回 5 个老结构（派生文件只由这里写）。
export function project(cfg) {
  const p = load();
  const groups = p.groups || {};
  const gids = Object.keys(groups).filter((g) => groups[g].present);

  // 1) 静音名单：mode=mention
  const muted = {};
  for (const g of Object.keys(groups)) if (groups[g].mode === 'mention') muted[`group:${g}`] = { at: new Date().toISOString() };
  atomic(path.join(STATE, 'muted-keys.json'), { items: muted });

  // 2) 学习模式：mode=silent
  const learn = {};
  for (const g of Object.keys(groups)) if (groups[g].mode === 'silent') learn[g] = { at: new Date().toISOString() };
  atomic(path.join(STATE, 'learn-mode.json'), { groups: learn });

  // 3) 群频率：保留今天的 count/lastAt/day
  const rateFile = path.join(STATE, 'group-rate.json');
  const oldRate = readJson(rateFile, { day: today(), groups: {} });
  const rateData = { day: oldRate.day || today(), groups: { ...(oldRate.groups || {}) } };
  if (rateData.day !== today()) { rateData.day = today(); for (const g of Object.keys(rateData.groups)) { rateData.groups[g].count = 0; rateData.groups[g].lastAt = 0; } }
  for (const g of Object.keys(groups)) {
    const r = groups[g].rate || {};
    const old = rateData.groups[g] || { level: 'normal', count: 0, lastAt: 0 };
    const lv = r.level === 'custom' ? (old.level || 'normal') : (r.level || 'normal');
    const next = { ...old, level: lv };
    if (r.level === 'custom') next.custom = { minGapMin: Number(r.minGapMin) || 1, perDay: Number(r.perDay) || 40 };
    if (!gids.includes(g)) delete rateData.groups[g];
    rateData.groups[g] = next;
  }
  atomic(rateFile, rateData);

  // 4) 白名单 + 5) attention（都写 config.json，原子替换，只改这三个字段）
  const cfgFile = readJson(CONFIG_FILE, null);
  if (cfgFile && typeof cfgFile === 'object') {
    cfgFile.allow = cfgFile.allow || {};
    cfgFile.allow.groups = gids;
    const sv = (cfgFile.socialV2 = cfgFile.socialV2 || {});
    const att = (sv.attention = sv.attention || {});
    att.replyOnly = {};
    att.sample = { ...(att.sample && typeof att.sample === 'object' ? att.sample : {}) };
    for (const g of gids) {
      const v = groups[g];
      if (v.replyOnly && v.replyOnly.length) att.replyOnly[g] = v.replyOnly;
      if (Number(v.sample) > 0) att.sample[g] = Number(v.sample); else delete att.sample[g];
    }
    for (const g of Object.keys(att.sample)) if (!gids.includes(g) && !/^\d+$/.test(g)) continue;
    atomic(CONFIG_FILE, cfgFile);
    if (cfg && cfg.allow) cfg.allow = { ...(cfg.allow || {}), groups: gids };
  }
  return { groups: gids.length, muted: Object.keys(muted).length, learn: Object.keys(learn).length };
}

// 迁移：读 5 个旧来源合成策略（migrate 脚本和 --dry-run 共用）
export function buildFromLegacy(cfg) {
  const allowGroups = new Set(((cfg && cfg.allow && cfg.allow.groups) || []).map(String));
  const allowPrivate = ((cfg && cfg.allow && cfg.allow.private) || []).map(String);
  const muted = new Set(Object.keys(readJson(path.join(STATE, 'muted-keys.json'), { items: {} }).items || {})
    .filter((k) => k.startsWith('group:')).map((k) => k.slice(6)));
  const learned = new Set(Object.keys(readJson(path.join(STATE, 'learn-mode.json'), { groups: {} }).groups || {}));
  const rates = readJson(path.join(STATE, 'group-rate.json'), { groups: {} }).groups || {};
  const att = (cfg && cfg.socialV2 && cfg.socialV2.attention) || {};
  const replyOnly = att.replyOnly || {};
  const sample = att.sample || {};

  const all = new Set([...allowGroups, ...muted, ...learned, ...Object.keys(rates)]);
  const out = emptyPolicy();
  for (const g of all) {
    const mode = learned.has(g) ? 'silent' : muted.has(g) ? 'mention' : 'normal';
    const r = rates[g] || {};
    const custom = r.custom && (Number(r.custom.minGapMin) || Number(r.custom.perDay))
      ? { level: 'custom', minGapMin: Number(r.custom.minGapMin) || 1, perDay: Number(r.custom.perDay) || 40 }
      : { level: (r.level === 'quiet' || r.level === 'active') ? r.level : 'normal' };
    out.groups[g] = {
      present: allowGroups.has(g),
      mode,
      rate: custom,
      replyOnly: Array.isArray(replyOnly[g]) ? replyOnly[g].map(String) : [],
      sample: Number(sample[g]) || 0,
      updatedAt: 0,
    };
  }
  for (const u of allowPrivate) out.private[u] = { present: true };
  return out;
}

// 桥接里的 5 个写接口：先写策略，再 project()。返回 true 表示已处理，调用方直接 return。
export function handleWrite({ pathname, body, cfg, sendJson, log }) {
  if (!isEnabled(cfg)) return false;
  const gid = String(body?.group || body?.id || '').replace(/\D/g, '');
  const key = String(body?.key || '');
  const gFromKey = key.startsWith('group:') ? key.slice(6) : gid;

  if (pathname === '/api/socialV2/mute') {
    if (body?.action === 'list') return false;
    if (!gFromKey) { sendJson({ ok: false, error: '缺少群号' }, 400); return true; }
    const cur = get(gFromKey) || { mode: 'normal', present: true };
    set(gFromKey, { present: cur.present !== false, mode: body?.action === 'mute' ? 'mention' : 'normal' });
    project(cfg);
    log?.(`[策略] ${body?.action === 'mute' ? '静音' : '恢复'} group:${gFromKey}（经 group-policy）`);
    sendJson({ ok: true, keys: Object.keys(load().groups).filter((g) => load().groups[g].mode === 'mention').map((g) => `group:${g}`) });
    return true;
  }
  if (pathname === '/api/socialV2/learnmode') {
    if (body?.action === 'list') return false;
    const cur = get(gid) || { mode: 'normal', present: true };
    set(gid, { present: cur.present !== false, mode: body?.action === 'on' ? 'silent' : (cur.mode === 'silent' ? 'normal' : cur.mode) });
    project(cfg);
    sendJson({ ok: true, groups: Object.keys(load().groups).filter((g) => load().groups[g].mode === 'silent') });
    return true;
  }
  if (pathname === '/api/socialV2/grouprate') {
    if (body?.action === 'list') return false;
    const cur = get(gid) || { present: true };
    if (body?.action === 'set') set(gid, { present: cur.present !== false, rate: { level: String(body.level || 'normal') } });
    else if (body?.action === 'custom') set(gid, { present: cur.present !== false, rate: { level: 'custom', minGapMin: Number(body.minGapMin) || 1, perDay: Number(body.perDay) || 40 } });
    else { sendJson({ ok: false, error: 'action 只能是 list / set / custom' }, 400); return true; }
    project(cfg);
    const g = get(gid);
    sendJson({ ok: true, rate: { gid, level: g.rate.level, custom: g.rate.level === 'custom' ? { minGapMin: g.rate.minGapMin, perDay: g.rate.perDay } : undefined }, rates: [] });
    return true;
  }
  if (pathname === '/api/socialV2/allow') {
    const action = String(body?.action || 'add');
    const list = body?.kind === 'private' ? 'private' : 'groups';
    const cur = load();
    const setOf = new Set(list === 'groups' ? (cfg?.allow?.groups || []).map(String) : (cfg?.allow?.private || []).map(String));
    if (action === 'add') setOf.add(String(body?.id || gid)); else setOf.delete(String(body?.id || gid));
    if (list === 'groups') {
      for (const g of Object.keys(cur.groups)) cur.groups[g].present = setOf.has(g);
      atomic(POLICY_FILE, cur);
      cache = { sig: '', data: null };
      project(cfg);
    } else {
      cur.private = {};
      for (const u of setOf) cur.private[u] = { present: true };
      atomic(POLICY_FILE, cur);
      cache = { sig: '', data: null };
      project(cfg);
    }
    sendJson({ ok: true, groups: list === 'groups' ? [...setOf] : (cfg?.allow?.groups || []), private: list === 'private' ? [...setOf] : (cfg?.allow?.private || []) });
    return true;
  }
  return false;
}

export const manifest = {
  id: 'group-policy', layer: '判断', title: '群规则唯一事实源', kind: 'tool',
  enabledByDefault: false, hot: true, order: 210, hooks: [], config: [], stateFiles: ['group-policy.json'],
  pages: [{ id: 'group-rules', title: '群规则' }],
};
