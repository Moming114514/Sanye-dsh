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
const ok = { isError: undefined, content: [{ type: 'text', text: 'ok' }] };
const bad = { isError: true, content: [{ type: 'text', text: 'boom' }] };
const file = path.join(dir, 'tool-calls.json');

function make({ limits, now } = {}) {
  const cfg = { socialV2: { toolLimits: limits || {} } };
  return createToolLimiter({ stateDir: dir, getCfg: () => cfg, log, now: now || (() => Date.now()) });
}
function counted(limiter, name, result = ok) {
  const denied = limiter(name, {});
  if (denied) return denied;
  limiter.after(name, {}, result);
  return null;
}

// 1) 成功才计数：limit 2，第三次被拒
{
  fs.rmSync(file, { force: true });
  const limiter = make({ limits: { qq_send_poke: 2 } });
  assert.equal(counted(limiter, 'qq_send_poke'), null);
  assert.equal(counted(limiter, 'qq_send_poke'), null);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).counts.qq_send_poke, 2);
  const third = limiter('qq_send_poke', {});
  assert.ok(third && third.isError, '第三次数应被拒');
  const body = JSON.parse(third.content[0].text);
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.detail, '今日已达上限 2 次');
  assert.ok(logs.some((l) => l.includes('[权限] 限额 qq_send_poke 2/2')), '应有限额日志');
}

// 2) 失败不计数
{
  fs.rmSync(file, { force: true });
  const limiter = make({ limits: { qq_send_poke: 1 } });
  for (let i = 0; i < 5; i += 1) assert.equal(counted(limiter, 'qq_send_poke', bad), null, '失败不应被拒');
  const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { counts: {} };
  assert.equal(Number(st.counts.qq_send_poke || 0), 0, '失败不应计数');
}

// 3) 跨天清零（东八区）
{
  fs.writeFileSync(file, JSON.stringify({ day: '2000-01-01', counts: { qq_send_poke: 99 } }));
  const now = new Date('2026-01-02T00:30:00+08:00').getTime();
  const limiter = make({ limits: { qq_send_poke: 2 }, now: () => now });
  assert.equal(counted(limiter, 'qq_send_poke'), null, '跨天应放行');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(st.day, '2026-01-02');
  assert.equal(st.counts.qq_send_poke, 1, '跨天后从 1 计数');
}

// 4) 红级不叠加限额
{
  const red = [...RED_TOOLS][0];
  const limiter = make({ limits: { [red]: 1 } });
  assert.equal(counted(limiter, red), null);
  assert.equal(counted(limiter, red), null);
}

// 5) 发送类不限额、不计数
{
  fs.rmSync(file, { force: true });
  const limiter = make();
  for (let i = 0; i < 150; i += 1) assert.equal(counted(limiter, 'qq_send_message'), null);
  const exists = fs.existsSync(file);
  if (exists) {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(!st.counts || !st.counts.qq_send_message, '发送类不应计数');
  }
}

// 6) 黄级默认 100 + installToolGuard 集成（先判后执行、成功后计数）
{
  const yellow = 'qq_collect_sticker';
  assert.ok(YELLOW_TOOLS.has(yellow));
  const cfg = { socialV2: { toolLimits: {} } };
  const now = new Date('2026-01-03T10:00:00+08:00').getTime();
  const limiter = createToolLimiter({ stateDir: dir, getCfg: () => cfg, log, now: () => now });

  const order = [];
  const fake = {
    server: {
      _requestHandlers: new Map([['tools/call', async () => { order.push('handler'); return ok; }]]),
    },
  };
  installToolGuard(fake, { log, limit: limiter });
  const call = (name) => fake.server._requestHandlers.get('tools/call')({ params: { name, arguments: {} } }, {});
  for (let i = 0; i < 100; i += 1) assert.equal((await call(yellow)).isError, undefined);
  const over = await call(yellow);
  assert.ok(over && over.isError, '第 101 次应被拒');
  const st = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(st.counts[yellow], 100, '应恰好计数 100 次');
  assert.ok(order.includes('handler'));
}

console.log('B_TOOL_LIMITS_OK');
