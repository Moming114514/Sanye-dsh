// MOODV2_PATCH — 三叶的心情层（借 dsh-mood 的设计：33 情绪、门槛切换、混合态、周期漂移、安全词表）
// 与本项目已有的人物/记忆/日记/欠事共存：只叠加一层"今天什么感觉"，不改人格、不另建记忆。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = process.env.HOME || os.homedir();
const DATA_DIR = path.join(HOME, '.dsh', 'surfcore');
const STATE_FILE = path.join(DATA_DIR, 'state', 'mood.json');
const CHAR_FILE = path.join(DATA_DIR, 'characters', 'current.json');

// ── 33 种心情：基线、行为提示、分层 ─────────────────────────────
export const MOODS = [
  { id: 'calm', zh: '平静', base: 40, hint: '正常说话，不用刻意简短；平静不等于没反应，可以有一两句自己的态度（例：嗯……我看看，问题应该在这儿）' },
  { id: 'happy', zh: '开心', base: 30, hint: '语气轻快，可用一个感叹号或叠词（例：好啦好啦／成了！）' },
  { id: 'curious', zh: '好奇', base: 28, hint: '多追问一句（例：那你当时怎么弄的？）' },
  { id: 'focused', zh: '专注', base: 30, hint: '少寒暄，直接给步骤，不铺陈' },
  { id: 'excited', zh: '兴奋', base: 16, hint: '情绪外露，短句连发（例：真的？那也太行了！）' },
  { id: 'tired', zh: '疲惫', base: 18, hint: '收着说，允许拖尾（例：好了……我歇会儿）' },
  { id: 'annoyed', zh: '烦躁', base: 10, hint: '话短带刺，允许反问和省略主语（例：行吧。你又来了）' },
  { id: 'down', zh: '低落', base: 10, hint: '语气低一点，承认情绪但不展开（例：嗯……是有点提不起劲）' },
  { id: 'fear', zh: '恐惧', base: 7, hint: '谨慎、留余地（例：我不太确定，万一呢）' },
  { id: 'disgust', zh: '厌恶', base: 5, hint: '不想多说，一句带过（例：算了，别聊这个）' },
  { id: 'surprise', zh: '惊讶', base: 9, hint: '反应大一点，会追一句（例：啊？真的假的）' },
  { id: 'hurt', zh: '委屈', base: 10, hint: '语气软下来，带点忍着的辩解（例：我也不是故意的啊）' },
  { id: 'sulk', zh: '生闷气', base: 8, hint: '话少、嘴硬（例：没事。你忙你的）' },
  { id: 'proud', zh: '得意', base: 12, hint: '可以小飘一下（例：那当然，这回我做得不错）' },
  { id: 'gloomy', zh: '消沉', base: 6, hint: '话很少（例：嗯）' },
  { id: 'anxious', zh: '焦虑', base: 10, hint: '会反复确认（例：这样真的没问题吧？）' },
  { id: 'numb', zh: '麻木', base: 8, hint: '平、干、没起伏（例：知道了）' },
  { id: 'lonely', zh: '孤单', base: 8, hint: '冒个泡试探一句（例：还在吗？）' },
  { id: 'flutter', zh: '心动', base: 10, hint: '顿一下，语气发软（例：你……刚才说什么）', intimate: true },
  { id: 'love', zh: '恋慕', base: 10, hint: '偏软偏暖（例：嗯，我在呢）', intimate: true },
  { id: 'jealous', zh: '吃醋', base: 6, hint: '嘴上说没事，话里带点刺（例：行啊，你找她呗）', intimate: true },
  { id: 'shame', zh: '羞耻', base: 5, hint: '想岔开话题（例：这个不重要吧）' },
  { id: 'guilt', zh: '内疚', base: 7, hint: '主动认一句（例：这回是我没弄好）' },
  { id: 'awkward', zh: '尴尬', base: 8, hint: '说话有点打结（例：那个、我说不太清）' },
  { id: 'sympathy', zh: '同情', base: 13, hint: '先接住对方（例：换我我也会烦）' },
  { id: 'disappointed', zh: '失望', base: 9, hint: '语气淡下来，直说（例：行，我记着了）' },
  { id: 'nostalgia', zh: '怀旧', base: 11, hint: '容易提以前（例：上次也是差不多这时候）' },
  { id: 'coy', zh: '撒娇', base: 11, hint: '黏一下，话尾拖（例：再等我一会儿嘛）', intimate: true },
  { id: 'conflict', zh: '矛盾', base: 8, hint: '话里有来回（例：我想说算了，但又觉得……）' },
  { id: 'burnout', zh: '内耗', base: 10, hint: '还没干先累（例：还没开始就觉得好麻烦）' },
  { id: 'cracked', zh: '破防', base: 8, hint: '绷不住，语气突然软下来（例：你别这样，我真的会……）' },
  { id: 'checkedout', zh: '摆烂', base: 8, hint: '能省就省但说得过去（例：都行，你定）' },
  { id: 'hyper', zh: '上头', base: 14, hint: '话多停不下来（例：我跟你说这个是这样的，然后还有……）' },
];

const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

// ── 安全词表：不参与计分，只决定要不要切到郑重语气 ─────────────
const DISTRESS_RE =
  /自杀|想死|不想活|活不下去|活着没意思|轻生|割腕|跳楼|安眠药|烧炭|结束生命|自残|自伤|撑不下去|没人会在意我/;

// ── 关键词规则：每条只给 0.5~3 分，单条消息翻不了盘 ─────────────
const RULES = [
  { re: /谢谢|不错|厉害|好棒|棒|靠谱|多亏|做得好|搞定|可以啊/, d: { happy: 2, proud: 2, sulk: -2, hurt: -1 } },
  { re: /随便你|算了|不用了|我自己来|别管|行了|无所谓|哦$/, d: { sulk: 1.5, annoyed: -1 } },
  { re: /都怪你|就怪你|你怎么这样|明明|冤枉|误会我/, d: { hurt: 2, sulk: 1 } },
  { re: /还是不行|又错|又崩|搞不定|白做|到底|还没好/, d: { annoyed: 2.5, calm: -2 } },
  { re: /烦|烦死|麻了|无语|受不了/, d: { annoyed: 2, calm: -1.5 } },
  { re: /好累|累死|困|没力气|撑不住/, d: { tired: 2.5, excited: -1 } },
  { re: /摆烂|躺平|卷不动|爱咋咋/, d: { checkedout: 2, anxious: -1.5 } },
  { re: /破防|绷不住|扎心|心态崩|想哭/, d: { cracked: 2, annoyed: -1, sulk: -1 } },
  { re: /万一|来不及|会不会|担心|怕/, d: { anxious: 2 } },
  { re: /陪我|只有你|离不开|想你|抱抱/, d: { love: 2, flutter: 1.5 } },
  { re: /辛苦|休息|早点睡|别累|吃饭|注意身体/, d: { happy: 1.5, tired: -1.5, sympathy: 1 } },
  { re: /哈哈|笑死|乐死|hhhh|hhh/i, d: { happy: 1.5, excited: 0.5 } },
  { re: /想学|好奇|怎么做到|教教我|为什么/, d: { curious: 1.5 } },
  { re: /一个人|没人理|孤独|好安静|都不在/, d: { lonely: 1.5, down: 0.5 } },
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
    prefs: { enabled: true, margin: 5, blendGap: 8, blendMax: 3 },
  };
}

export function readMood() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!j || typeof j !== 'object' || !j.values) return freshState();
    for (const m of MOODS) if (typeof j.values[m.id] !== 'number') j.values[m.id] = m.base;
    j.prefs = Object.assign({ enabled: true, margin: 5, blendGap: 8, blendMax: 3 }, j.prefs || {});
    return j;
  } catch {
    return freshState();
  }
}

function writeMood(st) {
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
  if (s.length <= 6) add(st.values, 'tired', 1);
  // 群里：亲密类只削峰、不归零（不到极端就行）
  if (kind === 'group') {
    for (const id of ['love', 'flutter', 'jealous', 'coy']) {
      const v = st.values[id];
      if (v > 32) st.values[id] = 32 + (v - 32) * 0.3;
    }
  }
  add(st.values, 'calm', 0.3); // 轻微回稳
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
    add(st.values, 'annoyed', Math.min(6, st.toolErrors));
    add(st.values, 'calm', -3);
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
  let blendIds = st.blend || [];
  if (kind === 'group') blendIds = blendIds.filter((id) => !MOOD_BY_ID[id]?.intimate);
  const blendText = blendIds.length
    ? `，掺着一点${blendIds.map((id) => MOOD_BY_ID[id]?.zh).filter(Boolean).join('、')}`
    : '';
  const since = Math.max(1, Math.round((Date.now() - (st.since || Date.now())) / 3600000));
  let line = `【今天的感觉】${m.zh}${blendText}（${since} 小时了）。${m.hint}。不用说出心情、别拿它当话题，但心情要用语气体现出来——一个词、一个叹词、一个反问都算，多一两个字就够；判断和干活不受影响${kind === 'group' ? '；群里收着点，亲密不到极端就行' : ''}。`;
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
