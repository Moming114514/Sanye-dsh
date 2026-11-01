// 学说法：只学目标的人怎么说话（框架），进提示词当参考
// 从 bridge.js 的 STYLE_INJECT_PATCH / STYLE_GATE_PATCH / STYLE_STRICT_PATCH 迁出（M2 第四步）
import { appendStyleSample, styleSamplesBlock, styleObserve, styleCandidates, styleSetStatus } from '../style-lib.js';

export function styleCfg(cfg) {
  const c = cfg?.socialV2?.styleLearn ?? {};
  return {
    enabled: c.enabled !== false,
    targetQQ: String(c.targetQQ || '2000000000'),
    strictTarget: c.strictTarget !== false,
    injectMaxChars: Math.max(0, Number(c.injectMaxChars ?? 520) || 520),
    injectMaxItems: Math.max(1, Number(c.injectMaxItems) || 6),
  };
}

export default {
  id: 'style',
  title: '学说法',

  // 提示词块：学到的说法（只取正式样本）
  promptBlock(cfg) {
    const c = styleCfg(cfg);
    if (!c.enabled || !c.injectMaxChars) return '';
    const block = styleSamplesBlock(c.injectMaxChars, c.injectMaxItems);
    if (!block) return '';
    return ['【说话方式（从别人那儿学来的框架；是参考，不是台词：别整段照搬原话，更别学成对方的口气）】', block].join('\n');
  },

  // 群消息入口：观察谁在复用候选句式
  onGroupMessage({ key, uin, text, cfg }) {
    if (!String(key || '').startsWith('group:')) return;
    if (!uin || !text) return;
    styleObserve(key, uin, text, cfg);
  },

  routes: [
    {
      path: '/api/socialV2/style-candidate',
      handle({ body, log, sendJson }) {
        const act = String(body?.action || 'list');
        if (act === 'set') {
          const r = styleSetStatus(String(body?.id || ''), String(body?.status || ''));
          log('[学样] 人工' + (r.ok ? `：${body?.status} ${String(body?.id).slice(0, 12)}` : '失败：' + r.error));
          return sendJson(r, r.ok ? 200 : 400);
        }
        return sendJson({ ok: true, ...styleCandidates() });
      },
    },
    {
      path: '/api/socialV2/style-note',
      handle({ body, cfg, log, sendJson }) {
        if (cfg?.socialV2?.tools?.styleNote === false) return sendJson({ ok: false, error: 'styleNote 已关闭' }, 403);
        const c = styleCfg(cfg);
        // 只学目标的人，别把路人/自己记进来
        if (c.strictTarget && c.targetQQ) {
          const okUin = String(body?.uin || '') === c.targetQQ;
          const okName = /亚托莉/.test(String(body?.from || ''));
          if (!okUin && !okName) {
            log('[学样] 拒收：' + String(body?.from || '空') + '（不是目标 ' + c.targetQQ + '）');
            return sendJson({ ok: false, error: '只学 QQ ' + c.targetQQ + '（亚托莉）的说法，别人的不记' }, 400);
          }
        }
        const r = appendStyleSample(body || {});
        log('[学样] ' + (r.ok ? `记了一条（共 ${r.total}）` : '失败：' + r.error));
        return sendJson(r.ok ? { ok: true, total: r.total, duplicated: !!r.duplicated } : { ok: false, error: r.error }, r.ok ? 200 : 400);
      },
    },
  ],
};
