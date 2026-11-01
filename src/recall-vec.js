import fs from 'node:fs';

// recall-vec.js — 轻量「语义近似」召回（零依赖、零下载、零模型）
//
// 为什么不用真向量模型：这台机器 2 核无 GPU，装 ONNX 小模型要下 100MB+，
// 而我们要解决的只是「换了说法就搜不到」这一类问题。
// 做法：字符 bigram + 词形 TF-IDF 余弦（和上游 sticker-semantics 一个思路）。
// 好处：确定、瞬时、不吃内存；坏处：不懂同义词（同义词靠下面的 SYN 表兜一点）。
// 以后若有了 embedding 服务，把打分换掉即可，接口不变。

const STOP = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '就', '都', '也', '很',
  '这', '那', '有', '没', '不', '吗', '呢', '啊', '吧', '呀', '么', '个', '要', '会', '说', '着',
  'the', 'and', 'for', 'with', 'that', 'this',
]);

const SYN = [
  [/鲸鱼娘|鲸鱼|小鲸鱼|大肥鱼/g, '三叶 鲸鱼 蓝'],
  [/生日|过生日|生日快乐/g, '生日 蛋糕'],
  [/考|考试|复习|考研/g, '考试 学习'],
  [/说说|空间|动态/g, '说说 空间 动态'],
];

function normalize(s) {
  let t = String(s ?? '').toLowerCase();
  for (const [re, rep] of SYN) t = t.replace(re, rep);
  return t;
}

function tokens(s) {
  const t = normalize(s);
  const out = [];
  for (const m of t.matchAll(/[a-z0-9_]{2,}/g)) out.push(m[0]);
  for (const m of t.matchAll(/[\u4e00-\u9fff]+/g)) {
    const run = m[0];
    for (let i = 0; i < run.length; i += 1) {
      const uni = run[i];
      if (!STOP.has(uni)) out.push(uni);
      if (i + 1 < run.length) out.push(run.slice(i, i + 2));
    }
  }
  return out;
}

function tf(toks) {
  const m = new Map();
  for (const t of toks) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

export function fuzzyRecallFiles(files, query, { limit = 3, minScore = 0.2, maxLines = 4000 } = {}) {
  const qToks = tokens(query);
  if (!qToks.length) return [];
  const qTf = tf(qToks);
  const qSet = new Set(qToks);

  const docs = [];
  for (const f of files) {
    let raw = '';
    try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const lines = raw.split('\n');
    const cap = Math.min(lines.length, maxLines);
    for (let i = 0; i < cap; i += 1) {
      const line = lines[i].trim();
      if (line.length < 6) continue;
      const toks = tokens(line);
      if (!toks.length) continue;
      if (!toks.some((t) => qSet.has(t))) continue;
      docs.push({ file: f.split(/[\\/]/).pop(), line, tf: tf(toks) });
    }
  }
  if (!docs.length) return [];

  const df = new Map();
  for (const d of docs) for (const k of d.tf.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = docs.length;
  const idf = (k) => Math.log((N + 1) / ((df.get(k) || 0) + 1)) + 1;

  let qNorm = 0;
  for (const [k, v] of qTf) qNorm += (v * idf(k)) ** 2;
  qNorm = Math.sqrt(qNorm) || 1;

  const scored = [];
  for (const d of docs) {
    let dot = 0;
    let dNorm = 0;
    for (const [k, v] of d.tf) {
      const w = v * idf(k);
      dNorm += w * w;
      const qv = qTf.get(k);
      if (qv) dot += qv * idf(k) * w;
    }
    dNorm = Math.sqrt(dNorm) || 1;
    const score = dot / (qNorm * dNorm);
    if (score >= minScore) {
      scored.push({ file: d.file, score, via: 'fuzzy', text: d.line.length > 240 ? d.line.slice(0, 240) + '…' : d.line });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    if (seen.has(s.text)) continue;
    seen.add(s.text);
    out.push({ ...s, score: Math.round(s.score * 1000) / 1000 });
    if (out.length >= limit) break;
  }
  return out;
}
