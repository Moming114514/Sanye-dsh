// bot-detect.js —— 本地判断「这条是不是机器人发的」（零 token）
// 兼「人群档案」数据源：按群记录活跃度、句长、复读率、我的标记。
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/home/dsh';
const DIR = path.join(HOME, '.dsh/surfcore/state');
const FILE = path.join(DIR, 'bot-ids.json');
const MARKS = path.join(DIR, 'human-marks.json');

const PHRASE = /(正在解析|已调用|调用工具|有什么可以帮你|请问还有什么|可以帮你做什么|命令执行|处理中|收到您|为您查询|当前模型|token 用量|已收到你的|请稍后)/;
const NICK = /(bot$|bots$|机器人$|助手$|助理$|\bAI\b)/i;
const WINDOW_MS = 60000;
const dayKey = () => new Date().toLocaleDateString('sv');

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
let db = readJson(FILE, { uins: {} });
if (!db.uins) db.uins = {};
let marks = readJson(MARKS, {});   // { uin: 'human' | 'bot' }
const win = new Map();

function save() { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); } catch {} }
function saveMarks() { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(MARKS, JSON.stringify(marks, null, 2)); } catch {} }

export function observe({ gid, uin, name, text }) {
  const u = String(uin || '');
  if (!u) return false;
  const g = String(gid || '');
  const t = Date.now();
  const k = g + '|' + u;
  const arr = (win.get(k) || []).filter((x) => t - x < WINDOW_MS);
  arr.push(t);
  win.set(k, arr);

  const rec = db.uins[u] || (db.uins[u] = { phraseHits: 0, groups: {}, firstAt: t });
  rec.at = t;
  rec.name = String(name || rec.name || '').slice(0, 20);
  const key = 'g' + g;
  const day = dayKey();
  const gs = rec[key] || (rec[key] = { day, n: 0, lenSum: 0, recent: [], skips: 0 });
  if (gs.day !== day) { gs.day = day; gs.n = 0; gs.lenSum = 0; gs.recent = []; gs.skips = 0; }
  gs.n += 1;
  gs.lenSum += String(text || '').length;
  gs.recent = (gs.recent || []).slice(-29);
  gs.recent.push(String(text || '').slice(0, 60));
  gs.last = String(text || '').slice(0, 60);
  rec.groups[g] = gs.n;

  const hitPhrase = PHRASE.test(String(text || ''));
  if (hitPhrase) rec.phraseHits = (rec.phraseHits || 0) + 1;
  if (hitPhrase && rec.lastPhrase && t - rec.lastPhrase > 30 * 60000) rec.phraseHits = 1;

  let score = 0;
  if (arr.length >= 6) score += 1;
  if (arr.length >= 12) score += 1;
  if ((rec.phraseHits || 0) >= 2) score += 1;
  if (NICK.test(String(name || ''))) score += 1;
  rec.score = score;
  if (hitPhrase) rec.lastPhrase = t;

  const mark = marks[u] || '';
  const final = score + (mark === 'bot' ? 3 : mark === 'human' ? -3 : 0);
  const recent = gs.recent || [];
  const uniq = new Set(recent).size;
  const noisy = arr.length >= 10 && uniq <= Math.max(2, Math.floor(recent.length / 2));
  const shortSpam = arr.length >= 6 && String(text || '').trim().length <= 8;
  const skip = final >= 3 && (noisy || shortSpam);
  rec.noisy = skip;
  if (skip) gs.skips = (gs.skips || 0) + 1;
  save();
  return skip;
}

export function isKnownBot(uin) {
  const r = db.uins[String(uin || '')];
  if (!r || (r.score || 0) < 3) return false;
  return Date.now() - (r.at || 0) < 7 * 24 * 3600 * 1000;
}

// 人群档案：某群今天最活跃的前 N 人
export function getPeople(gid, limit = 50) {
  let g = String(gid || '');
  // 没指定群：自动挑「今天最热闹」的那个群
  if (!g) {
    const day0 = dayKey();
    const totals = {};
    for (const rec of Object.values(db.uins)) {
      for (const [k, v] of Object.entries(rec)) {
        if (!k.startsWith('g') || !v || v.day !== day0) continue;
        totals[k.slice(1)] = (totals[k.slice(1)] || 0) + (v.n || 0);
      }
    }
    const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    g = best ? best[0] : '';
    if (!g) return [];
  }
  const key = 'g' + g;
  const day = dayKey();
  const rows = [];
  for (const [u, rec] of Object.entries(db.uins)) {
    const gs = rec[key];
    if (!gs || gs.day !== day) continue;
    const n = gs.n || 0;
    if (!n) continue;
    const recent = gs.recent || [];
    const uniq = new Set(recent).size;
    const dup = recent.length ? Math.round((1 - uniq / recent.length) * 100) : 0;
    const avgLen = Math.round((gs.lenSum || 0) / n);
    const mark = marks[u] || '';
    const score = (rec.score || 0) + (mark === 'bot' ? 3 : mark === 'human' ? -3 : 0);
    let verdict = '真人';
    if (score >= 3) verdict = '噪音机器人';
    else if (score >= 2) verdict = '疑似机器人';
    rows.push({ uin: u, name: rec.name || '', n, avgLen, dup, skips: gs.skips || 0, last: gs.last || '', mark, score, verdict });
  }
  rows.sort((a, b) => b.n - a.n);
  return rows.slice(0, Math.max(1, Math.min(200, limit)));
}

export function setMark(uin, mark) {
  const u = String(uin || '');
  if (!u) return false;
  if (mark === 'human' || mark === 'bot') marks[u] = mark;
  else delete marks[u];
  saveMarks();
  return true;
}

export function getMarks() { return marks; }
// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'bot-detect',
  layer: '感知', title: '机器识别', kind: 'tool', enabledByDefault: true, hot: false, hooks: [], config: [], stateFiles: ['bot-ids.json', 'human-marks.json'] };
