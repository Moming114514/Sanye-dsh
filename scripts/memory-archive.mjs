// memory-archive.mjs —— 把「已遗忘」的记忆从热文件挪到冷归档（可检索、不进提示词）
// 用法：node scripts/memory-archive.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/home/dsh';
const DIR = path.join(HOME, '.dsh/surfcore/characters/char-mvugwthv/memory');
const CARD = path.join(DIR, 'memory-card.json');
const ARCH = path.join(DIR, 'memory-archive.jsonl');
const apply = process.argv.includes('--apply');

const raw = JSON.parse(fs.readFileSync(CARD, 'utf8'));
const recs = raw.records || raw.items || [];
const forgotten = recs.filter((r) => r && (r.forgottenAt || r.status === 'forgotten'));
const keep = recs.filter((r) => !(r && (r.forgottenAt || r.status === 'forgotten')));

console.log('总条数', recs.length, '| 已遗忘', forgotten.length, '| 保留', keep.length);
console.log('归档文件', ARCH, fs.existsSync(ARCH) ? '(已有 ' + fs.statSync(ARCH).size + ' B)' : '(将新建)');
if (!apply) {
  console.log('干跑：没有改动。加 --apply 执行。');
  process.exit(0);
}
if (forgotten.length) {
  const lines = forgotten.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(ARCH, lines, 'utf8');
  if (raw.records) raw.records = keep; else raw.items = keep;
  raw.archivedAt = new Date().toISOString();
  const tmp = CARD + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, CARD);
  console.log('已归档', forgotten.length, '条；热文件剩', keep.length, '条');
} else {
  console.log('没有需要归档的记录');
}