// F-1：静音闸门的「主人直呼例外」
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mute-f1-'));
process.env.SURFCORE_STATE_DIR = dir;
fs.writeFileSync(path.join(dir, 'muted-keys.json'), JSON.stringify({
  items: { 'group:111': { at: new Date().toISOString() }, 'private:222': { at: new Date().toISOString() } },
}, null, 1));

const mute = (await import('../../src/ext/mute.js')).default;
const gate = (key, reason) => mute.wakeGate({ key, reason });

let r = gate('group:111', 'ownerMention');
assert.notStrictEqual(r, false);
assert.strictEqual(r.allow, true);
assert.match(r.reason, /静音·主人直呼放行/);
assert.strictEqual(gate('group:111', 'ownerCall').allow, true);
assert.notStrictEqual(gate('group:111', 'manual'), false);
assert.notStrictEqual(gate('group:111', 'admin'), false);

r = gate('group:111', 'atMention');
assert.strictEqual(r.allow, false);
assert.match(r.reason, /静音/);
assert.strictEqual(gate('group:111', 'nameMention').allow, false);
assert.strictEqual(gate('group:111', 'anyMessage').allow, false);
assert.strictEqual(gate('group:111', 'question').allow, false);

assert.strictEqual(gate('group:999', 'anyMessage'), true);
assert.strictEqual(gate('private:222', 'private').allow, false);

fs.rmSync(dir, { recursive: true, force: true });
console.log('MUTE_OWNER_CALL_OK');