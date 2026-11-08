// C（G5 shadow）：群聊上下文压缩的离线试算，不接入请求、不改提示词。
// 最近 20 条留原文，更早的每 20 条一批压成 3 行（取最长 3 条、各截 40 字）。
import fs from 'node:fs';
import path from 'node:path';

export const KEEP_RAW = 20;
export const BATCH_SIZE = 20;
export const LINES_PER_BATCH = 3;
export const LINE_CHARS = 40;

export function createGroupDigest({ stateDir, now = () => Date.now(), log = console.error } = {}) {
  const file = path.join(stateDir, 'gc-shadow.json');
  const save = (rec) => {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(rec));
      fs.renameSync(tmp, file);
    } catch (err) {
      log(`[压缩] 写盘失败 ${err?.message ?? err}`);
    }
  };

  function digest(key, messages) {
    const list = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .map((m) => ({ text: m.text.trim() }));
    const cut = Math.max(0, list.length - KEEP_RAW);
    const older = list.slice(0, cut);
    const kept = list.slice(cut);
    const batches = [];
    for (let i = 0; i < older.length; i += BATCH_SIZE) {
      const batch = older.slice(i, i + BATCH_SIZE);
      const lines = batch
        .slice()
        .sort((a, b) => b.text.length - a.text.length)
        .slice(0, LINES_PER_BATCH)
        .map((m) => m.text.slice(0, LINE_CHARS));
      batches.push(lines);
    }
    const sum = (arr) => arr.reduce((n, m) => n + m.text.length, 0);
    const charsBefore = sum(list);
    const charsAfter = sum(kept) + batches.reduce((n, lines) => n + lines.join('').length, 0);
    const rec = {
      key: String(key || ''),
      at: now(),
      kept: kept.length,
      batches: batches.length,
      charsBefore,
      charsAfter,
      lines: batches,
    };
    save(rec);
    log(`[压缩] ${rec.key || '-'} 原文 ${charsBefore} 字 → 摘要 ${charsAfter} 字`);
    return rec;
  }

  return { digest, file };
}
