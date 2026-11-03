// utterances.js —— 她说的话（调试用：汇总她所有发言 + 人工打标）
// 数据源：apps/surfcore/state/social-v2.json 的 conversations[*].recentMessages
// 标记：~/.dsh/surfcore/state/utterance-marks.json
import fs from 'node:fs';
import path from 'node:path';

const MID = 3042876599; // 三叶自己的 QQ
const ROOT = process.env.SURFCORE_DIR || '/home/dsh/apps/surfcore';
const STATE = process.env.SURFCORE_STATE || '/home/dsh/.dsh/surfcore/state';
const CONV = path.join(ROOT, 'state', 'social-v2.json');
const MARKS = path.join(STATE, 'utterance-marks.json');

function readJson(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}

function isSelf(m) {
  const s = m && m.sender;
  if (!s) return false;
  const uin = Number(s.uin || s.user_id || s.id || 0);
  if (uin === MID) return true;
  return String(s.name || s.nickname || '') === '三叶';
}

function listAll({ sinceHours = 72, key = '' } = {}) {
  const d = readJson(CONV, {});
  const convs = d.conversations || {};
  const marks = readJson(MARKS, {});
  const since = Date.now() - Math.max(1, Number(sinceHours) || 72) * 3600 * 1000;
  const out = [];
  for (const [ck, c] of Object.entries(convs)) {
    if (key && ck !== key) continue;
    const ms = (c && (c.recentMessages || c.messages)) || [];
    for (const m of ms) {
      if (!isSelf(m)) continue;
      const t = Number(m.time || m.at || 0);
      if (t && t < since) continue;
      const id = String(m.id || m.message_id || (ck + ':' + t));
      const mk = marks[id] || {};
      out.push({ id, key: ck, at: t, text: String(m.plain || m.text || ''), tag: mk.tag || '', note: mk.note || '' });
    }
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

export default function createUtterances() {
  return {
    id: 'utterances',
    title: '她说的话',
    routes: [
      {
        path: '/api/socialV2/utterances',
        handle({ body, sendJson }) {
          const all = listAll({ sinceHours: body?.sinceHours, key: body?.key });
          const limit = Math.max(1, Math.min(500, Number(body?.limit) || 200));
          const tags = {};
          for (const it of all) if (it.tag) tags[it.tag] = (tags[it.tag] || 0) + 1;
          const byKind = {};
          for (const it of all) { const k = it.key.split(':')[0]; byKind[k] = (byKind[k] || 0) + 1; }
          return sendJson({ ok: true, total: all.length, byKind, tags, items: all.slice(0, limit) });
        },
      },
      {
        path: '/api/socialV2/utterance-mark',
        handle({ body, sendJson }) {
          const id = String(body?.id || '');
          if (!id) return sendJson({ ok: false, error: 'id 不能为空' });
          const all = readJson(MARKS, {});
          const tag = String(body?.tag || '').slice(0, 20);
          const note = String(body?.note || '').slice(0, 200);
          if (!tag && !note) delete all[id];
          else all[id] = { tag, note, at: Date.now() };
          try {
            fs.mkdirSync(path.dirname(MARKS), { recursive: true });
            fs.writeFileSync(MARKS, JSON.stringify(all, null, 0));
          } catch (e) {
            return sendJson({ ok: false, error: String(e?.message || e) });
          }
          return sendJson({ ok: true, marked: !!(tag || note) });
        },
      },
    ],
  };
}
