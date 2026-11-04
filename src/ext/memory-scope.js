// MEMSCOPE_PATCH：按会话给记忆卡分权限。
// 目标：
//   群聊 → 只给她「这个群里的记忆」+ 公开记忆（B站动态）；
//   私聊 → 只给「这个人的记忆」+ 公开记忆；
//   没带会话标记的老条目 → 视作主人的私事，只在主人私聊里出现；
//   拿不到 key（内部用途/调试）→ 全量，保持旧行为。
import fs from 'node:fs';
import { loadMemoryCard, renderMemoryCard, normalizeMemoryCardConfig } from '../memory-card.js';

const cache = new Map(); // 只保留最近几份，避免无界增长
const CACHE_MAX = 8;

function isPublicRecord(r) {
  const src = String(r?.source || '');
  if (src.startsWith('bili')) return true;
  if (r?.kind === 'public') return true;
  return false;
}

export function filterCardForSession(card, key, { ownerQQ = '' } = {}) {
  const records = Array.isArray(card?.records) ? card.records : [];
  const k = String(key || '').trim();
  if (!k) return { card, kept: records.length, total: records.length, mode: 'all' };

  const isGroup = k.startsWith('group:');
  const gid = isGroup ? k.slice(6) : '';
  const uin = isGroup ? '' : k.replace(/^private:/, '');
  const owner = String(ownerQQ || '').trim();

  const kept = records.filter((r) => {
    const ck = String(r?.conversationKey || '');
    const rg = String(r?.groupId || '');
    // 「永远不会忘的」（anchor / pinned）对所有会话可见：这是她的人格底座，不该因为换个群就忘。
    if (r?.anchor === true || r?.pinned === true) return true;
    if (isGroup) return ck === k || (!ck && rg === gid) || isPublicRecord(r);
    // 私聊：本人的 + 公开的 + 没标记归属的老条目（默认算主人）
    if (ck === k || isPublicRecord(r)) return true;
    if (!ck && !rg) return !owner || uin === owner;
    return false;
  });

  return { card: { ...card, records: kept }, kept: kept.length, total: records.length, mode: isGroup ? 'group' : 'private' };
}

// 返回 { text, kept, total, mode }；jsonPath 不存在时抛错，由调用方回退到旧的 md。
export function scopedMemoryText({ paths, key = '', config = {}, maxChars = 2800, ownerQQ = '' }) {
  const jsonPath = paths?.json;
  const st = fs.statSync(jsonPath);
  const cacheKey = `${key || '-'}|${st.mtimeMs}:${st.size}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const card = loadMemoryCard(paths);
  const { card: filtered, kept, total, mode } = filterCardForSession(card, key, { ownerQQ });
  const cfgN = normalizeMemoryCardConfig(config || {});
  const text = String(renderMemoryCard(filtered, { platform: 'qq', config: cfgN, maxChars }) || '');
  const out = { text, kept, total, mode };

  cache.set(cacheKey, out);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'memory-scope',
  layer: '记忆', title: '记忆可见范围', kind: 'core', enabledByDefault: true, hot: false, hooks: [], config: [], stateFiles: [] };
