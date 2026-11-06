// R3：从 src/bridge.js main() 抽出的对话收尾判断（逻辑逐行等价）。
// 判断本身仍由 conversation-closure.js 提供；这里只做会话状态装配与落记录。
// 不 import bridge：状态读写、脱敏、唤醒计算等副作用都通过参数注入。
import {
  assessConversationClosure,
  classifyMessage,
  closeGate,
  closurePromptBlock,
  makeClosureRecord,
  normalizeClosureConfig,
  reopenClosure,
} from '../conversation-closure.js';
import { planClose } from '../action-planner.js';

export function createClosureClassifier({
  cfg,
  log = () => {},
  now = () => Date.now(),
  getState,
  canonicalKey,
  hasSendFailed = () => false,
  readThroughSeq,
  requestedReadThroughSeq,
  acknowledge,
  redact,
  ensureWakeable,
  markReadCalled,
  cancelReplyCheck,
  saveState,
  computeWakeSafety,
  appendActivity = () => {},
} = {}) {
  // ── 对话收尾判断（conversation closure）─────────────────────────────────
  // 判断本身是纯函数；这里只负责取当前会话状态、落记录、算冷却。
  // 关键边界：close 不是潜水 —— 不改变 wakeConfig，也不走 preSleepWaitBlockedV2。
  function closureConfigV2() {
    return normalizeClosureConfig(cfg.socialV2?.closure ?? {});
  }

  function assessClosureV2(key, st) {
    if (!st) st = getState(key);
    return assessConversationClosure({
      key,
      kind: String(key ?? '').startsWith('private:') ? 'private' : 'group',
      messages: st.recentMessages,
      unread: st.unread,
      now: now(),
      lastAiReplyAt: st.lastAiReplyAt,
      lastIncomingAt: st.lastIncomingAt,
      activeTopics: st.activeTopics,
      pendingThoughts: st.pendingThoughts,
      config: closureConfigV2(),
    });
  }

  function closurePromptLineV2(key, st) {
    const config = closureConfigV2();
    if (!config.enabled || !config.promptInWake) return '';
    const assessment = assessClosureV2(key, st);
    return closurePromptBlock(assessment, { record: st?.closure ?? null, now: now(), config });
  }

  /**
   * 自然收尾：不发消息，记下「收在哪 / 下次怎么接」，保持唤醒配置。
   * 与 qq_mark_read 的区别：mark_read 只是划走消息；close 留下结束点，
   * 下次唤醒会看到「上次这段怎么收的」，避免每次都重新开场。
   */
  function closeConversationV2(key, body = {}) {
    const canonical = canonicalKey(key);
    if (!canonical) {
      const error = new Error(`无效的会话 key：${String(key ?? '')}`);
      error.statusCode = 400;
      throw error;
    }
    key = canonical;
    const config = closureConfigV2();
    if (!config.enabled) {
      const error = new Error('对话收尾判断已关闭');
      error.statusCode = 403;
      throw error;
    }
    const st = getState(key);
    const plan = planClose({ st, sendFailed: hasSendFailed(key) === true });
    if (plan.blocked) {
      if (plan.code === 'CLOSE_AFTER_SEND_FAILED') {
        const error = new Error(plan.error);
        error.statusCode = 409;
        error.code = plan.code;
        error.hint = plan.hint;
        throw error;
      }
      return { ok: true, key, ...plan };
    }
    const assessment = assessClosureV2(key, st);
    const gate = closeGate(assessment, config);
    if (gate.blocked) {
      const error = new Error(gate.error);
      error.statusCode = 409;
      error.code = gate.reason;
      error.assessment = {
        verdict: assessment.verdict, score: assessment.score,
        reasons: assessment.reasons, signals: assessment.signals,
      };
      throw error;
    }
    // throughSeq 不传时，只确认「已经展示给模型」的安全水位；
    // 绝不因为收尾就把没看过的消息一起标成已读。
    const throughSeq = Object.prototype.hasOwnProperty.call(body, 'throughSeq') && body.throughSeq !== null
      ? requestedReadThroughSeq(st, body, true)
      : readThroughSeq(st);
    const markedCount = acknowledge(st, throughSeq);
    // 收尾摘要会进下一次唤醒提示，必须先脱敏已知令牌；路径/凭据由出站审计兜底，
    // 但内部状态不该原样带着令牌。
    const safeBody = {
      ...body,
      summary: redact(String(body.summary ?? '')),
      nextOpening: redact(String(body.nextOpening ?? '')),
    };
    const record = makeClosureRecord({
      key,
      kind: key.startsWith('private:') ? 'private' : 'group',
      assessment,
      body: safeBody,
      now: now(),
      config,
    });
    st.closure = record;
    st.lastActionAt = now();
    st.wakeConfig.noActionCount = 0;
    ensureWakeable(st, { key });
    // 复用「本轮已收尾」标记：回合结束检查看到它就不会再发「你还没设置唤醒」的提醒。
    markReadCalled(key);
    // 刚收尾就别再安排 30 秒后的「回复检查」——那等于自己把自己叫醒。
    cancelReplyCheck(key);
    saveState();
    const summaryText = record.summary ? `：${record.summary}` : '';
    log(`[收尾] ${key} 自然结束（${record.reason}）${summaryText}；冷却至 ${new Date(record.cooldownUntil).toLocaleString()}`);
    appendActivity(`${key} [收尾] ${record.summary ? record.summary.slice(0, 60) : '对话自然结束'}`);
    return {
      ok: true,
      key,
      closedAt: record.at,
      cooldownUntil: record.cooldownUntil,
      markedCount,
      unreadCount: st.unread.length,
      wakeKept: true,
      wakeGuaranteed: computeWakeSafety(st.wakeConfig).guaranteed,
      summary: record.summary,
      nextOpening: record.nextOpening,
      note: '已自然收尾：没有发消息，唤醒配置保持不变；对方再找你/开新话题仍会醒。',
    };
  }

  /**
   * 对方又开口时，把「上次收尾」标成已重开（记录保留，供提示词用）。
   * 私聊：对方一说话就算重新开始。
   * 群聊：只有直接叫到/引用/提问/道别才重开，普通闲聊不打断冷却 ——
   *       否则「收尾冷却」等于没设，还是会每句都醒。
   */
  function noteClosureReopenV2(key, st, { plain, text, quoteSelf = false, directAddress = false, media = [] } = {}) {
    if (!st?.closure) return false;
    const cls = classifyMessage({
      plain: plain ?? text, text: text ?? plain,
      quoteSelf, atSelf: directAddress, media,
    });
    const isPrivate = String(key ?? '').startsWith('private:');
    const reopen = isPrivate || directAddress || quoteSelf || ['question', 'request', 'ending'].includes(cls.kind);
    if (!reopen) return false;
    st.closure = reopenClosure(st.closure, { reason: cls.kind, now: now() });
    return true;
  }

  return { closureConfigV2, assessClosureV2, closurePromptLineV2, closeConversationV2, noteClosureReopenV2 };
}
