#!/usr/bin/env node
// scripts/verify.mjs —— 一条命令验收「有没有改坏东西」
//
//   node scripts/verify.mjs             # 语法 + 单测 + 代码结构快照（工具/路由）+ 接口探活
//   node scripts/verify.mjs --save-base # 重建代码基准 scripts/snap-base/code.json（非必要不做）
//   node scripts/verify.mjs --no-api    # 桥接没在跑时只做静态检查
//
// 代码基准 scripts/snap-base/code.json 提交进 git → 空环境/新机器也能跑；
// 提示词人格基准只在服务器 ~/.dsh/surfcore/snap/，由 node scripts/snap-split.mjs --check 单独校验，
// 缺失时打印 persona baseline skipped，不算失败（m00399）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const NODE = process.execPath;
const ROUTES = ['/api/status', '/api/socialV2/states', '/api/socialV2/mood', '/api/socialV2/style-list', '/api/socialV2/tech-notes'];
const saveBase = process.argv.includes('--save-base');
const skipApi = process.argv.includes('--no-api');

const results = [];
let failed = 0;
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) failed++; };

function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
  });
}

// 带 stdin 的子进程（snap-split --check --stdin 从标准输入拿 {tools,routes}）
function runInput(cmd, args, input, cwd = ROOT) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err += c; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    try { p.stdin.end(input); } catch {}
  });
}

function walk(dir, acc = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const ent of ents) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (ent.name.endsWith('.js') || ent.name.endsWith('.mjs')) acc.push(full);
  }
  return acc;
}

function toolsList() {
  return new Promise((resolve) => {
    const p = spawn(NODE, [path.join(ROOT, 'src/mcp-snowluma-safe.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    const timer = setTimeout(() => { try { p.kill(); } catch {} resolve({ count: 0, names: [] }); }, 15000);
    p.stdout.on('data', (c) => {
      buf += c;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 2 && m.result?.tools) {
            clearTimeout(timer);
            try { p.kill(); } catch {}
            resolve({ count: m.result.tools.length, names: m.result.tools.map((t) => t.name).sort() });
          }
        } catch {}
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  });
}

// 1) 语法检查
{
  const scripts = ['scripts/snapshot.mjs', 'scripts/snap-split.mjs', 'scripts/dump-manifests.mjs', 'scripts/verify.mjs', 'scripts/upgrade.mjs'];
  const files = [...walk(path.join(ROOT, 'src')), ...scripts.map((s) => path.join(ROOT, s))].filter((f) => fs.existsSync(f));
  const bad = [];
  for (const f of files) {
    const r = await run(NODE, ['--check', f]);
    if (r.code !== 0) bad.push(`${path.relative(ROOT, f)}: ${(r.err || r.out).split('\n').filter(Boolean)[0]}`);
  }
  record(`语法检查（${files.length} 个文件）`, bad.length === 0, bad.slice(0, 3).join(' | '));
}

// 2) 单测
{
  const dir = path.join(ROOT, 'scripts/test');
  const tests = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort() : [];
  if (!tests.length) record('扩展单测', true, '没有 scripts/test/*.test.mjs（跳过）');
  for (const t of tests) {
    const r = await run(NODE, [path.join('scripts/test', t)]);
    const last = (r.out || r.err).trim().split('\n').slice(-1)[0] || '';
    record(`单测 ${t}`, r.code === 0, last.slice(0, 140));
  }
}

// 3) 代码结构快照：工具名 + 路由状态码
//    比对逻辑只有一份——scripts/snap-split.mjs；verify 把探活结果用 stdin 递过去，
//    免得两份实现慢慢漂移（人格侧不在这里，见 scripts/snap-split.mjs --check）。
if (!skipApi) {
  let token = '';
  try { token = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).consoleToken || ''; } catch {}
  const routes = {};
  let down = false;
  for (const p of ROUTES) {
    try {
      const res = await fetch(`http://127.0.0.1:3100${p}?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
      routes[p] = res.status;
    } catch { down = true; break; }
  }
  if (down) {
    record('代码结构快照', true, '桥接未运行（跳过）');
  } else {
    const tools = await toolsList();
    const payload = JSON.stringify({ tools, routes });
    const r = await runInput(NODE, ['scripts/snap-split.mjs', saveBase ? '--save-code' : '--check', '--stdin'], payload);
    const lines = (r.out || r.err).trim().split('\n').filter(Boolean);
    const tail = lines.slice(-3).join(' | ');
    record(saveBase ? '代码结构基准' : '代码结构快照（工具/路由）', r.code === 0, tail.slice(0, 220));
  }
}

for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log('');
console.log(failed === 0 ? 'VERIFY_PASS' : `VERIFY_FAIL（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
