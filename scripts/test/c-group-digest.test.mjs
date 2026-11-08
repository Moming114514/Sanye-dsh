import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createGroupDigest, KEEP_RAW } from '../../src/lib/group-digest.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c-group-digest-'));
const logs = [];
const d = createGroupDigest({ stateDir: dir, now: () => 1700000000000, log: (l) => logs.push(String(l)) });
const mk = (n, len = 10) => Array.from({ length: n }, (_, i) => ({ text: 'm' + i + '：' + 'x'.repeat(len) }));

// 空会话
{
  const rec = d.digest('group:1', []);
  assert.equal(rec.kept, 0);
  assert.equal(rec.batches, 0);
  assert.equal(rec.charsBefore, 0);
  assert.equal(rec.charsAfter, 0);
}

// 少于 20 条：全部保留
{
  const msgs = mk(12, 20);
  const rec = d.digest('group:2', msgs);
  assert.equal(rec.kept, 12);
  assert.equal(rec.batches, 0);
  assert.equal(rec.charsAfter, rec.charsBefore);
}

// 65 条：保留 20，45 条压成 3 批
{
  const msgs = mk(65, 50).map((m, i) => ({ text: m.text + '#' + i }));
  const rec = d.digest('group:3', msgs);
  assert.equal(rec.kept, KEEP_RAW);
  assert.equal(rec.batches, 3);
  assert.equal(rec.lines.length, 3);
  for (const lines of rec.lines) {
    assert.equal(lines.length, 3, '每批 3 行');
    for (const line of lines) assert.ok(line.length <= 40, '每行 <=40 字');
  }
  assert.ok(rec.charsAfter < rec.charsBefore, '压缩后字符应变少');
  assert.ok(logs.some((l) => l.includes('[压缩] group:3') && l.includes('→')), '应有压缩日志');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'gc-shadow.json'), 'utf8'));
  for (const k of ['key', 'at', 'kept', 'batches', 'charsBefore', 'charsAfter']) assert.ok(k in onDisk, '缺少字段 ' + k);
}
console.log('C_GROUP_DIGEST_OK');
