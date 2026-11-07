// 潜水限次：同一群 1 小时内最多切 2 次 diving。
// 状态文件：<stateDir>/wake-dive.json，形状 { "group:<gid>": { at: [ts, ...] } }。
import fs from 'node:fs';
import path from 'node:path';

export const DIVE_WINDOW_MS = 60 * 60 * 1000;
export const DIVE_MAX_PER_WINDOW = 2;

export function createDiveLimiter({ stateDir, now = () => Date.now() } = {}) {
  const file = path.join(String(stateDir), 'wake-dive.json');

  function readAll() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      return {};
    }
  }

  function writeAll(obj) {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
  }

  function pruned(list, t) {
    return (Array.isArray(list) ? list : [])
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x) && t - x < DIVE_WINDOW_MS)
      .sort((a, b) => a - b);
  }

  // 只读判断：现在再切一次潜水是否被允许。
  function canSwitch(key) {
    const t = now();
    const at = pruned(readAll()[String(key)]?.at, t);
    return { ok: at.length < DIVE_MAX_PER_WINDOW, used: at.length, at };
  }

  // 记录一次切换；超限返回 false 且不写文件。
  function trySwitch(key) {
    const t = now();
    const all = readAll();
    const k = String(key);
    const at = pruned(all[k]?.at, t);
    if (at.length >= DIVE_MAX_PER_WINDOW) return false;
    at.push(t);
    all[k] = { at };
    writeAll(all);
    return true;
  }

  return { canSwitch, trySwitch, file };
}
