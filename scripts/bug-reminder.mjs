#!/usr/bin/env node
// 每天 18:00 提醒：把「自检里还没修的项目」发一条 QQ 给主人（只在他有异常时发）。
// 也可以手动跑：node scripts/bug-reminder.mjs --force
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = process.env.SURFCORE_STATE || join(process.env.HOME || '/home/dsh', '.dsh/surfcore/state');
const force = process.argv.includes('--force');

const read = (p, d = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const cfg = read(join(ROOT, 'config.json'), {}) || {};
const sc = read(join(STATE, 'selfcheck.json'), null);
const token = cfg.consoleToken || '';
const owner = String(cfg.ownerQQ || '').trim();

if (!sc) { console.log('没有自检数据，跳过'); process.exit(0); }
const bad = (sc.items || []).filter((i) => !i.ok);
if (!bad.length && !force) { console.log('自检全绿，今天不发提醒'); process.exit(0); }

const when = sc.at ? new Date(sc.at).toLocaleString('zh-CN', { hour12: false }) : '';
const lines = bad.length
  ? bad.map((i) => `· ${i.name}：${String(i.detail || '').slice(0, 80)}`)
  : ['· （强制发送，当前没有异常）'];
const text = [
  '【今天还没修的问题】',
  ...lines,
  '',
  `自检时间 ${when}；要修的话面板「总览 → 自检」能看到同一份。`,
].join('\n');

const payload = JSON.stringify({ key: `private:${owner}`, messages: [text] });
const res = await fetch('http://127.0.0.1:3100/api/socialV2/send-message', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-console-token': token },
  body: payload,
}).then((r) => r.text()).catch((e) => `ERR ${e.message}`);

writeFileSync(join(STATE, 'bug-reminder.json'), JSON.stringify({ at: Date.now(), bad: bad.length, text, result: String(res).slice(0, 200) }, null, 2));
console.log(`发送 ${bad.length} 项异常提醒 → ${String(res).slice(0, 120)}`);
