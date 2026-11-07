import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermGuard, installToolGuard, RED_TOOLS } from '../../src/lib/tool-guard.js';

const OWNER = '3160624852';
const guard = (key, ownerQQ = OWNER, log = () => {}) => createPermGuard({ resolveKey: async () => key, ownerQQ });

const RED5 = ['qq_memory_clear', 'qq_set_profile', 'qq_set_avatar', 'qq_delete_qzone_msg', 'qq_handle_friend_request'];
const SEND = ['qq_send_message', 'qq_reply', 'qq_send_group_message', 'qq_send_private_message', 'qq_send_burst', 'qq_send_poke', 'qq_send_sticker', 'qq_send_qzone_msg', 'qq_qzone_comment'];

test('红名单正好 5 个（发送类不算红）', () => {
  assert.deepEqual([...RED_TOOLS].sort(), [...RED5].sort());
});

test('5 个红工具在群里 → forbidden', async () => {
  const g = guard('group:1025377431');
  for (const tool of RED5) {
    const r = await g(tool, { token: 't', key: 'group:1025377431' });
    assert.ok(r && r.isError, tool);
    assert.deepEqual(JSON.parse(r.content[0].text), { ok: false, error: 'forbidden', detail: '该工具仅主人私聊可用', tool });
  }
});

test('红工具在主人私聊 → 放行；别人私聊/无 token → 拒绝', async () => {
  const ok = guard(`private:${OWNER}`);
  for (const tool of RED5) assert.equal(await ok(tool, { token: 't' }), null, tool);
  const other = guard('private:999999');
  assert.ok(await other('qq_set_profile', { token: 't' }));
  const noTok = guard('');
  assert.ok(await noTok('qq_memory_clear', {}));
});

test('发送类在任何会话都放行（由 tokenGuard 频率管，不由红级管）', async () => {
  const g = guard('group:1025377431');
  for (const tool of SEND) assert.equal(await g(tool, { token: 't', key: 'group:1025377431' }), null, tool);
});

test('黄 / 绿工具不受影响', async () => {
  const g = guard('group:1');
  assert.equal(await g('qq_mark_read', { token: 't' }), null);
  assert.equal(await g('qq_set_wake_config', { token: 't' }), null);
  assert.equal(await g('qq_status', {}), null);
});

test('installToolGuard：红工具在 handler 前拦截，发送类照常进 handler', async () => {
  let called = 0;
  const handlers = new Map([['tools/call', async () => { called += 1; return { content: [{ type: 'text', text: '{}' }] }; }]]);
  const server = { server: { _requestHandlers: handlers } };
  assert.equal(installToolGuard(server, { perm: guard('group:1') }).installed, true);
  const denied = await handlers.get('tools/call')({ params: { name: 'qq_set_avatar', arguments: { token: 't' } } });
  assert.equal(called, 0);
  assert.equal(JSON.parse(denied.content[0].text).tool, 'qq_set_avatar');
  const passed = await handlers.get('tools/call')({ params: { name: 'qq_send_message', arguments: { token: 't', key: 'group:1' } } });
  assert.equal(called, 1);
  assert.equal(passed.isError, undefined);
});
