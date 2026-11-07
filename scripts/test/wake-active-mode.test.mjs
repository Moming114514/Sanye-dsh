import test from 'node:test';
import assert from 'node:assert/strict';
import { applyModeDefaults } from '../../src/lib/wake-mode.js';

const mk = (mode, anyMessage = false) => ({ mode, infinite: false, sleepUntil: 'x', triggers: { anyMessage } });

test('active + 显式 anyMessage:false → 保留 false', () => {
  const next = applyModeDefaults(mk('active'), { anyMessage: false });
  assert.equal(next.triggers.anyMessage, false);
  assert.equal(next.infinite, true);
  assert.equal(next.sleepUntil, null);
});

test('active 不给 anyMessage → 默认 true', () => {
  const next = applyModeDefaults(mk('active'), { atMention: true });
  assert.equal(next.triggers.anyMessage, true);
});

test('active + 显式 true → true', () => {
  const next = applyModeDefaults(mk('active'), { anyMessage: true });
  assert.equal(next.triggers.anyMessage, true);
});

test('diving 不受影响', () => {
  const next = applyModeDefaults(mk('diving', false), {});
  assert.equal(next.triggers.anyMessage, false);
  assert.equal(next.infinite, false);
  assert.equal(next.sleepUntil, 'x');
});
