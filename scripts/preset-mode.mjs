// F-2：三档卡的模式/活跃度推导（纯函数，面板与测试共用）
export function derivePresetMode({ learned, muted }) {
  if (learned) return 'watch'; // 只看不说优先
  if (muted) return 'called'; // 只听叫我
  return 'normal';
}

export function derivePresetActivity({ sample, level }) {
  const s = Number(sample) || 0;
  if (s >= 1) return 'active';
  if (s > 0) return 'normal';
  if (level === 'active') return 'active';
  if (level === 'quiet') return 'quiet';
  return 'normal';
}
