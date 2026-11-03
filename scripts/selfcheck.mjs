#!/usr/bin/env node
// 自检：服务/端口/QQ/磁盘/配置/新增报错。输出 state/selfcheck.json，供面板「总览」显示。
// 用法：node scripts/selfcheck.mjs [--quiet]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statfsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = process.env.SURFCORE_STATE || join(process.env.HOME || '/home/dsh', '.dsh/surfcore/state');
const OUT = join(STATE, 'selfcheck.json');
const MARK = join(STATE, 'selfcheck-mark.json');
const LOG = '/var/log/surfcore-bridge.log';

const sh = (cmd, args = []) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};

const items = [];
const add = (name, ok, detail) => items.push({ name, ok: !!ok, detail });

// 1. systemd 服务
for (const unit of ['dsh-web', 'surfcore-bridge', 'her-console']) {
  const s = sh('systemctl', ['is-active', unit]);
  add(unit, s === 'active', s || 'not active');
}
// asr-shim 自 2026-11-03 起改为 socket 按需激活（MEM-01 T3）：service 平时就该 inactive，
// 只要 asr-shim.socket 在监听就算正常，否则这条会常年挂红。
{
  const asrSock = sh('systemctl', ['is-active', 'asr-shim.socket']);
  const asrSvc = sh('systemctl', ['is-active', 'asr-shim']);
  const ok = asrSock === 'active' || asrSvc === 'active';
  const detail = asrSvc === 'active' ? 'active（转写中）' : (asrSock === 'active' ? 'socket 待命（按需启动）' : (asrSvc || asrSock || 'not active'));
  add('asr-shim', ok, detail);
}

// 2. NapCat 由端口 6099 + OneBot 3001 代判（dsh 用户无 docker 权限）

// 3. 端口
const ports = [[3080, 'DSH'], [3100, '桥接控制台'], [7800, '面板'], [3001, 'OneBot'], [6099, 'NapCat WebUI']];
for (const [p, label] of ports) {
  const r = sh('ss', ['-lntH', `sport = :${p}`]);
  add(`端口 ${p}（${label}）`, r.length > 0, r ? 'listening' : '没在听');
}

// 4. 磁盘
let disk = { ok: true, detail: 'n/a' };
try {
  const st = statfsSync('/');
  const freeGB = (st.bfree * st.bsize) / 1024 ** 3;
  disk = { ok: freeGB > 5, detail: `${freeGB.toFixed(1)} GB 可用` };
} catch (e) { disk = { ok: false, detail: String(e && e.message || e) }; }
add('磁盘剩余', disk.ok, disk.detail);

// 5. 配置能解析
let cfg = null;
try { cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')); add('config.json 可解析', true, 'ok'); }
catch (e) { add('config.json 可解析', false, String(e && e.message || e)); }

// 6. 桥接日志新增报错（自上次自检以来的增量）
let errCount = 0, errSample = '';
const hadMark = existsSync(MARK);
try {
  if (existsSync(LOG)) {
    const size = (await import('node:fs')).statSync(LOG).size;
    const prev = existsSync(MARK) ? JSON.parse(readFileSync(MARK, 'utf8')) : { offset: 0 };
    const from = Number(prev.offset) || 0;
    if (size < from) prev.offset = 0; // 日志被轮转
    const fd = (await import('node:fs')).openSync(LOG, 'r');
    const len = Math.max(0, size - (Number(prev.offset) || 0));
    const buf = Buffer.alloc(len);
    if (len > 0) (await import('node:fs')).readSync(fd, buf, 0, len, Number(prev.offset) || 0);
    (await import('node:fs')).closeSync(fd);
    const text = buf.toString('utf8');
    const lines = text.split('\n').filter((l) => /\b(error|Error|ERROR|ReferenceError|TypeError|unhandled|ECONNREFUSED)\b/.test(l) && !/\[学样\] 拒收/.test(l));
    errCount = lines.length;
    errSample = lines.slice(-1)[0]?.slice(0, 160) || '';
    writeFileSync(MARK, JSON.stringify({ offset: size, at: Date.now() }));
  }
} catch (e) { errSample = String(e && e.message || e); }
add('新增报错', errCount === 0, !hadMark ? '开始记录（本次为基线）' : errCount === 0 ? '0 条（自上次自检）' : `${errCount} 条，最近：${errSample}`);

const bad = items.filter((i) => !i.ok);
const out = { ok: bad.length === 0, at: Date.now(), items, bad: bad.length, errors: { count: errCount, sample: errSample } };
writeFileSync(OUT, JSON.stringify(out, null, 2));
if (!process.argv.includes('--quiet')) {
  console.log(out.ok ? '✅ 全部正常' : `⚠️ ${bad.length} 项异常`);
  for (const i of items) console.log(`${i.ok ? '·' : '✗'} ${i.name}: ${i.detail}`);
}
process.exit(0);
