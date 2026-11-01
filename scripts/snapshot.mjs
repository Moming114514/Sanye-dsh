#!/usr/bin/env node
// scripts/snapshot.mjs —— M2 重构的行为快照工具
//
// 用法：
//   node scripts/snapshot.mjs             # 生成快照到 /tmp/snap-live/
//   node scripts/snapshot.mjs --diff      # 与 /tmp/snap-base/ 对比，只打印差异
//   node scripts/snapshot.mjs --save-base # 把当前快照存为基准
//
// 抓的东西：三份提示词（私聊 / 两个群）、MCP 工具清单、几个只读接口的状态码。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = '/home/dsh/apps/surfcore';
const BASE = '/tmp/snap-base';
const LIVE = '/tmp/snap-live';
const KEYS = ['private:1000000000', 'group:1000000002', 'group:1000000001'];

const token = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).consoleToken;

async function j(url) {
  const r = await fetch(url);
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: { raw: text.slice(0, 200) } }; }
}

function toolsList() {
  return new Promise((resolve) => {
    const p = spawn('/opt/node-v22.23.4/bin/node', [path.join(ROOT, 'src/mcp-snowluma-safe.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    const done = (v) => { try { p.kill(); } catch {} resolve(v); };
    const timer = setTimeout(() => done({ error: 'timeout' }), 15000);
    p.stdout.on('data', (c) => {
      buf += c;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 2 && m.result?.tools) {
            clearTimeout(timer);
            done({ count: m.result.tools.length, names: m.result.tools.map((t) => t.name).sort() });
          }
        } catch {}
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'snap', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  });
}

async function main() {
  const out = { at: new Date().toISOString(), prompts: {}, routes: {}, tools: null };
  for (const key of KEYS) {
    const r = await j(`http://127.0.0.1:3100/api/socialV2/prompt?key=${encodeURIComponent(key)}&token=${token}`);
    const hint = r.body?.role?.hint ?? '';
    out.prompts[key] = { status: r.status, hintLen: hint.length, hint };
  }
  for (const p of ['/api/status', '/api/socialV2/states', '/api/socialV2/mood', '/api/socialV2/style-list', '/api/socialV2/tech-notes']) {
    const r = await j(`http://127.0.0.1:3100${p}?token=${token}`);
    out.routes[p] = r.status;
  }
  out.tools = await toolsList();

  const dir = process.argv.includes('--save-base') ? BASE : LIVE;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'snap.json'), JSON.stringify(out, null, 1));

  if (process.argv.includes('--diff')) {
    if (!fs.existsSync(path.join(BASE, 'snap.json'))) { console.log('没有基准快照，先跑 --save-base'); return; }
    const base = JSON.parse(fs.readFileSync(path.join(BASE, 'snap.json'), 'utf8'));
    let bad = 0;
    for (const key of KEYS) {
      const a = base.prompts?.[key]?.hint ?? '';
      const b = out.prompts[key].hint;
      const la = a.split('\n'), lb = b.split('\n');
      const added = lb.filter((x) => !la.includes(x));
      const removed = la.filter((x) => !lb.includes(x));
      console.log(`${key}: len ${a.length} -> ${b.length} (+${added.length}/-${removed.length} 行)`);
      for (const x of added.slice(0, 5)) console.log('   + ' + x.slice(0, 110));
      for (const x of removed.slice(0, 5)) console.log('   - ' + x.slice(0, 110));
    }
    const bt = base.tools?.count, ct = out.tools?.count;
    console.log(`tools: ${bt} -> ${ct}${bt === ct ? '' : '  ⚠ 数量变了'}`);
    if (bt === ct) {
      const bn = base.tools?.names || [], cn = out.tools?.names || [];
      const gone = bn.filter((n) => !cn.includes(n));
      const added = cn.filter((n) => !bn.includes(n));
      if (gone.length || added.length) { bad++; console.log('  ⚠ 工具名变化 gone=' + gone.join(',') + ' added=' + added.join(',')); }
    } else bad++;
    for (const [p, st] of Object.entries(out.routes)) {
      if (base.routes?.[p] !== st) { bad++; console.log(`route ${p}: ${base.routes?.[p]} -> ${st}`); }
    }
    console.log(bad ? `\n有 ${bad} 处结构差异需要人看` : '\n结构一致（提示词差异若只是数据漂移即可）');
  } else {
    console.log('快照已写入 ' + dir);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
