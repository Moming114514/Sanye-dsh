// 只听主人：群里只在他说话之后才醒（补唤醒/主动机会/定时一律不吵模型）
// 从 bridge.js 的 OWNERONLY_GATE_PATCH 迁出（M2 第三步）
const lastGroupSpeaker = new Map();

function noteGroupSpeaker(key, uin) {
  try {
    if (!String(key || '').startsWith('group:')) return;
    lastGroupSpeaker.set(String(key), { uin: String(uin == null ? '' : uin), at: Date.now() });
  } catch {}
}

function ownerOnlyGroupAllowed(key, cfg) {
  const rec = lastGroupSpeaker.get(String(key));
  if (!rec) return false;
  if (Date.now() - Number(rec.at || 0) > 6 * 60 * 60 * 1000) return false;
  return rec.uin === String(cfg?.ownerQQ ?? '');
}

export { ownerOnlyGroupAllowed };

export default {
  id: 'owner-only',
  title: '只听主人',

  // 群消息入口记下最后说话的人（open 模式不影响任何行为）
  onGroupMessage({ key, uin }) {
    noteGroupSpeaker(key, uin);
  },

  // 唤醒闸门：返回 { allow:false } 就不叫醒模型
  wakeGate({ key, reason, cfg, mode }) {
    if (!String(key || '').startsWith('group:')) return { allow: true };
    if (mode === 'privateonly') {
      if (['manual', 'admin'].includes(String(reason))) return { allow: true };
      return { allow: false, reason: `[只跟我私聊] 跳过群唤醒 ${key}（${reason}）` };
    }
    if (mode !== 'owneronly') return { allow: true };
    if (['manual', 'admin'].includes(String(reason))) return { allow: true };
    if (ownerOnlyGroupAllowed(key, cfg)) return { allow: true };
    return { allow: false, reason: `[只听主人] 跳过唤醒 ${key}（${reason}）：他最近没在这个群说话` };
  },
};

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'owner-only', layer: '判断',
  title: '只听主人',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 10,
  hooks: ['wakeGate', 'onGroupMessage'],
  config: ['ownerQQ'],
  stateFiles: [],
};
