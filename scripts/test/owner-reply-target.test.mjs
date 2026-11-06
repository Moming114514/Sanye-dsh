// 回谁：主人优先 + 未回答问句
import assert from 'node:assert/strict';
import path from 'node:path';

const now = Date.now();
const mk = (o) => ({ sender: 'u', time: now, isSelf: false, plain: '在吗？', ...o });
const { decideReplyTarget } = await import(`file://${path.resolve('src/ext/reply-target.js')}?t=${Date.now()}`);
// ---------- 2) reply-target：owner 优先 + 未回答问句 ----------

const ownerWin = decideReplyTarget({
  key: 'group:1', now,
  last: mk({ sender: '1962605653', plain: '你在旁边盯着人家发呆吗？' }),
  recent: [
    mk({ sender: '3160624852', isOwner: true, plain: '嗯？你何时开机的', time: now - 60_000 }),
    mk({ sender: '1962605653', plain: '你在旁边盯着人家发呆吗？' }),
  ],
  reason: 'question',
});
assert.equal(ownerWin.rule, 'owner', '5 分钟内主人说过话 → 先回主人');
assert.equal(ownerWin.target, '3160624852');

const staleQuestion = decideReplyTarget({
  key: 'group:1', now,
  last: mk({ sender: 'A', plain: '随便说说' }),
  recent: [
    mk({ sender: 'B', plain: '那个是怎么回事呢？', time: now - 20 * 60_000 }),
    mk({ sender: 'A', plain: '随便说说', time: now - 1000 }),
  ],
});
assert.equal(staleQuestion.rule, 'question', '旧问句（10 条内）应被采用');
assert.equal(staleQuestion.target, 'B');

const answered = decideReplyTarget({
  key: 'group:1', now,
  last: mk({ sender: 'A', plain: '随便聊聊' }),
  recent: [
    mk({ sender: 'B', plain: '这个怎么做？', time: now - 60_000 }),
    mk({ sender: 'self', isSelf: true, plain: '这样这样', time: now - 30_000 }),
    mk({ sender: 'A', plain: '随便聊聊', time: now - 1000 }),
  ],
  reason: 'question',
});
assert.notEqual(answered.rule, 'question', '已被回答的问句应跳过');
assert.equal(answered.rule, 'sample');

const noCand = decideReplyTarget({
  key: 'group:1', now,
  last: mk({ sender: 'A', plain: '嗯' }),
  recent: [mk({ sender: 'A', plain: '嗯' })],
  policy: { allow: true },
});
assert.equal(noCand.rule, 'sample', '无候选时落 sample');


console.log('OWNER_REPLY_TARGET_OK');
