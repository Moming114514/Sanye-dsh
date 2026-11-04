#!/usr/bin/env node
// 检查「文案里点名的工具」与 lean 档保留清单是否冲突。
//
// 用途：开 lean 档前先跑这个脚本。被点名的工具如果会被 lean 隐藏，模型会看到
// 文案里提了玩法、但没有对应 schema，白跑一轮。冲突不为 0 就不要开。
//
// 用法：
//   node scripts/check-tool-mentions.mjs          # 人读表格
//   node scripts/check-tool-mentions.mjs --json   # 机器读
// 退出码：0 = 无冲突；1 = 有冲突（可直接进 CI）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOME = process.env.HOME || os.homedir();
const MCP_FILE = path.join(REPO, 'src', 'mcp-snowluma-safe.js');
const JSON_MODE = process.argv.includes('--json');

const NAME_RE = /\b(qq_[a-z0-9_]+|video_storyboard|note_tech)\b/g;
const MAX_POS_PER_NAME = 4;

function readLeanKeep() {
  const src = fs.readFileSync(MCP_FILE, 'utf8');
  const m = src.match(/LEAN_TOOL_NAMES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error('mcp-snowluma-safe.js 里找不到 LEAN_TOOL_NAMES');
  const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return new Set(names);
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(md|txt|ya?ml|json|mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

// 扫描范围：桥接主体、仓库文档（含 handoff 任务文案）、角色包、DSH preset/插件文案
function scanRoots() {
  const files = [];
  const bridge = path.join(REPO, 'src', 'bridge.js');
  if (fs.existsSync(bridge)) files.push(bridge);
  files.push(...walk(path.join(REPO, 'docs')));
  files.push(...walk(path.join(HOME, '.dsh', 'surfcore', 'characters')));
  const profiles = path.join(HOME, '.dsh', 'profiles');
  if (fs.existsSync(profiles)) {
    for (const prof of fs.readdirSync(profiles)) {
      const dir = path.join(profiles, prof);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
      } catch { continue; }
      // preset 文案 + 插件源码；跳过 web/node_modules 与产物目录
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const p = path.join(dir, e.name);
        if (e.isFile() && /\.(ya?ml|md|mjs|js)$/.test(e.name)) files.push(p);
      }
      files.push(...walk(path.join(dir, 'plugins')));
    }
  }
  return [...new Set(files)];
}

function collectMentions(files) {
  const byName = new Map(); // name -> [{file,line}]
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(NAME_RE)) {
        const name = m[1];
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push({ file, line: i + 1 });
      }
    });
  }
  return byName;
}

function shortPath(p) {
  const rel = path.relative(REPO, p);
  if (!rel.startsWith('..')) return rel;
  const h = path.relative(HOME, p);
  return h.startsWith('..') ? p : '~/' + h;
}

// 给出现位置归类：桥接代码 / 仓库文档 / 角色包 / preset
function sourceOf(file) {
  if (file === path.join(REPO, 'src', 'bridge.js')) return 'bridge';
  if (file.startsWith(path.join(REPO, 'docs'))) return 'docs';
  if (file.startsWith(path.join(HOME, '.dsh', 'surfcore', 'characters'))) return 'characters';
  return 'preset';
}

function registeredTools() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [MCP_FILE], {
      cwd: REPO,
      env: { ...process.env, SURFCORE_TOOL_PROFILE: 'full' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let done = false;
    const finish = (names) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch {}
      resolve(names);
    };
    child.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          if (j.id === 2) finish((j.result?.tools ?? []).map((t) => t.name));
        } catch {}
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mention-check', version: '1' } } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    setTimeout(() => finish([]), 5000);
  });
}

const keep = readLeanKeep();
const files = scanRoots();
const mentions = collectMentions(files);
const registered = await registeredTools();
const registeredSet = new Set(registered);
if (!registered.length) console.error('⚠️ 拉不到 MCP tools/list（服务未起来？），只按清单判断');

const conflicts = [];
const notRegistered = [];
for (const [name, positions] of mentions) {
  if (keep.has(name)) continue;
  if (registeredSet.size && !registeredSet.has(name)) {
    if (/^(qq_|note_tech)/.test(name)) notRegistered.push({ name, count: positions.length });
    continue;
  }
  conflicts.push({
    name,
    count: positions.length,
    sources: [...new Set(positions.map((p) => sourceOf(p.file)))].sort(),
    positions: positions.slice(0, MAX_POS_PER_NAME).map((p) => `${shortPath(p.file)}:${p.line}`),
    more: Math.max(0, positions.length - MAX_POS_PER_NAME),
  });
}
conflicts.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

if (JSON_MODE) {
  console.log(JSON.stringify({ keep: keep.size, files: files.length, registered: registered.length, leanHidden: registered.length - registered.filter((n) => keep.has(n)).length, conflicts, notRegistered }, null, 2));
} else {
  console.log(`lean 保留 ${keep.size} 个 / 实际注册 ${registered.length} 个 / 扫描 ${files.length} 个文件`);
  console.log(`被文案点名、但会被 lean 隐藏的工具：${conflicts.length} 个`);
  if (conflicts.length) {
    console.log('');
    console.log('工具名 | 出现位置(文件:行) | 出现次数');
    for (const c of conflicts) {
      const pos = c.positions.join(' · ') + (c.more ? ` · …另 ${c.more} 处` : '');
      console.log(`${c.name} | ${pos} | ${c.count}`);
    }
  }
  if (notRegistered.length) {
    console.log('');
    console.log(`另有 ${notRegistered.length} 个被点名但当前未注册（配置关闭/不在本 server）：${notRegistered.map((x) => x.name).join(', ')}`);
  }
  const bySource = { bridge: 0, docs: 0, characters: 0, preset: 0 };
  for (const c of conflicts) for (const s of c.sources) bySource[s] += 1;
  console.log('');
  console.log(`按来源（冲突工具数）：bridge ${bySource.bridge} · docs ${bySource.docs} · characters ${bySource.characters} · preset ${bySource.preset}`);
  console.log('提示：bridge.js 里多数是 toolMap/enabledTools 的权限名单，不是提示词文案；真正会让模型照文案去找工具的是 characters / preset。');
  console.log('');
  console.log(`CONFLICT_COUNT=${conflicts.length}`);
}
process.exit(conflicts.length ? 1 : 0);
