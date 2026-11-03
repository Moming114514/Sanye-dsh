// 欠事捕获：从她自己刚发的话里认出「欠下的事」，自动进 loops（欠事层）
// 从 bridge.js 的 PROMISE_PATCH / PROMISE_PATCH2 迁出（M2 第四步）
import { addLoop } from '../loops-lib.js';

const RE_WHEN = /(明天|后天|下次|回头|等会|一会儿|晚点|过会|周末|这两天|今晚|等下|稍后|待会)/;
const RE_ACT = /(查|找|弄|做|发|看|问|告诉你|给你|帮你|找给|发你|整理|写|画|下)/;
const DONE = /(弄好了|弄完了|查到了|找到了|做好了|发你了|给你了|处理好了|写好了|都搞定了)/;

/** 单句分析（/api/debug/promise 也用它，保持口径一致）。 */
export function analyzePromise(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const when = RE_WHEN.test(s);
  const act = RE_ACT.test(s);
  const selfPromise = /(我|咱)(去|先|这就|回头)?(帮你|给你|替你)/.test(s);
  const selfSubject = /(我|咱|帮你|给你|替你)/.test(s);
  const done = DONE.test(s);
  const will = !done && s.length >= 5 && s.length <= 200 && ((when && act && selfSubject) || selfPromise);
  const sent = will
    ? String(s.split(/[。！？!?\n]/).map((x) => x.trim()).filter(Boolean).find((x) => RE_WHEN.test(x) || /(帮你|给你|替你)/.test(x)) || s).slice(0, 60)
    : '';
  return { text: s, will, when, act, selfPromise, selfSubject, done, captured: sent };
}

/** 从一轮回复里挑出承诺句（引号里的转述、「你是…的人」这类描述不算）。 */
export function detectPromises(messages) {
  const out = [];
  for (const t of Array.isArray(messages) ? messages : []) {
    const stripped = String(t ?? '')
      .replace(/[「『“"]([^」』”"]{0,80})[」』”"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped.length < 5 || stripped.length > 200) continue;
    if (/你是|那个人|你说的|就是那个/.test(stripped)) continue;
    const a = analyzePromise(stripped);
    if (!a.will) continue;
    if (a.captured.length < 5) continue;
    out.push(a.captured);
  }
  return out;
}

export default {
  id: 'promises',
  title: '欠事捕获',

  afterSend({ messages, cfg, log }) {
    if (cfg?.socialV2?.loops?.autoCapture === false) return;
    const say = typeof log === 'function' ? log : () => {}; // AFTERSEND_LOG_FIX：分发器没给 log 时别炸
    for (const text of detectPromises(messages)) {
      const r = addLoop({ text, by: '自己', raw: cfg });
      if (r?.ok) say(`[欠事] 捕获：${text}`);
    }
  },
};

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'promises',
  title: '欠事捕获',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 110,
  hooks: ['afterSend'],
  config: ['socialV2.loops'],
  stateFiles: [],
};
