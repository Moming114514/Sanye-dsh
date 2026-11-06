// 回谁：把群里「这条该回谁」写成显式规则表（shadow 观测用）。
// 纯函数：不读文件、不写文件、不调任何状态；所有输入由调用方从 state 快照传入。
// 接入方式：bridge 在 [策略·预测] 之后旁路调用一次，只打一行 [回谁] 日志，不改变发送逻辑。
// 判定顺序：private > owner > at > name > quote > question > sample > none

export const REPLY_RULES = ['private', 'owner', 'at', 'name', 'quote', 'question', 'sample', 'none'];

const NAME_RE = /三叶|三葉|叶子/;
const QUESTION_RE = /[?？]|吗|呢|怎么|为什么|有没有|是不是|能不能|会不会/;
const AT_REASON_RE = /atMention|ownerMention/;
const OWNER_FRESH_MS = 5 * 60 * 1000;

function norm(s) {
  return String(s || '')
    .replace(/\[图片\]|\[表情(:[^\]]*)?\]|\[表情包\]|\[动图\]|\[语音\]|\[视频\]/g, ' ')
    .replace(/\[引用[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function senderOf(m) {
  return String(m?.sender ?? m?.uin ?? m?.userId ?? '').trim();
}

function textOf(m) {
  return m?.plain ?? m?.text ?? '';
}

function isAtSelf(last, reason) {
  if (last?.atSelf === true) return true;
  return AT_REASON_RE.test(String(reason || ''));
}

/**
 * @param {object} input
 * @param {string} input.key        会话键（group:gid / private:uin）
 * @param {object|null} input.last  触发唤醒的那条消息
 * @param {object[]} [input.recent] 最近 N 条消息（chronological，含 last，可含 isSelf）
 * @param {string} [input.reason]   唤醒原因
 * @param {number} [input.now]      判定时间
 * @param {{allow?:boolean, source?:string}} [input.policy]
 * @param {string[]} [input.selfUins]
 * @returns {{target:string|null, rule:string, candidates:string[]}}
 */
export function decideReplyTarget(input = {}) {
  const key = String(input.key || '');
  const last = input.last || null;
  const recent = Array.isArray(input.recent) ? input.recent : (last ? [last] : []);
  const now = Number(input.now || Date.now());
  const policy = input.policy || {};
  const self = new Set((input.selfUins || []).map(String));

  const candidates = [];
  for (const m of recent) {
    const u = senderOf(m);
    if (u && !m?.isSelf && !self.has(u) && !candidates.includes(u)) candidates.push(u);
  }

  const target = senderOf(last) || null;

  if (!key.startsWith('group:')) return { target, rule: 'private', candidates };
  if (!last) return { target: null, rule: 'none', candidates };

  // 主人优先级：最近 5 分钟内主人说过话，就先回主人
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i];
    if (!m || !m.isOwner) continue;
    if (now - Number(m.time || 0) <= OWNER_FRESH_MS) {
      return { target: senderOf(m) || target, rule: 'owner', candidates };
    }
    break;
  }

  if (isAtSelf(last, input.reason)) return { target, rule: 'at', candidates };
  if (NAME_RE.test(norm(textOf(last)))) return { target, rule: 'name', candidates };
  if (last.quoteTargetIsSelf === true) return { target, rule: 'quote', candidates };

  // 未回答的问句：从后往前找，跳过她已回过的
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const m = recent[i];
    if (!m || m.isSelf) continue;
    if (!QUESTION_RE.test(norm(textOf(m)))) continue;
    const answered = recent.slice(i + 1).some((x) => x && x.isSelf);
    if (answered) continue;
    return { target: senderOf(m) || target, rule: 'question', candidates };
  }

  if (policy.allow !== false) return { target, rule: 'sample', candidates };
  return { target: null, rule: 'none', candidates };
}

export const manifest = {
  id: 'reply-target',
  title: '回谁（shadow）',
  layer: '判断',
  kind: 'tool',
  enabledByDefault: true,
  hot: true,
  hooks: [],
  config: [],
  stateFiles: [],
};
