// src/console/routes/misc-read.js —— R9-5：7 条只读杂项路由
// 迁移来源：src/bridge.js 内联分支（whitelist / security / socialV2/config /
// socialV2/activity / socialV2/feedback / slang / social）。响应体逐字照搬。
// 依赖语义（上次事故点）：每个 dep 对应 bridge 里真实的调用形态，注册处写明「等价：原调用 …」。
export function registerMiscRead(router, deps) {
  const REQUIRED = [
    'getCfg', 'getStateDirHardened', 'stateDir', 'manualDirCommand',
    'getSocialV2Root', 'readFeedbackEntries',
    'getSlangEntries', 'getSlangWritable', 'getSocial',
  ];
  const missing = REQUIRED.filter((k) => deps == null || deps[k] == null);
  if (missing.length) throw new Error('misc-read 依赖缺失：' + missing.join(', '));

  const {
    getCfg, getStateDirHardened, stateDir, manualDirCommand,
    getSocialV2Root, readFeedbackEntries,
    getSlangEntries, getSlangWritable, getSocial,
  } = deps;

  router.register('/api/whitelist', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    ctx.json(200, { allow: cfg.allow ?? { private: [], groups: [] }, deny: cfg.deny ?? { users: [], private: [], groups: [] }, ownerQQ: cfg.ownerQQ ?? null });
  });

  router.register('/api/security', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    ctx.json(200, {
      security: cfg.security ?? { interceptNotify: true },
      stateDir: {
        hardened: !!getStateDirHardened(),
        path: stateDir,
        manualCommand: process.platform === 'win32'
          ? manualDirCommand(stateDir)
          : `chmod 700 "${stateDir}"`,
      },
    });
  });

  router.register('/api/socialV2/config', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    ctx.json(200, { ok: true, config: cfg.socialV2 ?? {} });
  });

  router.register('/api/socialV2/activity', ['GET'], async (req, res, ctx) => {
    const root = getSocialV2Root() ?? {};
    ctx.json(200, { ok: true, paused: !!root.paused });
  });

  router.register('/api/socialV2/feedback', ['GET'], async (req, res, ctx) => {
    const entries = readFeedbackEntries();
    ctx.json(200, { ok: true, entries: Array.isArray(entries) ? entries : [] });
  });

  router.register('/api/slang', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    const all = getSlangEntries();
    const entries = Array.isArray(all) ? all : [];
    const status = ctx.query.get('status') || '';
    const list = status ? entries.filter((e) => e.status === status) : entries;
    ctx.json(200, { entries: list, config: cfg.slang, writable: !!getSlangWritable() });
  });

  router.register('/api/social', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    const social = getSocial() ?? {};
    const stats = {};
    for (const [k, e] of (social.pendingSummaries ?? new Map()).entries()) stats[k] = (e?.items ?? []).length;
    const states = {};
    const keys = new Set([...(social.states ?? new Map()).keys(), ...(social.recentMessages ?? new Map()).keys()]);
    for (const k of keys) {
      const st = (social.states ?? new Map()).get(k);
      states[k] = { phase: st?.phase ?? 'idle' };
    }
    ctx.json(200, { config: cfg.social, pendingSummaries: stats, states });
  });
}
