// src/console/routes/social-read.js —— R9-3：7 条纯读控制台路由
// 迁移来源：src/bridge.js 内联分支（tool-log / owner-audit / bili/status /
// sessions / pending / socialV2/states / plugins）。响应体逐字照搬，未改字段顺序。
// 所有依赖由 bridge 注入，本文件不 import bridge、不读全局变量。
export function registerSocialRead(router, deps) {
  const {
    sendJson,
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
    sendJson({ ok: true, entries: readToolLog(limit) });
  });

  router.register('/api/owner-audit', ['GET'], async (req, res, ctx) => {
    const limit = Math.max(1, Math.min(200, Number(ctx.query.get('limit')) || 50));
    sendJson({ ok: true, entries: ownerAudit.readTail(limit), health: ownerAudit.health, path: ownerAudit.path });
  });

  router.register('/api/bili/status', ['GET'], async () => {
    const cfg = getCfg();
    sendJson({
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

  router.register('/api/sessions', ['GET'], async () => {
    const cfg = getCfg();
    const list = [];
    for (const [key, sessionId] of Object.entries(getSessionsMap())) {
      list.push({ key, sessionId, owner: key === `private:${String(cfg.ownerQQ ?? '')}` });
    }
    sendJson({ sessions: list });
  });

  router.register('/api/pending', ['GET'], async () => {
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
    sendJson({ pending: list });
  });

  router.register('/api/socialV2/states', ['GET'], async () => {
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
    sendJson({ ok: true, conversations: list });
  });

  router.register('/api/plugins', ['GET'], async (req, res) => {
    try {
      const cfg = getCfg();
      const token = String(req.headers['x-agent-token'] || '');
      const consoleOk = String(req.headers['x-console-token'] || '') === String(cfg.consoleToken || '');
      const localOk = (req.socket?.remoteAddress === '127.0.0.1' || req.socket?.remoteAddress === '::1' || req.socket?.remoteAddress === '::ffff:127.0.0.1');
      if (!isLiveAgentToken(token) && !consoleOk && !localOk) {
        sendJson({ ok: false, error: 'agent token 无效' }, 403);
        return;
      }
      sendJson(buildPlugins());
    } catch (e) {
      sendJson({ ok: false, error: String(e?.message || e) }, 500);
    }
  });
}

export default registerSocialRead;
