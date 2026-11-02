// scripts/gen-index.mjs —— 自动生成 docs/INDEX.md（功能索引），避免每次靠 grep 翻代码
// 用法：node scripts/gen-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs', 'INDEX.md');
const lines = [];
const add = (s = '') => lines.push(s);

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

// 1) 扩展模块：src/ext/*.js
const extDir = path.join(ROOT, 'src', 'ext');
const extFiles = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((f) => f.endsWith('.js') && f !== 'index.js') : [];

// 2) 桥接里的 HTTP 路由
const bridge = read(path.join(ROOT, 'src', 'bridge.js'));
const routes = [...new Set([...bridge.matchAll(/url\.pathname === '([^']+)'/g)].map((m) => m[1]))].sort();

// 3) 聊天命令
const cmds = [...new Set([...bridge.matchAll(/lowerCmd === '(\/[^']+)'/g)].map((m) => m[1]))];
const cmds2 = [...new Set([...bridge.matchAll(/=== '(\/[\u4e00-\u9fa5A-Za-z]{2,10})'/g)].map((m) => m[1]))];
const commands = [...new Set([...cmds, ...cmds2])].sort();

// 4) 脚本
const scriptsDir = path.join(ROOT, 'scripts');
const scripts = fs.existsSync(scriptsDir) ? fs.readdirSync(scriptsDir).filter((f) => /\.(mjs|sh)$/.test(f)).sort() : [];

// 5) 定时器（本机 systemd）
let timers = [];
try {
  timers = execSync('systemctl list-timers --all --no-pager --plain 2>/dev/null | grep -i sanye | awk \'{print $NF}\'', { shell: '/bin/bash' })
    .toString().trim().split('\n').filter(Boolean);
} catch {}

// 6) 补丁标记统计
const patches = {};
for (const f of [...fs.readdirSync(path.join(ROOT, 'src')).filter((x) => x.endsWith('.js')).map((x) => path.join('src', x)), ...extFiles.map((x) => path.join('src', 'ext', x))]) {
  const t = read(path.join(ROOT, f));
  for (const m of t.matchAll(/([A-Z0-9_]{3,})_PATCH/g)) patches[m[1] + '_PATCH'] = (patches[m[1] + '_PATCH'] || 0) + 1;
}

add('# 功能索引（自动生成）');
add('');
add('> 由 `node scripts/gen-index.mjs` 生成，别手改。查东西先看这里，再去对应文件。');
add('');
add('## 扩展模块（src/ext/*.js）');
add('');
add('| 模块 | 说明（首行注释） |');
add('|---|---|');
for (const f of extFiles) {
  const t = read(path.join(extDir, f));
  const first = (t.split('\n').find((l) => l.trim().startsWith('//') && l.trim().length > 6) || '').replace(/^\/\/\s*/, '').slice(0, 60);
  add(`| ${f} | ${first || '—'} |`);
}
add('');
add('## HTTP 路由（bridge.js 里注册的）');
add('');
for (const r of routes) add(`- \`${r}\``);
add('');
add('## 聊天命令（管理员/主人可用）');
add('');
for (const c of commands) add(`- \`${c}\``);
add('');
add('## 脚本（scripts/）');
add('');
for (const s of scripts) add(`- \`scripts/${s}\``);
add('');
add('## 定时器');
add('');
for (const t of timers) add(`- \`${t}\``);
add('');
add('## 补丁标记（出现次数）');
add('');
add('| 标记 | 次数 |');
add('|---|---|');
for (const [k, v] of Object.entries(patches).sort((a, b) => b[1] - a[1])) add(`| \`${k}\` | ${v} |`);
add('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`INDEX 已生成：${OUT}（扩展 ${extFiles.length} / 路由 ${routes.length} / 命令 ${commands.length} / 脚本 ${scripts.length}）`);
