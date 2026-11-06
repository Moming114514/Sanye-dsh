import assert from 'node:assert/strict';
import { createSendGuard } from '../../src/lib/send-guard.js';

let t = 1_000_000_000_000;
const health = {
  connected: false,
  everConnected: true,
  lastSendOkAt: 0,
  lastSendFailAt: 0,
  lastSendError: '',
  downNotified: false,
  downTimer: null,
  downReason: '',
};
const records = [];
const acks = [];
const logs = [];
const decisions = [];
let saves = 0;
const schedules = [];
const states = new Map();
const stateFor = (k) => {
  if (!states.has(k)) states.set(k, { sendFailureStreak: 0, wakeSuspendedUntil: 0 });
  return states.get(k);
};

const guard = createSendGuard({
  health,
  gateEvents: {
    record: (e) => records.push(e),
    ackByDedupe: (k) => acks.push(k),
  },
  log: (m) => logs.push(String(m)),
  now: () => t,
  decisionMarkOutcome: (key, o) => decisions.push({ key, ...o }),
  getSocialV2State: stateFor,
  saveSocialV2State: () => { saves += 1; },
  scheduleProactiveCheck: (k) => schedules.push(k),
  listConversationKeys: () => ['group:1', 'private:2'],
});

// 1) 同一 tag 窗口内只放行一次；不同 tag（不同错误类型）各一次；过期再来
assert.equal(guard.logThrottled('err:A', 600_000, 'a1'), true);
t += 60_000;
assert.equal(guard.logThrottled('err:A', 600_000, 'a2'), false);
assert.equal(guard.logThrottled('err:B', 600_000, 'b1'), true);
t += 600_000;
assert.equal(guard.logThrottled('err:A', 600_000, 'a3'), true);
assert.equal(logs.filter((x) => /^a[0-9]$/.test(x)).length, 2);

// 2) 同一会话连续失败：send-failed 只记一次；第 3 次触发 30 分钟暂停
const key = 'group:1';
guard.noteSendFailure(key, new Error('timeout'));
assert.equal(stateFor(key).sendFailureStreak, 1);
assert.equal(records.filter((r) => r.event === 'send-failed').length, 1);
guard.noteSendFailure(key, new Error('timeout'));
assert.equal(stateFor(key).sendFailureStreak, 2);
assert.equal(records.filter((r) => r.event === 'send-failed').length, 1);
guard.noteSendFailure(key, new Error('timeout'));
assert.equal(stateFor(key).sendFailureStreak, 3);
assert.equal(records.filter((r) => r.event === 'wake-suspended-after-send-failures').length, 1);
assert.equal(stateFor(key).wakeSuspendedUntil, t + 30 * 60 * 1000);
assert.equal(health.lastSendError, 'timeout');

// 3) 守卫/审计类拒绝不算通道故障
const before = stateFor(key).sendFailureStreak;
guard.noteSendFailure(key, new Error('该会话不在白名单里'));
assert.equal(stateFor(key).sendFailureStreak, before);

// 4) 成功清零 + 决策补「回了」
guard.noteSendSuccess(key, '她回了');
assert.equal(stateFor(key).sendFailureStreak, 0);
assert.equal(stateFor(key).wakeSuspendedUntil, 0);
assert.equal(health.lastSendOkAt, t);
assert.equal(health.lastSendError, '');
assert.deepEqual(decisions.at(-1), { key, replied: true, outbound: 1, reply: '她回了' });
assert.ok(schedules.includes(key));

// 5) 通道状态：未连接 / 最近失败（2 分钟窗）/ 恢复
assert.equal(guard.qqSendChannelStatus().code, 'SNOWLUMA_OFFLINE');
health.connected = true;
health.lastSendFailAt = t;
health.lastSendOkAt = t - 1000;
assert.equal(guard.qqSendChannelStatus().code, 'SEND_RECENTLY_FAILED');
t += 3 * 60 * 1000;
assert.equal(guard.qqSendChannelStatus().ok, true);

// 6) 断线告警边沿：只报一次，恢复时报一次并清状态
guard.notifySendChannelDown('ws closed');
assert.equal(health.downNotified, true);
assert.equal(records.filter((r) => r.event === 'send-channel-down').length, 1);
guard.notifySendChannelDown('ws closed again');
assert.equal(records.filter((r) => r.event === 'send-channel-down').length, 1);

stateFor('group:1').sendFailureStreak = 2;
stateFor('group:1').wakeSuspendedUntil = t + 1000;
guard.notifySendChannelUp();
assert.equal(health.downNotified, false);
assert.equal(records.filter((r) => r.event === 'send-channel-restored').length, 1);
assert.ok(acks.includes('snowluma:send-channel-down'));
assert.equal(stateFor('group:1').sendFailureStreak, 0);
assert.deepEqual(schedules.sort(), ['group:1', 'group:1', 'private:2']);

// 7) 从未连接过：只记日志，不弹断线告警
health.everConnected = false;
health.downNotified = false;
const downBefore = records.filter((r) => r.event === 'send-channel-down').length;
guard.notifySendChannelDown('not started');
assert.equal(records.filter((r) => r.event === 'send-channel-down').length, downBefore);

console.log('R6_SENDGUARD_OK records=%d saves=%d', records.length, saves);
