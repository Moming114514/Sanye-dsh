// 发言策略：把现在散落在 ext wakeGate + 鱼群保护里的「要不要开口」合成一个纯函数。
// 只读观测用：bridge 在 sendWakePromptV2 入口旁路调用一次，打一行 [策略] 日志，不改变任何现有判断。
// 纯函数约定：不读文件、不写文件、不调 wakeGate、不碰状态；所有输入都从 state 快照进来。
//
// 优先级（显式写在 SPEAK_PRIORITY 里，不依赖模块注册顺序）：
//   ownerOnly > mute > learn > replyOnly > economy > rate > attention > sample > fishGuard > safe
//
// 与现状的有意差异（第 3 步差异对照表用）：
//   1. replyOnly 现在实际藏在 attention.js 内部、排在 economy/rate 之后；这里按目标顺序排在 economy 之前，
//      命中时 note 注明「现状由 attention 判」。
//   2. 抽样在现状里也由 attention 内部 Math.random 决定；这里 rng 由调用方注入，命中记 source=sample。

// 与 src/ext/group-rate.js 的 LEVELS 保持一致（纯函数不 import 那个模块的 IO）。
const LEVELS = {
  quiet: { minGapMs: 15 * 60 * 1000, maxPerDay: 12 },
  normal: { minGapMs: 6 * 60 * 1000, maxPerDay: 40 },
  active: { minGapMs: 2 * 60 * 1000, maxPerDay: 120 },
};

export const SPEAK_PRIORITY = ['ownerOnly', 'mute', 'learn', 'replyOnly', 'economy', 'rate', 'attention', 'sample', 'fishGuard', 'safe'];

const MENTION_RE = /atMention|mention/i;
const TRAIL = '（现状由 attention 在 economy/rate 之后判）';

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(Number(ms || 0) / 60000));
}

/**
 * @param {object} input
 * @param {string} input.key       会话键，group:群号 / private:QQ
 * @param {string} [input.gid]     群号（缺省从 key 里取）
 * @param {string} [input.sender]  发送者 QQ（仅日志展示用）
 * @param {string} [input.text]    消息文本（保留字段，当前不参与判定）
 * @param {number} [input.at]      判定的时间戳，默认 Date.now()
 * @param {string} [input.reason]  唤醒原因（manual/admin/atMention/...）
 * @param {string} [input.mode]    当前 QQ 模式（all/owneronly/privateonly/off）
 * @param {object} input.state     只读状态快照，字段见 docs 或 bridge 里的 speakPolicyState()
 * @param {function} [input.rng]   抽样随机源（0~1），默认 Math.random
 * @returns {{allow:boolean, source:string, reason:string, maxSentences?:number, note?:string}}
 */
export function evaluate(input = {}) {
  const key = String(input.key || '');
  const why = String(input.reason || '');
  const at = Number(input.at || Date.now());
  const mode = String(input.mode || '');
  const st = input.state || {};
  const rng = typeof input.rng === 'function' ? input.rng : Math.random;
  const isGroup = key.startsWith('group:');
  const gid = String(input.gid || (isGroup ? key.slice('group:'.length) : '')).replace(/\D/g, '');
  // manual/admin/学说法任务不占额、不受大多数闸门限制（与各 ext 的通行做法一致）
  const bypass = why === 'manual' || why === 'admin' || why.startsWith('style-learn');

  const block = (source, reason, note) => ({ allow: false, source, reason, ...(note ? { note } : {}) });
  const allow = (source, reason, extra) => ({ allow: true, source, reason, ...(extra || {}) });

  // 1) 只听主人 / 只跟我私聊
  if (isGroup && !bypass) {
    const oo = st.ownerOnly || {};
    const m = mode || oo.mode || '';
    if (m === 'privateonly') return block('ownerOnly', `[只跟我私聊] 跳过群唤醒 ${key}（${why}）`);
    if (m === 'owneronly' && !oo.groupAllowed) return block('ownerOnly', `[只听主人] 跳过群唤醒 ${key}（${why}）：他最近没在这个群说话`);
  }

  // 2) 静音
  if (!bypass && st.muted) return block('mute', `[静音] 跳过唤醒 ${key}（${why}）：面板里设了先不理这个会话`);

  // 3) 学习模式（主人 @ 的例外）
  if (isGroup && !bypass && st.learn && st.learn.on) {
    const ownerOk = MENTION_RE.test(why) && st.learn.ownerSpoke;
    if (!ownerOk) {
      return block('learn', MENTION_RE.test(why)
        ? `[学习模式] 跳过唤醒 ${key}（${why}）：不是主人 @ 的，群里只看不聊`
        : `[学习模式] 跳过唤醒 ${key}（${why}）：这个群现在只看不聊`);
    }
  }

  const att = st.attention || {};
  const min = Number.isFinite(Number(att.minScore)) ? Number(att.minScore) : 2;

  // 4) 只回指定人（目标顺序在这里；现状在 attention 内部、economy/rate 之后）
  if (isGroup) {
    const ro = Array.isArray(att.replyOnly) ? att.replyOnly.map(String) : [];
    if (ro.length && att.uin && !ro.includes(String(att.uin))) {
      return block('replyOnly', `[只回几人] ${att.uin} 不在 ${key} 的名单里`, TRAIL);
    }
  }

  // 5) 省钱
  if (isGroup && !bypass && st.economy && st.economy.on) {
    if (MENTION_RE.test(why)) {
      if (st.economy.replyAt === false) return block('economy', `[省钱] 跳过唤醒 ${key}（${why}）：省钱模式设了完全不发，只等手动`);
    } else {
      return block('economy', `[省钱] 跳过唤醒 ${key}（${why}）：省钱模式只回 @ 和手动指令`);
    }
  }

  // 6) 群发言频率（现状放行时还会 bump 计数；这里只读）
  if (isGroup && !bypass && st.rate) {
    const r = st.rate;
    const lv = LEVELS[r.level] ? r.level : 'normal';
    const cu = r.custom || null;
    const maxPerDay = cu && cu.perDay ? Number(cu.perDay) : LEVELS[lv].maxPerDay;
    const minGapMs = cu && cu.minGapMin ? Number(cu.minGapMin) * 60000 : LEVELS[lv].minGapMs;
    const count = Number(r.count || 0);
    const lastAt = Number(r.lastAt || 0);
    if (count >= maxPerDay) return block('rate', `[频繁度] 跳过唤醒 ${key}（${why}）：今天已 ${count}/${maxPerDay} 次`);
    if (lastAt && at - lastAt < minGapMs) return block('rate', `[频繁度] 跳过唤醒 ${key}（${why}）：还要等 ${minutesLeft(minGapMs - (at - lastAt))} 分钟`);
  }

  // 7) 注意力 / 8) 抽样
  let positive = null;
  if (isGroup) {
    const scored = att.score != null && Number(att.at || 0) > 0 && at - Number(att.at) <= 10 * 60 * 1000;
    if (!scored) {
      positive = allow('attention', `[注意力] 没有最近的分数，不拦（${why}）`);
    } else if (Number(att.score) >= min) {
      positive = allow('attention', `[注意力] 分 ${att.score} ≥ ${min}`, Number(att.score) < min + 2 ? { maxSentences: 1 } : undefined);
    } else {
      const sp = att.sample || {};
      const pct = Number(sp[gid] ?? sp.default ?? 0);
      const cap = Number(sp.maxPerDay ?? 20);
      const hit = pct > 0 && rng() * 100 < pct;
      if (hit) positive = allow('sample', `[抽样] 放行 ${key}（分数 ${att.score} < ${min}，按 ${pct}% 抽样）`, { maxSentences: 1, note: `每日上限 ${cap} 由 attention 内存计数，这里不复核` });
      else return block('attention', `[注意力] 跳过唤醒 ${key}（${why}）：跟她关系不大（分 ${att.score}）`);
    }
  }

  // 9) 鱼群保护
  if (!bypass && st.fish && Number(st.fish.until || 0) > at) {
    return block('fishGuard', `[鱼群保护] 跳过唤醒 ${key}（${why}）：保护冷却中，还有 ${minutesLeft(Number(st.fish.until) - at)} 分钟`);
  }

  // 10) 敏感话题降温
  if (!bypass && st.safe && Number(st.safe.coolUntil || 0) > at) {
    return block('safe', `[安全] 跳过唤醒 ${key}（${why}）：敏感话题降温中，还有 ${minutesLeft(Number(st.safe.coolUntil) - at)} 分钟`);
  }

  return positive || allow('attention', `[注意力] 私聊不参与打分（${why}）`);
}

export default { evaluate, SPEAK_PRIORITY };
