// 拍一拍合并（2026-11-07）：
// 同一群 60 秒内多次 poke 只唤醒一次；状态 ~/.dsh/surfcore/state/poke-merge.json。
// 只写本地文件，失败静默（合并是节流优化，不能因为写盘失败丢唤醒）。
import fs from 'node:fs';
import path from 'node:path';

export const POKE_MERGE_WINDOW_MS = 180_000;

export function createPokeMerger({ stateDir, now = () => Date.now(), windowMs = POKE_MERGE_WINDOW_MS }) {
  const file = path.join(stateDir, 'poke-merge.json');
  const read = () => {
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch { return {}; }
  };
  const write = (obj) => {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, file);
    } catch {}
  };
  function tryMerge(key, at = now()) {
    const t = Number(at) || now();
    const all = read();
    const next = {};
    for (const [k, v] of Object.entries(all)) {
      const last = Number(v);
      if (Number.isFinite(last) && t - last < windowMs) next[k] = last;
    }
    const last = Number(next[key]);
    if (Number.isFinite(last) && t - last < windowMs) {
      next[key] = last;
      write(next);
      return { merged: true, sinceSec: Math.max(0, Math.round((t - last) / 1000)) };
    }
    next[key] = t;
    write(next);
    return { merged: false, sinceSec: 0 };
  }
  return { tryMerge, file };
}
