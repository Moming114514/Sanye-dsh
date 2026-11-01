// src/ext/index.js
// EXT_PATCH（M2）：扩展装配点。bridge.js 只保留 4 个钩子——
//   1) 装配（import 本文件）2) 路由分发 extDispatchRoute 3) 提示词块 extPromptBlocks 4) 状态键 extStateKey
// 唤醒闸门与发送后回调的钩子随后续迁移接入。新增功能 = ext/ 下新建模块 + EXTENSIONS 加一行。
import techNotes from './tech-notes.js';
import impressions from './impressions.js';
import ownerOnly from './owner-only.js';
import promises from './promises.js';

// 注册顺序 = 提示词注入顺序（印象在前、技术笔记在后，与原内联顺序一致）
const EXTENSIONS = [ownerOnly, promises, impressions, techNotes].filter(Boolean);

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
