// src/console/routes/agent-read.js —— R9-6：7 条 agent 侧只读路由
// 迁移来源：src/bridge.js 内联分支（socialV2/recent、unread、my-recent、slang/query、
// message-detail、purpose/status、dsh/model）。
// deps 语义：getSocialV2State 是「按 key 取会话」；getSlangEntries 返回当前 slangEntries；
// getPurposeState/getPurposeRun 取当前对象；getModelCatalogCache 返回 {inflight, errors} 共享缓存。
export function registerAgentRead(router, deps) {
  const REQUIRED = [
    'getCfg', 'getSocialV2State', 'getMode', 'agentTokenOk', 'v2SessionAllowed', 'v2ToolEnabled',
    'noteModelMessagesV2', 'readThroughSeqV2', 'stickerMatchFor', 'resolveReplyInfo',
    'confirmedSlangListV2', 'getSlangEntries', 'buildSlangContext',
    'ensurePurposeDay', 'getPurposeState', 'purposeOwnerId', 'adminIdentity',
    'summarizePurposeState', 'getPurposeRun',
    'fetchModelCatalog', 'withTimeout', 'unwrap', 'log', 'effortOptions', 'effortDefault',
    'getModelCatalogCache',
  ];
  const missing = REQUIRED.filter((k) => deps == null || deps[k] == null);
  if (missing.length) throw new Error('agent-read 依赖缺失：' + missing.join(', '));

  const {
    getCfg, getSocialV2State, getMode, agentTokenOk, v2SessionAllowed, v2ToolEnabled,
    noteModelMessagesV2, readThroughSeqV2, stickerMatchFor, resolveReplyInfo,
    confirmedSlangListV2, getSlangEntries, buildSlangContext,
    ensurePurposeDay, getPurposeState, purposeOwnerId, adminIdentity,
    summarizePurposeState, getPurposeRun,
    fetchModelCatalog, withTimeout, unwrap, log, effortOptions, effortDefault,
    getModelCatalogCache,
  } = deps;

  // 与原内联分支一致：只有带了 x-agent-token 才做三道校验
  const agentGate = (req, key, tool, label) => {
    const tok = req.headers['x-agent-token'];
    if (tok && !agentTokenOk(key, tok)) return { code: 403, body: { ok: false, error: 'agent token 无效' } };
    if (tok && !v2SessionAllowed(key)) return { code: 403, body: { ok: false, error: '目标不在当前模式允许范围内' } };
    if (tok && !v2ToolEnabled(tool)) return { code: 403, body: { ok: false, error: '工具未启用：' + label } };
    return null;
  };
  const deny = (ctx, gate) => { if (!gate) return false; ctx.json(gate.code, gate.body); return true; };

  router.register('/api/socialV2/recent', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 20));
    const offset = Math.max(0, Number(ctx.query.get('offset')) || 0);
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (deny(ctx, agentGate(req, key, 'getRecent', 'qq_get_recent_messages'))) return;
    const st = getSocialV2State(key) ?? {};
    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const start = Math.max(0, recent.length - offset - limit);
    const end = Math.max(0, recent.length - offset);
    const messages = recent.slice(start, end);
    // 等价：原调用 noteModelMessagesV2(st, messages) / readThroughSeqV2(st)
    const readThroughSeq = req.headers['x-agent-token'] ? noteModelMessagesV2(st, messages) : readThroughSeqV2(st);
    ctx.json(200, { ok: true, key, messages, readThroughSeq });
  });

  router.register('/api/socialV2/unread', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit')) || 30));
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (deny(ctx, agentGate(req, key, 'getUnread', 'qq_get_unread_messages'))) return;
    const afterRaw = ctx.query.get('afterSeq');
    const afterSeq = afterRaw === null ? null : Number(afterRaw);
    if (afterRaw !== null && (!/^\d+$/.test(afterRaw) || !Number.isSafeInteger(afterSeq) || afterSeq < 0)) {
      ctx.json(400, { ok: false, error: 'afterSeq 必须是非负安全整数；从最早未读开始请传 0' });
      return;
    }
    const st = getSocialV2State(key) ?? {};
    const unread = Array.isArray(st.unread) ? st.unread : [];
    const messages = afterSeq === null ? unread.slice(-limit)
      : unread.filter((m) => Number.isSafeInteger(m.seq) && m.seq > afterSeq).slice(0, limit);
    const readThroughSeq = req.headers['x-agent-token'] ? noteModelMessagesV2(st, messages) : readThroughSeqV2(st);
    const stickerMatch = stickerMatchFor(messages);
    ctx.json(200, { ok: true, key, unreadCount: unread.length, ...(stickerMatch ? { stickerMatch } : {}), messages, readThroughSeq });
  });

  router.register('/api/socialV2/my-recent', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const limit = Math.min(50, Math.max(1, Number(ctx.query.get('limit')) || 10));
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (deny(ctx, agentGate(req, key, 'getMyRecent', 'qq_get_my_recent_messages'))) return;
    const st = getSocialV2State(key) ?? {};
    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const mine = recent.filter((m) => m && m.isSelf).slice(-limit);
    ctx.json(200, { ok: true, key, messages: mine, readThroughSeq: readThroughSeqV2(st) });
  });

  router.register('/api/socialV2/slang/query', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const q = String(ctx.query.get('q') ?? '').trim().toLowerCase();
    if (!key) { ctx.json(400, { ok: false, error: 'key 不能为空' }); return; }
    if (deny(ctx, agentGate(req, key, 'slangQuery', 'qq_slang_query'))) return;
    const cfg = getCfg() ?? {};
    const list = confirmedSlangListV2().filter((e) => {
      if (!q) return true;
      return e.content.toLowerCase().includes(q)
        || e.meaning.toLowerCase().includes(q)
        || e.usage.toLowerCase().includes(q)
        || e.example.toLowerCase().includes(q);
    });
    ctx.json(200, {
      ok: true,
      key,
      total: list.length,
      entries: list,
      // 等价：原调用 buildSlangContext(slangEntries, cfg.slang?.injectMax ?? 8)
      block: buildSlangContext(getSlangEntries(), cfg.slang?.injectMax ?? 8),
    });
  });

  router.register('/api/socialV2/message-detail', ['GET'], async (req, res, ctx) => {
    const key = String(ctx.query.get('key') ?? '').trim();
    const messageId = String(ctx.query.get('messageId') ?? '').trim();
    if (!key || !messageId) { ctx.json(400, { ok: false, error: 'key 和 messageId 不能为空' }); return; }
    if (deny(ctx, agentGate(req, key, 'getMessageDetail', 'qq_get_message_detail'))) return;
    const keyMatch = /^(group|private):(\d+)$/.exec(key);
    if (!keyMatch) { ctx.json(400, { ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }); return; }
    const kind = keyMatch[1];
    const id = Number(keyMatch[2]);
    try {
      const st = getSocialV2State(key) ?? {};
      const found = (st.recentMessages || []).find((m) => m && (String(m.seq) === messageId || (m.messageId && String(m.messageId) === messageId)));
      const forwardFields = found ? {
        forwardIds: Array.isArray(found.forwardIds) ? found.forwardIds : [],
        hasForward: !!found.hasForward,
      } : {};
      let info = null;
      // 等价原逻辑：入参命中本地 seq 且本地存有真实 messageId 时优先按 seq 展示
      if (found && found.messageId && String(found.messageId) !== messageId) {
        info = {
          sender: String(found.sender || ''),
          text: String(found.text || found.plain || '').slice(0, 200),
          userId: found.userId ? String(found.userId) : null,
          messageId: String(found.messageId),
          seq: found.seq,
        };
      } else {
        // 等价：原调用 resolveReplyInfo(kind, id, messageId)
        info = await resolveReplyInfo(kind, id, messageId);
        if (!info && found) {
          info = {
            sender: String(found.sender || ''),
            text: String(found.text || found.plain || '').slice(0, 200),
            userId: found.userId ? String(found.userId) : null,
            messageId: found.messageId ? String(found.messageId) : null,
            seq: found.seq,
          };
        }
      }
      if (info && found) Object.assign(info, forwardFields);
      if (info) info.textTruncated = String(info.text ?? '').length >= 200;
      ctx.json(200, { ok: true, key, messageId, info });
    } catch (error) {
      ctx.json(500, { ok: false, error: `获取消息详情失败：${error?.message ?? error}` });
    }
  });

  router.register('/api/purpose/status', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    const state = getPurposeState() ?? {};
    // 等价：原调用 ensurePurposeDay(purposeState, Date.now())，每请求 1 次（日切副作用保持）
    ensurePurposeDay(state, Date.now());
    ctx.json(200, {
      ok: true,
      enabled: cfg.purpose?.enabled !== false,
      mode: getMode(),
      ownerUin: purposeOwnerId(),
      ownerName: String(adminIdentity()?.displayName || '').trim() || '主人',
      config: cfg.purpose,
      state: summarizePurposeState(state, { config: cfg.purpose }),
      running: Boolean(getPurposeRun()),
    });
  });

  router.register('/api/dsh/model', ['GET'], async (req, res, ctx) => {
    const cfg = getCfg() ?? {};
    const cache = getModelCatalogCache() ?? { inflight: null, errors: new Set() };
    const provider = String(cfg.dsh?.provider || 'deepseek-official');
    const model = String(cfg.dsh?.model || 'deepseek-flash');
    // 档位优先取 DSH 实际公布的能力，失败退回内置白名单
    let options = effortOptions.slice();
    let labels = {};
    let providerDefault = null;
    let catalogSource = 'fallback';
    try {
      if (!cache.inflight) {
        // 等价：原复用 modelCatalogInFlight 单飞，finally 清理
        cache.inflight = withTimeout(fetchModelCatalog(), 3000, 'session/modelCatalog')
          .finally(() => { cache.inflight = null; });
      }
      const catalog = unwrap(await cache.inflight, 'session.modelCatalog');
      const group = (catalog?.groups ?? []).find((g) => g?.id === provider);
      const entry = (group?.models ?? []).find((m) => m?.id === model);
      const efforts = entry?.reasoning?.efforts ?? [];
      const advertised = efforts.map((e) => String(e?.id ?? '')).filter((id) => effortOptions.includes(id));
      if (advertised.length) {
        options = advertised;
        labels = Object.fromEntries(efforts.map((e) => [String(e.id), { name: e.name ?? '', description: e.description ?? '' }]));
        providerDefault = entry.reasoning.defaultEffort ?? null;
        catalogSource = 'dsh';
      }
    } catch (error) {
      // 同一条失败原因只记一次，避免控制台刷新把日志刷爆
      const reason = String(error?.message ?? error);
      if (!cache.errors.has(reason)) {
        cache.errors.add(reason);
        log(`读取 DSH 模型能力失败，思考强度暂用内置清单：${reason}`);
      }
    }
    ctx.json(200, {
      provider,
      model,
      reasoningEffort: String(cfg.dsh?.reasoningEffort || effortDefault),
      options,
      labels,
      default: effortDefault,
      providerDefault,
      catalogSource,
      globalSideEffect: true,
    });
  });
}
