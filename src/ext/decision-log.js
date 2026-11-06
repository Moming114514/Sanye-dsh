// DECISION_LOG（P1）：把「要不要回」的判决落成一行可回放的 JSON。
// 只做记录：不读业务状态、不改任何判断、不阻塞调用方。写失败一律吞掉。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DAY_MS = 8 * 3600 * 1000;
const MAX_PENDING = 1000;

export function createDecisionLog({ stateDir, log = () => {} } = {}) {
  if (!stateDir) return null;
  const dir = path.join(String(stateDir), 'decision');
  const pending = new Map(); // key -> { id, ts, day }

  const dayOf = (t = Date.now()) => new Date(t + DAY_MS).toISOString().slice(0, 10);
  const fileOf = (day) => path.join(dir, `${day}.jsonl`);
  // P2-J1：日志上限——保留最近 7 个日文件；单文件超 5MB 就写 -2/-3…；清理每天最多一次
  const KEEP_DAYS = 7;
  const MAX_BYTES = 5 * 1024 * 1024;
  const CLEANUP_MARK = path.join(dir, '.last-cleanup');
  const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;

  function fileFor(day) {
    let n = 1;
    while (true) {
      const f = path.join(dir, n === 1 ? `${day}.jsonl` : `${day}-${n}.jsonl`);
      try {
        const st = fs.statSync(f);
        if (st.size < MAX_BYTES) return f;
      } catch {
        return f; // 不存在：就用这个
      }
      n += 1;
      if (n > 99) return path.join(dir, `${day}-99.jsonl`);
    }
  }

  function cleanupOnce() {
    const today = dayOf(Date.now());
    try { if (fs.readFileSync(CLEANUP_MARK, 'utf8').trim() === today) return; } catch {}
    try {
      const days = new Set();
      for (const name of fs.readdirSync(dir)) {
        const m = DAY_FILE_RE.exec(name);
        if (m) days.add(m[1]);
      }
      const sorted = [...days].sort().reverse();
      for (const d of sorted.slice(KEEP_DAYS)) {
        for (const name of fs.readdirSync(dir)) {
          const m = DAY_FILE_RE.exec(name);
          if (m && m[1] === d) {
            try { fs.unlinkSync(path.join(dir, name)); log('[decision] 清理过期日志：' + name); } catch {}
          }
        }
      }
    } catch (e) {
      log('[decision] 清理失败：' + (e?.message || e));
    }
    try { fs.writeFileSync(CLEANUP_MARK, today + '\n'); } catch {}
  }
  const sha1 = (text) => crypto.createHash('sha1').update(String(text)).digest('hex');

  function ensureDir() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (e) {
      log('[decision] 建目录失败：' + (e?.message || e));
      return false;
    }
  }

  function prune(maxDays) {
    try {
      const days = Math.max(1, Number(maxDays) || 14);
      const cutoff = Date.now() - days * 24 * 3600 * 1000;
      for (const name of fs.readdirSync(dir)) {
        const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
        if (!m) continue;
        const t = Date.parse(m[1] + 'T00:00:00+08:00');
        if (Number.isFinite(t) && t < cutoff) fs.unlinkSync(path.join(dir, name));
      }
    } catch {}
  }

  function shortId(ts) {
    return `${dayOf(ts).replace(/-/g, '')}-${ts.toString(36).slice(-5)}${crypto.randomBytes(2).toString('hex')}`;
  }

  function append(rec) {
    try {
      ensureDir();
      fs.appendFileSync(fileFor(rec.day), JSON.stringify(rec) + '\n');
      cleanupOnce();
      return true;
    } catch (e) {
      log('[decision] 写入失败：' + (e?.message || e));
      return false;
    }
  }

  /** 记一条判决；返回 id（用来和 outcome 对上）。 */
  function record(entry = {}) {
    try {
      const ts = Date.now();
      const day = dayOf(ts);
      const cfg = entry.cfg?.socialV2?.decisionLog || {};
      const limit = Math.max(0, Math.min(200, Number(cfg.textLimit) || 40));
      const text = String(entry.text || '');
      const id = shortId(ts);
      const rec = {
        type: 'decision',
        id,
        ts,
        day,
        key: String(entry.key || ''),
        reason: String(entry.reason || ''),
        text: text.slice(0, limit),
        textHash: sha1(text),
        score: entry.score == null ? null : Number(entry.score),
        allow: entry.allow !== false,
        source: String(entry.source || ''),
        layers: Array.isArray(entry.layers) ? entry.layers.map((l) => ({ id: String(l.id || ''), allow: l.allow !== false, reason: String(l.reason || '') })) : [],
        at: new Date(ts).toISOString(),
      };
      if (!append(rec)) return null;
      if (rec.key) {
        pending.delete(rec.key);
        pending.set(rec.key, { id, ts, day });
        if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
      }
      prune(cfg.maxDays);
      return id;
    } catch (e) {
      log('[decision] record 失败：' + (e?.message || e));
      return null;
    }
  }

  /** 发送成功/失败后补结果。keyOrId 可以是会话 key（补最近一次判决）或判决 id。 */
  function markOutcome(keyOrId, info = {}) {
    try {
      const s = String(keyOrId || '');
      if (!s) return false;
      const hit = pending.get(s) || null;
      let id = hit?.id || '';
      let day = hit?.day || '';
      if (!id) {
        const m = /^(\d{4})(\d{2})(\d{2})-/.exec(s);
        if (m) {
          id = s;
          day = `${m[1]}-${m[2]}-${m[3]}`;
        }
      }
      if (!id) return false;
      const ts = Date.now();
      const rec = {
        type: 'outcome',
        id,
        ts,
        day: day || dayOf(ts),
        replied: info.replied === true,
        reply: String(info.reply || '').slice(0, 80),
        outbound: Number(info.outbound) || 0,
        latencyMs: Number.isFinite(Number(info.latencyMs)) ? Math.max(0, Number(info.latencyMs)) : Math.max(0, ts - (hit?.ts || ts)),
      };
      return append(rec);
    } catch (e) {
      log('[decision] markOutcome 失败：' + (e?.message || e));
      return false;
    }
  }

  function load(day) {
    const out = [];
    try {
      const raw = fs.readFileSync(fileOf(day), 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line)); } catch {}
      }
    } catch {}
    return out;
  }

  /** 读一天（默认今天），合并 outcome，可按 allow/key/source/分数过滤。 */
  function read(day = dayOf(), filter = {}) {
    const byId = new Map();
    for (const r of load(day)) {
      if (r.type === 'outcome') {
        const b = byId.get(r.id);
        if (b) { b.replied = r.replied; b.outbound = r.outbound; b.latencyMs = r.latencyMs; }
        continue;
      }
      byId.set(r.id, r);
    }
    let items = [...byId.values()];
    if (filter.allow === true || filter.allow === false) items = items.filter((x) => x.allow === filter.allow);
    if (filter.key) items = items.filter((x) => String(x.key || '').includes(String(filter.key)));
    if (filter.source) items = items.filter((x) => String(x.source || '') === String(filter.source));
    if (filter.minScore != null && filter.minScore !== '') items = items.filter((x) => Number(x.score) >= Number(filter.minScore));
    if (filter.maxScore != null && filter.maxScore !== '') items = items.filter((x) => Number(x.score) <= Number(filter.maxScore));
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return items;
  }

  function stats(day = dayOf()) {
    const items = read(day);
    const total = items.length;
    const allow = items.filter((x) => x.allow).length;
    const replied = items.filter((x) => x.replied === true).length;
    const top = new Map();
    for (const x of items) {
      if (x.allow) continue;
      const k = x.source || 'unknown';
      top.set(k, (top.get(k) || 0) + 1);
    }
    return {
      day,
      total,
      allow,
      block: total - allow,
      replied,
      topSources: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }

  return { dayOf, record, markOutcome, read, stats };
}

export const manifest = {
  id: 'decision-log',
  title: '决策记录',
  kind: 'tool',
  layer: '判断',
  enabledByDefault: true,
  hot: true,
  order: 200,
  hooks: [],
  config: [],
  stateFiles: [],
  pages: [{ id: 'decisions', title: '决策记录' }],
};
