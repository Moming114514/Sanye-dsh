// LOOPS_PATCH：前瞻记忆——「欠着的事」。只记未完成/待跟进的状态，不存事实、不写人设。
// 文件：~/.dsh/surfcore/state/loops.json  { items: [{id,text,by,at,due,done,notified}] }
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const DIR = path.join(HOME, '.dsh', 'surfcore', 'state');
const FILE = path.join(DIR, 'loops.json');

function p2(n) { return String(n).padStart(2, '0'); }
export function dueLabel(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function loopsConfig(raw) {
  const c = raw?.socialV2?.loops ?? {};
  return {
    enabled: c.enabled !== false,
    maxItems: Number.isFinite(c.maxItems) ? c.maxItems : 10,
    expireDays: Number.isFinite(c.expireDays) ? c.expireDays : 14,
    injectMaxChars: Number.isFinite(c.injectMaxChars) ? c.injectMaxChars : 320,
  };
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j?.items) ? j.items : [];
  } catch { return []; }
}

function save(items) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ items }, null, 1));
  } catch {}
}

function mmdd(ts) {
  const d = new Date(Number(ts) || Date.now());
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function prune(cfg) {
  const all = load();
  const now = Date.now();
  const keep = all.filter((it) => it && !it.done && (now - Number(it.at || 0)) < cfg.expireDays * 86400000);
  if (keep.length !== all.length) save(keep);
  return keep;
}

export function listLoops(raw) {
  const cfg = loopsConfig(raw);
  const items = prune(cfg);
  return items.map((it) => ({ id: it.id, text: it.text, by: it.by || '', at: it.at, age: mmdd(it.at), due: it.due || 0, dueText: dueLabel(it.due) }));
}

export function addLoop({ text = '', by = '', due = 0, raw } = {}) {
  const cfg = loopsConfig(raw);
  if (!cfg.enabled) return { ok: false, error: 'loops 已关闭' };
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!clean) return { ok: false, error: 'text 不能为空' };
  const items = prune(cfg);
  if (items.some((it) => it.text === clean && !it.done)) return { ok: true, duplicated: true, total: items.length, items: listLoops(raw) };
  const now = Date.now();
  items.push({
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    text: clean,
    by: String(by || '').slice(0, 20),
    at: now,
    due: Number(due) > now ? Number(due) : 0,
  });
  while (items.length > cfg.maxItems) items.shift();
  save(items);
  return { ok: true, total: items.length, items: listLoops(raw) };
}

export function doneLoop({ id = '', text = '', raw } = {}) {
  const all = load();
  const needle = String(text || '').replace(/\s+/g, ' ').trim();
  let hit = 0;
  const next = all.map((it) => {
    if (it.done) return it;
    const match = id ? it.id === String(id) : needle && (it.text === needle || it.text.includes(needle));
    if (match) { hit += 1; return { ...it, done: true, at_done: Date.now() }; }
    return it;
  });
  if (!hit) return { ok: false, error: '没找到这条' };
  save(next);
  return { ok: true, closed: hit, items: listLoops(raw) };
}

export function loopsMeta() {
  try { const s = fs.statSync(FILE); return `${s.mtimeMs}:${s.size}`; } catch { return 'none'; }
}

export function loopsBlock(raw) {
  try {
    const cfg = loopsConfig(raw);
    if (!cfg.enabled) return '';
    const items = prune(cfg);
    if (!items.length) return '';
    // ABSTIME_LOOP：把「刚才/今天」这类相对时间换成绝对时间，避免旧事被说成刚发生
    const abs = (t, at) => String(t || '').replace(/刚才|刚刚/g, () => {
      const d = new Date(Number(at) || Date.now());
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }).replace(/今天/g, '今天').replace(/昨天/g, '前一天');
    let body = '【欠着的事】（你自己记的待跟进；做完就用 qq_loop 的 done 划掉）\n'
      + items.map((it) => `- [${mmdd(it.at)}] ${abs(it.text, it.at)}${it.due ? `（约好 ${dueLabel(it.due)}）` : ''}`).join('\n');
    if (body.length > cfg.injectMaxChars) body = body.slice(0, cfg.injectMaxChars) + '…';
    return body;
  } catch { return ''; }
}
