// 沉默白名单：只有 timeout 允许 [SILENT]/安静收尾；poke/sample/直呼必须说。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wakeAllowsSilent } from '../../src/lib/wake-mode.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bridge = fs.readFileSync(path.join(HERE, '../../src/bridge.js'), 'utf8');

// 1) 白名单映射
assert.equal(wakeAllowsSilent('timeout'), true, 'timeout 允许沉默');
for (const r of ['poke', 'sample', 'atMention', 'nameMention', 'ownerMention', 'ownerCall']) {
  assert.equal(wakeAllowsSilent(r), false, `${r} 必须说`);
}
assert.equal(wakeAllowsSilent('bootstrap'), true, '其它唤醒保持原行为');
assert.equal(wakeAllowsSilent('poke', true), true, '显式 allowSilent=true 优先');
assert.equal(wakeAllowsSilent('timeout', false), false, '显式 allowSilent=false 优先');

// 2) 接线：poke 唤醒调用点显式 allowSilent=false
assert.ok(bridge.includes("scheduleWakeV2(key, 'poke', { allowSilent: false })"), 'poke 调用点应传 allowSilent=false');
assert.ok(bridge.includes('pendingWakeNoSilent.set(key, true)'), 'scheduleWakeV2 应记住 noSilent');
assert.ok(bridge.includes('buildWakePromptV2(key, reason, opts)'), 'sendWakePromptV2 应把 opts 透传给提示词');

// 3) 提示词里非 timeout 有硬性「必须回应」，timeout 仍保留安静收尾
assert.ok(bridge.includes('这次唤醒必须回应：不要用 qq_mark_read / qq_close_conversation 收尾'), '通用分支应有必须回应文案');
assert.ok(bridge.includes('不想接就安静收尾（qq_mark_read 或 qq_close_conversation）。'), 'poke 分支仍保留可沉默文案（供 allowSilent=true）');

// 4) 拍一拍合并日志格式
assert.ok(bridge.includes("[poke] 合并，跳过唤醒 ${key}（距上次 ${merged.sinceSec} 秒）"), '合并日志格式');

console.log('WAKE_SILENT_OK');
