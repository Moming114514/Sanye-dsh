// 回谁：把群里「这条该回谁」写成显式规则表（shadow 观测用）。
// 纯函数：不读文件、不写文件、不调任何状态；所有输入由调用方从 state 快照传入。
// 接入方式：bridge 在 [策略·预测] 之后旁路调用一次，只打一行 [回谁] 日志，不改变发送逻辑。
//
// 判定顺序（固定，见 REPLY_RULES）：
//   private > at > name > quote > question > sample > none
//   - at 由唤醒原因（atMention/ownerMention）或消息上的 atSelf 标记得出；
//   - question 要求「问句 + 30 秒内没有别人接话」；
//   - 现状里 attention 放行本身就含抽样，所以「放行但非直呼」统一记为 sample；

export const REPLY_RULES = ['private', 'at', 'name', 'quote', 'question', 'sample', 'none'];

const NAME_RE = /三叶|三葉|叶子/;
const QUESTION_RE = /[?？]|吗|呢|怎么|为什么|有没有|是不是|能不能|会不会/;
const AT_REASON_RE = /atMention|ownerMention/;
const FRESH_MS = 30 * 1000;

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
 * @param {object|null} input.last  触发唤醒的那条消息（state.unread 的最后一条）
 * @param {object[]} [input.recent] 最近 N 条消息（含 last）
 * @param {string} [input.reason]   唤醒原因
 * @param {number} [input.now]      判定时间
 * @param {{allow?:boolean, source?:string}} [input.policy]  speak-policy 的结论
 * @param {string[]} [input.selfUins] 她自己的 QQ（用于从候选里排除）
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
    if (u && !self.has(u) && !candidates.includes(u)) candidates.push(u);
  }

  const target = senderOf(last) || null;

  // 1) 私聊：永远回对方
  if (!key.startsWith('group:')) {
    return { target, rule: 'private', candidates };
  }

  if (!last) return { target: null, rule: 'none', candidates };

  // 2) 群里被 @
  if (isAtSelf(last, input.reason)) {
    return { target, rule: 'at', candidates };
  }

  // 3) 没 @ 但叫了名字
  if (NAME_RE.test(norm(textOf(last)))) {
    return { target, rule: 'name', candidates };
  }

  // 4) 引用了我的消息
  if (last.quoteTargetIsSelf === true) {
    return { target, rule: 'quote', candidates };
  }

  // 5) 问句且 30 秒内没有别人接话
  if (QUESTION_RE.test(norm(textOf(last)))) {
    const t0 = Number(last.time || 0);
    const fresh = now - t0 <= FRESH_MS;
    const answered = recent.some((m) => {
      const u = senderOf(m);
      return u && u !== target && Number(m?.time || 0) > t0;
    });
    if (fresh && !answered) {
      return { target, rule: 'question', candidates };
    }
  }

  // 6) 其余：现有策略放行即视为抽样命中（attention 内部含抽样）
  if (policy.allow !== false) {
    return { target, rule: 'sample', candidates };
  }

  // 7) 不放行
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
