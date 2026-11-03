// 黑箱模式：某些内部任务（比如学说法）不希望她的回复发到 QQ
// 从 bridge.js 的 STYLE_PATCH13/14 迁出（M2 第七步）
const TTL_MS = 15 * 60 * 1000;
const until = new Map(); // key -> 过期时间戳

export function markSilent(key, ms = TTL_MS) {
  if (!key) return;
  until.set(String(key), Date.now() + Math.max(1000, Number(ms) || TTL_MS));
}

export function isSilent(key) {
  const t = until.get(String(key)) || 0;
  return t > Date.now();
}

/** 取一次并清掉（用于「本轮回复不发送」这种一次性语义） */
export function consumeSilent(key) {
  const k = String(key);
  if (!isSilent(k)) return false;
  until.delete(k);
  return true;
}

export function clearSilent(key) {
  try {
    until.delete(String(key));
  } catch {}
}

export default {
  id: 'blackbox',
  title: '黑箱任务',
};

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'blackbox', title: '黑箱静默', kind: 'core', enabledByDefault: true, hot: false, hooks: [], config: [], stateFiles: [] };
