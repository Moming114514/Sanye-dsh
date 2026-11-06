// src/console/routes/social-read.js —— R9-3：7 条纯读控制台路由
// 迁移来源：src/bridge.js 内联分支（tool-log / owner-audit / bili/status /
// sessions / pending / socialV2/states / plugins）。响应体逐字照搬，未改字段顺序。
// 响应统一用 ctx.json()（与 bridge 的 sendJson 逐字等价）；deps 里只放「按进程创建」的
// 稳定依赖，绝不能放按请求创建的闭包（router 是缓存复用的）。
export function registerSocialRead(router, deps) {
  // 注册期校验：缺依赖直接启动即失败，不要等到运行时 500。
  const REQUIRED = [
    'getCfg', 'readToolLog', 'ownerAudit', 'biliMemory',
    'getBiliDynamics', 'getBiliShare', 'getSessionsMap', 'getPending',
    'getSocialV2', 'buildPlugins', 'isLiveAgentToken',
  ];
  const missing = REQUIRED.filter((k) => deps == null || deps[k] == null);
  if (missing.length) throw new Error('social-read 依赖缺失：' + missing.join(', '));

  const {
    getCfg,
    readToolLog,
    ownerAudit,
    biliMemory,
    getBiliDynamics,
    getBiliShare,
    getSessionsMap,
    getPending,
    getSocialV2,
    buildPlugins,
    isLiveAgentToken,
  } = deps;

  router.register('/api/socialV2/tool-log', ['GET'], async (req, res, ctx) => {
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 200));
    ctx.json(200, { ok: true, entries: readToolLog(limit) });
  });

  router.register('/api/owner-audit', ['GET'], async (req, res, ctx) => {
    const limit = Math.max(1, Math.min(200, Number(ctx.query.get('limit')) || 50));
    ctx.json(200, { ok: true, entries: ownerAudit.readTail(limit), health: ownerAudit.health, path: ownerAudit.path });
  });

  router.register('/api/bili/status', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg();
    ctx.json(200, {
      enabled: cfg.biliBridge?.enabled !== false,
      memory: biliMemory.status(),
      dynamics: getBiliDynamics()?.status() ?? { enabled: false },
      share: getBiliShare()?.status() ?? { enabled: false },
      groups: {
        allow: cfg.allow?.groups ?? [],
        dynamics: cfg.biliBridge?.dynamics?.groups ?? [],
        share: cfg.biliBridge?.share?.groups ?? [],
      },
    });
  });

  router.register('/api/sessions', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg();
    const list = [];
    for (const [key, sessionId] of Object.entries(getSessionsMap())) {
      list.push({ key, sessionId, owner: key === `private:${String(cfg.ownerQQ ?? '')}` });
    }
    ctx.json(200, { sessions: list });
  });

  router.register('/api/pending', ['GET'], async (req, res, ctx) => {
    const list = [];
    for (const [key, p] of getPending().entries()) {
      list.push({
        key,
        kind: p.kind,
        sessionId: p.sessionId,
        ...(p.kind === 'approval' ? { toolName: p.toolName, reason: p.reason, approvalId: p.approvalId } : {}),
        ...(p.kind === 'question' ? { questions: p.questions } : {}),
      });
    }
    ctx.json(200, { pending: list });
  });

  router.register('/api/socialV2/states', ['GET'], async (req, res, ctx) => {
    const list = [];
    for (const [key, st] of getSocialV2().conversations) {
      list.push({
        key,
        wakeConfig: st.wakeConfig,
        unreadCount: st.unread.length,
        recentCount: st.recentMessages.length,
        lastWakeReason: st.lastWakeReason,
        lastAiReplyAt: st.lastAiReplyAt,
        noActionCount: st.wakeConfig.noActionCount || 0,
      });
    }
    ctx.json(200, { ok: true, conversations: list });
  });

  router.register('/api/plugins', ['GET'], async (req, res, ctx) => {
    try {
      const cfg = getCfg();
      const token = String(req.headers['x-agent-token'] || '');
      const consoleOk = String(req.headers['x-console-token'] || '') === String(cfg.consoleToken || '');
      const localOk = (req.socket?.remoteAddress === '127.0.0.1' || req.socket?.remoteAddress === '::1' || req.socket?.remoteAddress === '::ffff:127.0.0.1');
      if (!isLiveAgentToken(token) && !consoleOk && !localOk) {
        ctx.json(403, { ok: false, error: 'agent token 无效' });
        return;
      }
      ctx.json(200, buildPlugins());
    } catch (e) {
      ctx.json(500, { ok: false, error: String(e?.message || e) });
    }
  });
}

export default registerSocialRead;
