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

// 沉默白名单（2026-11-07）：只有 timeout 唤醒允许 [SILENT]/安静收尾。
// poke / sample / 直呼必须说；其它唤醒（bootstrap/history/replyCheck 等）保持原行为。
export const SILENT_ALLOWED_REASONS = Object.freeze(new Set(['timeout']));
export const MUST_REPLY_REASONS = Object.freeze(new Set(['poke', 'sample', 'atMention', 'nameMention', 'ownerMention', 'ownerCall']));

export function wakeAllowsSilent(reason, explicit) {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const r = String(reason ?? '');
  if (SILENT_ALLOWED_REASONS.has(r)) return true;
  if (MUST_REPLY_REASONS.has(r)) return false;
  return true;
}
