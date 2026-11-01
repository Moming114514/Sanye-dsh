// 印象库（IMPR_PATCH）：她「对他的看法」——不是设定，是看法，会变。
// 存 ~/.dsh/surfcore/state/impressions.json：{ items: [{ id, text, about, at, confidence, by }] }
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const STATE = path.join(HOME, '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'impressions.json');
const MAX_ITEMS = 50;
const MAX_TEXT = 60;

export function impressionsPath() { return FILE; }

export function loadImpressions() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const items = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
    return items.filter((x) => x && typeof x.text === 'string' && x.text.trim());
  } catch { return []; }
}

export function saveImpressions(items) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ items: items.slice(-MAX_ITEMS), at: Date.now() }, null, 1), { mode: 0o644 });
    fs.renameSync(tmp, FILE);
    return true;
  } catch { return false; }
}

function norm(s) { return String(s || '').replace(/[\s，。、！？~…—"'「」『』（）()]/g, '').toLowerCase(); }

export function addImpression({ text, about, confidence } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!t) return { ok: false, error: 'text 不能为空' };
  const ab = ['he', 'world', 'me'].includes(String(about)) ? String(about) : 'he';
  const cf = String(confidence) === 'sure' ? 'sure' : 'guess';
  const items = loadImpressions();
  const nt = norm(t);
  const dup = items.find((x) => { const nx = norm(x.text); return nx === nt || nx.includes(nt) || nt.includes(nx); });
  if (dup) {
    dup.at = Date.now();
    if (cf === 'sure') dup.confidence = 'sure';
    saveImpressions(items);
    return { ok: true, duplicated: true, total: items.length, item: dup };
  }
  const item = { id: 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: t, about: ab, at: Date.now(), confidence: cf, by: 'self' };
  items.push(item);
  // 超限先丢最旧的「猜的」，都确定了才丢最旧的
  while (items.length > MAX_ITEMS) {
    const i = items.findIndex((x) => x.confidence !== 'sure');
    items.splice(i >= 0 ? i : 0, 1);
  }
  saveImpressions(items);
  return { ok: true, total: items.length, item };
}

export function forgetImpression(id) {
  const items = loadImpressions();
  const key = String(id || '').trim();
  if (!key) return { ok: false, error: 'id 不能为空' };
  const idx = items.findIndex((x) => x.id === key);
  if (idx < 0) {
    const byText = items.findIndex((x) => norm(x.text) === norm(key));
    if (byText < 0) return { ok: false, error: '没有这条' };
    items.splice(byText, 1);
  } else items.splice(idx, 1);
  saveImpressions(items);
  return { ok: true, total: items.length };
}

export function impressionsData() { return { items: loadImpressions(), max: MAX_ITEMS }; }

const ABOUT_CN = { he: '他', world: '外面的事', me: '我自己' };

// 注入提示词：只给最近 8 条、300 字以内
export function impressionsBlock(opts = {}) {
  const maxItems = Math.max(1, Math.min(20, Number(opts?.maxItems) || 8));
  const maxChars = Math.max(60, Math.min(1200, Number(opts?.maxChars) || 300));
  const items = loadImpressions()
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, maxItems);
  if (!items.length) return '';
  const lines = [];
  let used = 0;
  for (const it of items) {
    const line = `- ${it.confidence === 'sure' ? '' : '（觉得）'}${it.text}${it.about && it.about !== 'he' ? '（' + (ABOUT_CN[it.about] || it.about) + '）' : ''}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return '';
  return ['【我现在的看法（我自己攒的，不是设定，可以变）】', ...lines].join('\n');
}
