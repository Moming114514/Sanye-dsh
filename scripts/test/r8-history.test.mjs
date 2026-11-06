import {
  normalizeHistoryConfig,
  selectMissedHistory,
  summarizeHistoryCatchup,
  historyWatermark,
} from '../../src/history-catchup.js';
import { createHistoryBackfill } from '../../src/lib/history.js';

const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };
const conv = new Map();
for (const key of ['group:111', 'group:222', 'group:333', 'private:444', 'private:555']) {
  conv.set(key, { bootstrapSent: true });
}
const states = new Map();
const getSocialV2State = (key) => {
  if (!states.has(key)) states.set(key, { recentMessages: [], unread: [], lastUnreadSeq: 0 });
  return states.get(key);
};
const wakes = [];
const msgs = {
  'get_group_msg_history:111': [
    { message_id: 'm1', time: Math.floor(Date.now() / 1000) - 120, sender: { user_id: 999, nickname: '我' }, message: [{ type: 'text', data: { text: '我自己' } }] },
    { message_id: 'm2', time: Math.floor(Date.now() / 1000) - 110, sender: { user_id: 1001, nickname: '小明' }, message: [{ type: 'text', data: { text: '群里好' } }] },
  ],
  'get_group_msg_history:222': [
    { message_id: 'm3', time: Math.floor(Date.now() / 1000) - 100, sender: { user_id: 1002, nickname: '小红' }, message: [{ type: 'text', data: { text: '222' } }] },
  ],
  'get_group_msg_history:333': [
    { message_id: 'm4', time: Math.floor(Date.now() / 1000) - 90, sender: { user_id: 1003, nickname: '静音群' }, message: [{ type: 'text', data: { text: '不该补' } }] },
  ],
  'get_friend_msg_history:444': [
    { message_id: 'm5', time: Math.floor(Date.now() / 1000) - 80, sender: { user_id: 1004, nickname: '私聊A' }, message: [{ type: 'text', data: { text: '在吗' } }] },
  ],
  'get_friend_msg_history:555': [
    { message_id: 'm6', time: Math.floor(Date.now() / 1000) - 70, sender: { user_id: 1005, nickname: '私聊B' }, message: [{ type: 'text', data: { text: '你好' } }] },
  ],
};

const cfg = {
  snowluma: { httpUrl: 'http://127.0.0.1:3000' },
  ownerQQ: '999',
  deny: { users: [] },
  fishGuard: {},
  socialV2: {
    history: { ...normalizeHistoryConfig({}), wake: true },
    context: { recentLimit: 100, unreadLimit: 30 },
  },
};

const backfill = createHistoryBackfill({
  cfg,
  log: () => {},
  getConversations: () => conv,
  getSocialV2State,
  saveSocialV2State: () => {},
  isSessionAllowedInCurrentMode: (key) => key !== 'group:333',
  getSelfUserId: () => '999',
  getCurrentMode: () => 'reserved2',
  scheduleWakeV2: (key, reason) => wakes.push([key, reason]),
  ownerMessageTag: () => '管理员',
  segmentsToText: async (segs) => (Array.isArray(segs) ? segs : []).map((s) => s?.data?.text ?? '').join(''),
  extractMediaFromSegments: () => [],
  extractForwardIds: () => [],
  truncateText: (s) => String(s ?? ''),
  truncateTextTail: (s) => String(s ?? ''),
  isFishName: () => false,
  selectMissedHistory,
  summarizeHistoryCatchup,
  historyWatermark,
  normalizeHistoryConfig,
  fetchImpl: async (url, opts) => {
    const action = String(url).split('/').pop();
    const params = JSON.parse(opts.body);
    const id = String(params.group_id ?? params.user_id ?? '');
    const list = msgs[action + ':' + id] ?? [];
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { messages: list } }) };
  },
});

// 1) 过滤：静音/不允许的群不补；私聊全部补；完成会话计数
const r1 = await backfill.runHistoryCatchUp('online');
assert(r1.ok === true, 'run ok');
assert(r1.targets === 4, 'targets=4 got ' + r1.targets);
assert(getSocialV2State('group:333').unread.length === 0, 'muted group skipped');
assert(getSocialV2State('group:111').unread.length === 1, 'group incoming merged');
assert(getSocialV2State('group:111').unread[0].history === true, 'history flag');
assert(getSocialV2State('group:111').recentMessages.length === 2, 'self message kept in recent only');
assert(getSocialV2State('private:444').unread.length === 1 && getSocialV2State('private:555').unread.length === 1, 'privates merged');

// 2) 补唤醒：有 incoming 的会话各一次，静音群没有
const wokeKeys = wakes.map((x) => x[0]).sort();
assert(JSON.stringify(wokeKeys) === JSON.stringify(['group:111', 'group:222', 'private:444', 'private:555']), 'wake set ' + wokeKeys.join(','));

// 3) 节流：10 秒内第二次直接 throttled
const r2 = await backfill.runHistoryCatchUp('online');
assert(r2.throttled === true, 'throttled');

// 4) force 重跑：重复消息只补一次
const before = ['group:111', 'private:444'].map((k) => getSocialV2State(k).unread.length);
await backfill.runHistoryCatchUp('manual', { force: true });
const after = ['group:111', 'private:444'].map((k) => getSocialV2State(k).unread.length);
assert(JSON.stringify(before) === JSON.stringify(after), 'dedupe by messageId');

// 5) 空历史不报错
conv.set('private:666', { bootstrapSent: true });
const r5 = await backfill.runHistoryCatchUp('manual', { force: true });
assert(r5.ok === true && getSocialV2State('private:666').unread.length === 0, 'empty history ok');

console.log('R8_HISTORY_OK');
