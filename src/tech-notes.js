// 技术笔记库（TECHNOTES_PATCH）：她看的技术视频/文章，抽出「能用的东西」存下来。
// 这不是给她的记忆，是给人（dsh / 主人）升级时查的资料库。
// 存 ~/.dsh/surfcore/state/tech-notes.json，并同步生成 docs/TECH-NOTES.md 便于直接读。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const STATE = path.join(HOME, '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'tech-notes.json');
const MD_DIR = path.join(HOME, 'apps', 'surfcore', 'docs');
const MD_FILE = path.join(MD_DIR, 'TECH-NOTES.md');
const MAX_ITEMS = 600;

export function techNotesPath() { return FILE; }
export function techNotesMdPath() { return MD_FILE; }

export function loadTechNotes() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const items = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
    return items.filter((x) => x && typeof x.title === 'string' && x.title.trim());
  } catch { return []; }
}

function clean(s, max) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function listOf(v, max, each) {
  const arr = Array.isArray(v) ? v : (v ? String(v).split(/[、,;；\n]/) : []);
  const out = [];
  for (const x of arr) {
    const t = clean(x, each);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function bvOf(url) {
  const m = String(url || '').match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : '';
}

function renderMarkdown(items) {
  const lines = ['# 技术笔记（她看过的技术视频/文章，给人升级时查）', '',
    `> 自动生成于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · 共 ${items.length} 条 · 由 note_tech 工具写入`, ''];
  const sorted = [...items].sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const it of sorted) {
    const when = new Date(it.at || Date.now()).toISOString().slice(0, 10);
    lines.push(`## ${it.title}`);
    const meta = [when, it.up ? `UP：${it.up}` : '', it.bv ? it.bv : '', it.url || ''].filter(Boolean).join(' · ');
    lines.push(`*${meta}*`, '');
    if (it.summary) lines.push(it.summary, '');
    if (it.points?.length) {
      lines.push('**要点**');
      for (const p of it.points) lines.push(`- ${p}`);
      lines.push('');
    }
    if (it.tools?.length) {
      lines.push('**能用的东西**');
      for (const t of it.tools) lines.push(`- ${t}`);
      lines.push('');
    }
    if (it.tags?.length) lines.push(`标签：${it.tags.join(' / ')}`, '');
  }
  return lines.join('\n');
}

export function saveTechNotes(items) {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    const list = items.slice(-MAX_ITEMS);
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ items: list, at: Date.now() }, null, 1), { mode: 0o644 });
    fs.renameSync(tmp, FILE);
    try {
      fs.mkdirSync(MD_DIR, { recursive: true });
      const mtmp = MD_FILE + '.tmp';
      fs.writeFileSync(mtmp, renderMarkdown(list), { mode: 0o644 });
      fs.renameSync(mtmp, MD_FILE);
    } catch { /* 没权限就只存 json */ }
    return true;
  } catch { return false; }
}

export function addTechNote({ title, url, bv, up, summary, points, tools, tags } = {}) {
  const t = clean(title, 120);
  if (!t) return { ok: false, error: 'title 不能为空' };
  const u = clean(url, 300);
  const b = clean(bv, 20) || bvOf(u);
  const items = loadTechNotes();
  const same = items.find((x) => (b && x.bv === b) || (u && x.url === u) || (x.title === t));
  if (same) {
    same.at = Date.now();
    if (summary) same.summary = clean(summary, 400);
    same.points = listOf([...(same.points || []), ...(Array.isArray(points) ? points : [points])], 10, 90);
    same.tools = listOf([...(same.tools || []), ...(Array.isArray(tools) ? tools : [tools])], 10, 120);
    same.tags = listOf([...(same.tags || []), ...(Array.isArray(tags) ? tags : [tags])], 8, 20);
    saveTechNotes(items);
    return { ok: true, updated: true, total: items.length, item: same };
  }
  const item = {
    id: 'tn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: t, url: u, bv: b, up: clean(up, 40), at: Date.now(),
    summary: clean(summary, 400),
    points: listOf(points, 8, 90),
    tools: listOf(tools, 8, 120),
    tags: listOf(tags, 6, 20),
  };
  items.push(item);
  saveTechNotes(items);
  return { ok: true, total: items.length, item };
}

export function forgetTechNote(id) {
  const items = loadTechNotes();
  const key = clean(id, 40);
  const idx = items.findIndex((x) => x.id === key || x.bv === key);
  if (idx < 0) return { ok: false, error: '没有这条' };
  items.splice(idx, 1);
  saveTechNotes(items);
  return { ok: true, total: items.length };
}

export function searchTechNotes({ q, limit = 20, tag } = {}) {
  const kw = clean(q, 60).toLowerCase();
  const tg = clean(tag, 20);
  let items = loadTechNotes().sort((a, b) => (b.at || 0) - (a.at || 0));
  if (tg) items = items.filter((x) => (x.tags || []).includes(tg));
  if (kw) {
    items = items.filter((x) => {
      const hay = [x.title, x.summary, (x.points || []).join(' '), (x.tools || []).join(' '), (x.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(kw);
    });
  }
  return items.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}

export function techNotesData() {
  const items = loadTechNotes();
  return { items: [...items].sort((a, b) => (b.at || 0) - (a.at || 0)), total: items.length, md: MD_FILE };
}

// 给她的提示词：让她知道「看过的别再重复看」，并且看完必须落地
export function techNotesBlock(opts = {}) {
  const maxItems = Math.max(1, Math.min(10, Number(opts?.maxItems) || 3));
  const items = loadTechNotes().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, maxItems);
  const head = '【技术笔记】看完技术类视频/文章，用 note_tech 记一条（标题 + 3~5 个要点 + 能用的工具/链接），这是给主人升级用的资料，不是闲聊。';
  if (!items.length) return head;
  return [head, '最近记过：' + items.map((x) => x.title.slice(0, 24)).join('；')].join('\n');
}
