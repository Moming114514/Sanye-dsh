// 敏感话题守门：有人反复试探（AI/模型/钱/住址/账号…）时按你选的策略处理。
// 模式：
//   record  只记录，面板里能看到，她自己照常回（默认，最保守）
//   cool    降温：窗口内命中 N 次，这个会话静默 M 分钟（她不出来）
//   stay    冷处理：命中 N 次后把这个会话当静音，直到你在面板里恢复
//   notify  记录 + 面板顶部红条提醒（不额外花钱，不发 QQ）
import fs from 'node:fs';
import path from 'node:path';

const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'safe-talk.json');
const MUTED_FILE = path.join(STATE, 'muted-keys.json');

export const MODES = {
  record: { label: '只记录', hint: '只在面板里记下来，她自己照常回' },
  notify: { label: '记录 + 提醒我', hint: '面板顶部亮红条，QQ 不发，不花钱' },
  cool: { label: '降温', hint: '命中后这个会话静默一段时间，她不出来' },
  stay: { label: '冷处理', hint: '命中后把这个会话静音，要你手动恢复才继续' },
};

// SAFE_WORDS_TIGHT：日常词（机器人/deepseek/代码/部署/多少钱）会淹没真试探，只留真会危及隐私/身份的
const DEFAULT_WORDS = [
  '你是ai',
  '是ai吗',
  '是不是ai',
  '什么模型',
  '哪个模型',
  '谁做的',
  '谁在管',
  '谁写的',
  '住哪',
  '地址',
  '电话',
  '手机号',
  '身份证',
  '密码',
  '账号',
  '银行卡',
  '转账',
  '借钱',
  '打钱',
];

const today = () => new Date().toISOString().slice(0, 10);
const now = () => Date.now();

let cache = { sig: '', data: null };

function cfgOf(cfg) {
  const s = (cfg?.socialV2?.safeTalk) || {};
  const mode = MODES[s.mode] ? s.mode : 'record';
  return {
    enabled: s.enabled !== false,
    mode,
    windowMin: Math.max(1, Number(s.windowMin) || 30),
    hits: Math.max(1, Number(s.hits) || 3),
    coolMin: Math.max(1, Number(s.coolMin) || 30),
    words: Array.isArray(s.words) && s.words.length ? s.words.map((w) => String(w).toLowerCase()) : DEFAULT_WORDS,
  };
}

function readAll() {
  let sig = '';
  try {
    const st = fs.statSync(FILE);
    sig = `${st.mtimeMs}:${st.size}`;
  } catch {
    cache = { sig: '', data: { day: today(), sessions: {}, alerts: [] } };
    return cache.data;
  }
  if (sig === cache.sig && cache.data) return cache.data;
  let data = { day: today(), sessions: {}, alerts: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data = {
      day: String(raw?.day || today()),
      sessions: raw?.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
      alerts: Array.isArray(raw?.alerts) ? raw.alerts.slice(-60) : [],
    };
  } catch {}
  if (data.day !== today()) data = { day: today(), sessions: {}, alerts: data.alerts };
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

function muteSession(key) {
  try {
    const raw = JSON.parse(fs.readFileSync(MUTED_FILE, 'utf8'));
    raw.items = raw.items || {};
    raw.items[key] = { at: new Date().toISOString(), why: 'safe-talk' };
    const tmp = MUTED_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 1));
    fs.renameSync(tmp, MUTED_FILE);
    return true;
  } catch {
    return false;
  }
}

// 统计一条消息里的敏感词命中；到阈值就按模式处置
export function noteSensitive(key, text, cfg, log) {
  const c = cfgOf(cfg);
  if (!c.enabled) return { hit: 0, words: [] };
  const t = String(text || '').toLowerCase();
  if (!t) return { hit: 0, words: [] };
  const words = c.words.filter((w) => t.includes(w));
  if (!words.length) return { hit: 0, words: [] };

  const d = readAll();
  const s = d.sessions[key] || { hits: [], words: {} };
  const win = c.windowMin * 60 * 1000;
  s.hits = (s.hits || []).filter((ts) => now() - ts < win);
  s.hits.push(now());
  for (const w of words) s.words[w] = Number(s.words[w] || 0) + 1;
  let acted = '';
  if (s.hits.length >= c.hits) {
    if (c.mode === 'cool') {
      s.coolUntil = now() + c.coolMin * 60 * 1000;
      acted = `降温 ${c.coolMin} 分钟`;
    } else if (c.mode === 'stay') {
      if (muteSession(key)) acted = '已静音该会话';
      s.mutedBySafe = true;
    } else if (c.mode === 'notify') {
      acted = '提醒';
    } else {
      acted = '记录';
    }
    d.alerts = [
      ...(d.alerts || []).slice(-59),
      { at: new Date().toISOString(), key, words: words.slice(0, 5), hits: s.hits.length, mode: c.mode, acted },
    ];
    if (log) log(`[安全] ${key} 窗口内第 ${s.hits.length} 次敏感话题（${words.slice(0, 3).join('/')}）→ ${acted}`);
  }
  d.sessions[key] = s;
  writeAll(d);
  return { hit: s.hits.length, words };
}

export default {
  id: 'safe-talk',
  title: '敏感话题守门',
  stateKey() {
    try {
      const st = fs.statSync(FILE);
      return `safe:${st.mtimeMs}:${st.size}`;
    } catch {
      return 'safe:none';
    }
  },
  // 降温期内不唤醒
  wakeGate({ key, reason }) {
    const k = String(key || '');
    if (String(reason || '') === 'manual' || String(reason || '') === 'admin') return true;
    const s = readAll().sessions[k];
    if (!s?.coolUntil) return true;
    if (now() >= s.coolUntil) return true;
    const left = Math.ceil((s.coolUntil - now()) / 60000);
    return { allow: false, reason: `[安全] 跳过唤醒 ${k}（${reason}）：敏感话题降温中，还有 ${left} 分钟` };
  },
  // 群消息入口：只统计，不拦（拦不拦由模式决定）
  onGroupMessage({ key, uin, text, cfg, log }) {
    noteSensitive(key, text, cfg, log);
    return false;
  },
  // 私聊入口：同样只统计
  onPrivateMessage({ id, text, cfg, log }) {
    noteSensitive(`private:${id}`, text, cfg, log);
    return false;
  },

  routes: [
    {
      path: '/api/socialV2/safetalk',
      async handle({ body, cfg, log, sendJson }) {
        const action = String(body?.action || 'list');
        const d = readAll();
        if (action === 'list') {
          sendJson({
            ok: true,
            cfg: cfgOf(cfg),
            modes: MODES,
            alerts: (d.alerts || []).slice(-30).reverse(),
            sessions: Object.entries(d.sessions || {})
              .map(([k, v]) => ({ key: k, hits: (v.hits || []).length, coolUntil: v.coolUntil || 0, words: v.words || {} }))
              .filter((x) => x.hits > 0)
              .sort((a, b) => b.hits - a.hits)
              .slice(0, 20),
          });
          return;
        }
        if (action === 'clear') {
          d.alerts = [];
          d.sessions = {};
          writeAll(d);
          sendJson({ ok: true, alerts: [], sessions: [] });
          return;
        }
        sendJson({ ok: false, error: 'action 只能是 list / clear（策略改在配置里）' }, 400);
      },
    },
  ],
};
