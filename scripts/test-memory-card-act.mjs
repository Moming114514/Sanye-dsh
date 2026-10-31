// 记忆卡手动操作：toast 文案不能阻断 reload；禁止再引用不存在的 item。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const src = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
const start = src.indexOf('      const act = async (action, extra = {}) => {');
assert.ok(start > 0, '找不到 MemoryCardPanel act');
const block = src.slice(start, start + 1800);
assert.ok(!block.includes('item.staged'), 'act 里不能再引用 item.staged');
assert.ok(block.includes('"✓ 已更新"'), 'fallback 必须是固定文案');
assert.ok(block.includes('try { await reload(); } catch {}'), 'reload 必须在 toast 之前且不能被文案异常阻断');
assert.ok(block.indexOf('await reload()') < block.indexOf('toast(action ==='), 'reload 必须先于 toast');
assert.ok(src.includes('function MemoryCardPanel'), 'MemoryCardPanel 必须存在');
console.log('✅ 记忆卡手动操作通过');
