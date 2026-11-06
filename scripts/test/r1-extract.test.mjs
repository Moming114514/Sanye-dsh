// R1 回归：抽到 src/lib/ 的纯函数行为不变，且带图唤醒的提示词仍含 [图片] 与看图硬规则。
import assert from 'node:assert/strict';
import { bridgeHarness } from '../audit-bridge-harness.mjs';

const h = await bridgeHarness({
  config: { socialV2: { mode: 'reserved2', styleLearn: { enabled: false }, tokenGuard: { enabled: false } } },
  files: { 'state/mode.json': { mode: 'reserved2' } },
});

// 1) segmentsToText：图片 / 表情包 / 动图 / 文本 的占位文本不变
assert.equal(
  await h.segmentsToText([
    { type: 'image', data: { file: 'a.jpg' } },
    { type: 'image', data: { sub_type: '1' } },
    { type: 'image', data: { file: 'x.gif' } },
    { type: 'text', data: { text: ' 你好 ' } },
  ]),
  '[图片][表情包][动图] 你好'
);
assert.equal(await h.segmentsToText('纯字符串'), '纯字符串');

// 2) extractMediaFromSegments：emoji 字段仍保留、摘要仍清洗
const media = h.extractMediaFromSegments([
  { type: 'mface', data: { summary: '糖\n果', emoji_id: '100', url: 'https://x/y' } },
]);
assert.equal(media[0].kind, 'sticker');
assert.equal(media[0].emojiId, '100');
assert.equal(media[0].summary, '糖 果');

// 3) 提示词级实测：带图未读 → 提示词同时含 [图片] 与看图硬规则
h.setMode('reserved2');
const st = h.getSocialV2State('group:456');
assert.ok(st, 'socialV2 state');
const txt = await h.segmentsToText([{ type: 'image', data: { file: 'b.jpg' } }]);
st.unread.push({
  messageId: 'm1', seq: 1, senderId: '123', senderName: 'A',
  text: txt, media: [{ kind: 'image', file: 'b.jpg', url: '' }], at: Date.now(),
});
const prompt = h.buildWakePromptV2('group:456', 'wake') || '';
// 现行提示词不内联未读正文（模型通过工具读消息），所以 [图片] 在消息文本层验证：
assert.equal(st.unread.at(-1).text, '[图片]', '未读文本应保留 [图片] 占位');
assert.ok(prompt.includes('看图硬规则'), 'prompt 缺少看图硬规则');
assert.ok(prompt.includes('条带图片/表情'), 'prompt 缺少媒体计数行');

console.log('R1_OK');
