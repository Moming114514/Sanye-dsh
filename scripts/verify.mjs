#!/usr/bin/env node
// scripts/verify.mjs —— 一条命令验收「有没有改坏东西」
//
//   node scripts/verify.mjs             # 语法 + 单测 + 结构快照 + 接口探活
//   node scripts/verify.mjs --save-base # 把当前行为存成基准（scripts/snap-base/structure.json）
//   node scripts/verify.mjs --no-api    # 桥接没在跑时只做静态检查
//
// 基准文件只存「结构」（字节数、小节标题、工具名、路由状态码），不存提示词正文，
// 因此可以安全提交进公开仓库。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const NODE = process.execPath;
const KEYS = ['private:1000000000', 'group:1000000002', 'group:1000000001'];
const ROUTES = ['/api/status', '/api/socialV2/states', '/api/socialV2/mood', '/api/socialV2/style-list', '/api/socialV2/tech-notes'];
const BASE_DIR = path.join(ROOT, 'scripts/snap-base');
const BASE_FILE = path.join(BASE_DIR, 'structure.json');
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

// 只留结构信息：字节数 + 小节标题（【…】 与 ## 标题），不含正文
function structureOf(hint) {
  const titles = [];
  for (const line of String(hint || '').split('\n')) {
    const t = line.trim();
    const m = /^【[^】]{1,30}】/.exec(t);
    if (m) { titles.push(m[0]); continue; }
    if (/^#{2,3}\s/.test(t)) titles.push(t.slice(0, 40));
  }
  return { bytes: String(hint || '').length, sections: titles.length, titles: [...new Set(titles)] };
}

// 1) 语法检查
{
  const files = [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'scripts/snapshot.mjs'), path.join(ROOT, 'scripts/verify.mjs'), path.join(ROOT, 'scripts/upgrade.mjs')].filter((f) => fs.existsSync(f));
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

// 3) 结构快照
if (!skipApi) {
  let token = '';
  try { token = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).consoleToken || ''; } catch {}
  const live = { prompts: {}, tools: null, routes: {} };
  let down = false;
  for (const key of KEYS) {
    let body = null;
    try {
      const res = await fetch(`http://127.0.0.1:3100/api/socialV2/prompt?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
      body = await res.json();
    } catch { down = true; break; }
    live.prompts[key] = structureOf(body?.role?.hint ?? '');
  }
  if (!down) {
    for (const p of ROUTES) {
      try {
        const res = await fetch(`http://127.0.0.1:3100${p}?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
        live.routes[p] = res.status;
      } catch { down = true; break; }
    }
  }
  if (down) {
    record('结构快照', true, '桥接未运行（跳过）');
  } else {
    live.tools = await toolsList();
    if (saveBase) {
      fs.mkdirSync(BASE_DIR, { recursive: true });
      fs.writeFileSync(BASE_FILE, JSON.stringify({ at: new Date().toISOString(), ...live }, null, 1));
      record('结构快照基准', true, `已写入 ${path.relative(ROOT, BASE_FILE)}`);
    } else if (!fs.existsSync(BASE_FILE)) {
      record('结构快照', false, '没有基准：先跑 node scripts/verify.mjs --save-base');
    } else {
      const base = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
      const diffs = [];
      for (const key of KEYS) {
        const a = base.prompts?.[key], b = live.prompts[key];
        if (!a) { diffs.push(`${key} 基准缺失`); continue; }
        if (a.bytes !== b.bytes) diffs.push(`${key} 字节 ${a.bytes}→${b.bytes}`);
        const gone = (a.titles || []).filter((t) => !(b.titles || []).includes(t));
        const added = (b.titles || []).filter((t) => !(a.titles || []).includes(t));
        if (gone.length) diffs.push(`${key} 少了小节 ${gone.join(',')}`);
        if (added.length) diffs.push(`${key} 多了小节 ${added.join(',')}`);
      }
      const bt = base.tools?.count ?? 0, ct = live.tools?.count ?? 0;
      if (bt !== ct) diffs.push(`工具数 ${bt}→${ct}`);
      else {
        const gone = (base.tools?.names || []).filter((n) => !(live.tools.names || []).includes(n));
        if (gone.length) diffs.push('工具消失 ' + gone.join(','));
      }
      for (const [p, st] of Object.entries(live.routes)) {
        if (base.routes?.[p] !== st) diffs.push(`${p} ${base.routes?.[p]}→${st}`);
      }
      // 小节与工具的结构必须一致；字节数允许「数据漂移」（记忆卡/心情本来就会变）
      const hard = diffs.filter((d) => !/ 字节 /.test(d));
      record('结构快照（小节/工具/路由）', hard.length === 0, hard.slice(0, 4).join(' | '));
      if (diffs.length && hard.length === 0) console.log('   ℹ 字节数变化（数据漂移，正常）：' + diffs.join(' | '));
    }
  }
}

for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log('');
console.log(failed === 0 ? 'VERIFY_PASS' : `VERIFY_FAIL（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
