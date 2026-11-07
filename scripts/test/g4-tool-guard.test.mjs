// G4：工具调用入口守卫——参数校验转译 + 可重试错误重试
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  withRetry, isRetryableError, describeInvalid, schemaHint, installToolGuard, buildToolSchema,
} from '../../src/lib/tool-guard.js';

const sleep = () => Promise.resolve();
const logs = [];
const log = (m) => logs.push(m);

// 1) 缺必填 → 结构化错误 + missing 列表
const schema = z.object({ key: z.string(), messageId: z.string().optional() });
const miss = describeInvalid(schema, { messageId: 'm1' });
assert.ok(miss, '应判为无效');
assert.deepEqual(miss.missing, ['key']);
assert.match(miss.detail, /missing: key/);
assert.match(miss.hint, /key: string/);
assert.match(miss.hint, /messageId: string\?/);

// 2) 类型错 → invalid 列表
const bad = describeInvalid(schema, { key: 123 });
assert.ok(bad);
assert.equal(bad.missing.length, 0);
assert.match(bad.detail, /invalid: key/);

// 3) 正常参数零开销：不抛、不产生日志
const okFn = async () => 'ok';
let calls = 0;
const wrappedOk = await withRetry(async () => { calls += 1; return okFn(); }, { name: 'ok', log, sleep });
assert.equal(wrappedOk, 'ok');
assert.equal(calls, 1);
assert.equal(logs.length, 0);

// 4) 超时重试后成功：第 1 次 ETIMEDOUT，第 2 次成功
let n = 0;
const result = await withRetry(async () => {
  n += 1;
  if (n === 1) { const e = new Error('timed out'); e.code = 'ETIMEDOUT'; throw e; }
  return 'recovered';
}, { name: 'qq_x', log, sleep, delays: [300, 800] });
assert.equal(result, 'recovered');
assert.equal(n, 2);
assert.equal(logs.length, 1);
assert.match(logs[0], /\[tool\] 重试第 1 次 qq_x timed out/);

// 5) 非可重试错误不重试：权限错只调用一次
let m = 0;
await assert.rejects(async () => withRetry(async () => {
  m += 1;
  throw new Error('权限错：不在白名单');
}, { name: 'qq_y', log, sleep }), /权限错/);
assert.equal(m, 1, '不可重试错误不应重试');

// 6) 最多 2 次重试（共 3 次尝试）后抛出
let k = 0;
await assert.rejects(async () => withRetry(async () => {
  k += 1;
  const e = new Error('HTTP 503'); e.status = 503; throw e;
}, { name: 'qq_z', log, sleep }), /503/);
assert.equal(k, 3, '应共尝试 3 次');
assert.equal(logs.filter((x) => x.includes('qq_z')).length, 2);

assert.equal(isRetryableError(new Error('HTTP 500')), true);
assert.equal(isRetryableError(new Error('权限错')), false);

// 7) installToolGuard：SDK 抛 -32602 时翻译成结构化结果，并留日志
const handlers = new Map();
handlers.set('tools/call', async () => { const e = new Error('Input validation error: Invalid arguments for tool qq_demo: key Required'); e.code = -32602; throw e; });
const fakeServer = { server: { _requestHandlers: handlers } };
const guard = installToolGuard(fakeServer, { log });
assert.equal(guard.installed, true);
guard.schemas.set('qq_demo', buildToolSchema({ key: z.string() }));
const res = await handlers.get('tools/call')({ params: { name: 'qq_demo', arguments: {} } }, {});
assert.equal(res.isError, true);
const payload = JSON.parse(res.content[0].text);
assert.equal(payload.ok, false);
assert.equal(payload.error, 'invalid_arguments');
assert.match(payload.detail, /missing: key/);
assert.match(payload.schema_hint, /key: string/);
assert.ok(logs.some((x) => x.includes('参数无效 qq_demo missing=key')));

// 7b) SDK 1.30 风格：校验错误被包成 isError 结果（不是抛异常）
handlers.set('tools/call', async () => ({
  content: [{ type: 'text', text: 'MCP error -32602: Input validation error: Invalid arguments for tool qq_demo: Invalid input: expected string, received undefined at key' }],
  isError: true,
}));
const guard1b = installToolGuard(fakeServer, { log });
assert.equal(guard1b.installed, true);
guard1b.schemas.set('qq_demo', buildToolSchema({ key: z.string() }));
const res1b = await handlers.get('tools/call')({ params: { name: 'qq_demo', arguments: {} } }, {});
assert.equal(res1b.isError, true);
const p1b = JSON.parse(res1b.content[0].text);
assert.equal(p1b.error, 'invalid_arguments');
assert.match(p1b.detail, /missing: key/);
// 8) 非校验错误不被吞掉
handlers.set('tools/call', async () => { throw new Error('权限错：不在白名单'); });
const guard2 = installToolGuard(fakeServer, { log });
assert.equal(guard2.installed, true);
await assert.rejects(handlers.get('tools/call')({ params: { name: 'qq_demo', arguments: {} } }, {}), /权限错/);

console.log('G4_TOOL_GUARD_OK');
