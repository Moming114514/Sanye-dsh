import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isSidecarTask, sidecarReasons, buildSidecarPrompt } from '../../src/ext/sidecar-task.js';

// 1) 副手提示词不含人格/记忆/语气/反AI味等唤醒段落
const p = buildSidecarPrompt('study', 'private:1', 'tok123');
for (const bad of ['人格核心', '人格语气', '记忆卡', '【今天的感觉】', '【当前角色】', '【反AI味】', '【B站']) {
  assert.ok(!p.includes(bad), 'sidecar 不应包含: ' + bad);
}
assert.ok(p.includes('【会话令牌】tok123'));
assert.ok(p.includes('【副手模式】'));
assert.ok(p.includes('非必要') === false); // 无寒暄类模板

// 2) 默认四个任务；message 不受影响；配置可覆盖
assert.deepEqual(sidecarReasons({}), ['study', 'style-learn', 'style-learn-auto', 'github-learn']);
assert.equal(isSidecarTask('message', {}), false);
assert.equal(isSidecarTask('study', { socialV2: { tasks: { noPersona: ['x'] } } }), false);

// 3) bridge 里只有一处旁路，且在任何人格段落之前返回（非副手路径逐字节不变）
const bridge = fs.readFileSync(new URL('../../src/bridge.js', import.meta.url), 'utf8');
const fnAt = bridge.indexOf('function buildWakePromptV2');
assert.ok(fnAt > 0);
const head = bridge.slice(fnAt, fnAt + 1200);
assert.equal((head.match(/isSidecarTask\(reason/g) || []).length, 1);
assert.ok(head.indexOf('isSidecarTask(reason') < head.indexOf('const personaV2Line'));

console.log('SIDECAR_OK');
