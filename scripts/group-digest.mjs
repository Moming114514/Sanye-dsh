// group-digest.mjs —— 每 15 分钟把各群最近的消息压成 3 行摘要（纯本地规则，不调模型）
// 输出 ~/.dsh/surfcore/state/group-digest.json
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/home/dsh';
const SV = path.join(HOME, 'apps/surfcore/state/social-v2.json');
const OUT = path.join(HOME, '.dsh/surfcore/state/group-digest.json');
const WINDOW_MIN = 20;

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const hhmm = (t) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });

const sv = readJson(SV, {});
const convs = sv.conversations || {};
const now = Date.now();
const out = { at: new Date().toISOString(), groups: {} };

for (const [key, c] of Object.entries(convs)) {
  if (!key.startsWith('group:')) continue;
  const ms = (c.recentMessages || []).filter((m) => {
    const t = Number(m.time || 0);
    return t && now - t <= WINDOW_MIN * 60000;
  });
  if (ms.length < 3) continue;
  const speakers = new Map();
  for (const m of ms) {
    const s = m.sender;
    const nm = (typeof s === 'object' && s && (s.name || s.card || s.user_id)) || (typeof s === 'string' ? s : '?');
    speakers.set(nm, (speakers.get(nm) || 0) + 1);
  }
  const top = [...speakers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const tail = ms.slice(-3).map((m) => {
    const s = m.sender;
    const nm = (typeof s === 'object' && s && (s.name || s.card || s.user_id)) || (typeof s === 'string' ? s : '?');
    return `${hhmm(Number(m.time))} ${nm}：${String(m.plain || '').slice(0, 40)}`;
  });
  out.groups[key] = {
    n: ms.length,
    who: top.map(([nm, c2]) => `${nm}×${c2}`).join('、'),
    tail,
  };
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log('digest groups:', Object.keys(out.groups).length, '| window', WINDOW_MIN, 'min');