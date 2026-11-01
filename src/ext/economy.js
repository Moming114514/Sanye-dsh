// 省钱模式：少说话、只回 @，可以全局也可精确到群。
//
// 语义：
//   mode = 'auto'  跟随 tokenGuard（花到 downgradeAtRatio 自动进省钱）——原来的行为
//   mode = 'on'    强制省钱（即使今天还没花到线）
//   mode = 'off'   永不自动（花到线也不降级）
//   群的覆盖：groups[gid] = 'on' | 'off'，优先于全局 mode
//
// 省钱的规则：群里只在「@ 她 / 手动让她说话 / 管理员指令 / 学说法任务」时醒来，
// 主动搭话、超时追问、历史补看一律跳过——private 会话不受影响。
import fs from 'node:fs';
import path from 'node:path';

const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'economy.json');

export const MODES = {
  auto: { label: '自动', hint: '花到降级线（默认 50%）自动进省钱，平时正常' },
  on: { label: '一直省', hint: '永远只回 @ 和手动指令' },
  off: { label: '不省', hint: '花到降级线也不降级（花超了才知道）' },
};

let cache = { sig: '', data: null };

function readAll() {
  let sig = '';
  try {
    const st = fs.statSync(FILE);
    sig = `${st.mtimeMs}:${st.size}`;
  } catch {
    cache = { sig: '', data: { mode: 'auto', groups: {} } };
    return cache.data;
  }
  if (sig === cache.sig && cache.data) return cache.data;
  let data = { mode: 'auto', groups: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = {
      mode: MODES[raw?.mode] ? raw.mode : 'auto',
      groups: raw?.groups && typeof raw.groups === 'object' ? raw.groups : {},
    };
  } catch {}
  cache = { sig, data };
  return data;
}

function writeAll(data) {
  fs.mkdirSync(STATE, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...data, at: Date.now() }, null, 1));
  fs.renameSync(tmp, FILE);
  cache = { sig: '', data: null };
}

const clean = (gid) => String(gid || '').replace(/\D/g, '');

/** 这个群当前是不是省钱模式。autoOn = tokenGuard 的自动降级状态。 */
export function ecoForGroup(gid, autoOn) {
  const d = readAll();
  const g = clean(gid);
  if (g && d.groups[g] === 'on') return true;
  if (g && d.groups[g] === 'off') return false;
  if (d.mode === 'on') return true;
  if (d.mode === 'off') return false;
  return !!autoOn;
}

export function setEcoMode(mode) {
  if (!MODES[mode]) throw new Error('模式只能是 auto / on / off');
  const d = readAll();
  d.mode = mode;
  writeAll(d);
  return { mode: d.mode };
}

export function setEcoGroup(gid, on) {
  const g = clean(gid);
  if (!g) throw new Error('群号不对');
  const d = readAll();
  if (on === null || on === undefined) delete d.groups[g];
  else d.groups[g] = on ? 'on' : 'off';
  writeAll(d);
  return { gid: g, value: d.groups[g] ?? null };
}

export function ecoState(autoOn) {
  const d = readAll();
  return {
    mode: d.mode,
    modes: MODES,
    autoOn: !!autoOn,
    groups: Object.entries(d.groups).map(([gid, v]) => ({ gid, on: v === 'on' })),
  };
}

export default {
  id: 'economy',
  title: '省钱模式（少说话）',
  stateKey() {
    try {
      const st = fs.statSync(FILE);
      return `eco:${st.mtimeMs}:${st.size}`;
    } catch {
      return 'eco:none';
    }
  },
  wakeGate({ key, reason, economyOn }) {
    const k = String(key || '');
    if (!k.startsWith('group:')) return true; // 私聊不受影响
    const why = String(reason || '');
    if (why === 'manual' || why === 'admin' || /style-learn/.test(why)) return true;
    const gid = k.slice('group:'.length);
    if (!ecoForGroup(gid, economyOn)) return true;
    if (/atMention|mention/i.test(why)) return true; // @ 她照常回
    return { allow: false, reason: `[省钱] 跳过唤醒 ${k}（${why}）：省钱模式只回 @ 和手动指令` };
  },
  routes: [
    {
      path: '/api/socialV2/economy',
      async handle({ body, log, sendJson, economyOn }) {
        try {
          const action = String(body?.action || 'list');
          if (action === 'list') return sendJson({ ok: true, ...ecoState(economyOn) });
          if (action === 'set') {
            const r = setEcoMode(String(body?.mode || 'auto'));
            log(`[省钱] 全局模式 → ${r.mode}`);
            return sendJson({ ok: true, ...ecoState(economyOn) });
          }
          if (action === 'group') {
            const r = setEcoGroup(body?.gid, body?.on === null ? null : !!body?.on);
            log(`[省钱] 群 ${r.gid} → ${r.value ?? '跟随全局'}`);
            return sendJson({ ok: true, ...ecoState(economyOn) });
          }
          return sendJson({ ok: false, error: '未知 action' }, 400);
        } catch (e) {
          return sendJson({ ok: false, error: String(e?.message || e) }, 400);
        }
      },
    },
  ],
};
