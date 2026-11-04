// 注意力判定（一级，纯本地零成本）：群消息在叫醒她接话之前先算一个分，
// 明显跟她无关的直接不唤醒。被 @、手动指挥、管理员指令、学说法任务不参与评分。
// 打分只在内存里记一份「最近一条消息的分」，wakeGate 时读它。
export default function createAttention({ log }) {
  let active = null; // 3TIER：最近一次被放行的会话（供提示词用）
  const last = new Map(); // key -> { score, hits, at, text }
  const recent = new Map(); // key -> [text...] 最近几条，用于查重复
  const sampleCount = new Map(); // SAMPLE_PATCH：每次抽样的每日计数

  function norm(s) {
    return String(s || '')
      .replace(/\[图片\]|\[表情(:[^\]]*)?\]|\[表情包\]|\[动图\]|\[语音\]|\[视频\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function score(text, cfg) {
    const raw = String(text || '');
    const t = norm(raw);
    const hits = [];
    let s = 0;
    const add = (n, why) => { s += n; hits.push((n > 0 ? '+' : '') + n + ':' + why); };

    if (/三叶|三葉/.test(t)) add(4, '叫她的名字');
    if (/[?？]|吗|呢|怎么|为什么|有没有|是不是|能不能|会不会/.test(t)) add(2, '像在问');
    if (/在吗|在么|帮我看|看下|你说|求|问下|谁知道|有没有人|来解释/.test(t)) add(2, '像在找人帮忙');
    if (t.length >= 8) add(1, '有点内容');
    if (t.length <= 3 && !/[?？吗呢]/.test(t)) add(-2, '太短没头没尾');
    if (/^@/.test(raw.trim()) && !/三叶|三葉/.test(t)) add(-3, '@的是别人');
    if (!t) add(-2, '只有图/表情');

    const kept = recent.get(hits.key || '') || null; // 占位，真正的重复检测在 record()
    return { s, hits, text: t };
  }

  function record(key, text) {
    const arr = recent.get(key) || [];
    const t = norm(text);
    const dup = t && arr.includes(t);
    arr.push(t);
    while (arr.length > 6) arr.shift();
    recent.set(key, arr);
    return dup;
  }

  return {
    id: 'attention',
    title: '该不该接话',
    // 每条群消息算一次分
    onGroupMessage({ key, text, uin, cfg }) {
      try {
        const c = cfg?.socialV2?.attention ?? {};
        if (c.enabled === false) return;
        const r = score(text, cfg);
        if (record(key, text)) { r.s -= 3; r.hits.push('-3:重复消息'); }
        last.set(key, { score: r.s, hits: r.hits, at: Date.now(), text: r.text.slice(0, 60), uin: String(uin || '') });
      } catch {}
    },
    wakeGate({ key, reason, cfg }) {
      try {
        const c = cfg?.socialV2?.attention ?? {};
        if (c.enabled === false) return true;
        const k = String(key || '');
        if (!k.startsWith('group:')) return true;
        const why = String(reason || '');
        if (why === 'manual' || why === 'admin' || /style-learn/.test(why)) return true;
        const st = last.get(k);
        // REPLYONLY_PATCH（STALE_REPLY_FIX）：名单检查必须在"分数过期"之前，
        // 否则冷场 10 分钟后名单外的人 @ 她也会被接话。
        const ro = (c.replyOnly || {})[k.replace('group:', '')];
        if (Array.isArray(ro) && ro.length && st && st.uin) {
          const allowed = ro.map(String);
          if (!allowed.includes(String(st.uin))) {
            if (c.log !== false) log(`[只回几人] 跳过唤醒 ${k}（${why}）：${st.uin} 不在名单`);
            return { allow: false, reason: `[只回几人] ${st.uin} 不在 ${k} 的名单里` };
          }
        }
        if (!st || Date.now() - st.at > 10 * 60 * 1000) return true; // 没分数或太旧，不拦
        const min = Number.isFinite(Number(c.minScore)) ? Number(c.minScore) : 2;
        if (st.score >= min) { active = { key: k, score: st.score, min, at: Date.now() }; return true; }
        // SAMPLE_PATCH：分数不够时按概率抽样放行（热闹群里「时不时说一句」），有每日上限
        const sp = c.sample || {};
        const gid = k.replace('group:', '');
        const pct = Number(sp[gid] ?? sp.default ?? 0);
        if (pct > 0) {
          const day = new Date().toISOString().slice(0, 10);
          const ck = k + '|' + day;
          const used = sampleCount.get(ck) || 0;
          const cap = Number(sp.maxPerDay ?? 20);
          if (used < cap && Math.random() * 100 < pct) {
            sampleCount.set(ck, used + 1);
            active = { key: k, score: min, min, at: Date.now() };
            log(`[抽样] 放行 ${k}（分数 ${st.score} < ${min}，今天第 ${used + 1} 次）`);
            return true;
          }
        }
        if (c.log !== false) log(`[注意力] 跳过唤醒 ${k}（${why}）：分 ${st.score} < ${min}（${st.hits.join(' ')}）`);
        return { allow: false, reason: `[注意力] 跳过唤醒 ${k}（${why}）：跟她关系不大（分 ${st.score}）` };
      } catch {
        return true;
      }
    },
    // 3TIER：分数刚过线（min ~ min+1）时，只允许一句短回，避免冷场又避免长篇
    // 只读：最近一次打分的快照（speak-policy 旁路观测用，不改变判断）
    getLast(key) {
      const v = last.get(String(key || ''));
      return v ? { score: v.score, uin: v.uin, at: v.at } : null;
    },
    promptBlock(cfg) {
      try {
        const c = cfg?.socialV2?.attention ?? {};
        if (c.enabled === false || !active) return null;
        if (Date.now() - active.at > 3 * 60 * 1000) return null;
        const min = active.min || 2;
        if (active.score < min + 2) {
          return '【这条只值一句】只回一句话（15 字以内），别提问、别举例、别展开；想不出说什么就不说。';
        }
        return null;
      } catch { return null; }
    },
    routes: [
      {
        path: '/api/socialV2/attention',
        handle({ body, sendJson }) {
          const act = String(body?.action || 'show');
          if (act === 'recent') {
            const out = {};
            for (const [k, v] of last.entries()) out[k] = v;
            return sendJson({ ok: true, recent: out });
          }
          return sendJson({ ok: true, hint: 'action=recent 看最近每条群消息的分' });
        },
      },
    ],
  };
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'attention',
  layer: '判断',
  title: '该不该接话',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 60,
  hooks: ['promptBlock', 'wakeGate', 'routes', 'onGroupMessage'],
  config: ['socialV2.attention'],
  stateFiles: [],
};
