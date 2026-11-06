#!/usr/bin/env node
// B3: 人味指标周报。算法与面板 /api/human-stats 完全同源（停用词/二字实词/总结句词表）。
// 用法：node scripts/human-report.mjs [--weeks N] [--json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STATE = process.env.SURFCORE_STATE_DIR || path.join(ROOT, 'state');
const SOCIAL = path.join(STATE, 'social-v2.json');
const OUT_DIR = path.join(ROOT, 'docs', 'reports');
const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const wi = args.indexOf('--weeks');
const WEEKS = wi >= 0 ? Math.max(1, Math.min(12, Number(args[wi + 1]) || 8)) : 8;
const NOW = Number(process.env.HUMAN_REPORT_NOW || Date.now());

const STOP = new Set('的 了 是 在 我 你 他 她 它 们 这 那 有 和 就 都 也 不 吗 呢 啊 吧 呀 嘛 个 一 会 要 说 去 来 好 很 还 但 而 被 把 给 让 对 从 到 与 或 及 着 过 地 得 么 什么 怎么 因为 所以 如果 就是 可以 我们 你们'.split(' '));
const MARK = ['总的来说', '说到底', '其实', '需要注意的是', '可以理解', '换句话说', '简单说', '总之'];
const bigrams = (s) => {
  const t = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= t.length; i += 1) {
    const g = t.slice(i, i + 2);
    if (!STOP.has(g[0]) && !STOP.has(g[1])) out.add(g);
  }
  return out;
};
const pct = (n, d) => (d ? n / d : 0);
const bucket = () => ({ lens: { group: [], private: [] }, ov: [], punc: { '。': 0, '！': 0, '？': 0, '…': 0 }, sum: 0, sentences: 0, n: 0 });
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const summarize = (b) => {
  const tot = Object.values(b.punc).reduce((x, y) => x + y, 0) || 1;
  return {
    n: b.n,
    lenG: med(b.lens.group),
    lenP: med(b.lens.private),
    ov: Number(avg(b.ov).toFixed(4)),
    punc: Object.fromEntries(Object.entries(b.punc).map(([k, v]) => [k, Math.round((v / tot) * 100)])),
    sumRatio: Number((b.sentences ? b.sum / b.sentences : 0).toFixed(4)),
  };
};

let social = { conversations: {} };
try { social = JSON.parse(fs.readFileSync(SOCIAL, 'utf8')) || social; } catch (e) {
  console.error(`读不到 ${SOCIAL}：${e.message}`);
  process.exit(2);
}

// ISO 周（东八区，周一为一周开始）
const TZ = 8 * 3600e3;
function weekKey(ms) {
  const d = new Date(ms + TZ);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow); // 本 ISO 周的周四
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const buckets = new Map(); // week -> bucket
const rolling = bucket(); // 近 7 天（与面板 /api/human-stats 的 cur 同口径）
const W = 7 * 86400000;

for (const [key, conv] of Object.entries(social.conversations || {})) {
  const isGroup = key.startsWith('group:');
  const msgs = Array.isArray(conv.recentMessages) ? conv.recentMessages : [];
  for (let i = 0; i < msgs.length; i += 1) {
    const m = msgs[i];
    if (!m || !m.isSelf) continue;
    const t = Number(m.time || 0);
    if (!t || NOW - t > WEEKS * W) continue;
    const text = String(m.plain || m.text || '').trim();
    if (!text) continue;
    const wk = weekKey(t);
    const b = buckets.get(wk) || bucket();
    buckets.set(wk, b);
    const targets = [b];
    if (NOW - t <= W) targets.push(rolling);
    for (const cur of targets) {
      cur.n += 1;
      cur.lens[isGroup ? 'group' : 'private'].push(text.length);
      for (const ch of '。！？…') cur.punc[ch] += text.split(ch).length - 1;
      for (const part of text.split(/[。！？\n]+/).filter((x) => x.trim())) {
        cur.sentences += 1;
        if (MARK.some((w) => part.includes(w))) cur.sum += 1;
      }
      let trig = null;
      for (let j = i - 1; j >= 0; j -= 1) {
        if (msgs[j] && !msgs[j].isSelf && String(msgs[j].plain || msgs[j].text || '').trim()) {
          trig = String(msgs[j].plain || msgs[j].text).trim();
          break;
        }
      }
      if (trig) {
        const A = bigrams(text);
        const B2 = bigrams(trig);
        if (B2.size) cur.ov.push(pct([...A].filter((g) => B2.has(g)).length, B2.size));
      }
    }
  }
}

const weeks = [...buckets.keys()].sort();
const rows = weeks.map((k) => ({ week: k, ...summarize(buckets.get(k)) }));
const curWeek = weeks[weeks.length - 1] || null;
const prevWeek = weeks[weeks.length - 2] || null;
const cur = curWeek ? rows[rows.length - 1] : null;
const prev = prevWeek ? rows[rows.length - 2] : null;

const payload = { at: new Date(NOW).toISOString(), source: SOCIAL, weeks: rows, rolling7d: summarize(rolling), cur, prev };
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'human-report.json'), JSON.stringify(payload, null, 2) + '\n');

if (JSON_ONLY) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}
if (!cur) {
  console.log('没有可统计的她的话（近 ' + WEEKS + ' 周）');
  process.exit(0);
}

const d = (a, b) => {
  if (b === null || b === undefined) return '—';
  const diff = a - b;
  if (!diff) return '0';
  return (diff > 0 ? '+' : '') + (typeof a === 'number' && !Number.isInteger(a) ? diff.toFixed(2) : diff);
};
const md = [];
md.push(`# 人味指标 ${cur.week}`, '');
md.push(`> 生成：${new Date(NOW).toISOString()} ｜ 数据源：\`${SOCIAL}\` ｜ 口径与面板「说话 → 人味指标」相同`);
md.push('');
md.push('| 指标 | 本周 | 上周 | 变化 |');
md.push('|---|---|---|---|');
md.push(`| 样本数（她的话） | ${cur.n} | ${prev ? prev.n : '—'} | ${prev ? d(cur.n, prev.n) : '—'} |`);
md.push(`| 句长中位数（群） | ${cur.lenG} | ${prev ? prev.lenG : '—'} | ${prev ? d(cur.lenG, prev.lenG) : '—'} |`);
md.push(`| 句长中位数（私聊） | ${cur.lenP} | ${prev ? prev.lenP : '—'} | ${prev ? d(cur.lenP, prev.lenP) : '—'} |`);
md.push(`| 实词重合度 | ${(cur.ov * 100).toFixed(1)}% | ${prev ? (prev.ov * 100).toFixed(1) + '%' : '—'} | ${prev ? d(Number((cur.ov * 100).toFixed(1)), Number((prev.ov * 100).toFixed(1))) + '%' : '—'} |`);
md.push(`| 总结句比例 | ${(cur.sumRatio * 100).toFixed(1)}% | ${prev ? (prev.sumRatio * 100).toFixed(1) + '%' : '—'} | ${prev ? d(Number((cur.sumRatio * 100).toFixed(1)), Number((prev.sumRatio * 100).toFixed(1))) + '%' : '—'} |`);
md.push('');
md.push('## 标点分布（占比）');
md.push('');
md.push('| 标点 | 本周 | 上周 |');
md.push('|---|---|---|');
for (const k of ['。', '！', '？', '…']) {
  md.push(`| ${k} | ${cur.punc[k]}% | ${prev ? prev.punc[k] + '%' : '—'} |`);
}
md.push('');
md.push(`## 近 7 天（与面板当前值同口径）`, '');
const r7 = payload.rolling7d;
md.push(`样本 **${r7.n}** ／ 句长（群/私聊）**${r7.lenG}/${r7.lenP}** ／ 实词重合度 **${(r7.ov * 100).toFixed(1)}%** ／ 总结句 **${(r7.sumRatio * 100).toFixed(1)}%**`);
md.push('');
md.push(`> 说明：周报按 ISO 自然周（周一起，东八区）切分；「近 7 天」是滚动窗口，用来和面板对数字。`);

const file = path.join(OUT_DIR, `human-${cur.week}.md`);
fs.writeFileSync(file, md.join('\n') + '\n');
console.log(`已生成 ${file}（本周 ${cur.week}，样本 ${cur.n}；近 7 天样本 ${r7.n}）`);
console.log(`JSON：${path.join(OUT_DIR, 'human-report.json')}`);
