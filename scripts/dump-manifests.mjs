#!/usr/bin/env node
// scripts/dump-manifests.mjs —— 扫 src/ext/*.js，输出并校验每个模块的 manifest
//
//   node scripts/dump-manifests.mjs            # 表格 + 汇总
//   node scripts/dump-manifests.mjs --strict   # 有「manifest 不合格」就 exit 1（缺 manifest 仍只算未迁移）
//   node scripts/dump-manifests.mjs --require-all --strict
//                                              # 波 2 收尾门槛：缺 manifest 也算失败
//   node scripts/dump-manifests.mjs --json     # 另写 docs/generated/manifests.json
//   node scripts/dump-manifests.mjs --selftest # 用 3 正例 + 4 反例自检校验器本身
//   node scripts/dump-manifests.mjs --order-map # 打印「EXTENSIONS 第几位 → 该给的 order」
//
// 契约：docs/EXT-MANIFEST.md
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const EXT_DIR = path.join(ROOT, 'src', 'ext');
const OUT_FILE = path.join(ROOT, 'docs', 'generated', 'manifests.json');

const HOOKS = ['promptBlock', 'wakeGate', 'routes', 'onGroupMessage', 'onPrivateMessage', 'afterSend', 'stateKey'];
const KINDS = ['core', 'hook', 'tool', 'panel'];
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const CFG_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/; // 允许顶层单段（如 ownerQQ）

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const requireAll = args.has('--require-all');
const wantJson = args.has('--json');
const selftest = args.has('--selftest');
const orderMapOnly = args.has('--order-map');

function isFn(v) { return typeof v === 'function'; }
function isBool(v) { return typeof v === 'boolean'; }
function isPosInt(v) { return Number.isInteger(v) && v > 0; }

function hasHook(mod, name) {
  const d = mod?.default;
  if (name === 'routes') {
    const r = d?.routes ?? mod?.routes;
    return Array.isArray(r) || isFn(r);
  }
  return isFn(d?.[name]) || isFn(mod?.[name]);
}

// m: manifest 对象；ctx: { file, impl(模块命名空间), id }。
// 返回 { errors: string[], warnings: string[] }；errors 为空即合格。
function validate(m, ctx = {}) {
  const errors = [];
  const warnings = [];
  const impl = ctx.impl;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { errors: ['manifest 不是对象'], warnings };

  // R1 id
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) errors.push(`id 非法：「${m.id}」（应匹配 ^[a-z][a-z0-9-]{1,31}$）`);
  else if (ctx.file && m.id !== path.basename(ctx.file, '.js')) {
    // 少数模块的运行时实例 id 与文件名不同（如 advice-capture.js 的实例 id 是 advice）。
    // 只要 manifest.id 与实例 id 一致，就记警告而不是报错；否则肯定是写错了。
    if (ctx.instanceId && ctx.instanceId === m.id) {
      warnings.push(`id「${m.id}」与文件名「${path.basename(ctx.file)}」不同（实例 id 就是它，历史原因；日志前缀仍是 ${m.id}）`);
    } else {
      errors.push(`id「${m.id}」与文件名「${path.basename(ctx.file)}」不一致`);
    }
  }

  // R3 title
  if (typeof m.title !== 'string' || !m.title.trim()) errors.push('title 缺失');
  else if (m.title.length > 24) errors.push(`title 过长（${m.title.length} 字，上限 24）`);

  // R4 kind / 布尔
  if (!KINDS.includes(m.kind)) errors.push(`kind 非法：「${m.kind}」（只能是 ${KINDS.join('/')}）`);
  if (!isBool(m.enabledByDefault)) errors.push('enabledByDefault 必须是 boolean');
  if (!isBool(m.hot)) errors.push('hot 必须是 boolean');

  // R5 hooks 白名单
  if (!Array.isArray(m.hooks)) errors.push('hooks 必须是数组（没有钩子写 []）');
  else {
    for (const h of m.hooks) if (!HOOKS.includes(h)) errors.push(`未知钩子「${h}」（白名单：${HOOKS.join(', ')}）`);
    // R6 声明了必须真有实现
    if (impl) for (const h of m.hooks) if (HOOKS.includes(h) && !hasHook(impl, h)) errors.push(`声明了 ${h} 但没实现`);
    if (m.hooks.includes('promptBlock') && !m.hooks.includes('stateKey')) {
      warnings.push('有 promptBlock 但没有 stateKey：内容会拼进全局提示词，污染所有会话缓存');
    }
  }

  // R7 order
  if (m.order !== undefined && !isPosInt(m.order)) errors.push(`order 非法：「${m.order}」（正整数）`);
  if (Array.isArray(m.hooks) && m.hooks.includes('promptBlock') && m.order === undefined) {
    errors.push('有 promptBlock 必须给 order（提示词注入顺序）');
  }

  // R8 pages（v1 删除：等 /api/plugins 真被消费、且能证明"页面只从一个来源渲染"再加，见 m00399）
  if (m.pages !== undefined) {
    errors.push('v1 不支持 pages 字段（决策 m00399：面板仍用 PAGES + features.json）');
  }

  // R9 config / stateFiles
  if (m.config !== undefined) {
    if (!Array.isArray(m.config)) errors.push('config 必须是数组');
    else for (const c of m.config) if (typeof c !== 'string' || !CFG_RE.test(c)) errors.push(`config 点路径非法：「${c}」`);
  }
  if (m.stateFiles !== undefined) {
    if (!Array.isArray(m.stateFiles)) errors.push('stateFiles 必须是数组');
    else for (const f of m.stateFiles) {
      if (typeof f !== 'string' || !f || f.includes('/') || f.includes('\\') || f.includes('..')) {
        errors.push(`stateFiles 非法：「${f}」（只写文件名，不含路径）`);
      }
    }
  }

  return { errors, warnings };
}

// ---------- 注册顺序 → order 对照 ----------
// 提示词注入顺序 = EXTENSIONS 数组顺序。order 用「下标 ×10 + 10」写死（m00399），
// 这样以后调顺序是改 index.js + 各 manifest 的一处可见改动，而不是靠数组位置悄悄变。
function parseExtensions() {
  const file = path.join(EXT_DIR, 'index.js');
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const imported = new Map();
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'\.\/([\w.-]+)\.js'/g)) imported.set(m[1], m[2] + '.js');
  // 装配表是 MODULES（namespace 导入 + {name, mod}），EXTENSIONS 由它派生，不再手写数组
  const block = /const\s+MODULES\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (!block) return [];
  const body = block[1];
  const heads = [...body.matchAll(/\{\s*name:\s*'([^']+)',\s*mod:\s*(\w+)/g)];
  const rows = [];
  heads.forEach((h, i) => {
    // 每个条目从 name 开始到下一个条目之前，用来判断有没有 factory（工厂条目需要实例化后才能校验钩子）
    const seg = body.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : body.length);
    const fileName = imported.get(h[2]) || null;
    rows.push({
      name: fileName ? fileName.replace(/\.js$/, '') : h[2],
      file: fileName,
      factory: /\bfactory\s*:/.test(seg),
    });
  });
  return rows.map((r, i) => ({ ...r, order: (i + 1) * 10, index: i }));
}

function printOrderMap() {
  const plan = parseExtensions();
  if (!plan.length) { console.error('解析不出 src/ext/index.js 的 EXTENSIONS 数组'); process.exit(2); }
  console.log(`EXTENSIONS 顺序 → manifest.order（${plan.length} 个，每步 +10）\n`);
  for (const p of plan) console.log(`  order=${String(p.order).padEnd(3)} ${(p.file || p.name).padEnd(22)} 下标 ${p.index}`);
  const unknown = plan.filter((p) => !p.file);
  if (unknown.length) console.log(`\n  ⚠ 解析不出文件：${unknown.map((p) => p.name).join(',')}`);
  console.log('\n把上面的数字原样写进各模块 manifest 的 order。');
}

// ---------- 自检：3 个正例 + 4 个反例 ----------
function selftestRun() {
  const implOk = () => {
    const f = () => {};
    return { default: { promptBlock: f, wakeGate: f, routes: [], stateKey: f, afterSend: f }, routes: [] };
  };
  const cases = [
    { name: '纯函数', expect: null, manifest: { id: 'memory-card', title: '记忆卡片上限', kind: 'core', enabledByDefault: true, hot: false, hooks: [] }, impl: { default: () => {} } },
    { name: '写自身 state', expect: null, manifest: { id: 'group-rate', title: '群聊频率', kind: 'hook', enabledByDefault: true, hot: true, order: 50, config: ['socialV2.groupRate'], stateFiles: ['group-rate.json'], hooks: ['promptBlock', 'routes', 'stateKey'] }, impl: implOk() },
    { name: '带 route', expect: null, manifest: { id: 'tech-notes', title: '技术笔记', kind: 'hook', enabledByDefault: true, hot: true, order: 140, hooks: ['promptBlock', 'routes', 'stateKey'] }, impl: implOk() },
    { name: '反例：钩子拼错 route', expect: '未知钩子', manifest: { id: 'x-bad1', title: '拼错', kind: 'hook', enabledByDefault: true, hot: true, order: 10, hooks: ['promptBlock', 'route'] }, impl: implOk() },
    { name: '反例：声明了没实现', expect: '但没实现', manifest: { id: 'x-bad2', title: '空声明', kind: 'hook', enabledByDefault: true, hot: true, hooks: ['afterSend'] }, impl: { default: () => {} } },
    { name: '反例：pages 字段', expect: 'v1 不支持 pages', manifest: { id: 'x-bad3', title: '页', kind: 'panel', enabledByDefault: true, hot: false, hooks: [], pages: [{ id: 'p1', title: 'P', api: '/api/x' }] }, impl: {} },
    { name: '反例：promptBlock 缺 order', expect: '必须给 order', manifest: { id: 'x-bad4', title: '缺序', kind: 'hook', enabledByDefault: true, hot: true, hooks: ['promptBlock', 'stateKey'] }, impl: implOk() },
  ];
  let bad = 0;
  console.log('校验器自检（3 正例 + 4 反例）\n');
  for (const c of cases) {
    const { errors } = validate(c.manifest, { impl: c.impl });
    const hit = c.expect === null ? errors.length === 0 : errors.some((e) => e.includes(c.expect));
    if (!hit) bad++;
    const mark = hit ? '✓' : '✗';
    console.log(`  ${mark} ${c.name}${c.expect ? ` → 期待命中「${c.expect}」` : ' → 期待合格'}`);
    if (!hit) console.log(`      实际：${errors.length ? errors.join(' | ') : '（无错误）'}`);
  }
  console.log(bad === 0 ? '\nSELFTEST_OK' : `\nSELFTEST_FAIL（${bad} 条不符）`);
  process.exit(bad === 0 ? 0 : 1);
}

async function main() {
  if (selftest) return selftestRun();
  if (orderMapOnly) return printOrderMap();
  if (!fs.existsSync(EXT_DIR)) {
    console.error(`找不到扩展目录：${EXT_DIR}（请在仓库根目录运行）`);
    process.exit(2);
  }
  const files = fs.readdirSync(EXT_DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').sort();
  const rows = [];
  const orderSeen = new Map();
  const idSeen = new Map();
  const orderPlan = parseExtensions();
  const expectedOrder = new Map(orderPlan.filter((p) => p.file).map((p) => [p.file, p]));

  for (const f of files) {
    const full = path.join(EXT_DIR, f);
    let mod = null;
    let importErr = null;
    try {
      mod = await import(pathToFileURL(full).href);
    } catch (e) {
      importErr = e.message.split('\n')[0];
    }
    if (importErr) {
      rows.push({ file: f, id: '', title: '', hooks: [], order: null, status: 'fail', errors: [`import 失败：${importErr}`], warnings: [] });
      continue;
    }
    const m = mod.manifest;
    if (!m) {
      rows.push({ file: f, id: '', title: '', hooks: [], order: null, status: 'missing', errors: [], warnings: ['缺 manifest（未迁移）'] });
      continue;
    }
    // 工厂模块（默认导出是 createX 函数）要先实例化，才能在实例上校验钩子——
    // 与 loader 的 instanceOf() 同一语义；工厂里只传一个空 log，不碰任何状态。
    let impl = mod;
    let factoryError = null;
    if (expectedOrder.get(f)?.factory) {
      const create = mod.default;
      if (typeof create !== 'function') {
        factoryError = `MODULES 标了 factory，但默认导出不是函数（${typeof create}）`;
      } else {
        try {
          impl = { ...mod, default: create({ log: () => {} }) };
        } catch (e) {
          factoryError = `实例化失败：${String(e?.message || e).split('\n')[0]}`;
        }
      }
    }
    const instanceId = typeof impl?.default?.id === 'string' ? impl.default.id : null;
    const { errors, warnings } = validate(m, { file: f, impl, instanceId });
    if (factoryError) errors.push(factoryError);
    if (typeof m.id === 'string') {
      if (idSeen.has(m.id)) errors.push(`id 重复：与 ${idSeen.get(m.id)} 撞了`);
      else idSeen.set(m.id, f);
    }
    if (isPosInt(m.order)) {
      if (orderSeen.has(m.order)) errors.push(`order 重复：${m.order} 已被 ${orderSeen.get(m.order)} 占用`);
      else orderSeen.set(m.order, f);
      const exp = expectedOrder.get(f);
      if (exp && m.order !== exp.order) {
        errors.push(`order 应为 ${exp.order}（EXTENSIONS 第 ${exp.index + 1} 位 ×10）；现在是 ${m.order}——改 order 等于改提示词注入顺序`);
      }
    }
    rows.push({
      file: f, id: m.id || '', title: m.title || '',
      hooks: Array.isArray(m.hooks) ? m.hooks : [], order: m.order ?? null,
      status: errors.length ? 'fail' : 'ok', errors, warnings,
    });
  }

  const ok = rows.filter((r) => r.status === 'ok');
  const fail = rows.filter((r) => r.status === 'fail');
  const missing = rows.filter((r) => r.status === 'missing');

  console.log(`扫描 ${files.length} 个模块（${EXT_DIR}）\n`);
  for (const r of rows) {
    const mark = r.status === 'ok' ? '✓' : r.status === 'missing' ? '·' : '✗';
    const hooks = r.hooks.length ? r.hooks.join(',') : '-';
    const ord = r.order === null ? '-' : String(r.order);
    console.log(`  ${mark} ${r.file.replace(/\.js$/, '').padEnd(16)} ${hooks.padEnd(34)} order=${ord}`);
    for (const e of r.errors) console.log(`      ✗ ${e}`);
    for (const w of r.warnings) console.log(`      · ${w}`);
  }

  console.log(`\n汇总：合格 ${ok.length} / 不合格 ${fail.length} / 未迁移 ${missing.length}（共 ${rows.length}）`);
  if (missing.length) console.log(`  未迁移的 ${missing.length} 个在波 2 逐个补；补完用 --require-all --strict 收口`);

  if (wantJson) {
    const payload = {
      schema: 'ext-manifests/v1',
      at: new Date().toISOString(),
      modules: rows.filter((r) => r.status === 'ok').map((r) => ({ file: r.file, id: r.id, title: r.title, hooks: r.hooks, order: r.order })),
      pending: rows.filter((r) => r.status !== 'ok').map((r) => ({ file: r.file, status: r.status, errors: r.errors })),
    };
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 1) + '\n');
    console.log(`\n已写入 ${OUT_FILE}（合格 ${payload.modules.length} 条，未迁移 ${payload.pending.length} 条）`);
  }

  const hardFail = fail.length > 0 || (requireAll && missing.length > 0);
  if (strict && hardFail) {
    console.log('\nMANIFEST_FAIL');
    process.exit(1);
  }
  console.log(strict ? '\nMANIFEST_OK（--strict 下通过）' : '\n（未加 --strict，退出码恒为 0）');
}

main().catch((e) => {
  console.error('dump-manifests 崩了：', e);
  process.exit(2);
});
