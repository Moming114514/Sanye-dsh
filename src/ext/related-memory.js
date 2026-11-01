// 相关记忆：按「这一句」挑最相关的几条旧记忆，临时挂在私聊 roleHint 后面
// 从 bridge.js 的 RELATEDMEM_PATCH 迁出（M2 第五步）
import fs from 'node:fs';

const RELMEM_STOP = new Set(['一个', '什么', '我们', '你们', '他们', '这个', '那个', '现在', '就是', '还是', '可以', '没有', '知道', '觉得', '时候', '今天', '明天', '真的', '不是', '自己', '因为', '所以', '但是', '如果', '这样', '那样', '一点', '有点', '已经', '东西', '事情', '问题', '然后', '还有', '这里', '那里', '怎么', '这么', '那么', '一起', '一样', '不会', '不能']);

const cache = { key: '', records: [], df: new Map(), total: 0 };

export function relmemGrams(s) {
  const text = String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  const out = [];
  for (const chunk of text.split(' ')) {
    if (!chunk) continue;
    if (/^[a-z0-9_.+-]+$/.test(chunk)) {
      if (chunk.length >= 2) out.push(chunk);
      continue;
    }
    const chars = Array.from(chunk);
    for (let i = 0; i < chars.length - 1; i += 1) {
      const g = chars[i] + chars[i + 1];
      if (!RELMEM_STOP.has(g)) out.push(g);
    }
  }
  return out;
}

function index(paths) {
  try {
    const file = paths?.json;
    if (!file) return { key: '', records: [], df: new Map(), total: 0 };
    const st = fs.statSync(file);
    const key = `${st.mtimeMs}:${st.size}`;
    if (cache.key === key) return cache;
    const card = JSON.parse(fs.readFileSync(file, 'utf8'));
    const records = (card.records || []).filter((r) => r && !r.forgottenAt && (r.text || r.title));
    const df = new Map();
    for (const r of records) {
      const set = new Set(relmemGrams(`${r.title || ''} ${r.text || ''}`));
      for (const g of set) df.set(g, (df.get(g) || 0) + 1);
    }
    cache.key = key;
    cache.records = records;
    cache.df = df;
    cache.total = records.length;
    return cache;
  } catch {
    return { key: '', records: [], df: new Map(), total: 0 };
  }
}

function clean(s) {
  return String(s || '').replace(/\[图片\]/g, '').replace(/\[表情\]/g, '').replace(/\s+/g, ' ').trim();
}

export function relatedMemoryBlock(text, { cfg, paths } = {}) {
  const rc = cfg?.socialV2?.relatedMemories ?? {};
  if (rc.enabled === false) return '';
  const q = String(text ?? '').trim();
  if (q.length < 2 || q.startsWith('/')) return '';
  const maxItems = Math.max(1, Math.min(6, Number(rc.maxItems) || 3));
  const maxChars = Math.max(120, Math.min(900, Number(rc.injectMaxChars) || 300));
  const minHits = Math.max(1, Math.min(4, Number(rc.minHits) || 2));
  const idx = index(paths);
  if (!idx.records.length) return '';
  const qg = [...new Set(relmemGrams(q))];
  if (!qg.length) return '';
  const needHits = Math.min(minHits, qg.length);
  const n = Math.max(1, idx.total);
  const scored = [];
  for (const r of idx.records) {
    const hay = new Set(relmemGrams(`${r.title || ''} ${r.text || ''}`));
    let score = 0;
    let hit = 0;
    for (const g of qg) {
      if (!hay.has(g)) continue;
      hit += 1;
      score += Math.log(1 + n / (idx.df.get(g) || 1));
    }
    if (hit < needHits) continue;
    score += (Number(r.importance) || 0) / 250;
    if (r.pinned) score += 0.3;
    const last = Date.parse(r.lastSeenAt || r.createdAt || '') || 0;
    if (last && Date.now() - last < 14 * 86400000) score += 0.15;
    scored.push({ r, score });
  }
  if (!scored.length) return '';
  scored.sort((a, b) => b.score - a.score);
  const lines = [];
  let used = 0;
  for (const { r } of scored.slice(0, maxItems)) {
    const line = '- ' + clean(r.text || r.title || '').slice(0, 90);
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return '';
  return `【和这句话有关的记忆（你自己想起来的旧事，只当背景：和当前话题无关就当没想起来，不要硬提）】\n${lines.join('\n')}`;
}

// 只在私聊注入：群聊里不能把「和主人」的旧事塞给所有人看
export function relatedMemorySuffix({ key, text, cfg, paths, log } = {}) {
  try {
    if (!String(key || '').startsWith('private:')) return '';
    const block = relatedMemoryBlock(text, { cfg, paths });
    if (!block) return '';
    if (cfg?.socialV2?.relatedMemories?.log !== false && typeof log === 'function') {
      log(`[相关记忆] ${key} 注入 ${block.split('\n').length - 1} 条 for「${String(text).slice(0, 30)}」`);
    }
    return '\n\n' + block;
  } catch (e) {
    if (typeof log === 'function') log('[相关记忆] 计算失败:', e?.message ?? e);
    return '';
  }
}

export default {
  id: 'related-memory',
  title: '相关记忆',
};
