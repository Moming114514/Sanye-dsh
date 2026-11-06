// R8: 上线补历史消息（冷启动/账号上线时拉取离线窗口的群聊与私聊历史）。
// 从 bridge main() 原样搬出：过滤规则（白名单/首次唤醒/私聊开关）、条数上限、
// 去重键（messageId + 时间水位）与状态字段全部不变。
export function createHistoryBackfill({
  cfg,
  log,
  getConversations,
  getSocialV2State,
  saveSocialV2State,
  isSessionAllowedInCurrentMode,
  getSelfUserId,
  getCurrentMode,
  scheduleWakeV2,
  ownerMessageTag,
  segmentsToText,
  extractMediaFromSegments,
  extractForwardIds,
  truncateText,
  truncateTextTail,
  isFishName,
  selectMissedHistory,
  summarizeHistoryCatchup,
  historyWatermark,
  normalizeHistoryConfig,
  fetchImpl = fetch,
}) {
// ── 上线补历史消息（socialV2.history） ──────────────────────────────────
//
// 用户需求（2026-10-24）：每次上线查看历史消息，防止错过群友在掉线期间发的消息；
// 设置里可关，默认勾选打开。
//
// 为什么必须用历史接口：SnowLuma 只在 WebSocket 在线时推送消息，桥接/QQ 掉线期间
// 的消息不会补发；它们只存在 QQ 服务端。桥接启动或 QQ 账号重新上线时，对**已经在
// 二代状态里、且完成过首次唤醒**的白名单会话各取最近 N 条，按 messageId + 时间水位
// 去重后并入 unread（标 history=true）。只补历史、不重复走 handleIncoming，
// 所以不会触发鱼群/黑话/唤醒触发器的二次判定（唤醒由这里单独调度一次）。
const HISTORY_CATCHUP_THROTTLE_MS = 10_000;
const historyFetchErrorAt = new Map();
// 按 action 记录「这个运行时没实现」：群历史可用但好友历史不可用时，不能一起关掉。
const historyApiUnsupported = new Set();
let historyCatchUpRunning = null;
let historyCatchUpStartedAt = 0;

function historyCatchUpConfig() {
  return normalizeHistoryConfig(cfg.socialV2?.history);
}

function historyCatchUpTargets(conf) {
  const targets = [];
  for (const [key, st] of getConversations()) {
    // 没完成首次唤醒的会话不补：bootstrap 提示词还没发过，直接补历史会让模型
    // 在缺少二代协议说明的情况下被唤醒。等它先正常醒过一次再说。
    if (!st || st.bootstrapSent !== true) continue;
    const match = /^(group|private):(\d+)$/.exec(key);
    if (!match) continue;
    const kind = match[1];
    if (kind === 'private' && conf.includePrivate === false) continue;
    if (!isSessionAllowedInCurrentMode(key)) continue;
    targets.push({ key, kind, id: match[2] });
  }
  return targets;
}

async function fetchOneBotHistory(kind, id, count) {
  const action = kind === 'private' ? 'get_friend_msg_history' : 'get_group_msg_history';
  if (historyApiUnsupported.has(action)) return null;
  const params = kind === 'private'
    ? { user_id: Number(id), count }
    : { group_id: Number(id), count };
  const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${httpUrl}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {})
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
      const wording = String(body.wording ?? body.message ?? '');
      if (!historyApiUnsupported.has(action) && (res.status === 404 || res.status === 405
        || /not\s*(support|implement)|unsupported|unknown action/i.test(wording))) {
        historyApiUnsupported.add(action);
        log(`⚠️ 当前 SnowLuma 未实现 ${action}，上线补历史已跳过该接口（不影响正常收消息）`);
      } else if (!historyApiUnsupported.has(action)) {
        // 断线重连风暴时同一个错误会反复出现；每个 action 最多 5 分钟报一次。
        const now = Date.now();
        if (now - (historyFetchErrorAt.get(action) || 0) > 300_000) {
          historyFetchErrorAt.set(action, now);
          log(`[history] ${action} ${kind}:${id} 失败：${wording || `HTTP ${res.status}`}`);
        }
      }
      return null;
    }
    return Array.isArray(body.data?.messages) ? body.data.messages : [];
  } catch (error) {
    const now = Date.now();
    if (now - (historyFetchErrorAt.get(action) || 0) > 300_000) {
      historyFetchErrorAt.set(action, now);
      log(`[history] ${action} ${kind}:${id} 请求异常：${error?.message ?? error}`);
    }
    return null;
  }
}

async function historyCandidateFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const segments = Array.isArray(raw.message) ? raw.message : (typeof raw.message === 'string' ? raw.message : []);
  let text = '';
  let plain = '';
  try {
    // 历史消息里的引用/at 不在这里解析（解析器会逐条打网关）；引用用占位符即可，
    // 真要看那条消息 AI 仍可按 messageId 调 qq_get_message_detail。
    text = await segmentsToText(segments, { includeReply: true });
    plain = await segmentsToText(segments, { includeReply: false });
  } catch {}
  const senderInfo = raw.sender && typeof raw.sender === 'object' ? raw.sender : {};
  const senderId = String(senderInfo.user_id ?? raw.user_id ?? '').trim();
  const self = String(getSelfUserId() || '').trim();
  const isSelf = Boolean(self) && senderId === self;
  const sender = isSelf ? '我' : (String(senderInfo.card || senderInfo.nickname || '').trim() || senderId || '未知');
  const messageIdRaw = raw.message_id ?? raw.real_id ?? raw.message_seq;
  const messageId = messageIdRaw != null ? String(messageIdRaw).trim() : '';
  const time = Number(raw.time) > 0 ? Number(raw.time) * 1000 : 0;
  if (!messageId || !time) return null;
  const media = extractMediaFromSegments(segments);
  const forwardIds = extractForwardIds(Array.isArray(segments) ? segments : []);
  const isOwner = Boolean(cfg.ownerQQ) && senderId === String(cfg.ownerQQ);
  return {
    messageId,
    time,
    userId: senderId || null,
    sender,
    text: truncateText(text || '[消息]', 200),
    plain: truncateText(plain || text || '[消息]', 200),
    tail: truncateTextTail(plain || text || '', 200),
    isSelf,
    isOwner,
    fish: !isSelf && !isOwner && isFishName(sender, cfg.fishGuard),
    media,
    forwardIds
  };
}

function appendHistoryCatchupV2(key, candidates, { trigger = 'online', watermark = 0, maxAgeMs, fetched = 0 } = {}) {
  const st = getSocialV2State(key);
  const recentLimit = Number(cfg.socialV2?.context?.recentLimit) || 100;
  const unreadLimit = Number(cfg.socialV2?.context?.unreadLimit) || 30;
  const existingIds = new Set();
  for (const message of [...(st.recentMessages || []), ...(st.unread || [])]) {
    const id = String(message?.messageId ?? '').trim();
    if (id) existingIds.add(id);
  }
  const picked = selectMissedHistory(candidates, {
    watermark,
    maxAgeMs,
    limit: historyCatchUpConfig().limit,
    existingIds,
    blockedUsers: cfg.deny?.users ?? []
  });
  const caughtUpAt = Date.now();
  for (const candidate of picked) {
    const media = Array.isArray(candidate.media) ? candidate.media.slice(0, 20) : [];
    const forwardIds = Array.isArray(candidate.forwardIds) ? candidate.forwardIds.slice(0, 20) : [];
    const msg = {
      seq: null,
      messageId: candidate.messageId,
      sender: candidate.sender,
      userId: candidate.userId,
      text: candidate.text,
      plain: candidate.plain,
      tail: candidate.tail,
      quoteTargetIsSelf: false,
      isOwner: candidate.isOwner,
      ownerLabel: candidate.isOwner ? `${ownerMessageTag()}管理员（ownerQQ ${cfg.ownerQQ ?? ''}）` : '',
      isSelf: candidate.isSelf,
      history: true,
      fish: candidate.fish,
      media,
      hasMedia: media.length > 0,
      forwardIds,
      hasForward: forwardIds.length > 0,
      time: candidate.time
    };
    if (candidate.isSelf) {
      // 自己以前发的消息只进 recent 帮助理解上下文，不进未读（不需要“处理”）。
      st.recentMessages.push(msg);
      continue;
    }
    msg.seq = (st.lastUnreadSeq || 0) + 1;
    st.lastUnreadSeq = msg.seq;
    st.recentMessages.push(msg);
    st.unread.push(msg);
  }
  if (st.recentMessages.length > recentLimit) st.recentMessages.splice(0, st.recentMessages.length - recentLimit);
  if (st.unread.length > unreadLimit) st.unread.splice(0, st.unread.length - unreadLimit);
  // 水位按「本次看到的最新历史消息」推进（而不是 now）：历史接口返回后、下一次检查前
  // 到达的消息时间一定更大，不会被误跳；同一批消息也不会二次灌入。
  // 未来时间（时钟漂移/异常网关）不参与水位，否则会把之后正常的消息全跳过去。
  const newestFetched = (Array.isArray(candidates) ? candidates : [])
    .reduce((max, item) => {
      const time = Number(item?.time) || 0;
      return time > 0 && time <= caughtUpAt ? Math.max(max, time) : max;
    }, 0);
  if (newestFetched > (st.lastHistoryMessageTime || 0)) st.lastHistoryMessageTime = newestFetched;
  st.lastHistoryCheckedAt = caughtUpAt;
  const summary = summarizeHistoryCatchup(picked);
  st.lastHistoryCatchup = {
    at: new Date(caughtUpAt).toISOString(),
    trigger,
    fetched: Number(fetched) || 0,
    ...summary
  };
  saveSocialV2State();
  return summary;
}

async function catchUpHistoryForConversation({ key, kind, id }, conf, trigger) {
  const st = getSocialV2State(key);
  const maxAgeMs = conf.maxAgeMinutes * 60_000;
  // 水位必须在 fetch 之前算：fetch 期间可能来实时消息，把 lastIncomingAt 推到现在；
  // 如果 fetch 后再算，会把真正错过的历史消息误判成“太旧”而丢掉。
  const watermark = historyWatermark(st, { now: Date.now(), maxAgeMs });
  const raw = await fetchOneBotHistory(kind, id, conf.limit);
  if (!raw) return { key, ok: false };
  const candidates = [];
  for (const item of raw) {
    const candidate = await historyCandidateFromRaw(item);
    if (candidate) candidates.push(candidate);
  }
  if (!candidates.length) {
    return { key, ok: true, fetched: 0, incoming: 0, self: 0, total: 0, wakeScheduled: false };
  }
  const summary = appendHistoryCatchupV2(key, candidates, { trigger, watermark, maxAgeMs, fetched: candidates.length });
  let wakeScheduled = false;
  if (summary.incoming > 0 && conf.wake !== false) {
    scheduleWakeV2(key, 'history');
    wakeScheduled = true;
  }
  if (summary.total > 0) {
    log(`[history] ${key} 补回 ${summary.incoming} 条群友消息 / ${summary.self} 条自己的旧消息（${trigger}）`);
  }
  return { key, ok: true, fetched: candidates.length, ...summary, wakeScheduled };
}

async function runHistoryCatchUp(trigger = 'online', { force = false } = {}) {
  const conf = historyCatchUpConfig();
  if (!conf.enabled) return { ok: true, disabled: true, results: [] };
  if (getCurrentMode() !== 'reserved2' || cfg.socialV2?.enabled === false) {
    return { ok: true, skipped: 'mode', results: [] };
  }
  // 没有自己的 QQ 号时无法区分「群友」和「自己以前发的消息」；宁可等下一次
  // （open 的 getLoginInfo 完成后会再触发一次），也不要先把历史消息错灌进未读。
  if (!String(getSelfUserId() || '').trim()) {
    return { ok: true, skipped: 'no-self-id', results: [] };
  }
  if (historyCatchUpRunning) return historyCatchUpRunning;
  const now = Date.now();
  if (!force && now - historyCatchUpStartedAt < HISTORY_CATCHUP_THROTTLE_MS) {
    return { ok: true, throttled: true, results: [] };
  }
  historyCatchUpStartedAt = now;
  historyCatchUpRunning = (async () => {
    const targets = historyCatchUpTargets(conf);
    const results = [];
    for (const target of targets) {
      try {
        results.push(await catchUpHistoryForConversation(target, conf, trigger));
      } catch (error) {
        results.push({ key: target.key, ok: false, error: error?.message ?? String(error) });
        log(`[history] ${target.key} 补历史异常：${error?.message ?? error}`);
      }
    }
    const summary = results.reduce((acc, item) => ({
      incoming: acc.incoming + (Number(item?.incoming) || 0),
      self: acc.self + (Number(item?.self) || 0),
      total: acc.total + (Number(item?.total) || 0)
    }), { incoming: 0, self: 0, total: 0 });
    if (summary.total > 0) {
      log(`[history] 上线补历史完成（${trigger}）：${results.filter((item) => Number(item?.total) > 0).length} 个会话，共 ${summary.total} 条`);
    }
    return { ok: true, trigger, targets: targets.length, results, ...summary };
  })().finally(() => { historyCatchUpRunning = null; });
  return historyCatchUpRunning;
}

  return { historyCatchUpConfig, historyCatchUpTargets, fetchOneBotHistory, historyCandidateFromRaw, appendHistoryCatchupV2, catchUpHistoryForConversation, runHistoryCatchUp };
}
