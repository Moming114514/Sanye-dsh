// 拍一拍合并：同一群 180 秒内只唤醒一次。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPokeMerger, POKE_MERGE_WINDOW_MS } from '../../src/lib/poke-merge.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-merge-'));
let now = 1_000_000;
const merger = createPokeMerger({ stateDir: dir, now: () => now });
const key = 'group:680787260';

const a = merger.tryMerge(key);
assert.equal(a.merged, false, '第一次拍一拍应放行');
assert.equal(a.sinceSec, 0);

now += 25_000;
const b = merger.tryMerge(key);
assert.equal(b.merged, true, '窗口内第二次应合并');
assert.equal(b.sinceSec, 25);

// 179 秒：仍在窗口内（边界内合并）
now += 179_000 - 25_000;
const c = merger.tryMerge(key);
assert.equal(c.merged, true, '179 秒仍应合并');
assert.equal(c.sinceSec, 179);

// 181 秒：超出窗口，放行
now += 181_000 - 179_000;
const d = merger.tryMerge(key);
assert.equal(d.merged, false, '181 秒应重新放行');

// 不同群互不影响
const other = merger.tryMerge('group:1043145514');
assert.equal(other.merged, false, '另一个群应独立放行');

// 窗口常量
assert.equal(POKE_MERGE_WINDOW_MS, 180_000, '窗口应为 180 秒');

// 落盘形状：{ "<key>": timestamp }
const raw = JSON.parse(fs.readFileSync(path.join(dir, 'poke-merge.json'), 'utf8'));
assert.equal(typeof raw[key], 'number', '文件里应有最近一次时间戳');
assert.equal(raw[key], now, '时间戳应是最后一次放行的时间');

// 旧记录会被裁掉，不无限增长
now += POKE_MERGE_WINDOW_MS * 2;
merger.tryMerge('group:999');
const raw2 = JSON.parse(fs.readFileSync(path.join(dir, 'poke-merge.json'), 'utf8'));
assert.equal(raw2['group:999'] !== undefined, true);
assert.equal(raw2[key], undefined, '过期记录应被裁掉');

console.log('POKE_MERGE_OK');
