#!/usr/bin/env node
// B2: 表情库 404 清理。默认 dry-run；--apply 才把 404/410 移到 stickers.removed.json
// 用法：node scripts/sticker-audit.mjs [--apply] [--limit N] [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STATE = process.env.SURFCORE_STATE_DIR || path.join(ROOT, 'state');
const STICKERS = path.join(STATE, 'stickers.json');
const REMOVED = path.join(STATE, 'stickers.removed.json');
const AUDIT = path.join(STATE, 'sticker-audit.json');
const concurrency = 6;
const TIMEOUT_MS = 3000;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const AS_JSON = args.includes('--json');
const limitArg = args.indexOf('--limit');

function fail(msg) { console.error(msg); process.exit(2); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

async function probe(url) {
  const attempt = async (method) => {
    const init = { method, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' };
    if (method === 'GET') init.headers = { range: 'bytes=0-0' };
    const res = await fetch(url, init);
    // 有些 CDN 不支持 HEAD（403/405），用 Range GET 复核一次
    return { status: res.status };
  };
  let lastErr = '';
  for (let i = 0; i < 2; i += 1) {
    try {
      let r = await attempt('HEAD');
      if (r.status === 403 || r.status === 405 || r.status === 501) {
        r = await attempt('GET');
      }
      return { status: r.status, error: '' };
    } catch (error) {
      lastErr = String(error?.name === 'TimeoutError' ? 'timeout' : (error?.message ?? error));
      if (i === 0) await new Promise((r) => setTimeout(r, 300));
    }
  }
  return { status: 0, error: lastErr };
}

const all = readJson(STICKERS, null);
if (!Array.isArray(all)) fail(`stickers.json 不是数组：${STICKERS}`);
const limit = limitArg >= 0 ? Math.max(1, Number(args[limitArg + 1]) || all.length) : all.length;
const list = all.slice(0, limit);

const items = [];
let cursor = 0;
async function worker() {
  while (cursor < list.length) {
    const idx = cursor; cursor += 1;
    const it = list[idx];
    const url = String(it?.url ?? '').trim();
    const out = { id: String(it?.id ?? ''), no: it?.no ?? null, desc: String(it?.desc ?? '').slice(0, 40), url, status: 0, result: 'unknown', error: '' };
    if (!url) { out.result = 'no-url'; items[idx] = out; continue; }
    const r = await probe(url);
    out.status = r.status;
    out.error = r.error;
    if (r.status >= 200 && r.status < 300) out.result = 'ok';
    else if (r.status === 404 || r.status === 410) out.result = 'dead';
    else if (r.status === 0) out.result = 'timeout';
    else out.result = 'other';
    items[idx] = out;
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));

const count = (k) => items.filter((x) => x && x.result === k).length;
const summary = {
  at: new Date().toISOString(),
  file: STICKERS,
  dryRun: !APPLY,
  total: list.length,
  ok: count('ok'),
  dead: count('dead'),
  timeout: count('timeout'),
  other: count('other'),
  noUrl: count('no-url'),
  items: items.map((x) => ({ id: x.id, no: x.no, desc: x.desc, url: x.url, status: x.status, result: x.result, error: x.error })),
};

if (APPLY) {
  const dead = items.filter((x) => x && x.result === 'dead');
  if (dead.length) {
    const removed = readJson(REMOVED, []);
    const removedList = Array.isArray(removed) ? removed : [];
    const stamp = new Date().toISOString();
    const keep = all.filter((it) => !dead.some((d) => d.id === String(it?.id ?? '')));
    for (const d of dead) {
      const src = all.find((it) => String(it?.id ?? '') === d.id);
      if (src) removedList.push({ ...src, removedAt: stamp, reason: `HTTP ${d.status}` });
    }
    writeJsonAtomic(STICKERS, keep);
    writeJsonAtomic(REMOVED, removedList);
    summary.removed = dead.length;
    summary.remain = keep.length;
  } else {
    summary.removed = 0;
    summary.remain = all.length;
  }
}

writeJsonAtomic(AUDIT, summary);

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`表情库审计（${APPLY ? 'APPLY' : 'dry-run'}）：总数 ${summary.total} / 可用 ${summary.ok} / 失效 ${summary.dead} / 超时 ${summary.timeout} / 其它 ${summary.other}${summary.noUrl ? ` / 无 URL ${summary.noUrl}` : ''}`);
  for (const x of summary.items.filter((i) => i.result !== 'ok')) {
    console.log(`  [${i.result}] HTTP ${i.status || '-'} #${i.no ?? '?'} ${i.desc || i.id} ${i.error ? '(' + i.error + ')' : ''}`);
  }
  if (APPLY) console.log(`已移出 ${summary.removed} 条到 stickers.removed.json，剩余 ${summary.remain} 条`);
  else console.log('dry-run：未修改任何文件（--apply 才会移出失效项）');
}
