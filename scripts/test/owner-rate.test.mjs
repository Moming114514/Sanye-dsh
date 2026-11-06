// 主人直呼不占群频率额度
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cnDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

// ---------- 1) group-rate：主人直呼不占额度 ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-rate-'));
fs.writeFileSync(path.join(dir, 'group-rate.json'), JSON.stringify({
  day: cnDay(),
  groups: { 680787260: { level: 'conservative', count: 40, lastAt: Date.now() - 60_000, custom: { minGapMin: 6, perDay: 40 } } },
}, null, 2));
process.env.SURFCORE_STATE_DIR = dir;
const rate = (await import(`file://${path.resolve('src/ext/group-rate.js')}?t=${Date.now()}`)).default;

const allow = (r) => r === true || (r && r.allow === true);
const deny = (r) => r === false || (r && r.allow === false);

const aOwner = rate.wakeGate({ key: 'group:680787260', reason: 'ownerMention', isOwner: true });
assert.ok(allow(aOwner), '主人被 @ 时即使满额也应放行');
assert.match(String(aOwner.reason || ''), /主人消息，跳过限制/);

const aOwnerAt = rate.wakeGate({ key: 'group:680787260', reason: 'atMention', isOwner: true });
assert.ok(allow(aOwnerAt), '主人 atMention 也应放行');

const aOther = rate.wakeGate({ key: 'group:680787260', reason: 'atMention', isOwner: false });
assert.ok(deny(aOther), '普通成员 atMention 应仍被拦');

const aQuestion = rate.wakeGate({ key: 'group:680787260', reason: 'question', isOwner: false });
assert.ok(deny(aQuestion), '普通成员 question 应仍被拦');

const saved = JSON.parse(fs.readFileSync(path.join(dir, 'group-rate.json'), 'utf8'));
assert.equal(saved.groups['680787260'].count, 40, '主人直呼不应消耗当日配额');


fs.rmSync(dir, { recursive: true, force: true });
console.log('OWNER_RATE_OK');
