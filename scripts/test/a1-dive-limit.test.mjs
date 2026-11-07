import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiveLimiter, DIVE_WINDOW_MS } from '../../src/lib/dive-limit.js';

test('A1 潜水限次：1 小时内 2 次，第 3 次拒绝，跨窗恢复，群间独立', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dive-'));
  let t = Date.UTC(2026, 10, 7, 12, 0, 0);
  const lim = createDiveLimiter({ stateDir: dir, now: () => t });
  const k = 'group:111';
  try {
    assert.equal(lim.trySwitch(k), true, '第 1 次应允许');
    assert.equal(lim.trySwitch(k), true, '第 2 次应允许');
    assert.equal(lim.canSwitch(k).used, 2);
    assert.equal(lim.trySwitch(k), false, '第 3 次应拒绝');
    assert.equal(lim.canSwitch(k).used, 2, '拒绝不应写文件');

    // 别的群不受影响
    assert.equal(lim.trySwitch('group:222'), true, '另一个群应允许');

    // 文件形状
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'wake-dive.json'), 'utf8'));
    assert.deepEqual(Object.keys(raw['group:111']), ['at']);
    assert.equal(raw['group:111'].at.length, 2);

    // 跨 1 小时窗口后恢复（第 1 条过期，剩 1 条）
    t += DIVE_WINDOW_MS + 1000;
    assert.equal(lim.canSwitch(k).used, 0, '整窗滑过后旧记录应全部过期');
    assert.equal(lim.trySwitch(k), true, '窗口滑过后应恢复');
    assert.equal(lim.canSwitch(k).used, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
