import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDecisionLog } from '../../src/ext/decision-log.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-j1-'));
const dayDir = path.join(dir, 'decision');
fs.mkdirSync(dayDir, { recursive: true });

// 造 9 个老日文件
const days = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
for (const d of days) fs.writeFileSync(path.join(dayDir, d + '.jsonl'), JSON.stringify({ type: 'decision', day: d }) + '\n');

const log = createDecisionLog({ stateDir: dir, log: () => {} });
const cfg = { socialV2: { decisionLog: { textLimit: 40, maxDays: 14 } } };
const id1 = log.record({ key: 'group:1', text: 'hello', cfg, allow: true, source: 'ext' });
if (!id1) throw new Error('record failed');

const files = fs.readdirSync(dayDir).filter((n) => /\.jsonl$/.test(n));
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
console.log('after-first', files.length, 'today?', files.includes(today + '.jsonl'));
if (files.length !== 7) throw new Error('expect 7 day files, got ' + files.length);
if (!files.includes(today + '.jsonl')) throw new Error('today file missing');
for (const d of days.slice(0, 3)) if (files.includes(d + '.jsonl')) throw new Error('old not removed: ' + d);

// 第二次写入：marker 生效，不再删
log.record({ key: 'group:2', text: 'again', cfg, allow: true, source: 'ext' });
const files2 = fs.readdirSync(dayDir).filter((n) => /\.jsonl$/.test(n));
if (files2.length !== 7) throw new Error('second cleanup changed count: ' + files2.length);

// 5MB 轮转
fs.writeFileSync(path.join(dayDir, today + '.jsonl'), 'x'.repeat(5 * 1024 * 1024 + 10));
log.record({ key: 'group:3', text: 'big', cfg, allow: true, source: 'ext' });
if (!fs.existsSync(path.join(dayDir, today + '-2.jsonl'))) throw new Error('no rotation file');
console.log('rotation ok');
console.log('DECISION_RETENTION_OK');
