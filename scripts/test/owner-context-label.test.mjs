// 提示词署名：主人的消息写成「他」
import assert from 'node:assert/strict';
import path from 'node:path';

const { contextLines } = await import(`file://${path.resolve('src/lib/text.js')}?t=${Date.now()}`);
// const { contextLines } = await import(`file://${path.resolve('src/lib/text.js')}?t=${Date.now()}`);
const block = contextLines([
  { sender: '夏生', text: '嗯？你何时开机的', isOwner: true },
  { sender: '小雪人', text: '你在旁边盯着人家发呆吗', isOwner: false },
]);
assert.ok(block.includes('他：嗯？你何时开机的'), '主人消息应署名为「他」');
assert.ok(block.includes('小雪人：你在旁边盯着人家发呆吗'), '普通成员保持昵称');
assert.ok(!block.includes('夏生：'), '不应出现主人的昵称署名');


console.log('OWNER_CONTEXT_LABEL_OK');
