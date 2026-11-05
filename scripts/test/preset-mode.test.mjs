// F-2：三档卡推导单测——三个群分别处于三种状态时，mode 必须正确
import assert from 'node:assert';
import { derivePresetMode, derivePresetActivity } from '../../scripts/preset-mode.mjs';

// 只学习模式 → watch（优先级最高，即使同时静音）
assert.strictEqual(derivePresetMode({ learned: true, muted: false }), 'watch');
assert.strictEqual(derivePresetMode({ learned: true, muted: true }), 'watch');
// 只静音 → called
assert.strictEqual(derivePresetMode({ learned: false, muted: true }), 'called');
// 都没有 → normal
assert.strictEqual(derivePresetMode({ learned: false, muted: false }), 'normal');

// 活跃度：抽样优先，其次频率档位
assert.strictEqual(derivePresetActivity({ sample: 1, level: 'quiet' }), 'active');
assert.strictEqual(derivePresetActivity({ sample: 0.3, level: 'active' }), 'normal');
assert.strictEqual(derivePresetActivity({ sample: 0, level: 'active' }), 'active');
assert.strictEqual(derivePresetActivity({ sample: 0, level: 'quiet' }), 'quiet');
assert.strictEqual(derivePresetActivity({ sample: 0, level: 'normal' }), 'normal');

console.log('PRESET_MODE_OK');
