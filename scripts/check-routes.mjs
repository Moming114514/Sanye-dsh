#!/usr/bin/env node
// 路由对照：旧代码 vs 新代码的「路径集合 + 方法集合」必须一致。
// 见 docs/CONSOLE-SPLIT.md 第 4 节。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const BASE_FILE = path.join(ROOT, 'scripts/snap-base/routes.json');
const BRIDGE = path.join(ROOT, 'src/bridge.js');
const CONSOLE_DIR = path.join(ROOT, 'src/console');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : null;
};
const MODE = {
  saveBase: has('--save-base'),
  force: has('--force'),
  json: has('--json'),
  selftest: has('--selftest'),
  strictMethods: has('--strict-methods'),
  live: valOf('--live'),
  base: valOf('--base'),
};

const PATH_RE = /['"](\/api\/[A-Za-z0-9_./:~-]*)['"]/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// 每条路径向上/下看 6 行判方法；判不出记 GET（绝大多数只读接口）。
function extractFromText(text) {
  const lines = text.split('\n');
  const paths = new Map();
  let m;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text))) {
    const p = m[1];
    if (p.length < 6 || p === '/api/') continue;
    const lineNo = lineOf(text, m.index);
    const lo = Math.max(0, lineNo - 7);
    const hi = Math.min(lines.length, lineNo + 4);
    const same = lines[lineNo - 1] ?? '';
    const methods = new Set();
    const addFrom = (str) => {
      const mm = str.match(/\breq\.method\s*===?\s*['"](GET|POST|PUT|DELETE|PATCH)['"]/g) || [];
      for (const x of mm) { const g = x.match(/['"]([A-Z]+)['"]/); if (g) methods.add(g[1]); }
      const rg = str.match(/register\(\s*['"][^'"]+['"]\s*,\s*['"]([A-Z]+)['"]/);
      if (rg) methods.add(rg[1]);
    };
    // 先看路径所在行；再看窗口里「不含别的 /api 字面量」的行（避免邻居路由的方法串进来）
    addFrom(same);
    if (!methods.size) {
      for (let i = lo; i < hi; i++) {
        if (i === lineNo - 1) continue;
        if (/['"]\/api\//.test(lines[i])) continue;
        addFrom(lines[i]);
      }
    }
    if (!methods.size) methods.add('GET');
    if (!paths.has(p)) paths.set(p, new Set());
    for (const x of methods) paths.get(p).add(x);
  }
  return paths;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

function collectCurrent() {
  const all = new Map();
  const add = (map) => {
    for (const [p, set] of map) {
      if (!all.has(p)) all.set(p, new Set());
      for (const x of set) all.get(p).add(x);
    }
  };
  if (fs.existsSync(BRIDGE)) add(extractFromText(fs.readFileSync(BRIDGE, 'utf8')));
  for (const f of walk(CONSOLE_DIR)) add(extractFromText(fs.readFileSync(f, 'utf8')));
  return all;
}

function collectFromRev(rev) {
  const raw = execFileSync('git', ['show', `${rev}:src/bridge.js`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return extractFromText(raw);
}

const toObj = (map) => {
  const o = {};
  for (const p of [...map.keys()].sort()) o[p] = [...map.get(p)].sort();
  return o;
};

function loadBase() {
  if (MODE.base) return collectFromRev(MODE.base);
  if (!fs.existsSync(BASE_FILE)) return null;
  const j = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  const m = new Map();
  for (const [p, ms] of Object.entries(j.paths ?? {})) m.set(p, new Set(ms));
  return m;
}

function diffMaps(base, cur) {
  const missing = [];
  const extra = [];
  const methodDiff = [];
  for (const [p, ms] of base) {
    if (!cur.has(p)) { missing.push(p); continue; }
    const a = [...ms].sort().join(',');
    const b = [...cur.get(p)].sort().join(',');
    if (a !== b) methodDiff.push({ path: p, base: a, now: b });
  }
  for (const p of cur.keys()) if (!base.has(p)) extra.push(p);
  return { missing: missing.sort(), extra: extra.sort(), methodDiff: methodDiff.sort((x, y) => x.path.localeCompare(y.path)) };
}

function saveBase(map) {
  if (fs.existsSync(BASE_FILE) && !MODE.force) {
    console.error('基准已存在：' + BASE_FILE + '（要覆盖加 --force）');
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(BASE_FILE), { recursive: true });
  const obj = { schema: 'routes/v1', at: new Date().toISOString(), count: map.size, paths: toObj(map) };
  fs.writeFileSync(BASE_FILE, JSON.stringify(obj, null, 1) + '\n', 'utf8');
  console.log(`ROUTES_BASE_SAVED count=${map.size} file=${path.relative(ROOT, BASE_FILE)}`);
}

function selftest() {
  const base = new Map([['/api/a', new Set(['GET'])], ['/api/b', new Set(['POST'])]]);
  const cur = new Map([['/api/a', new Set(['GET'])]]);
  const d = diffMaps(base, cur);
  const okMissing = d.missing.length === 1 && d.missing[0] === '/api/b';
  const d2 = diffMaps(cur, base);
  const okExtra = d2.extra.length === 1 && d2.extra[0] === '/api/b';
  const d3 = diffMaps(new Map([['/api/c', new Set(['GET'])]]), new Map([['/api/c', new Set(['GET', 'POST'])]]));
  const okMethod = d3.methodDiff.length === 1;
  if (!okMissing || !okExtra || !okMethod) {
    console.error('CHECK_ROUTES_SELFTEST_FAIL', JSON.stringify({ okMissing, okExtra, okMethod }));
    process.exit(1);
  }
  console.log('CHECK_ROUTES_SELFTEST_OK');
}

async function liveProbe(baseline) {
  const port = MODE.live;
  const allow = ['/api/status', '/api/pending', '/api/plugins', '/api/tokens/daily', '/api/tokens/summary', '/api/tokens/series', '/api/mode', '/api/roles'];
  const results = [];
  for (const p of allow) {
    if (!baseline.has(p)) continue;
    try {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(3000) });
      results.push({ path: p, status: r.status });
    } catch (e) {
      results.push({ path: p, error: e?.message ?? String(e) });
    }
  }
  const bad = results.filter((x) => x.error || x.status >= 500 || x.status === 404);
  if (MODE.json) console.log(JSON.stringify({ live: results }, null, 2));
  else for (const x of results) console.log(`  ${x.path} → ${x.error ?? x.status}`);
  return bad;
}

(async () => {
  if (MODE.selftest) return selftest();

  const cur = collectCurrent();
  if (MODE.saveBase) return saveBase(cur);

  const base = loadBase();
  if (!base) {
    console.error('没有基准：先跑 node scripts/check-routes.mjs --save-base（只允许一次）');
    process.exit(2);
  }
  const d = diffMaps(base, cur);
  const badMethods = MODE.strictMethods ? d.methodDiff : [];
  const ok = d.missing.length === 0 && d.extra.length === 0 && badMethods.length === 0;

  if (MODE.json) {
    console.log(JSON.stringify({ ok, base: base.size, now: cur.size, ...d }, null, 2));
  } else {
    for (const x of d.methodDiff) console.log(`~ 方法差异 ${x.path}：基准 ${x.base} → 现在 ${x.now}`);
    for (const p of d.missing) console.log(`- 缺路径 ${p}`);
    for (const p of d.extra) console.log(`+ 新路径 ${p}`);
    if (ok) console.log(`ROUTES_OK count=${cur.size}`);
    else console.log(`ROUTES_DIFF missing=${d.missing.length} extra=${d.extra.length} methods=${badMethods.length}`);
  }

  if (MODE.live && ok) {
    const bad = await liveProbe(base);
    if (bad.length) { console.log(`LIVE_FAIL ${bad.length}`); process.exit(1); }
    console.log('LIVE_OK');
  }
  process.exit(ok ? 0 : 1);
})();
