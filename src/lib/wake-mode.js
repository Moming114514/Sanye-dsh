// 唤醒档位默认值（2026-11-07）：
// active 默认 anyMessage=true，但调用方显式传 false 时必须保留 false（否则「只回被叫」设置被吞）。
// diving 及其它 mode 不在这里动。
export function applyModeDefaults(next, triggersInput = {}) {
  if (!next || typeof next !== 'object') return next;
  if (next.mode === 'active') {
    next.infinite = true;
    next.sleepUntil = null;
    const hasExplicit = triggersInput && typeof triggersInput === 'object' && ('anyMessage' in triggersInput);
    next.triggers.anyMessage = hasExplicit ? triggersInput.anyMessage === true : true;
  }
  return next;
}
