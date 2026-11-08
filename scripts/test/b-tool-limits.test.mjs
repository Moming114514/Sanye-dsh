import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  createToolLimiter, installToolGuard, RED_TOOLS, YELLOW_TOOLS,
} from '../../src/lib/tool-guard.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b-tool-limits-'));
const logs = [];
const log = (line) => logs.push(String(line));

function make({ limits, now }) {
  const cfg = { socialV2: { toolLimits: limits || {} } };
  return createToolLimiter({ stateDir: dir, getCfg: () => cfg, log, now: now || (() => Date.now()) });
}

// 1) 第 N+1 次被拒
{
  const file = path.join(dir, 'tool-calls.json');
  fs.rmSync(file, { force: true });
  const limiter = make({ limits: { qq_send_poke: 2 } });
  assert.equal(limiter('qq_send_poke', {}), null);
  assert.equal(limiter('qq_send_poke', {}), null);
  const third = limiter('qq_send_poke', {});
  assert.ok(third && third.isError, '第三次数应被拒');
  const body = JSON.parse(third.content[0].text);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.detail, '今日已达上限 2 次');
  assert.equal(body.tool, 'qq_send_poke');
  assert.ok(logs.some((l) => l.includes('[权限] 限额 qq_send_poke 2/2')), '应有限额日志');
}

// 2) 跨天清零（东八区）
{
  const file = path.join(dir, 'tool-calls.json');
  fs.writeFileSync(file, JSON.stringify({ day: '2000-01-01', counts: { qq_send_poke: 99 } }));
  const now = new Date('2026-01-02T00:30:00+08:00').getTime();
  const limiter = make({ limits: { qq_send_poke: 2 }, now: () => now });
  assert.equal(limiter('qq_send_poke', {}), null, '跨天应放行');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(st.day, '2026-01-02');
  assert.equal(st.counts.qq_send_poke, 1, '跨天后重新从 1 计数');
}

// 3) 红级不叠加限额（由 perm 守卫处理）
{
  const red = [...RED_TOOLS][0];
  const limiter = make({ limits: { [red]: 1 } });
  assert.equal(limiter(red, {}), null);
  assert.equal(limiter(red, {}), null);
}

// 4) 发送类不限额
{
  const limiter = make({ limits: {} });
  for (let i = 0; i < 150; i += 1) assert.equal(limiter('qq_send_message', {}), null);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'tool-calls.json'), 'utf8'));
  assert.ok(!st.counts || !st.counts.qq_send_message, '发送类不应计数');
}

// 5) 黄级默认 100 + installToolGuard 顺序（perm 先于 limit）
{
  const yellow = 'qq_collect_sticker';
  assert.ok(YELLOW_TOOLS.has(yellow));
  const cfg = { socialV2: { toolLimits: {} } };
  let now = new Date('2026-01-03T10:00:00+08:00').getTime();
  const limiter = createToolLimiter({ stateDir: dir, getCfg: () => cfg, log, now: () => now });
  for (let i = 0; i < 100; i += 1) assert.equal(limiter(yellow, {}), null);
  assert.ok(limiter(yellow, {}), '第 101 次应被拒');

  const order = [];
  const fake = {
    server: {
      _requestHandlers: new Map([['tools/call', async () => { order.push('handler'); return { content: [{ type: 'text', text: 'ok' }] }; }]]),
    },
  };
  const perm = async (name) => { order.push('perm:' + name); return name === 'qq_memory_clear' ? { isError: true, content: [{ type: 'text', text: '{"ok":false,"error":"forbidden"}' }] } : null; };
  let n = 0;
  const limit = (name) => { order.push('limit:' + name); return name === 'qq_set_poke_limit_blocked' ? { isError: true, content: [{ type: 'text', text: '{"ok":false,"error":"rate_limited"}' }] } : null; };
  installToolGuard(fake, { log, perm, limit });
  const call = (name) => fake.server._requestHandlers.get('tools/call')({ params: { name, arguments: {} } }, {});
  assert.ok((await call('qq_memory_clear')).isError, '红级被 perm 拒');
  assert.deepEqual(order.slice(-1), ['perm:qq_memory_clear'], 'perm 拒绝后不再走 limit/handler');
  n += 1;
  assert.ok((await call('qq_set_poke_limit_blocked')).isError, '限额被拦');
  assert.deepEqual(order.slice(-2), ['perm:qq_set_poke_limit_blocked', 'limit:qq_set_poke_limit_blocked']);
  n += 1;
  const ok = await call('qq_send_message');
  assert.equal(ok.isError, undefined);
  assert.deepEqual(order.slice(-3), ['perm:qq_send_message', 'limit:qq_send_message', 'handler']);
  void n;
}

console.log('B_TOOL_LIMITS_OK');
