// MEMALIAS：零依赖的同义词/别名扩展（G1-轻量）
// 作用：把「米饭」和「大白饭」、「生日」和「10月30」这种说法接起来，
// 让倒排检索在"换个说法"时也能命中。
import fs from 'node:fs';

const ALIAS_PATH = new URL('../data/memory-aliases.json', import.meta.url);
let _cache = null;

function loadAliases() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(fs.readFileSync(ALIAS_PATH, 'utf8'));
  } catch {
    _cache = {};
  }
  return _cache;
}

// 构建「词 -> 同组所有词」的反查表
function buildIndex(map) {
  const rev = new Map();
  for (const [k, list] of Object.entries(map)) {
    if (!Array.isArray(list)) continue;
    const group = new Set([k, ...list]);
    for (const w of group) {
      const cur = rev.get(w) || new Set();
      for (const x of group) cur.add(x);
      rev.set(w, cur);
    }
  }
  return rev;
}

let _rev = null;

export function expandGrams(grams) {
  if (!Array.isArray(grams) || !grams.length) return grams || [];
  if (!_rev) _rev = buildIndex(loadAliases());
  if (!_rev.size) return grams;
  const out = new Set(grams);
  const addBigrams = (w) => {
    const t = String(w || '');
    for (let i = 0; i + 1 < t.length; i += 1) out.add(t.slice(i, i + 2));
  };
  // MEMALIAS_BIGRAM：倒排索引是按二元组建的，多字别名必须拆成二元组才可能命中
  for (const g of grams) {
    const group = _rev.get(g);
    if (!group) continue;
    for (const x of group) {
      out.add(x);
      if (x.length > 2) addBigrams(x);
    }
  }
  return [...out];
}

export function reloadAliases() {
  _cache = null;
  _rev = null;
}
