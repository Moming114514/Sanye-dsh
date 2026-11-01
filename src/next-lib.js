// NEXT_PATCH：提醒（due）、人物表、掉线告警、日报。都是小工具，不碰人设。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const STATE = path.join(HOME, '.dsh', 'surfcore', 'state');
const PEOPLE_FILE = path.join(STATE, 'people.json');
const ALERT_FILE = path.join(STATE, 'alerts.json');
const REPORT_FILE = path.join(STATE, 'last-report.json');
const LOOPS_FILE = path.join(STATE, 'loops.json');

function readJson(f, dflt) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; }
}
function writeJson(f, obj) {
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1)); } catch {}
}
function p2(n) { return String(n).padStart(2, '0'); }
function hhmm(ts) { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
function mdhm(ts) { const d = new Date(ts); return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; }

// ───────────────────────── 提醒时间解析 ─────────────────────────
// 支持：+30m / +2h / 20:30 / 明天 9:00 / 明天早上 / 今晚 / 后天 14:00 / 10-31 20:00
export function parseDue(text, now = Date.now()) {
  const s = String(text || '').trim();
  if (!s) return 0;
  const d = new Date(now);
  const at = (dayShift, h, m) => {
    const x = new Date(d.getTime());
    x.setDate(x.getDate() + dayShift);
    x.setHours(h, m, 0, 0);
    return x.getTime();
  };
  let m;
  if ((m = s.match(/^\+?(\d+)\s*(m|min|分钟|分)$/i))) return now + Number(m[1]) * 60000;
  if ((m = s.match(/^\+?(\d+(?:\.\d+)?)\s*(h|小时|时)$/i))) return now + Math.round(Number(m[1]) * 3600000);
  if ((m = s.match(/^(\d{1,2})[:：](\d{2})$/))) {
    const t = at(0, Number(m[1]), Number(m[2]));
    return t > now ? t : at(1, Number(m[1]), Number(m[2]));
  }
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2})[:：](\d{2})$/))) {
    const x = new Date(d.getTime());
    x.setMonth(Number(m[1]) - 1, Number(m[2]));
    x.setHours(Number(m[3]), Number(m[4]), 0, 0);
    return x.getTime() > now ? x.getTime() : x.getTime() + 365 * 86400000;
  }
  const dayShift = /^后天/.test(s) ? 2 : /^明天|^明早/.test(s) ? 1 : 0;
  const hourMatch = s.match(/(\d{1,2})[:：](\d{2})/);
  if (dayShift || /^今晚/.test(s)) {
    let h = 9, mm = 0;
    if (hourMatch) { h = Number(hourMatch[1]); mm = Number(hourMatch[2]); }
    else if (/早上|上午|明早/.test(s)) { h = 9; }
    else if (/中午/.test(s)) { h = 12; }
    else if (/下午/.test(s)) { h = 15; }
    else if (/晚上|今晚/.test(s)) { h = 20; }
    return at(dayShift, h, mm);
  }
  return 0;
}

// ───────────────────────── 提醒：到期检查 ─────────────────────────
export function dueReminders(now = Date.now()) {
  const j = readJson(LOOPS_FILE, { items: [] });
  const items = Array.isArray(j.items) ? j.items : [];
  return items.filter((it) => it && !it.done && it.due && !it.notified && it.due <= now);
}

export function markReminded(ids) {
  const j = readJson(LOOPS_FILE, { items: [] });
  const items = Array.isArray(j.items) ? j.items : [];
  const set = new Set(ids);
  for (const it of items) if (set.has(it.id)) { it.notified = true; it.notifiedAt = Date.now(); }
  writeJson(LOOPS_FILE, { items });
}

// ───────────────────────── 人物表 ─────────────────────────
const NOISE = /^(管理员|群主|机器人|QQ|qq)$/;

export function learnPeople(kind, id, event) {
  try {
    if (kind !== 'group') return;
    const s = event?.sender || {};
    const qq = String(s.user_id || event?.user_id || '');
    if (!qq) return;
    const nick = String(s.nickname || s.card || '').trim();
    if (!nick || NOISE.test(nick)) return;
    const card = String(s.card || '').trim();
    const j = readJson(PEOPLE_FILE, { people: {} });
    j.people = j.people || {};
    const cur = j.people[qq] || { name: nick, card: card || '', group: String(id), first: Date.now(), count: 0, note: '' };
    cur.name = nick;
    if (card) cur.card = card;
    cur.group = String(id);
    cur.count = Number(cur.count || 0) + 1;
    cur.last = Date.now();
    j.people[qq] = cur;
    writeJson(PEOPLE_FILE, j);
  } catch {}
}

export function notePerson({ qq, alias, note } = {}) {
  const key = String(qq || '').replace(/\D/g, '');
  if (!key) return { ok: false, error: '需要 QQ 号' };
  const j = readJson(PEOPLE_FILE, { people: {} });
  j.people = j.people || {};
  const cur = j.people[key] || { name: '', card: '', group: '', first: Date.now(), count: 0 };
  if (alias) cur.alias = String(alias).slice(0, 20);
  if (note) cur.note = String(note).slice(0, 60);
  j.people[key] = cur;
  writeJson(PEOPLE_FILE, j);
  return { ok: true, qq: key, alias: cur.alias || '', note: cur.note || '' };
}

export function listPeople(limit = 8) {
  const j = readJson(PEOPLE_FILE, { people: {} });
  const rows = Object.entries(j.people || {}).map(([qq, v]) => ({ qq, ...v }));
  rows.sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
  return rows.slice(0, limit);
}

export function peopleBlock(raw) {
  const cfg = raw?.socialV2?.people ?? {};
  if (cfg.enabled === false) return '';
  const rows = listPeople(Number(cfg.maxItems) || 8);
  if (!rows.length) return '';
  const lines = rows.map((r) => {
    const name = r.alias || r.card || r.name || r.qq;
    const extra = r.note ? `（${r.note}）` : '';
    return `- ${name}${extra}`;
  });
  const body = '【群里的人】（你认识的人，只是背景，不要主动念出来）\n' + lines.join('\n');
  const cap = Number(cfg.injectMaxChars) || 260;
  return body.length > cap ? body.slice(0, cap) + '…' : body;
}

// ───────────────────────── 掉线告警 ─────────────────────────
export function noteAlive() {
  const j = readJson(ALERT_FILE, {});
  const prev = Number(j.lastEventAt || 0);
  const now = Date.now();
  j.lastEventAt = now;
  writeJson(ALERT_FILE, j);
  return prev ? now - prev : 0;
}

export function lastEventAgo() {
  const j = readJson(ALERT_FILE, {});
  return j.lastEventAt ? Date.now() - j.lastEventAt : -1;
}

export function alertState() { return readJson(ALERT_FILE, {}); }
export function setAlert(patch) {
  const j = readJson(ALERT_FILE, {});
  Object.assign(j, patch || {});
  writeJson(ALERT_FILE, j);
  return j;
}

// ───────────────────────── 日报 ─────────────────────────
export function reportState() { return readJson(REPORT_FILE, {}); }
export function markReported(day) { writeJson(REPORT_FILE, { day, at: Date.now() }); }

export function fmtReport({ day, cost, cap, study, qzone, msgs, stickers }) {
  const m = [];
  m.push(`【今日小结】${day}`);
  if (cost != null) m.push(`花费 ${cost.toFixed(2)} 元（额度 ${cap}）`);
  if (msgs != null) m.push(`聊天 ${msgs} 条`);
  if (study) m.push(`学 B站：${study}`);
  if (qzone) m.push(`空间：${qzone}`);
  if (stickers) m.push(`表情：${stickers}`);
  return m.join('\n');
}

export { mdhm, hhmm };
