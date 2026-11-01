// B站「每日学一个」：关键词搜索 → 挑没看过的技术视频 → 收进收藏夹 → 交给三叶用 video_storyboard 真看。
//
// 边界：
//   · 只读公开数据 + 只写自己的收藏夹（fav/resource/deal），不评论、不点赞、不私信。
//   · 凭据沿用 ~/.dsh/surfcore/bili/credentials.json，不写日志、不回显。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadBiliAccount, fetchVideoInfo } from './bili-api.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

export function resolveStudyPaths(home = os.homedir()) {
  const dir = path.join(home, '.dsh', 'surfcore', 'state');
  return {
    dir,
    state: path.join(dir, 'bili-study.json'),
    notes: path.join(dir, 'bili-study.md'),
  };
}

function readJson(file, fallback) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

export function todayStr(now = Date.now()) {
  const d = new Date(now);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function readStudyState(home = os.homedir()) {
  const p = resolveStudyPaths(home);
  const st = readJson(p.state, null) || {};
  return {
    seen: Array.isArray(st.seen) ? st.seen.filter(Boolean) : [],
    day: String(st.day || ''),
    count: Number(st.count) || 0,
    kwCursor: Number(st.kwCursor) || 0,
    nextAt: Number(st.nextAt) || 0,
    lastBvid: String(st.lastBvid || ''),
    lastAt: Number(st.lastAt) || 0,
    folderId: String(st.folderId || ''),
    // PENDING_STATE_PATCH：催促逻辑要用这三个字段，之前被丢掉了
    pendingBvid: String(st.pendingBvid || ''),
    pendingAt: Number(st.pendingAt) || 0,
    nudged: Number(st.nudged) || 0,
  };
}

export function writeStudyState(patch, home = os.homedir()) {
  const p = resolveStudyPaths(home);
  const cur = readStudyState(home);
  const next = { ...cur, ...patch };
  if (next.seen.length > 500) next.seen = next.seen.slice(-500);
  writeJson(p.state, next);
  return next;
}

export function studyDefaults() {
  return {
    enabled: true,
    keywords: [
      'DeepSeek Harness 插件',
      'DSH 插件',
      'AI Agent 工作流',
      'MCP 服务器',
      '本地部署 大模型',
      '提示词工程 技巧',
      'token 省钱',
    ],
    dailyMax: 2,
    minDurationSec: 90,
    maxDurationSec: 2400,
    minPlay: 1000,
    maxAgeDays: 400,
    folderId: '4374163087',
    noteKeywords: [],
  };
}

export function studyCfg(raw) {
  const d = studyDefaults();
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = { ...d, ...c };
  out.keywords = (Array.isArray(out.keywords) ? out.keywords : d.keywords).map(s => String(s || '').trim()).filter(Boolean);
  if (!out.keywords.length) out.keywords = d.keywords.slice();
  for (const k of ['dailyMax', 'minDurationSec', 'maxDurationSec', 'minPlay', 'maxAgeDays']) {
    const n = Number(out[k]);
    out[k] = Number.isFinite(n) ? n : d[k];
  }
  out.enabled = out.enabled !== false;
  out.folderId = String(out.folderId || d.folderId).trim();
  return out;
}

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

async function wbiMixinKey(account, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: account.headers,
      signal: ctrl.signal,
    });
    const j = await r.json();
    const img = String(j?.data?.wbi_img?.img_url || '');
    const sub = String(j?.data?.wbi_img?.sub_url || '');
    const pick = u => (u.split('/').pop() || '').split('.')[0];
    const raw = pick(img) + pick(sub);
    if (raw.length < 64) return '';
    return MIXIN.map(i => raw[i] || '').join('').slice(0, 32);
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function signWbi(params, mixinKey) {
  const wts = Math.floor(Date.now() / 1000);
  const all = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

export function parseDuration(text) {
  const parts = String(text || '').trim().split(':').map(x => Number(x));
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function stripEm(text) {
  return String(text || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

export async function searchVideos({ keyword, pageSize = 10, home = os.homedir(), timeoutMs = 15000 } = {}) {
  const account = loadBiliAccount({ home });
  if (!account.hasCredentials) return { ok: false, reason: '缺少 B 站凭据' };
  const mixinKey = await wbiMixinKey(account, timeoutMs);
  if (!mixinKey) return { ok: false, reason: '拿不到 WBI 密钥' };
  const qs = signWbi({ search_type: 'video', keyword, page: 1, page_size: pageSize }, mixinKey);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`, {
      headers: { ...account.headers, referer: 'https://search.bilibili.com/' },
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j?.code !== 0) return { ok: false, reason: `搜索失败 code=${j?.code} ${j?.message || ''}`.trim() };
    const list = (Array.isArray(j?.data?.result) ? j.data.result : [])
      .filter(v => v && v.bvid && v.type === 'video')
      .map(v => ({
        bvid: String(v.bvid),
        aid: Number(v.aid) || 0,
        title: stripEm(v.title),
        author: stripEm(v.author),
        play: Number(v.play) || 0,
        durationSec: parseDuration(v.duration),
        durationText: String(v.duration || ''),
        pubdate: Number(v.pubdate) || 0,
        description: stripEm(v.description || ''),
      }));
    return { ok: true, list, keyword };
  } catch (err) {
    return { ok: false, reason: `搜索异常：${err?.message || err}` };
  } finally {
    clearTimeout(t);
  }
}

// FAVBYBV_PATCH：按 bvid 收进收藏夹（先查 aid；fetchVideoInfo 不返回 aid，所以这里自己查）
export async function favoriteByBvid({ bvid, folderId, home = os.homedir(), timeoutMs = 15000 } = {}) {
  const bv = String(bvid || '').trim();
  if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) return { ok: false, reason: 'BV 号格式不对' };
  const account = loadBiliAccount({ home });
  if (!account.hasCredentials) return { ok: false, reason: '缺少 B 站凭据' };
  try {
    const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bv), {
      headers: account.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    const aid = Number(j?.data?.aid || 0);
    if (!aid) return { ok: false, reason: 'view 拿不到 aid (code=' + (j?.code ?? r.status) + ')' };
    const out = await addToFolder({ aid, folderId, home, timeoutMs });
    return out.ok ? { ok: true, aid, title: String(j?.data?.title || ''), data: out.data } : { ok: false, aid, reason: out.reason };
  } catch (e) {
    return { ok: false, reason: '收藏异常：' + String(e?.message || e).slice(0, 120) };
  }
}

export async function addToFolder({ aid, folderId, home = os.homedir(), timeoutMs = 15000 } = {}) {
  const account = loadBiliAccount({ home });
  if (!account.hasCredentials) return { ok: false, reason: '缺少 B 站凭据' };
  const csrf = String(account.cred?.bili_jct || '');
  if (!csrf) return { ok: false, reason: '缺少 bili_jct' };
  const fid = String(folderId || '').trim();
  if (!fid) return { ok: false, reason: '没有收藏夹 id' };
  const body = new URLSearchParams({
    rid: String(aid),
    type: '2',
    add_media_ids: fid,
    csrf,
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.bilibili.com/x/v3/fav/resource/deal', {
      method: 'POST',
      headers: { ...account.headers, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (j?.code !== 0) return { ok: false, reason: `收藏失败 code=${j?.code} ${j?.message || ''}`.trim() };
    return { ok: true, data: j?.data ?? null };
  } catch (err) {
    return { ok: false, reason: `收藏异常：${err?.message || err}` };
  } finally {
    clearTimeout(t);
  }
}

function liked(title, cfg) {
  const low = String(title || '').toLowerCase();
  const bad = ['带货', '抽奖', '纯搬运', '标题党', '擦边', '广告'];
  return !bad.some(w => low.includes(w));
}

export async function pickStudyVideo({ cfg, home = os.homedir(), now = Date.now() } = {}) {
  const c = studyCfg(cfg);
  const st = readStudyState(home);
  const day = todayStr(now);
  const count = st.day === day ? st.count : 0;
  if (!c.enabled) return { ok: false, reason: '学习任务已关闭' };
  if (count >= c.dailyMax) return { ok: false, reason: `今天已经学了 ${count} 个（上限 ${c.dailyMax}）` };

  const seen = new Set(st.seen);
  const minPub = Math.floor((now - c.maxAgeDays * 86400000) / 1000);
  const picked = [];
  const tried = [];

  for (let i = 0; i < c.keywords.length; i += 1) {
    const kw = c.keywords[(st.kwCursor + i) % c.keywords.length];
    tried.push(kw);
    const res = await searchVideos({ keyword: kw, pageSize: 10, home });
    if (!res.ok) continue;
    for (const v of res.list) {
      if (seen.has(v.bvid)) continue;
      if (v.durationSec < c.minDurationSec || v.durationSec > c.maxDurationSec) continue;
      if (v.play < c.minPlay) continue;
      if (v.pubdate && v.pubdate < minPub) continue;
      if (!liked(v.title, c)) continue;
      picked.push({ ...v, keyword: kw, score: Math.log10(v.play + 10) * 10 + Math.min(5, (now / 1000 - (v.pubdate || 0)) / 86400 / 7) });
    }
    if (picked.length >= 6) break;
  }
  if (!picked.length) return { ok: false, reason: `没搜到新视频（试过：${tried.join('、')}）` };

  picked.sort((a, b) => b.score - a.score);
  let video = picked[0];
  if (!video.aid) {
    const info = await fetchVideoInfo(video.bvid, { home }).catch(() => null);
    if (info?.ok && info?.data?.aid) video = { ...video, aid: Number(info.data.aid), title: video.title || stripEm(info.data.title) };
  }

  const fav = video.aid ? await addToFolder({ aid: video.aid, folderId: c.folderId, home }) : { ok: false, reason: '没有 aid' };

  const nextState = writeStudyState({
    day,
    count: count + 1,
    kwCursor: (st.kwCursor + 1) % c.keywords.length,
    seen: [...st.seen, video.bvid],
    lastBvid: video.bvid,
    lastAt: now,
    folderId: c.folderId,
  }, home);

  return { ok: true, video, favorited: fav.ok, favReason: fav.ok ? '' : fav.reason, count: nextState.count, dailyMax: c.dailyMax };
}

export function studyStatusText({ cfg, home = os.homedir(), now = Date.now() } = {}) {
  const c = studyCfg(cfg);
  const st = readStudyState(home);
  const count = st.day === todayStr(now) ? st.count : 0;
  const lines = [
    `学习任务：${c.enabled ? '开' : '关'}`,
    `今天：${count} / ${c.dailyMax} 条`,
    `已收藏：${st.seen.length} 条`,
    `收藏夹 id：${c.folderId}`,
    `关键词：${c.keywords.join('、')}`,
    `时长范围：${Math.round(c.minDurationSec / 60)}~${Math.round(c.maxDurationSec / 60)} 分钟`,
  ];
  if (st.lastBvid) lines.push(`上一条：${st.lastBvid}`);
  return lines.join('\n');
}

/** 判断某条视频是否真的被"看过"：她会话里出现该 bvid，或分镜缓存目录在 sinceMs 后有新内容。 */
export async function hasWatched(bvid, home = os.homedir(), sinceMs = 0) { // HASWATCHED_PATCH
  // "她真的看了" 的证据 = 她自己的 DSH 会话里出现 video_storyboard 的调用记录，
  // 且该会话里没有"不在 QQ 桥接白名单内"的拒绝（否则只是尝试被拦）。
  // 不能用缓存目录判断：我自己手工跑测试会误判成她看了。
  const root = path.join(home, '.dsh', 'sessions');
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/^session\./.test(e.name)) continue;
      try {
        const st = fs.statSync(p);
        if (sinceMs && st.mtimeMs < sinceMs) continue;
        files.push(p);
      } catch {}
    }
  };
  walk(root, 0);
  for (const file of files) {
    try {
      const body = file.endsWith('.zstd')
        ? execFileSync('zstd', ['-dc', file], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
        : fs.readFileSync(file, 'utf8');
      if (body.includes('video_storyboard') && !body.includes('QQ 桥接白名单')) return true;
    } catch {}
  }
  return false;
}
