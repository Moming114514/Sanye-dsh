// 只听主人 / 只跟我私聊 两种模式的唤醒闸门
import assert from 'node:assert';
import owner from '../../src/ext/owner-only.js';

const cfg = { ownerQQ: '1000000000' };

// open：一律放行
assert.deepStrictEqual(owner.wakeGate({ key: 'group:1', reason: 'proactiveCheck', cfg, mode: 'open' }), { allow: true });

// owneronly + 群里没他说话：拦
let r = owner.wakeGate({ key: 'group:1', reason: 'proactiveCheck', cfg, mode: 'owneronly' });
assert.strictEqual(r.allow, false);
assert.match(r.reason, /只听主人/);

// manual / admin 放行
assert.strictEqual(owner.wakeGate({ key: 'group:1', reason: 'manual', cfg, mode: 'owneronly' }).allow, true);
assert.strictEqual(owner.wakeGate({ key: 'group:1', reason: 'admin', cfg, mode: 'owneronly' }).allow, true);

// 私聊不受影响
assert.strictEqual(owner.wakeGate({ key: 'private:2', reason: 'proactiveCheck', cfg, mode: 'owneronly' }).allow, true);

// 别人说话 → 仍然拦
owner.onGroupMessage({ key: 'group:1', uin: '999' });
assert.strictEqual(owner.wakeGate({ key: 'group:1', reason: 'backlog', cfg, mode: 'owneronly' }).allow, false);

// 他说话 → 放行
owner.onGroupMessage({ key: 'group:1', uin: '1000000000' });
assert.strictEqual(owner.wakeGate({ key: 'group:1', reason: 'backlog', cfg, mode: 'owneronly' }).allow, true);

// PRIVATEONLY：他刚说过也不放行（群里完全不接话）
r = owner.wakeGate({ key: 'group:1', reason: 'backlog', cfg, mode: 'privateonly' });
assert.strictEqual(r.allow, false);
assert.match(r.reason, /只跟我私聊/);
assert.strictEqual(owner.wakeGate({ key: 'group:1', reason: 'manual', cfg, mode: 'privateonly' }).allow, true);
assert.strictEqual(owner.wakeGate({ key: 'private:2', reason: 'proactiveCheck', cfg, mode: 'privateonly' }).allow, true);

console.log('OWNER_GATE_TESTS_OK');
