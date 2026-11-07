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

// 沉默白名单（2026-11-07 反转）：默认「被叫醒就说话」，
// 只有这些「非人类叫醒」的定时/自查唤醒允许安静收尾。
export const SILENT_ALLOWED_REASONS = Object.freeze(new Set([
  'timeout', 'bootstrap', 'history', 'replyCheck', 'proactive',
]));

export function wakeAllowsSilent(reason, explicit) {
  if (explicit === true) return true;
  if (explicit === false) return false;
  return SILENT_ALLOWED_REASONS.has(String(reason ?? ''));
}
