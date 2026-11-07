import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermGuard, installToolGuard } from '../../src/lib/tool-guard.js';

const OWNER = '3160624852';
const guard = (key, ownerQQ = OWNER, log = () => {}) => createPermGuard({ resolveKey: async () => key, ownerQQ, log });

test('红工具在群里 → forbidden', async () => {
  const g = guard('group:1025377431');
  const r = await g('qq_send_message', { token: 't', key: 'group:1025377431' });
  assert.ok(r && r.isError);
  assert.deepEqual(JSON.parse(r.content[0].text), {
    ok: false, error: 'forbidden', detail: '该工具仅主人私聊可用', tool: 'qq_send_message',
  });
});

test('红工具在主人私聊 → 放行', async () => {
  const g = guard(`private:${OWNER}`);
  assert.equal(await g('qq_send_message', { token: 't' }), null);
  assert.equal(await g('qq_memory_clear', { token: 't' }), null);
});

test('红工具在别人私聊 → 拒绝', async () => {
  const g = guard('private:999999');
  assert.ok(await g('qq_set_profile', { token: 't' }));
});

test('红工具无 token / token 无效 → 拒绝', async () => {
  const noTok = await guard('').call(null, 'qq_send_poke', {});
  assert.ok(noTok && noTok.isError);
  const bad = await createPermGuard({ resolveKey: async () => { throw new Error('x'); }, ownerQQ: OWNER })( 'qq_send_poke', { token: 't' });
  assert.ok(bad && bad.isError);
});

test('黄 / 绿工具不受影响', async () => {
  const g = guard('group:1');
  assert.equal(await g('qq_mark_read', { token: 't' }), null);
  assert.equal(await g('qq_status', {}), null);
});

test('installToolGuard 在 handler 执行前拦截', async () => {
  let called = 0;
  const handlers = new Map([['tools/call', async () => { called += 1; return { content: [] }; }]]);
  const server = { server: { _requestHandlers: handlers } };
  const r = installToolGuard(server, { perm: guard('group:1') });
  assert.equal(r.installed, true);
  const out = await handlers.get('tools/call')({ params: { name: 'qq_send_sticker', arguments: { token: 't' } } });
  assert.equal(called, 0, 'handler 不应被执行');
  assert.equal(JSON.parse(out.content[0].text).tool, 'qq_send_sticker');
});
