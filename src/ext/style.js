// 学说法：只学目标的人怎么说话（框架），进提示词当参考
// 从 bridge.js 的 STYLE_INJECT_PATCH / STYLE_GATE_PATCH / STYLE_STRICT_PATCH 迁出（M2 第四步）
import { readStyleSamples, styleStats } from '../style-lib.js';
import { appendStyleSample, styleSamplesBlock, styleObserve, styleCandidates, styleSetStatus } from '../style-lib.js';

export function styleCfg(cfg) {
  const c = cfg?.socialV2?.styleLearn ?? {};
  return {
    enabled: c.enabled !== false,
    targetQQ: String(c.targetQQ || ''),
    strictTarget: c.strictTarget !== false,
    injectMaxChars: Math.max(0, Number(c.injectMaxChars ?? 520) || 520),
    injectMaxItems: Math.max(1, Number(c.injectMaxItems) || 6),
    groups: Array.isArray(c.groups) && c.groups.length ? c.groups.map((g) => String(g).replace(/\D/g, '')) : ['1000000001'],
    perRound: Math.max(1, Number(c.perRound) || 2),
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

  // 私聊入口：主人说「学亚托莉 / 看看她刚说的 / 去群里学说话」→ 直接派一次手动学习任务
  onPrivateMessage({ id, text, cfg, log, deliverPrompt }) {
    const c = styleCfg(cfg);
    if (!c.enabled || !c.groups.length) return false;
    const plain = String(text || '').replace(/\s+/g, '');
    if (!plain || plain.length > 20) return false;
    if (!/学(一下)?(亚托莉|她)|看(看|一下)(亚托莉|她)|去群里学|学说法|学她说话/.test(plain)) return false;
    const gid = c.groups[0];
    if (!gid) return false;
    const task = '【学说法·手动】去烤研群（群 ' + gid + '）看看：调 qq_read_group_recent，参数 count=60、uin=' + String(cfg.socialV2?.styleLearn?.targetQQ || '') + ' —— **只把她一个人的消息拉回来**，别人的不用看（只用这一个工具，别用 qq_get_recent / qq_get_unread / qq_get_prompt，跨群一定报凭证错误）。'
      + '**只学 QQ ' + c.targetQQ + '（群昵称以「亚托莉」开头）这一个人的说话方式**，群里其他人的话只当上下文，不许学。按 QQ 号认人最准；找不到她就只记通用框架，别硬认人。'
      + '只提炼「说话框架」：怎么起句、怎么接话、怎么求人、怎么拒绝、怎么吐槽但不伤人；不要抄口头禅和梗，也别整段模仿。'
      + '记 ' + c.perRound + ' 条就够，每条都要写框架层面的「好在哪」（例：先用一句软话把事说清，再给结论）。脏话、攻击、阴阳怪气、贬低别人一律不学。'
      + '记完不改人格卡、不在群里发言、不私聊汇报（黑箱模式），记完就结束这一轮。';
    try {
      deliverPrompt('private:' + id, task, { reason: 'style-learn-manual-chat' });
      log('[学样] 主人私聊触发：' + gid);
      return true;
    } catch (error) {
      log('[学样] 手动触发失败：' + String(error?.message || error));
      return false;
    }
  },

  routes: [
    {
      path: '/api/socialV2/style-list',
      method: 'GET',
      handle({ sendJson }) {
        return sendJson({ ok: true, samples: readStyleSamples(30), stats: styleStats(), ...styleCandidates() });
      },
    },
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
