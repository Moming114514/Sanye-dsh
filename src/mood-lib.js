// MOODV3_PATCH — 三叶的心情层（TASK-W2 #2：6 种心情）（借 dsh-mood 的设计：33 情绪、门槛切换、混合态、周期漂移、安全词表）
// 与本项目已有的人物/记忆/日记/欠事共存：只叠加一层"今天什么感觉"，不改人格、不另建记忆。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.HOME || os.homedir();
const DATA_DIR = path.join(HOME, '.dsh', 'surfcore');
const STATE_FILE = path.join(DATA_DIR, 'state', 'mood.json');
const CHAR_FILE = path.join(DATA_DIR, 'characters', 'current.json');

// ── 6 种心情（TASK-W2 #2：33 → 6，只留最常用、最容易从语气里看出来的）───
export const MOODS = [
  { id: 'calm', zh: '平静', base: 26, hint: '正常说话，不用刻意简短；平静不等于没反应，可以有一两句自己的态度（例：嗯……我看看，问题应该在这儿）' },
  { id: 'happy', zh: '开心', base: 34, hint: '语气轻快，可用一个感叹号或叠词（例：好啦好啦／成了！）' },
  { id: 'curious', zh: '好奇', base: 32, hint: '多追问一句（例：那你当时怎么弄的？）' },
  { id: 'focused', zh: '专注', base: 30, hint: '少寒暄，直接给步骤，不铺陈' },
  { id: 'excited', zh: '兴奋', base: 30, hint: '情绪外露，短句连发（例：真的？那也太行了！）' },
  { id: 'proud', zh: '得意', base: 18, hint: '可以小飘一下（例：那当然，这回我做得不错）' },
];
/* 旧键迁移：只保留上面 6 个键的原值，其余键在 readMood 里直接丢弃。
   不把 tired/annoyed 的旧分数并进来——旧值曾被打满 100，并进来会立刻把新键顶满。 */

const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

// ── 安全词表：不参与计分，只决定要不要切到郑重语气 ─────────────
const DISTRESS_RE =
  /自杀|想死|不想活|活不下去|活着没意思|轻生|割腕|跳楼|安眠药|烧炭|结束生命|自残|自伤|撑不下去|没人会在意我/;

// ── 关键词规则：每条只给 0.5~3 分，单条消息翻不了盘 ─────────────
// ── 关键词规则：每条只给 0.5~2.5 分，单条消息翻不了盘 ─────
const RULES = [
  { re: /谢谢|不错|厉害|好棒|棒|靠谱|多亏|做得好|搞定|可以啊/, d: { happy: 2, proud: 2 } },
  { re: /随便你|算了|不用了|我自己来|别管|行了|无所谓|哦$/, d: { happy: -1.5, calm: 1 } },
  { re: /都怪你|就怪你|你怎么这样|明明|冤枉|误会我/, d: { happy: -2, calm: -1 } },
  { re: /还是不行|又错|又崩|搞不定|白做|到底|还没好/, d: { calm: -1.5, focused: 1.5 } },
  { re: /烦|烦死|麻了|无语|受不了/, d: { calm: -2, focused: -1 } },
  { re: /好累|累死|困|没力气|撑不住/, d: { focused: -2, excited: -1, calm: -1 } },
  { re: /摆烂|躺平|卷不动|爱咋咋/, d: { focused: -2 } },
  { re: /破防|绷不住|扎心|心态崩|想哭/, d: { calm: -2, happy: -1.5 } },
  { re: /万一|来不及|会不会|担心|怕/, d: { focused: -1, calm: -1 } },
  { re: /陪我|只有你|离不开|想你|抱抱/, d: { happy: 2, proud: 0.5 } },
  { re: /辛苦|休息|早点睡|别累|吃饭|注意身体/, d: { happy: 1.5, calm: 1 } },
  { re: /哈哈|笑死|乐死|hhhh|hhh/i, d: { happy: 1.5, excited: 0.5 } },
  { re: /想学|好奇|怎么做到|教教我|为什么/, d: { curious: 1.5 } },
  { re: /一个人|没人理|孤独|好安静|都不在/, d: { calm: -1, curious: -0.5 } },
  { re: /[?？]/, d: { curious: 1 } },
  { re: /[!！]|太.{0,3}了|居然/, d: { excited: 1 } },
];

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {}
}

function freshState() {
  const values = {};
  for (const m of MOODS) values[m.id] = m.base;
  return {
    values,
    current: 'calm',
    blend: [],
    since: Date.now(),
    lastTickAt: Date.now(),
    nextTickAt: Date.now() + 3 * 3600 * 1000,
    toolErrors: 0,
    roundsToday: 0,
    day: new Date().toISOString().slice(0, 10),
    diary: {},
    prefs: { enabled: true, margin: 3, blendGap: 8, blendMax: 3 },
  };
}

export const MOOD_LIVELY = 1; // 压低平静/疲惫，抬高开心/好奇/兴奋，情绪更容易切换

function readMood() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!j || typeof j !== 'object' || !j.values) return freshState();
    const known = new Set(MOODS.map((m) => m.id));
    let dropped = 0;
    for (const k of Object.keys(j.values)) if (!known.has(k)) { delete j.values[k]; dropped++; }
    for (const m of MOODS) if (typeof j.values[m.id] !== 'number') j.values[m.id] = m.base;
    if (!MOOD_BY_ID[j.current]) { j.current = 'calm'; j.since = Date.now(); }
    j.blend = (Array.isArray(j.blend) ? j.blend : []).filter((id) => known.has(id));
    j.prefs = Object.assign({ enabled: true, margin: 5, blendGap: 8, blendMax: 3 }, j.prefs || {});
    if (dropped) j.valuesDropped = dropped;
    return j;
  } catch {
    return freshState();
  }
}

function sampleHistory(st) { // MOOD_TIRED_FIX：面板画曲线用
  try {
    if (!Array.isArray(st.history)) st.history = [];
    const row = { t: Date.now(), cur: st.current || '' };
    for (const m of MOODS) row[m.id] = Math.round(st.values[m.id] || 0);
    st.history.push(row);
    if (st.history.length > 240) st.history = st.history.slice(-240);
  } catch {}
}

function writeMood(st) {
  sampleHistory(st);
  ensureDir(path.dirname(STATE_FILE));
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1), { mode: 0o600 });
  } catch {}
}

const clamp = (v) => Math.max(0, Math.min(100, v));

function add(val, id, delta) {
  if (!(id in val)) return;
  val[id] = clamp(val[id] + delta);
}

function pickSlow(st) {
  const { margin, blendGap, blendMax } = st.prefs;
  const ranked = MOODS.map((m) => ({ m, v: st.values[m.id] })).sort((a, b) => b.v - a.v);
  const top = ranked[0];
  const cur = st.values[st.current] ?? 0;
  const keep = ranked.find((x) => x.m.id === st.current);
  let primary = top;
  if (keep && top.v - cur < margin) primary = keep;
  const blend = ranked
    .filter((x) => x.m.id !== primary.m.id && primary.v - x.v < blendGap)
    .slice(0, blendMax)
    .map((x) => x.m.id);
  return { primary: primary.m.id, blend };
}

function commit(st, force = false) {
  const next = pickSlow(st);
  const changed = next.primary !== st.current;
  if (changed || force) {
    if (changed) st.since = Date.now();
    st.current = next.primary;
  }
  st.blend = next.blend;
  return st;
}

// ── 观察一条用户消息 ────────────────────────────────────
let _lastObs = { t: 0, s: '' };

export function moodObserve(text, kind = 'private') {
  const s = String(text || '');
  if (!s.trim()) return readMood();
  const now = Date.now();
  if (_lastObs.s === s && now - _lastObs.t < 1500) return readMood(); // 去重（两个观察点会重复调用）
  _lastObs = { t: now, s };
  const st = readMood();
  if (!st.prefs.enabled) return st;
  // MOOD_SETTLE（2026-11-03）：每条消息先向基线回落 5%，再按规则加分。
  // 之前只有每 3~6 小时一次的 moodTick 回落，活跃群里固定加分（calm +0.05/条、tired +0.2/条、
  // focused +1/条…）远超回落速度，几小时内就会把 calm/happy/curious/focused/excited/tired/proud 顶到 100 并卡住。
  for (const m of MOODS) add(st.values, m.id, (m.base - st.values[m.id]) * 0.05);
  const day = new Date().toISOString().slice(0, 10);
  if (st.day !== day) {
    st.day = day;
    st.roundsToday = 0;
    st.diary = {};
  }
  st.roundsToday = (st.roundsToday || 0) + 1;
  for (const r of RULES) {
    if (r.re.test(s)) {
      for (const [id, d] of Object.entries(r.d)) add(st.values, id, d);
    }
  }
  if (s.length >= 80) add(st.values, 'focused', 1);
  if (s.length <= 6) add(st.values, 'tired', 0.2); // MOOD_TIRED_FIX：短句只加一点点，别被「在吗/好」喂满
  add(st.values, 'calm', 0.05); // MOOD_TIRED_FIX：回稳别太快，否则平静永远满分
  commit(st);
  writeMood(st);
  return st;
}

// ── 周期漂移：每 3~6 小时 ───────────────────────────────
export function moodTick(now = Date.now()) {
  const st = readMood();
  if (!st.prefs.enabled) return st;
  if (now < (st.nextTickAt || 0)) return st;
  for (const m of MOODS) {
    const v = st.values[m.id];
    add(st.values, m.id, (m.base - v) * 0.25 + (Math.random() * 6 - 3));
  }
  if ((st.roundsToday || 0) >= 8) add(st.values, 'focused', 4);
  if ((st.toolErrors || 0) >= 3) {
    add(st.values, 'calm', -Math.min(6, st.toolErrors));
    st.toolErrors = 0;
  }
  st.lastTickAt = now;
  const hours = 3 + Math.random() * 3;
  st.nextTickAt = now + hours * 3600 * 1000;
  commit(st);
  writeMood(st);
  return st;
}

export function moodToolError() {
  const st = readMood();
  st.toolErrors = (st.toolErrors || 0) + 1;
  writeMood(st);
}

// ── 注入块（每轮 ~110~160 字）───────────────────────────
export function moodLine(text = '', kind = 'private') {
  const st = readMood();
  if (!st.prefs.enabled) return '';
  const m = MOOD_BY_ID[st.current] || MOOD_BY_ID.calm;
  const blendIds = st.blend || [];
  const blendText = blendIds.length
    ? `，掺着一点${blendIds.map((id) => MOOD_BY_ID[id]?.zh).filter(Boolean).join('、')}`
    : '';
  const since = Math.max(1, Math.round((Date.now() - (st.since || Date.now())) / 3600000));
  let line = `【今天的感觉】${m.zh}${blendText}（${since} 小时了）。${m.hint}。不用说出心情、别拿它当话题，但心情要用语气体现出来——一个词、一个叹词、一个反问都算，多一两个字就够；判断和干活不受影响${kind === 'group' ? '；群里收着点' : ''}。`;
  if (DISTRESS_RE.test(String(text || ''))) {
    line += `\n他这句话可能很重：不许打趣、不许用角色口吻敷衍，认真接住，先问一句他现在还好吗。`;
  }
  return line;
}

// ── 面板用：读全量 / 改全量 ─────────────────────────────
export function moodPublic() {
  const st = readMood();
  return {
    ok: true,
    values: st.values,
    current: st.current,
    blend: st.blend || [],
    since: st.since,
    nextTickAt: st.nextTickAt,
    lastTickAt: st.lastTickAt,
    prefs: st.prefs,
    moods: MOODS.map((m) => ({ id: m.id, zh: m.zh, base: m.base, intimate: !!m.intimate, hint: m.hint })),
    line: moodLine('', 'private'),
  };
}

export function moodUpdate(patch = {}) {
  const st = readMood();
  const p = patch && typeof patch === 'object' ? patch : {};
  if (p.values && typeof p.values === 'object') {
    for (const [k, v] of Object.entries(p.values)) {
      if (k in st.values && Number.isFinite(Number(v))) st.values[k] = clamp(Number(v));
    }
  }
  if (typeof p.enabled === 'boolean') st.prefs.enabled = p.enabled;
  for (const k of ['margin', 'blendGap', 'blendMax']) {
    if (Number.isFinite(Number(p[k]))) st.prefs[k] = Number(p[k]);
  }
  if (p.resetToBaseline) for (const m of MOODS) st.values[m.id] = m.base;
  if (typeof p.current === 'string' && MOOD_BY_ID[p.current]) {
    st.current = p.current;
    st.since = Date.now();
  }
  if (p.forcePick) commit(st, true);
  commit(st);
  writeMood(st);
  return moodPublic();
}

export function moodStatusText() {  const st = readMood();
  const ranked = MOODS.map((m) => ({ m, v: Math.round(st.values[m.id]) })).sort((a, b) => b.v - a.v);
  const head = `现在：${MOOD_BY_ID[st.current]?.zh || '平静'}${st.blend?.length ? `（掺着 ${st.blend.map((i) => MOOD_BY_ID[i]?.zh).join('、')}）` : ''}`;
  const top = ranked.slice(0, 5).map((x) => `${x.m.zh} ${x.v}`).join(' / ');
  const mins = Math.max(1, Math.round((st.nextTickAt - Date.now()) / 60000));
  return `${head}\n前五：${top}\n下次自己变：约 ${mins} 分钟后`;
}

function currentCharacterDir() {
  try {
    const j = JSON.parse(fs.readFileSync(CHAR_FILE, 'utf8'));
    if (j && j.id) return path.join(DATA_DIR, 'characters', j.id);
  } catch {}
  try {
    const dirs = fs.readdirSync(path.join(DATA_DIR, 'characters'));
    const d = dirs.find((x) => x.startsWith('char-'));
    if (d) return path.join(DATA_DIR, 'characters', d);
  } catch {}
  return null;
}

// 23:59 往已有的日记里补一行（不新建第二本日记）
export function moodDiaryTick(now = new Date()) {
  const st = readMood();
  if (!st.prefs.enabled) return;
  if (now.getHours() !== 23 || now.getMinutes() < 58) return;
  const day = now.toISOString().slice(0, 10);
  st.diary = st.diary || {};
  if (st.diary[day]) return;
  const dir = currentCharacterDir();
  if (!dir) return;
  const m = MOOD_BY_ID[st.current] || MOOD_BY_ID.calm;
  const blend = (st.blend || []).map((i) => MOOD_BY_ID[i]?.zh).filter(Boolean).join('、');
  const line = `- ${day} 心情：${m.zh}${blend ? `（掺着 ${blend}）` : ''}｜${m.hint}`;
  try {
    const f = path.join(dir, 'memory', 'diary.md');
    ensureDir(path.dirname(f));
    let raw = '';
    try {
      raw = fs.readFileSync(f, 'utf8');
    } catch {}
    if (!raw.includes(`${day} 心情：`)) {
      fs.writeFileSync(f, `${raw.replace(/\s*$/, '')}\n${line}\n`, { mode: 0o600 });
    }
    st.diary[day] = true;
    writeMood(st);
  } catch {}
}
