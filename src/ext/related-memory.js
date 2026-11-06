// 相关记忆：按「这一句」挑最相关的几条旧记忆，临时挂在私聊 roleHint 后面
// 从 bridge.js 的 RELATEDMEM_PATCH 迁出（M2 第五步）
import fs from 'node:fs';

const RELMEM_STOP = new Set(['一个', '什么', '我们', '你们', '他们', '这个', '那个', '现在', '就是', '还是', '可以', '没有', '知道', '觉得', '时候', '今天', '明天', '真的', '不是', '自己', '因为', '所以', '但是', '如果', '这样', '那样', '一点', '有点', '已经', '东西', '事情', '问题', '然后', '还有', '这里', '那里', '怎么', '这么', '那么', '一起', '一样', '不会', '不能']);

const cache = { key: '', records: [], df: new Map(), postings: new Map(), total: 0 }; // INVERTED_INDEX_PATCH

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
    if (!file) return { key: '', records: [], df: new Map(), postings: new Map(), total: 0 };
    const st = fs.statSync(file);
    const key = `${st.mtimeMs}:${st.size}`;
    if (cache.key === key) return cache;
    const card = JSON.parse(fs.readFileSync(file, 'utf8'));
    const records = (card.records || []).filter((r) => r && !r.forgottenAt && !r.displayOnly && (r.text || r.title)); // 只展示的不参与召回
    const df = new Map();
    const postings = new Map();
    records.forEach((r, i) => {
      const set = new Set(relmemGrams(`${r.title || ''} ${r.text || ''}`));
      for (const g of set) {
        df.set(g, (df.get(g) || 0) + 1);
        let arr = postings.get(g);
        if (!arr) { arr = []; postings.set(g, arr); }
        arr.push(i);
      }
    });
    cache.key = key;
    cache.records = records;
    cache.df = df;
    cache.postings = postings;
    cache.total = records.length;
    return cache;
  } catch {
    return { key: '', records: [], df: new Map(), postings: new Map(), total: 0 };
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
  // INVERTED_INDEX_PATCH：先用倒排拿到候选（只有命中 >= needHits 的记忆才可能进结果），
  // 再对候选算完整分。原来每条记忆都要重新切一遍 gram，2000 条以上会明显拖慢每轮注入。
  const hits = new Map();
  for (const g of qg) {
    const arr = idx.postings.get(g);
    if (!arr) continue;
    for (const i of arr) hits.set(i, (hits.get(i) || 0) + 1);
  }
  const scored = [];
  for (const [i, hit] of hits) {
    if (hit < needHits) continue;
    const r = idx.records[i];
    if (!r) continue;
    let score = 0;
    const hay = new Set(relmemGrams(`${r.title || ''} ${r.text || ''}`));
    for (const g of qg) {
      if (!hay.has(g)) continue;
      score += Math.log(1 + n / (idx.df.get(g) || 1));
    }
    score += (Number(r.importance) || 0) / 250;
    if (r.pinned) score += 0.3;
    const last = Date.parse(r.lastSeenAt || r.createdAt || '') || 0;
    if (last && Date.now() - last < 14 * 86400000) score += 0.15;
    scored.push({ r, score });
  }
  if (!scored.length) return '';
  scored.sort((a, b) => b.score - a.score);

  // ASSOC_PATCH：先按这句话挑出种子，再顺着种子把自己的「邻居」捞回来——
  // 同一场对话里前后几小时、或者同一个 tag 的记忆，往往才是她真正会想起的那件事。
  const expand = Math.max(0, Math.min(3, Number(rc.expand ?? 2)));
  const seeds = scored.slice(0, maxItems);
  const pickedIds = new Set(seeds.map((x) => x.r.id));
  const tagSet = (r) => new Set([...(Array.isArray(r.tags) ? r.tags : []), ...(r.tag ? [r.tag] : [])]);
  const tsOf = (r) => Date.parse(r.createdAt || r.lastSeenAt || '') || 0;
  const extras = [];
  if (expand > 0) {
    for (const seed of seeds) {
      if (extras.length >= expand) break;
      const sts = tsOf(seed.r);
      for (const r of idx.records) {
        if (extras.length >= expand) break;
        if (pickedIds.has(r.id)) continue;
        let near = false;
        // 关联 = 同一场对话里、和他这段话前后 15 分钟内记下的另一件事（通常是同一次交流的两面）
        if (seed.r.conversationKey && r.conversationKey === seed.r.conversationKey) {
          const d = Math.abs(tsOf(r) - sts);
          if (d > 0 && d <= 15 * 60 * 1000) near = true;
        }
        if (!near) continue;
        extras.push({ r, score: seed.score * 0.55 });
        pickedIds.add(r.id);
      }
    }
  }
  const lines = [];
  let used = 0;
  for (const { r } of seeds) {
    const line = '- ' + clean(r.text || r.title || '').slice(0, 90);
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  for (const { r } of extras) {
    const line = '- （顺着这条想起的）' + clean(r.text || r.title || '').slice(0, 84);
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
    const _rc0 = (cfg && cfg.socialV2 && cfg.socialV2.relatedMemories) || {};
    const _k0 = String(key || '');
    // MEMTOPIC：群聊也注入（受 groups 开关控制）
    if (!_k0.startsWith('private:') && !(_rc0.groups && _k0.startsWith('group:'))) return '';
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

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'related-memory',
  layer: '记忆', title: '相关记忆', kind: 'core', enabledByDefault: true, hot: false, hooks: [], config: ['socialV2.relatedMemories'], stateFiles: [] };
