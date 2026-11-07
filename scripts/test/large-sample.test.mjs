// 大群抽样：概率 0 不命中 / 命中计数 +1 / 3 分钟内第二次不命中 / 61 次不命中 / 跨天清零
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLargeSampler, LARGE_SAMPLE_GAP_MS, LARGE_SAMPLE_DAILY_CAP } from '../../src/lib/large-sample.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'large-sample-'));
let now = Date.parse('2026-11-07T20:00:00+08:00');
const logs = [];
const sampler = createLargeSampler({ stateDir: dir, now: () => now, log: (m) => logs.push(m) });
const key = 'group:680787260';

// 概率 0：不命中
assert.equal(sampler.trySample(key, 0, () => 0), false, '概率 0 不应命中');
assert.equal(logs.length, 0);

// 命中：计数 +1，日志
assert.equal(sampler.trySample(key, 1, () => 0), true, '概率 1 应命中');
let raw = JSON.parse(fs.readFileSync(path.join(dir, 'large-sample.json'), 'utf8'));
assert.equal(raw[key].count, 1);
assert.equal(raw[key].day, '2026-11-07');
assert.ok(logs[0].includes('大群命中 group:680787260（今日 1/60）'));

// 3 分钟内第二次：不命中（即使概率 1、rng=0）
now += 61_000;
assert.equal(sampler.trySample(key, 1, () => 0), false, '3 分钟内第二次不应命中');
raw = JSON.parse(fs.readFileSync(path.join(dir, 'large-sample.json'), 'utf8'));
assert.equal(raw[key].count, 1, '被冷却挡住时不应计数');

// 过了冷却：再次命中
now += LARGE_SAMPLE_GAP_MS;
assert.equal(sampler.trySample(key, 1, () => 0), true, '过冷却应再命中');
raw = JSON.parse(fs.readFileSync(path.join(dir, 'large-sample.json'), 'utf8'));
assert.equal(raw[key].count, 2);

// 抽到 60 次后，第 61 次不命中且打上限日志
for (let i = raw[key].count; i < LARGE_SAMPLE_DAILY_CAP; i++) {
  now += LARGE_SAMPLE_GAP_MS;
  assert.equal(sampler.trySample(key, 1, () => 0), true, `第 ${i + 1} 次应命中`);
}
now += LARGE_SAMPLE_GAP_MS;
const before = logs.length;
assert.equal(sampler.trySample(key, 1, () => 0), false, '第 61 次不应命中');
assert.ok(logs[logs.length - 1].includes('今日已达上限 group:680787260'), '应打上限日志');
assert.equal(logs.length, before + 1);

// 跨天（东八区）清零
now = Date.parse('2026-11-08T00:30:00+08:00');
assert.equal(sampler.trySample(key, 1, () => 0), true, '跨天应重新允许');
raw = JSON.parse(fs.readFileSync(path.join(dir, 'large-sample.json'), 'utf8'));
assert.equal(raw[key].count, 1, '跨天计数应归 1');
assert.equal(raw[key].day, '2026-11-08');

console.log('LARGE_SAMPLE_OK');
