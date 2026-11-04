#!/usr/bin/env node
// TASK-INPUT #3：媒体观测统计（一行摘要 / --json 原始 JSON）
// 数据源：state/media-stats.json（bridge 写；按天重置）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STATE = process.env.SURFCORE_STATE_DIR || path.join(ROOT, 'state');
const FILE = path.join(STATE, 'media-stats.json');

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return {
      day: String(j.day || ''),
      withMedia: Number(j.withMedia || 0),
      looked: Number(j.looked || 0),
      failed: Number(j.failed || 0),
      reasons: j.reasons && typeof j.reasons === 'object' ? j.reasons : {},
      at: Number(j.at || 0),
    };
  } catch {
    return { day: '', withMedia: 0, looked: 0, failed: 0, reasons: {}, at: 0, missing: true };
  }
}

const data = load();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const rate = data.withMedia > 0 ? Math.round((data.looked / data.withMedia) * 100) : 0;
console.log(`媒体 ${data.day || '（无数据）'}：有图 ${data.withMedia} 条 / 看了 ${data.looked} 条（${rate}%）/ 失败 ${data.failed} 条`);
const reasons = Object.entries(data.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6);
if (reasons.length) console.log('失败原因：' + reasons.map(([k, v]) => `${k}×${v}`).join('，'));
if (data.missing) console.log(`（还没生成 ${FILE}，等 bridge 重启后产生）`);
