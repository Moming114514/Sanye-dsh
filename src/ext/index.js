// src/ext/index.js —— 扩展装配点（M2）
//
// bridge.js 只保留接线，功能都住在这个目录里。可用钩子：
//   1) 路由     extDispatchRoute(pathname, ctx)      扩展自己的接口
//   2) 提示词   extPromptBlocks(cfg)                 注入段落，顺序 = 注册顺序
//   3) 唤醒闸门 extWakeGate(ctx)                     返回 false 则本次不唤醒（省钱）
//   4) 发送后   extAfterSend(ctx)                    回复发出后回调
//   5) 群消息   extOnGroupMessage(ctx)               群消息入口
//   6) 私聊消息 extOnPrivateMessage(ctx)             私聊指令入口（返回 true 表示已处理）
//   另有 extStateKey()：扩展读了文件就必须实现 stateKey()，否则提示词缓存会读到旧内容。
// 新增功能见同目录 README.md。
import techNotes from './tech-notes.js';
import impressions from './impressions.js';
import ownerOnly from './owner-only.js';
import promises from './promises.js';
import style from './style.js';
import loops from './loops.js';
import stickers from './stickers.js';
import mute from './mute.js'; // 静音名单
import learnmode from './learnmode.js'; // 学习模式（只看不聊）
import groupRate from './group-rate.js'; // 群发言频率
import attention from './attention.js'; // 一级注意力判定（零成本）
import safeTalk from './safe-talk.js'; // 敏感话题守门
import economy from './economy.js'; // 省钱模式（少说话，可按群）
import ownerTeach from './owner-teach.js'; // 主人教的说法（OWNERTEACH_PATCH）
import createAdviceCapture from './advice-capture.js'; // 建议收集（ADVICE_PATCH）
import createPeople from './people.js'; // 人群档案（PEOPLE_PATCH）
import createUtterances from './utterances.js'; // 她说的话（UTTER_PATCH）

// 注册顺序 = 提示词注入顺序（印象在前、技术笔记在后，与原内联顺序一致）
const advice = createAdviceCapture({ log: (m) => console.log('[ext:advice] ' + m) });
const people = createPeople();
const utterances = createUtterances();
const EXTENSIONS = [ownerOnly, mute, learnmode, economy, groupRate, attention, advice, people, utterances, safeTalk, promises, impressions, ownerTeach, techNotes, style, loops, stickers].filter(Boolean);

export function extList() {
  return EXTENSIONS;
}

/** 路由分发：命中已注册扩展路由时返回 true（该扩展已自行响应）。 */
export function extDispatchRoute(pathname, ctx) {
  for (const ext of EXTENSIONS) {
    for (const route of ext.routes || []) {
      if (route.path !== pathname) continue;
      try {
        route.handle(ctx);
      } catch (error) {
        ctx.log(`[ext:${ext.id}] 处理 ${pathname} 失败：${String(error?.message || error).slice(0, 160)}`);
        ctx.sendJson({ ok: false, error: String(error?.message || error) }, 500);
      }
      return true;
    }
  }
  return false;
}

/** 提示词块：按注册顺序拼接，空块自动跳过（顺序即注入顺序）。 */
export function extPromptBlocks(cfg) {
  const out = [];
  for (const ext of EXTENSIONS) {
    if (typeof ext.promptBlock !== 'function') continue;
    try {
      const text = ext.promptBlock(cfg);
      if (text) out.push(text);
    } catch (error) {
      console.error(`[ext:${ext.id}] 生成提示词块失败：${String(error?.message || error)}`);
    }
  }
  return out;
}

/** 状态键：任一扩展的状态文件变化都让提示词缓存失效。 */
export function extStateKey() {
  const parts = [];
  for (const ext of EXTENSIONS) {
    if (typeof ext.stateKey !== 'function') continue;
    try { parts.push(String(ext.stateKey() ?? '')); } catch { parts.push(''); }
  }
  return parts.join(',');
}

/** 群消息入口：谁在说话（只听主人/学说法都要用）。 */
export function extOnGroupMessage(ctx) {
  for (const ext of EXTENSIONS) {
    if (typeof ext.onGroupMessage !== 'function') continue;
    try { ext.onGroupMessage(ctx); } catch (error) {
      console.error(`[ext:${ext.id}] onGroupMessage 失败：${String(error?.message || error)}`);
    }
  }
}

/** 私聊消息入口：主人在私聊里下的「去做某件事」的指令（如学说法手动触发）。 */
export function extOnPrivateMessage(ctx) {
  for (const ext of EXTENSIONS) {
    if (typeof ext.onPrivateMessage !== 'function') continue;
    try {
      if (ext.onPrivateMessage(ctx) === true) return true;
    } catch (error) {
      console.error(`[ext:${ext.id}] onPrivateMessage 失败：${String(error?.message || error)}`);
    }
  }
  return false;
}

/** 唤醒闸门：任一扩展返回 { allow:false } 即拦下（不给模型烧 token）。 */
export function extWakeGate(ctx) {
  for (const ext of EXTENSIONS) {
    if (typeof ext.wakeGate !== 'function') continue;
    try {
      const r = ext.wakeGate(ctx);
      if (r && r.allow === false) return r;
    } catch (error) {
      console.error(`[ext:${ext.id}] wakeGate 失败：${String(error?.message || error)}`);
    }
  }
  return { allow: true };
}

/** 发送成功后：欠事捕获、学说法观察等。 */
export function extAfterSend(ctx) {
  for (const ext of EXTENSIONS) {
    if (typeof ext.afterSend !== 'function') continue;
    try { ext.afterSend(ctx); } catch (error) {
      console.error(`[ext:${ext.id}] afterSend 失败：${String(error?.message || error)}`);
    }
  }
}
