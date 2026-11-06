import assert from 'node:assert/strict';
import { decideReplyTarget } from '../../src/ext/reply-target.js';

const now = 1_800_000_000_000;
const m = (o) => ({ sender: '1001', text: '', time: now - 1000, ...o });

const cases = [];

// 1) 私聊：永远回对方
{
  const r = decideReplyTarget({ key: 'private:1001', last: m({ sender: '1001', text: '在吗' }), now });
  assert.equal(r.rule, 'private');
  assert.equal(r.target, '1001');
  cases.push('private');
}

// 2) 群里被 @
{
  const r = decideReplyTarget({
    key: 'group:680787260',
    last: m({ sender: '1001', text: '三叶 你看这个' }),
    reason: 'atMention',
    now,
  });
  assert.equal(r.rule, 'at');
  assert.equal(r.target, '1001');
  cases.push('at');
}

// 3) 叫名字
{
  const r = decideReplyTarget({ key: 'group:1', last: m({ sender: '2002', text: '叶子你来说说' }), now });
  assert.equal(r.rule, 'name');
  assert.equal(r.target, '2002');
  cases.push('name');
}

// 4) 引用我的消息
{
  const r = decideReplyTarget({
    key: 'group:1',
    last: m({ sender: '3003', text: '那这个呢', quoteTargetIsSelf: true }),
    now,
  });
  assert.equal(r.rule, 'quote');
  assert.equal(r.target, '3003');
  cases.push('quote');
}

// 5) 问句且 30 秒内没人接
{
  const r = decideReplyTarget({ key: 'group:1', last: m({ sender: '4004', text: '有人知道怎么弄吗？' }), now });
  assert.equal(r.rule, 'question');
  assert.equal(r.target, '4004');
  cases.push('question');
}

// 5b) 问句后只有别人接话 → 仍算未回答（新规则只认她自己的回复）
{
  const q = m({ sender: '4004', text: '有人知道怎么弄吗？', time: now - 6000 });
  const a = m({ sender: '5005', text: '我知道', time: now - 3000 });
  const r = decideReplyTarget({ key: 'group:1', last: q, recent: [q, a], now, policy: { allow: true } });
  assert.equal(r.rule, 'question');
  cases.push('question-others-replied');
}

// 6) 抽样/普通放行
{
  const r = decideReplyTarget({ key: 'group:1', last: m({ sender: '6006', text: '今天吃什么' }), now, policy: { allow: true } });
  assert.equal(r.rule, 'sample');
  assert.equal(r.target, '6006');
  cases.push('sample');
}

// 7) 多人抢话：回最后一条，候选去重
{
  const a = m({ sender: '7007', text: 'A', time: now - 3000 });
  const b = m({ sender: '8008', text: 'B', time: now - 2000 });
  const c = m({ sender: '9009', text: 'C', time: now - 1000 });
  const r = decideReplyTarget({ key: 'group:1', last: c, recent: [a, b, c], now, policy: { allow: true } });
  assert.equal(r.rule, 'sample');
  assert.deepEqual(r.candidates, ['7007', '8008', '9009']);
  cases.push('multi');
}

// 8) 空文本 + 不放行 → none
{
  const r = decideReplyTarget({ key: 'group:1', last: m({ sender: '1001', text: '' }), now, policy: { allow: false } });
  assert.equal(r.rule, 'none');
  assert.equal(r.target, null);
  cases.push('none');
}

// 8b) 没有 last → none
{
  const r = decideReplyTarget({ key: 'group:1', last: null, now, policy: { allow: true } });
  assert.equal(r.rule, 'none');
  cases.push('no-last');
}

console.log('G2_REPLY_TARGET_OK', JSON.stringify(cases));
