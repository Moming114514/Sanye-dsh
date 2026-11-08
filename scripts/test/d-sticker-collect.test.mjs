import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createStickerCollectGuard, installToolGuard } from '../../src/lib/tool-guard.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd-sticker-'));
const logs = [];
const log = (l) => logs.push(String(l));
let now = new Date('2026-01-05T10:00:00+08:00').getTime();
let key = 'group:1';
const guard = createStickerCollectGuard({ stateDir: dir, resolveKey: async () => key, now: () => now, log });

const okCall = { isError: undefined, content: [{ type: 'text', text: 'ok' }] };

// 1) 每会话每天 2 个：前两次放行、第三次拒绝
{
  assert.equal(await guard('qq_collect_sticker', { token: 't', id: 'a' }), null);
  await guard.after('qq_collect_sticker', { token: 't', id: 'a' }, okCall);
  assert.equal(await guard('qq_collect_sticker', { token: 't', id: 'b' }), null);
  await guard.after('qq_collect_sticker', { token: 't', id: 'b' }, okCall);
  const third = await guard('qq_collect_sticker', { token: 't', id: 'c' });
  assert.ok(third && third.isError, '第三次应被拒');
  const body = JSON.parse(third.content[0].text);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'rate_limited');
  assert.ok(logs.some((l) => l.includes('[收藏] 主动收 a（今日 1/10）')), '应有收藏日志');
  assert.ok(logs.some((l) => l.includes('[收藏] 拒绝')), '应有拒绝日志');
}

// 2) 失败调用不吃额度
{
  const g = createStickerCollectGuard({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'd-sticker2-')), resolveKey: async () => 'group:9', now: () => now, log });
  assert.equal(await g('qq_collect_sticker', { id: 'x' }), null);
  await g.after('qq_collect_sticker', { id: 'x' }, { isError: true, content: [{ type: 'text', text: 'boom' }] });
  assert.equal(await g('qq_collect_sticker', { id: 'y' }), null, '失败不应占额度');
}

// 3) 全局每天 10 个
{
  const g = createStickerCollectGuard({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'd-sticker3-')), resolveKey: async () => 'group:' + Math.random(), now: () => now, log });
  for (let i = 0; i < 10; i += 1) {
    assert.equal(await g('qq_collect_sticker', { id: 'g' + i }), null);
    await g.after('qq_collect_sticker', { id: 'g' + i }, okCall);
  }
  const over = await g('qq_collect_sticker', { id: 'g10' });
  assert.ok(over && over.isError, '第 11 次应被拒');
  assert.match(JSON.parse(over.content[0].text).detail, /全局/);
}

// 4) 跨天清零
{
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'd-sticker4-'));
  fs.writeFileSync(path.join(dir4, 'sticker-collect.json'), JSON.stringify({ day: '2000-01-01', global: 10, sessions: { 'group:1': 2 } }));
  const g = createStickerCollectGuard({ stateDir: dir4, resolveKey: async () => 'group:1', now: () => now, log });
  assert.equal(await g('qq_collect_sticker', { id: 'z' }), null, '跨天应放行');
}

// 5) installToolGuard 顺序：sticker 在 handler 前，成功后 after 计数
{
  const order = [];
  const dir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'd-sticker5-'));
  const g = createStickerCollectGuard({ stateDir: dir5, resolveKey: async () => 'group:5', now: () => now, log });
  const fake = { server: { _requestHandlers: new Map([['tools/call', async () => { order.push('handler'); return okCall; }]]) } };
  installToolGuard(fake, { log, sticker: g });
  const call = (name) => fake.server._requestHandlers.get('tools/call')({ params: { name, arguments: { token: 't', id: 'id1' } } }, {});
  const r = await call('qq_collect_sticker');
  assert.equal(r.isError, undefined);
  assert.deepEqual(order, ['handler']);
  const st = JSON.parse(fs.readFileSync(path.join(dir5, 'sticker-collect.json'), 'utf8'));
  assert.equal(st.global, 1);
  assert.equal(st.sessions['group:5'], 1);
}

// 6) 提示词里有引导（静态检查：两处唤醒路径都追加）
{
  const bridge = fs.readFileSync(new URL('../../src/bridge.js', import.meta.url), 'utf8');
  const needle = '看到好笑或贴合的表情包（[表情包] 标记）';
  assert.equal(bridge.split(needle).length - 1, 2, '应有两处追加');
  assert.ok(bridge.includes('同一个群/人每天最多收 2 个，别乱收。'));
}

console.log('D_STICKER_COLLECT_OK');
