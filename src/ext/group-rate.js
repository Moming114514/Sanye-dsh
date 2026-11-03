// 群发言频率：每个群单独一档（保守 / 正常 / 活跃），控成本和话痨程度。
// 只管「她自己被叫醒接话」的次数；你手动指挥、管理员指令、学说法任务不占额度。
import fs from 'node:fs';
import path from 'node:path';

const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'group-rate.json');

export const LEVELS = {
  quiet: { label: '保守', minGapMs: 15 * 60 * 1000, maxPerDay: 12, hint: '15 分钟最多接一次，一天 12 次' },
  normal: { label: '正常', minGapMs: 6 * 60 * 1000, maxPerDay: 40, hint: '6 分钟最多接一次，一天 40 次' },
  active: { label: '活跃', minGapMs: 2 * 60 * 1000, maxPerDay: 120, hint: '2 分钟最多接一次，一天 120 次' },
};

let cache = { sig: '', data: null };

const today = () => new Date().toISOString().slice(0, 10);

function readAll() {
  let sig = '';
  try {
    const st = fs.statSync(FILE);
    sig = `${st.mtimeMs}:${st.size}`;
  } catch {
    cache = { sig: '', data: { day: today(), groups: {} } };
    return cache.data;
  }
  if (sig === cache.sig && cache.data) return cache.data;
  let data = { day: today(), groups: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = { day: String(raw?.day || today()), groups: raw?.groups && typeof raw.groups === 'object' ? raw.groups : {} };
  } catch {
    // 文件坏了当默认
  }
  if (data.day !== today()) {
    // 新的一天：清计数，留档位
    const groups = {};
    for (const [gid, v] of Object.entries(data.groups)) groups[gid] = { level: v.level || 'normal', count: 0, lastAt: 0 };
    data = { day: today(), groups };
    try { writeAll(data); } catch {}
  }
  cache = { sig, data };
  return data;
}

function writeAll(data) {
  fs.mkdirSync(STATE, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, FILE);
  cache = { sig: '', data: null };
}

export function groupLevel(gid) {
  const g = readAll().groups[String(gid).replace(/\D/g, '')];
  const lv = String(g?.level || 'normal');
  return LEVELS[lv] ? lv : 'normal';
}

export function groupRates() {
  const d = readAll();
  return Object.entries(d.groups).map(([gid, v]) => ({
    gid,
    level: LEVELS[v?.level] ? v.level : 'normal',
    count: Number(v?.count || 0),
    lastAt: Number(v?.lastAt || 0),
    ...LEVELS[LEVELS[v?.level] ? v.level : 'normal'],
    custom: v?.custom || null,
  }));
}

export function setGroupCustom(gid, patch) { // CUSTOM_RATE：每群可单独设最小间隔/每日上限
  const id = String(gid || '').replace(/\D/g, '');
  if (!id) throw new Error('群号不对');
  const d = readAll();
  const cur = d.groups[id] || { level: 'normal', count: 0, lastAt: 0 };
  const minGapMin = Math.max(0, Math.round(Number(patch?.minGapMin ?? cur.custom?.minGapMin ?? 0)));
  const perDay = Math.max(1, Math.round(Number(patch?.perDay ?? cur.custom?.perDay ?? 40)));
  cur.custom = { minGapMin, perDay };
  d.groups[id] = cur;
  writeAll(d);
  return cur;
}

export function setGroupLevel(gid, level) {
  const id = String(gid || '').replace(/\D/g, '');
  if (!id) throw new Error('群号不对');
  if (!LEVELS[level]) throw new Error('档位只能是 quiet / normal / active');
  const d = readAll();
  d.groups[id] = { ...(d.groups[id] || {}), level, count: Number(d.groups[id]?.count || 0), lastAt: Number(d.groups[id]?.lastAt || 0) };
  writeAll(d);
  return d.groups[id];
}

// 记账：这次放行了就 +1
function bump(gid) {
  const d = readAll();
  const id = String(gid);
  const cur = d.groups[id] || { level: 'normal', count: 0, lastAt: 0 };
  cur.count = Number(cur.count || 0) + 1;
  cur.lastAt = Date.now();
  d.groups[id] = cur;
  writeAll(d);
}

export default {
  id: 'group-rate',
  title: '群发言频率',
  stateKey() {
    try {
      const st = fs.statSync(FILE);
      return `rate:${st.mtimeMs}:${st.size}`;
    } catch {
      return 'rate:none';
    }
  },
  wakeGate({ key, reason }) {
    const k = String(key || '');
    if (!k.startsWith('group:')) return true;
    const why = String(reason || '');
    // 这些不占群额度
    if (why === 'manual' || why === 'admin' || /style-learn/.test(why)) return true;
    const gid = k.slice('group:'.length).replace(/\D/g, '');
    const lv = groupLevel(gid);
    const cfg = LEVELS[lv];
    const st = readAll().groups[gid] || {};
    const count = Number(st.count || 0);
    const lastAt = Number(st.lastAt || 0);
    const now = Date.now();
    const cu = st.custom || null; // CUSTOM_RATE
    const maxPerDay = cu?.perDay ? Number(cu.perDay) : cfg.maxPerDay;
    const minGapMs = cu?.minGapMin ? Number(cu.minGapMin) * 60000 : cfg.minGapMs;
    if (count >= maxPerDay) {
      return { allow: false, reason: `[频繁度] 跳过唤醒 ${k}（${why}）：今天已 ${count}/${maxPerDay} 次` };
    }
    if (lastAt && now - lastAt < minGapMs) {
      const waitMin = Math.ceil((minGapMs - (now - lastAt)) / 60000);
      return { allow: false, reason: `[频繁度] 跳过唤醒 ${k}（${why}）：还要等 ${waitMin} 分钟` };
    }
    bump(gid);
    return true;
  },
  routes: [
    {
      path: '/api/socialV2/grouprate',
      async handle({ body, log, sendJson }) {
        const action = String(body?.action || 'list');
        if (action === 'list') {
          sendJson({ ok: true, levels: LEVELS, rates: groupRates() });
          return;
        }
        const gid = String(body?.group || '').replace(/\D/g, '');
        if (action === 'set') {
          try {
            const r = setGroupLevel(gid, String(body?.level || ''));
            log(`[频繁度] 群 ${gid} → ${LEVELS[r.level].label}`);
            sendJson({ ok: true, rate: r, rates: groupRates() });
          } catch (e) {
            sendJson({ ok: false, error: String(e?.message || e) }, 400);
          }
          return;
        }
        if (action === 'custom') {
          try {
            const r = setGroupCustom(gid, body || {});
            log(`[频繁度] 群 ${gid} 自定义：${r.custom.minGapMin} 分钟 / 每天 ${r.custom.perDay} 次`);
            sendJson({ ok: true, rate: r, rates: groupRates() });
          } catch (e) {
            sendJson({ ok: false, error: String(e?.message || e) }, 400);
          }
          return;
        }
        sendJson({ ok: false, error: 'action 只能是 list / set / custom' }, 400);
      },
    },
  ],
};
