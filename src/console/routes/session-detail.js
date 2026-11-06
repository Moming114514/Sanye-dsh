// src/console/routes/session-detail.js —— R9-4：7 条只读详情路由
// 迁移来源：src/bridge.js 内联分支（socialV2/active-members、memory、state、snapshot、
// bili/prompt-preview、presets、preset/sim-prompt/backups）。响应体逐字照搬。
// 规则：只用 ctx.json 写当前请求；deps 只放进程级对象/纯函数（router 缓存复用）。
export function registerSessionDetail(router, deps) {
  const REQUIRED = [
    'getCfg', 'getSocialV2', 'formatMemoryV2', 'computeWakeSafetyV2',
    'assessClosureV2', 'closureStatus', 'buildContextSnapshot',
    'biliMemory', 'currentRoleHint', 'api', 'unwrap',
    'knownPresetName', 'presetNames', 'listPresetBackups',
    'agentTokenOk', 'v2SessionAllowed', 'v2ToolEnabled',
  ];
  const missing = REQUIRED.filter((k) => deps == null || deps[k] == null);
  if (missing.length) throw new Error('session-detail 依赖缺失：' + missing.join(', '));

  const {
    getCfg, getSocialV2, formatMemoryV2, computeWakeSafetyV2,
    assessClosureV2, closureStatus, buildContextSnapshot,
    biliMemory, currentRoleHint, api, unwrap,
    knownPresetName, presetNames, listPresetBackups,
    agentTokenOk, v2SessionAllowed, v2ToolEnabled,
  } = deps;

  // 与原内联分支一致：只有带了 x-agent-token 才做这三道校验
  const agentGate = (req, key, tool, label) => {
    const tok = req.headers['x-agent-token'];
    if (tok && !agentTokenOk(key, tok)) return { code: 403, body: { ok: false, error: 'agent token 无效' } };
    if (tok && !v2SessionAllowed(key)) return { code: 403, body: { ok: false, error: '目标不在当前模式允许范围内' } };
    if (tok && !v2ToolEnabled(tool)) return { code: 403, body: { ok: false, error: '工具未启用：' + label } };
    return null;
  };
  const gateOrReject = (ctx, gate) => {
    if (!gate) return false;
    ctx.json(gate.code, gate.body);
    return true;
  };

  router.register('/api/socialV2/active-members', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const limit = Math.min(20, Math.max(1, Number(ctx.query.get('limit')) || 10));
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (gateOrReject(ctx, agentGate(req, key, 'getActiveMembers', 'qq_get_active_members'))) return;
    const st = getSocialV2(key) ?? {};
    const rows = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const map = new Map();
    for (const m of rows) {
      if (!m || m.isSelf) continue;
      const uid = m.userId ? String(m.userId) : '';
      const key2 = uid || String(m.sender || '未知');
      const cur = map.get(key2) || { sender: m.sender || key2, userId: uid || undefined, count: 0, lastTime: 0, isOwner: !!m.isOwner };
      if (!cur.userId && uid) cur.userId = uid;
      cur.count += 1;
      if (m.time > cur.lastTime) cur.lastTime = m.time;
      if (m.isOwner) cur.isOwner = true;
      map.set(key2, cur);
    }
    const members = [...map.values()].sort((a, b) => b.count - a.count || b.lastTime - a.lastTime).slice(0, limit);
    ctx.json(200, { ok: true, key, members });
  });

  router.register('/api/socialV2/memory', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const category = String(ctx.query.get('category') ?? '').trim();
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (gateOrReject(ctx, agentGate(req, key, 'memory', 'qq_memory_query'))) return;
    const st = getSocialV2(key) ?? {};
    const raw = {
      activeTopics: Array.isArray(st.activeTopics) ? st.activeTopics.slice(-20) : [],
      pendingThoughts: Array.isArray(st.pendingThoughts) ? st.pendingThoughts.filter((t) => !t.expiresAt || Date.now() < t.expiresAt).slice(-20) : [],
      memberImpressions: st.memberImpressions && typeof st.memberImpressions === 'object' ? st.memberImpressions : {},
    };
    if (category === 'activeTopic') {
      raw.pendingThoughts = [];
      raw.memberImpressions = {};
    } else if (category === 'pendingThought') {
      raw.activeTopics = [];
      raw.memberImpressions = {};
    } else if (category === 'memberImpression') {
      raw.activeTopics = [];
      raw.pendingThoughts = [];
    }
    ctx.json(200, { ok: true, key, category, formatted: formatMemoryV2({ ...st, ...raw }), raw });
  });

  router.register('/api/socialV2/state', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (gateOrReject(ctx, agentGate(req, key, 'socialState', 'qq_social_state'))) return;
    const st = getSocialV2(key) ?? {};
    const unread = Array.isArray(st.unread) ? st.unread : [];
    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    ctx.json(200, {
      ok: true,
      key,
      wakeConfig: st.wakeConfig,
      wakeSafety: computeWakeSafetyV2(st.wakeConfig ?? {}),
      unreadCount: unread.length,
      recentCount: recent.length,
      lastWakeReason: st.lastWakeReason,
      lastAiReplyAt: st.lastAiReplyAt,
      closure: closureStatus(st.closure, Date.now()),
      closureAssessment: (() => {
        const a = assessClosureV2(key, st);
        return { verdict: a.verdict, score: a.score, reasons: a.reasons };
      })(),
    });
  });

  router.register('/api/socialV2/snapshot', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (gateOrReject(ctx, agentGate(req, key, 'getSnapshot', 'qq_get_context_snapshot'))) return;
    const include = String(ctx.query.get('include') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const st = getSocialV2(key) ?? {};
    const cfg = getCfg();
    const configured = cfg.socialV2?.snapshot ?? {};
    const caps = {
      unread: ctx.query.get('unreadLimit') ?? configured.unread,
      recent: ctx.query.get('recentLimit') ?? configured.recent,
      activeMembers: ctx.query.get('activeLimit') ?? configured.activeMembers,
      textChars: ctx.query.get('textChars') ?? configured.textChars,
    };
    const snapshot = buildContextSnapshot({
      key,
      st,
      include,
      caps,
      afterSeq: Number(ctx.query.get('afterSeq') ?? 0) || 0,
    });
    ctx.json(200, snapshot);
  });

  router.register('/api/bili/prompt-preview', ['GET'], async (req, res, ctx) => {
    const text = String(ctx.query.get('text') ?? '').slice(0, 500);
    const roleHint = currentRoleHint();
    ctx.json(200, {
      ok: true,
      text,
      briefChars: (biliMemory.briefBlock() ?? '').length,
      recall: biliMemory.recallBlock(text),
      roleHint,
    });
  });

  router.register('/api/presets', ['GET'], async (req, res, ctx) => {
    let presets = [];
    try {
      const { presets: list } = unwrap(await api.agentPresets.list({}), 'agentPreset.list');
      presets = list.map((p) => ({ id: p.id, trust: p.trust ?? 'system' }));
    } catch {}
    ctx.json(200, { presets });
  });

  router.register('/api/preset/sim-prompt/backups', ['GET'], async (req, res, ctx) => {
    const preset = knownPresetName(ctx.query.get('preset'));
    if (!preset) { ctx.json(400, { ok: false, error: `未知预设（只支持 ${Object.values(presetNames).join(' / ')}）` }); return; }
    try {
      ctx.json(200, { ok: true, backups: listPresetBackups(preset) });
    } catch (error) {
      ctx.json(500, { ok: false, error: error?.message ?? '读取备份失败' });
    }
  });
}
