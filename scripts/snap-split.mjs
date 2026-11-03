#!/usr/bin/env node
// scripts/snap-split.mjs —— 把 live 快照切成两套基准（D-3：两个输出目录，不加 --scope）
//
//   snap-base/          代码结构：tools + routes。不含任何提示词文本或字节数。
//   snap-base-persona/  人格内容：三份提示词的 bytes/lines/sha256/小节/正文。
//                       正文含人格内容，权限 600，永不进 git（落在 state 目录里）。
//
// 用法：
//   node scripts/snap-split.mjs            # 只读：打印 live 摘要，不写文件
//   node scripts/snap-split.mjs --save     # 写基准；已存在则拒绝，除非再加 --force
//   node scripts/snap-split.mjs --check    # 与基准比对：代码侧差异 exit 1；
//                                          #   人格侧差异只报告（加 --strict 也变成 exit 1）
//
// 输入：/tmp/snap-live/snap.json（由 scripts/snapshot.mjs 生成）
// 输出：$SURFCORE_STATE_DIR/snap/…（默认 ~/.dsh/surfcore/snap/）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LIVE = process.env.SNAP_LIVE || '/tmp/snap-live/snap.json';
const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh/surfcore');
const ROOT = path.join(STATE, 'snap');
const CODE_FILE = path.join(ROOT, 'snap-base', 'code.json');
const PERSONA_FILE = path.join(ROOT, 'snap-base-persona', 'persona.json');

const args = process.argv.slice(2);
const mode = args.includes('--save') ? 'save' : args.includes('--check') ? 'check' : 'show';
const force = args.includes('--force');
const strict = args.includes('--strict');

// 会话 key 属于隐私：写进基准前归一成 private:#1 / group:#1 …（与 scripts/verify.mjs 一致）
function normKeys(prompts) {
  let p = 0, g = 0;
  const out = {};
  for (const k of Object.keys(prompts || {})) {
    out[k.startsWith('private:') ? `private:#${++p}` : `group:#${++g}`] = prompts[k];
  }
  return out;
}

// 只抽小节标题（【…】 与 ## / ### 开头），不抽正文
function titlesOf(hint) {
  const t = [];
  for (const line of String(hint || '').split('\n')) {
    const s = line.trim();
    const m = /^【[^】]{1,30}】/.exec(s);
    if (m) { t.push(m[0]); continue; }
    if (/^#{2,3}\s/.test(s)) t.push(s.slice(0, 40));
  }
  return [...new Set(t)];
}

// 易变小节：内容随时间/消息量自己变化（群聊近况、记忆、最近事件）。
// 实测 2026-11-03 20:13：private 正文 23 分钟内 13568B → 13621B，原因就是这些小节。
// 它们必须留在 persona 正文里（看得见），但不参与"稳定哈希"，否则人格基准每天都会红。
const VOLATILE = [
  /^【群里刚在说】/,
  /^【各群在聊什么/,
  /^【\d{5,12}】/,
  /^##\s*最近记得的/,
  /^##\s*正在模糊的事/,
];

function isHeading(s) {
  return /^【[^】]{1,30}】/.test(s) || /^#{2,3}\s/.test(s);
}

// 去掉易变小节后剩下的正文 → 稳定哈希的输入
function stableOf(hint) {
  const out = [];
  const dropped = [];
  let skipping = false;
  for (const line of String(hint || '').split('\n')) {
    const s = line.trim();
    if (isHeading(s)) {
      skipping = VOLATILE.some((re) => re.test(s));
      if (skipping) dropped.push(s.slice(0, 30));
    }
    if (!skipping) out.push(line);
  }
  return { text: out.join('\n'), dropped };
}

function readLive() {
  if (!fs.existsSync(LIVE)) {
    console.error(`没有 live 快照：${LIVE}\n先跑 node scripts/snapshot.mjs`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(LIVE, 'utf8'));
}

function build(snap) {
  const code = {
    schema: 'snap-code/v1',
    at: new Date().toISOString(),
    tools: { count: snap.tools?.count ?? 0, names: snap.tools?.names ?? [] },
    routes: snap.routes || {},
  };
  const src = normKeys(snap.prompts);
  const persona = {
    schema: 'snap-persona/v1',
    at: new Date().toISOString(),
    note: '含人格正文，禁止提交进 git',
    prompts: {},
  };
  for (const [k, v] of Object.entries(src)) {
    const hint = v?.hint ?? '';
    const st = stableOf(hint);
    persona.prompts[k] = {
      status: v?.status ?? null,
      bytes: hint.length,
      lines: hint ? hint.split('\n').length : 0,
      sha256: crypto.createHash('sha256').update(hint).digest('hex'),
      titles: titlesOf(hint),
      stableBytes: st.text.length,
      stableSha256: crypto.createHash('sha256').update(st.text).digest('hex'),
      volatile: st.dropped,
      text: hint,
    };
  }
  return { code, persona };
}

function write(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 1), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function check(built) {
  const diffs = [];
  const pdiffs = [];
  const drift = [];
  if (!fs.existsSync(CODE_FILE)) {
    diffs.push('缺少代码基准 code.json（先跑 --save）');
  } else {
    let base = null;
    try { base = JSON.parse(fs.readFileSync(CODE_FILE, 'utf8')); } catch (e) { diffs.push('code.json 解析失败：' + e.message); }
    if (base) {
      const bt = base.tools?.count ?? 0, ct = built.code.tools.count;
      if (bt !== ct) diffs.push(`工具数 ${bt}→${ct}`);
      else {
        const gone = (base.tools?.names || []).filter((n) => !built.code.tools.names.includes(n));
        const add = built.code.tools.names.filter((n) => !(base.tools?.names || []).includes(n));
        if (gone.length) diffs.push('工具消失 ' + gone.join(','));
        if (add.length) diffs.push('工具新增 ' + add.join(','));
      }
      for (const [p, st] of Object.entries(built.code.routes)) {
        if (base.routes?.[p] !== st) diffs.push(`路由 ${p} ${base.routes?.[p]}→${st}`);
      }
    }
  }
  if (!fs.existsSync(PERSONA_FILE)) {
    pdiffs.push('缺少人格基准 persona.json（先跑 --save）');
  } else {
    let base = null;
    try { base = JSON.parse(fs.readFileSync(PERSONA_FILE, 'utf8')); } catch (e) { pdiffs.push('persona.json 解析失败：' + e.message); }
    if (base) {
      for (const [k, v] of Object.entries(built.persona.prompts)) {
        const a = base.prompts?.[k];
        if (!a) { pdiffs.push(`${k} 基准缺失`); continue; }
        if ((a.stableSha256 ?? a.sha256) !== v.stableSha256) {
          const gone = (a.titles || []).filter((t) => !v.titles.includes(t));
          const add = v.titles.filter((t) => !(a.titles || []).includes(t));
          pdiffs.push(`${k} 稳定正文变化 ${a.stableBytes ?? a.bytes}→${v.stableBytes}B${add.length ? ' +小节:' + add.join('|') : ''}${gone.length ? ' -小节:' + gone.join('|') : ''}`);
        } else if (a.sha256 !== v.sha256) {
          drift.push(`${k} 只有易变小节变了 ${a.bytes}→${v.bytes}B（不算改变）`);
        }
      }
    }
  }

  for (const p of Object.keys(built.persona.prompts)) {
    const v = built.persona.prompts[p];
    console.log(`  ${p}: ${v.bytes}B / ${v.lines} 行 / ${v.titles.length} 小节 / 稳定 ${v.stableBytes}B / sha=${v.stableSha256.slice(0, 12)}`);
  }
  if (drift.length) { console.log('\n易变小节漂移（不算改变）：'); for (const d of drift) console.log('  · ' + d); }
  if (diffs.length) { console.log('\n代码侧差异（硬失败）：'); for (const d of diffs) console.log('  ✗ ' + d); }
  else console.log('\n代码侧：一致（工具/路由）');
  if (pdiffs.length) { console.log('\n人格侧差异（只有人格 commit 才应出现）：'); for (const d of pdiffs) console.log('  Δ ' + d); }
  else console.log('人格侧：一致');
  const bad = diffs.length > 0 || (strict && pdiffs.length > 0);
  console.log(bad ? '\nSNAP_FAIL' : '\nSNAP_OK');
  process.exit(bad ? 1 : 0);
}

const snap = readLive();
const built = build(snap);

if (mode === 'save') {
  if (!force && (fs.existsSync(CODE_FILE) || fs.existsSync(PERSONA_FILE))) {
    console.error('基准已存在，拒绝覆盖。确需重建请加 --force（这等于重新定义"没改坏"，非必要不做）');
    process.exit(1);
  }
  write(CODE_FILE, built.code);
  write(PERSONA_FILE, built.persona);
  console.log('已写入：');
  console.log('  ' + CODE_FILE);
  console.log('  ' + PERSONA_FILE);
  for (const [k, v] of Object.entries(built.persona.prompts)) console.log(`  ${k}: ${v.bytes}B / ${v.lines} 行 / 稳定 ${v.stableBytes}B`);
  process.exit(0);
}

if (mode === 'check') process.exit(check(built) ?? 0);

// 默认：只读摘要
console.log('live 摘要（不写任何文件）：');
console.log(`  工具：${built.code.tools.count} 个`);
console.log(`  路由：${Object.entries(built.code.routes).map(([k, v]) => k + '=' + v).join(' ')}`);
for (const [k, v] of Object.entries(built.persona.prompts)) console.log(`  ${k}: ${v.bytes}B / ${v.lines} 行 / ${v.titles.length} 小节`);
console.log(`\n基准位置：${ROOT}`);
