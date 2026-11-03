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
// 新增功能见同目录 README.md；manifest 契约见 docs/EXT-MANIFEST.md。
//
// 顺序：每个模块用命名导出 manifest.order（EXTENSIONS 下标×10+10）声明自己的位置。
// 缺 manifest 不炸：回退到本文件的注册顺序，并在启动时打一行汇总告警。
import * as modTechNotes from './tech-notes.js';
import * as modImpressions from './impressions.js';
import * as modOwnerOnly from './owner-only.js';
import * as modPromises from './promises.js';
import * as modStyle from './style.js';
import * as modLoops from './loops.js';
import * as modStickers from './stickers.js';
import * as modMute from './mute.js'; // 静音名单
import * as modLearnmode from './learnmode.js'; // 学习模式（只看不聊）
import * as modGroupRate from './group-rate.js'; // 群发言频率
import * as modAttention from './attention.js'; // 一级注意力判定（零成本）
import * as modSafeTalk from './safe-talk.js'; // 敏感话题守门
import * as modEconomy from './economy.js'; // 省钱模式（少说话，可按群）
import * as modOwnerTeach from './owner-teach.js'; // 主人教的说法（OWNERTEACH_PATCH）
import * as modAdviceCapture from './advice-capture.js'; // 建议收集（ADVICE_PATCH）
import * as modPeople from './people.js'; // 人群档案（PEOPLE_PATCH）
import * as modUtterances from './utterances.js'; // 她说的话（UTTER_PATCH）

// 注册顺序 = 没有 manifest 时的兜底顺序（与迁移前一致，保证行为不变）
const MODULES = [
  { name: 'owner-only', mod: modOwnerOnly },
  { name: 'mute', mod: modMute },
  { name: 'learnmode', mod: modLearnmode },
  { name: 'economy', mod: modEconomy },
  { name: 'group-rate', mod: modGroupRate },
  // attention 的默认导出是工厂（createAttention），必须显式实例化：
  // 迁移前的 index.js 直接把工厂函数放进 EXTENSIONS，导致它的三个钩子从未执行过。
  { name: 'attention', mod: modAttention, factory: (create) => create({ log: (m) => console.log('[ext:attention] ' + m) }) },
  { name: 'advice-capture', mod: modAdviceCapture, factory: (create) => create({ log: (m) => console.log('[ext:advice] ' + m) }) },
  { name: 'people', mod: modPeople, factory: (create) => create() },
  { name: 'utterances', mod: modUtterances, factory: (create) => create() },
  { name: 'safe-talk', mod: modSafeTalk },
  { name: 'promises', mod: modPromises },
  { name: 'impressions', mod: modImpressions },
  { name: 'owner-teach', mod: modOwnerTeach },
  { name: 'tech-notes', mod: modTechNotes },
  { name: 'style', mod: modStyle },
  { name: 'loops', mod: modLoops },
  { name: 'stickers', mod: modStickers },
];

function instanceOf(entry) {
  const d = entry.mod.default ?? entry.mod;
  if (!entry.factory) return d;
  if (typeof d !== 'function') {
    console.error(`[ext:loader] ${entry.name} 应该是工厂函数，实际是 ${typeof d}`);
    return null;
  }
  try {
    return entry.factory(d);
  } catch (error) {
    console.error(`[ext:loader] 创建 ${entry.name} 失败：${String(error?.message || error)}`);
    return null;
  }
}

// 装配：按 manifest.order 排序 + 校验；只告警不抛（契约要求扩展失败必须吞）
function assemble() {
  const problems = [];
  const missing = [];
  const rows = [];
  MODULES.forEach((entry, i) => {
    const ext = instanceOf(entry);
    const fallback = (i + 1) * 10;
    if (!ext) { problems.push(`${entry.name}: 实例为空，已跳过`); return; }
    const man = entry.mod.manifest ?? ext.manifest ?? null;
    let order = fallback;
    if (!man) missing.push(ext.id || entry.name);
    else if (!Number.isInteger(man.order) || man.order <= 0) problems.push(`${entry.name}: manifest.order 非法（${man.order}），回退到 ${fallback}`);
    else order = man.order;
    rows.push({ name: entry.name, ext, order, manifest: man });
  });
  const seen = new Map();
  for (const r of rows) {
    const who = r.ext.id || r.name;
    if (seen.has(r.order)) problems.push(`order 重复：${r.order} 被 ${seen.get(r.order)} 和 ${who} 同时使用`);
    else seen.set(r.order, who);
  }
  rows.sort((a, b) => a.order - b.order);
  return { rows, problems, missing, total: MODULES.length };
}

const ASSEMBLED = assemble();
if (ASSEMBLED.missing.length) {
  console.warn(`[ext:loader] ${ASSEMBLED.missing.length}/${ASSEMBLED.total} 个扩展还没有 manifest，按注册顺序回退：${ASSEMBLED.missing.slice(0, 6).join(', ')}${ASSEMBLED.missing.length > 6 ? ' …' : ''}`);
}
for (const p of ASSEMBLED.problems) console.error('[ext:loader] ' + p);

const EXTENSIONS = ASSEMBLED.rows.map((r) => r.ext);

/** 清单：给 /api/plugins 与 dump-manifests 用（id/order 是代码侧事实，不代替 features.json 的开关语义）。 */
export function extManifests() {
  return ASSEMBLED.rows.map((r) => ({ id: r.ext.id || r.name, file: r.name + '.js', order: r.order, hasManifest: !!r.manifest }));
}

export function extList() {
  return EXTENSIONS;
}

// ── 钩子隔离（T1，2026-11-03）────────────────────────────────────────────
// 目标：任一扩展在任一钩子里抛错，都只记一条日志，主流程继续，返回值按契约兜底。
//   promptBlock → ''（不注入）；wakeGate → { allow: true }（宁可放行也别误拦）；
//   其余钩子 → undefined / false。
// 同一 扩展+钩子 5 分钟内只记一条（防刷屏），但每次失败都计入 extStats.errors。
const HOOK_LOG_GAP_MS = 5 * 60 * 1000;
export const extStats = { errors: 0, reported: 0, suppressed: 0 };
const _hookLogAt = new Map();

function hookTag(ext, fallbackName) {
  return `ext:${(ext && ext.id) || fallbackName || 'unknown'}`;
}

function reportHookError(ext, fallbackName, hook, error) {
  extStats.errors += 1;
  const key = `${hookTag(ext, fallbackName)}|${hook}`;
  const now = Date.now();
  if (now - (_hookLogAt.get(key) || 0) < HOOK_LOG_GAP_MS) {
    extStats.suppressed += 1;
    return;
  }
  _hookLogAt.set(key, now);
  extStats.reported += 1;
  try {
    console.error(`[${hookTag(ext, fallbackName)}] ${hook} 失败：${String(error?.message || error)}`);
  } catch {}
}

function guardHook(ext, fallbackName, hook, fn, fallback) {
  try {
    return fn();
  } catch (error) {
    reportHookError(ext, fallbackName, hook, error);
    return fallback;
  }
}

/** 路由分发：命中已注册扩展路由时返回 true（该扩展已自行响应）。 */
export function extDispatchRoute(pathname, ctx) {
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    for (const route of ext.routes || []) {
      if (route.path !== pathname) continue;
      guardHook(ext, row.name, 'route', () => route.handle(ctx), undefined);
      return true;
    }
  }
  return false;
}

/** 提示词块：按 order 拼接，空块自动跳过（顺序即注入顺序）。 */
export function extPromptBlocks(cfg) {
  const out = [];
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    if (typeof ext.promptBlock !== 'function') continue;
    const text = guardHook(ext, row.name, 'promptBlock', () => ext.promptBlock(cfg), '');
    if (text) out.push(text);
  }
  return out;
}

/** 状态键：任一扩展的状态文件变化都让提示词缓存失效。 */
export function extStateKey() {
  const parts = [];
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    if (typeof ext.stateKey !== 'function') continue;
    parts.push(guardHook(ext, row.name, 'stateKey', () => String(ext.stateKey() ?? ''), ''));
  }
  return parts.join(',');
}

/** 群消息入口：谁在说话（只听主人/学说法都要用）。 */
export function extOnGroupMessage(ctx) {
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    if (typeof ext.onGroupMessage !== 'function') continue;
    guardHook(ext, row.name, 'onGroupMessage', () => ext.onGroupMessage(ctx), undefined);
  }
}

/** 私聊消息入口：主人在私聊里下的「去做某件事」的指令（如学说法手动触发）。 */
export function extOnPrivateMessage(ctx) {
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    if (typeof ext.onPrivateMessage !== 'function') continue;
    const handled = guardHook(ext, row.name, 'onPrivateMessage', () => ext.onPrivateMessage(ctx) === true, false);
    if (handled) return true;
  }
  return false;
}

/** 唤醒闸门：任一扩展返回 { allow:false } 即拦下（不给模型烧 token）。 */
export function extWakeGate(ctx) {
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    if (typeof ext.wakeGate !== 'function') continue;
    const r = guardHook(ext, row.name, 'wakeGate', () => ext.wakeGate(ctx), { allow: true });
    if (r && r.allow === false) return r;
  }
  return { allow: true };
}

/** 发送成功后：欠事捕获、学说法观察等。 */
export function extAfterSend(ctx) {
  for (const row of ASSEMBLED.rows) {
    const ext = row.ext;
    if (typeof ext.afterSend !== 'function') continue;
    guardHook(ext, row.name, 'afterSend', () => ext.afterSend(ctx), undefined);
  }
}
