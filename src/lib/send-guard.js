// R6: QQ send-channel health + cross-turn failure suppression, moved out of bridge main().
// Behavior identical: same failure predicates, same 2-minute "recently failed" window,
// same 30-minute wake suspension, same gate-event dedupe keys, same health field names.
// The live health object stays in bridge (other code mutates it) and is passed in by reference.
export function createSendGuard({
  health,
  gateEvents,
  log,
  now = Date.now,
  decisionMarkOutcome,
  getSocialV2State,
  saveSocialV2State,
  scheduleProactiveCheck,
  listConversationKeys,
}) {
  const snowlumaHealth = health;
  const SEND_CHANNEL_SUSPEND_MS = 30 * 60 * 1000;
  const logThrottle = new Map();

function qqSendChannelStatus() {
  if (snowlumaHealth.connected !== true) {
    return { ok: false, code: 'SNOWLUMA_OFFLINE', reason: 'SnowLuma WS 未连接' };
  }
  if (snowlumaHealth.lastSendFailAt > snowlumaHealth.lastSendOkAt
    && now() - snowlumaHealth.lastSendFailAt < 2 * 60 * 1000) {
    return { ok: false, code: 'SEND_RECENTLY_FAILED', reason: `最近发送失败：${snowlumaHealth.lastSendError || '未知'}` };
  }
  return { ok: true };
}

/** 同一 tag 在 ms 内只打一次日志（未授权会话/守卫重试会刷屏）。 */
function logThrottled(tag, ms, message) {
  const ts = now();
  const last = logThrottle.get(tag) ?? 0;
  if (ts - last < ms) return false;
  logThrottle.set(tag, ts);
  log(message);
  return true;
}

function notifySendChannelDown(reason = '') {
  // 启动时 SnowLuma 还没开：这是“未启动”，不是“断线”。只记日志，不弹 L2。
  if (!snowlumaHealth.everConnected) {
    log(`[snowluma] 尚未连接（${String(reason || '未启动').slice(0, 120)}）；等待用户启动 SnowLuma，不弹断线告警`);
    return;
  }
  if (snowlumaHealth.downNotified) return;
  snowlumaHealth.downNotified = true;
  const message = String(reason || 'SnowLuma 连接断开').slice(0, 300);
  gateEvents.record({
    gate: 'snowluma',
    kind: 'fault',
    event: 'send-channel-down',
    action: 'blocked',
    reason: { code: 'SNOWLUMA_OFFLINE', message },
    impact: '当前无法把消息发到 QQ；通道恢复前会自动跳过主动唤醒，避免先生成后丢弃、白烧 token。',
    recommendation: '启动或重启 SnowLuma（launcher.bat），确认 OneBot HTTP :3000 与 WS :3001 可用；恢复后会自动继续。',
    confidence: 'confirmed',
    dedupeKey: 'snowluma:send-channel-down',
  });
  log('❌ SnowLuma 发送通道不可用；自动唤醒已暂停，避免空烧 token。');
  log('   处理：启动/重启 SnowLuma（launcher.bat），确认 HTTP :3000 与 WS :3001 可用；恢复后自动继续。');
}

function notifySendChannelUp() {
  if (snowlumaHealth.downTimer) {
    clearTimeout(snowlumaHealth.downTimer);
    snowlumaHealth.downTimer = null;
  }
  // 不管告警是否真的发过，都把“未处理”的断线事件确认掉：
  // 重连成功后用户明明连着，不该再被 L2 弹窗追着确认（2026-10-31 用户反馈）。
  try { gateEvents.ackByDedupe('snowluma:send-channel-down'); } catch {}
  if (!snowlumaHealth.downNotified) return;
  snowlumaHealth.downNotified = false;
  gateEvents.record({
    gate: 'snowluma',
    kind: 'fault',
    event: 'send-channel-restored',
    action: 'allowed',
    reason: { code: 'SNOWLUMA_RESTORED', message: 'SnowLuma 已重新连接' },
    impact: '发送通道恢复，自动唤醒可以继续。',
    recommendation: '无需操作。',
    confidence: 'confirmed',
    dedupeKey: 'snowluma:send-channel-restored',
  });
  log('✅ SnowLuma 发送通道已恢复，自动唤醒恢复。');
  try {
    for (const key of listConversationKeys()) {
      const st = getSocialV2State(key);
      st.sendFailureStreak = 0;
      st.wakeSuspendedUntil = 0;
      scheduleProactiveCheck(key);
    }
    saveSocialV2State();
  } catch (error) {
    log('[snowluma] 恢复唤醒调度失败：', String(error?.message ?? error).slice(0, 160));
  }
}

function noteSendSuccess(key, reply = '') {
  // DECISION_LOG（P1）：发送成功 → 给这次判决补「回了」+ 回复正文（P2-H：前 80 字）。
  try { decisionMarkOutcome(key, { replied: true, outbound: 1, reply: String(reply || '') }); } catch {}
  snowlumaHealth.lastSendOkAt = now();
  snowlumaHealth.lastSendError = '';
  try {
    const st = getSocialV2State(key);
    if (st.sendFailureStreak || st.wakeSuspendedUntil) {
      st.sendFailureStreak = 0;
      st.wakeSuspendedUntil = 0;
      saveSocialV2State();
      scheduleProactiveCheck(key);
    }
  } catch {}
}

function noteSendFailure(key, error) {
  // 发送守卫/审计拒绝不是通道故障，不能拿它们去暂停唤醒。
  if (/白名单|不在允许|审计|会话令牌|replyToMessageId|atUserId/.test(String(error?.message ?? error))) return;
  snowlumaHealth.lastSendFailAt = now();
  snowlumaHealth.lastSendError = String(error?.message ?? error ?? '发送失败').slice(0, 200);
  try {
    const st = getSocialV2State(key);
    st.sendFailureStreak = Number(st.sendFailureStreak || 0) + 1;
    st.lastSendFailureAt = now();
    if (st.sendFailureStreak === 1) {
      gateEvents.record({
        gate: 'snowluma',
        kind: 'fault',
        event: 'send-failed',
        action: 'blocked',
        subject: { key },
        reason: { code: 'SEND_FAILED', message: snowlumaHealth.lastSendError },
        impact: '这次生成的内容没有发到 QQ；如果继续自动唤醒，会重复消耗 token。',
        recommendation: '检查 SnowLuma/QQ 通道；连续 3 次失败会自动暂停自动唤醒。',
        confidence: 'confirmed',
        dedupeKey: `snowluma:send-failed:${key}`,
      });
    }
    if (st.sendFailureStreak >= 3 && !(Number(st.wakeSuspendedUntil) > now())) {
      st.wakeSuspendedUntil = now() + SEND_CHANNEL_SUSPEND_MS;
      gateEvents.record({
        gate: 'snowluma',
        kind: 'fault',
        event: 'wake-suspended-after-send-failures',
        action: 'blocked',
        subject: { key },
        reason: { code: 'SEND_FAILURE_STREAK', message: `连续 ${st.sendFailureStreak} 次发送失败` },
        impact: '该会话的自动唤醒已暂停 30 分钟，避免继续先生成后丢弃、白烧 token。',
        recommendation: '检查 SnowLuma/QQ 通道；恢复或收到新消息后会自动解除。',
        confidence: 'confirmed',
        dedupeKey: `snowluma:send-fail:${key}`,
      });
      log(`⏸️ ${key} 连续 ${st.sendFailureStreak} 次发送失败；自动唤醒暂停 30 分钟，避免空烧。`);
    }
    saveSocialV2State();
  } catch {}
}
  return {
    qqSendChannelStatus,
    logThrottled,
    notifySendChannelDown,
    notifySendChannelUp,
    noteSendSuccess,
    noteSendFailure,
  };
}
