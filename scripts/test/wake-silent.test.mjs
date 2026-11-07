// 沉默白名单（反转后）：默认必须回应；只有 timeout/bootstrap/history/replyCheck/proactive 允许安静收尾。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wakeAllowsSilent, SILENT_ALLOWED_REASONS } from '../../src/lib/wake-mode.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bridge = fs.readFileSync(path.join(HERE, '../../src/bridge.js'), 'utf8');

// 1) 白名单
for (const r of ['timeout', 'bootstrap', 'history', 'replyCheck', 'proactive']) {
  assert.equal(wakeAllowsSilent(r), true, `${r} 允许沉默`);
  assert.ok(SILENT_ALLOWED_REASONS.has(r), `${r} 应在白名单里`);
}
// 2) 其余一律必须回应
for (const r of ['anyMessage', 'question', 'sample', 'poke', 'atMention', 'nameMention', 'ownerMention', 'ownerCall', 'keyword', 'manual', 'admin']) {
  assert.equal(wakeAllowsSilent(r), false, `${r} 必须回应`);
}
// 3) 显式参数优先
assert.equal(wakeAllowsSilent('poke', true), true, '显式 allowSilent=true 优先');
assert.equal(wakeAllowsSilent('timeout', false), false, '显式 allowSilent=false 优先');

// 4) 接线与日志
assert.ok(bridge.includes("scheduleWakeV2(key, 'poke', { allowSilent: false })"), 'poke 调用点应传 allowSilent=false');
assert.ok(bridge.includes("[唤醒] reason=${reason} 必须回应"), '必须回应的日志行');

console.log('WAKE_SILENT_OK');
