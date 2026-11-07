// src/console/routes/tokens.js —— R9-1：只读 tokens / status 路由
// 从 src/bridge.js 搬出，行为逐字节一致：同样的 JSON.stringify(obj, null, 2)、
// 同样的状态码、同样的 x-agent-token 拒绝逻辑（tokens 一律控制台专用）。
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res, obj, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj, null, 2));
}

// /api/status 的完整对象要读很多运行时状态，全部通过 getter 注入（不在 lib 里抓全局）。
export function registerTokens(router, deps) {
  const S = deps.status;
  const T = deps.tokens;

  router.register('/api/status', 'GET', (req, res) => {
    const rs = S.readRoleState();
    // 带 agent token 的调用来自 QQ 群里的 AI：只能拿到它自己该知道的运行状态。
    if (req.headers['x-agent-token'] || req.headers['x-agent-call'] !== undefined) {
      const agentToken = String(req.headers['x-agent-token'] || '');
      const agentKey = agentToken && typeof S.keyByAgentToken === 'function' ? S.keyByAgentToken(agentToken) : null;
      send(res, {
        key: agentKey,
        mode: S.getMode(),
        role: rs.role ?? null,
        roleMode: rs.mode ?? 'active',
        dshReady: S.getDshReady(),
        socialV2Paused: S.getSocialV2().paused,
      });
      return;
    }
    const socialV2 = S.getSocialV2();
    send(res, {
      mode: S.getMode(),
      root: S.root,
      dshBaseUrl: S.cfg.dsh.baseUrl,
      closedAgentPreset: S.getClosedAgentPreset(),
      role: rs.role ?? null,
      roleMode: rs.mode ?? 'active',
      dshReady: S.getDshReady(),
      ownerQQ: S.cfg.ownerQQ ?? null,
      ownerAudit: S.getOwnerAudit().health,
      allowGroups: S.cfg.allow?.groups ?? [],
      allowPrivate: S.cfg.allow?.private ?? [],
      socialV2Paused: socialV2.paused,
      purpose: {
        enabled: S.cfg.purpose?.enabled !== false,
        ...S.summarizePurposeState(S.getPurposeState(), { config: S.cfg.purpose }),
      },
      closure: (() => {
        const config = S.closureConfigV2();
        let latest = null;
        for (const [key, st] of socialV2.conversations) {
          if (!st?.closure?.at) continue;
          if (!latest || Number(st.closure.at) > Number(latest.record.at)) {
            latest = { key, record: st.closure };
          }
        }
        const assessment = latest ? S.assessClosureV2(latest.key, S.getSocialV2State(latest.key)) : null;
        return {
          enabled: config.enabled,
          config,
          active: latest ? {
            key: latest.key,
            ...S.closureStatus(latest.record, Date.now()),
            verdict: assessment?.verdict ?? null,
            score: assessment?.score ?? null,
            reasons: assessment?.reasons ?? [],
          } : null,
          recentlyClosed: [...socialV2.conversations.entries()]
            .filter(([, st]) => st?.closure?.at)
            .sort((a, b) => Number(b[1].closure.at) - Number(a[1].closure.at))
            .slice(0, 3)
            .map(([key, st]) => ({ key, ...S.closureStatus(st.closure, Date.now()) })),
        };
      })(),
      snowluma: S.snowlumaHealthSnapshot(),
      activity: S.readActivityTail(100),
    });
  });

  // ── Token 用量 / 花费（控制台专用）─────────────────────────────────
  // 路径刻意不放在 /api/socialV2/ 下：那一整个前缀对持有 x-agent-token 的
  // QQ 侧 AI 是放行的，而跨群花费属于管理信息。
  const onlyConsole = (req, res) => {
    if (req.headers['x-agent-token']) {
      send(res, { ok: false, error: '该接口仅控制台可用' }, 403);
      return true;
    }
    return false;
  };

  router.register('/api/tokens/summary', 'GET', (req, res, ctx) => {
    if (onlyConsole(req, res)) return;
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 200));
    send(res, { ...T.ledger.summary({ limit }), ledger: T.ledger.stats() });
  });

  router.register('/api/tokens/daily', 'GET', (req, res) => {
    if (onlyConsole(req, res)) return;
    const usage = T.dailyUsage();
    const limits = T.budgetLimits();
    const qqGate = T.evaluateBudget(usage, limits, { scopes: ['qq', 'total'] });
    send(res, { ok: true, usage, limits, gate: { blocked: qqGate.blocked, hits: qqGate.hits }, cutoff: T.localDayStart() });
  });

  router.register('/api/tokens/series', 'GET', (req, res, ctx) => {
    if (onlyConsole(req, res)) return;
    const hours = Math.min(24 * 90, Math.max(1, Number(ctx.query.get('hours')) || 24));
    const maxBuckets = Math.min(120, Math.max(6, Number(ctx.query.get('buckets')) || 48));
    send(res, T.ledger.series({ hours, maxBuckets }));
  });

  router.register('/api/tokens/turns', 'GET', (req, res, ctx) => {
    if (onlyConsole(req, res)) return;
    const key = String(ctx.query.get('key') ?? '').trim();
    const limit = Math.min(1000, Math.max(1, Number(ctx.query.get('limit')) || 200));
    const detail = T.ledger.conversation(key, { turnLimit: limit });
    if (!detail) { send(res, { ok: false, error: '未找到该会话的用量记录' }, 404); return; }
    send(res, detail);
  });

  router.register('/api/tokens/recent', 'GET', (req, res, ctx) => {
    if (onlyConsole(req, res)) return;
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get('limit')) || 50));
    send(res, { ok: true, symbol: T.priceSymbol, entries: T.ledger.recent(limit) });
  });

  return router;
}

export default registerTokens;
