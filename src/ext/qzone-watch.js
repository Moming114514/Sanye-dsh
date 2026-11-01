// src/ext/qzone-watch.js —— QQ 空间自动看他/她的说说（从 bridge.js 迁出，M2）
// 依赖注入：{ getCfg, log, stateDir, bot, deliverPrompt, paused, helpers }
//   helpers = { qzoneEnabled, qqIsOff, isPeakNow, tokenGuardDowngrade }
import fs from 'node:fs';
import path from 'node:path';

export default function createQzoneWatch({ getCfg, log, stateDir, getBot, getDeliverPrompt, paused, helpers }) {
  // 自动看他的说说但不秒评：发现新说说后隔 5~25 分钟才提醒她；
  // 高峰时段 / 省钱模式 完全不看；每天最多 watchMaxPerDay 条；一轮只提醒一条。
// QZONE_WATCH_PATCH（2026-10-30）：自动看他的说说，但**不秒评** —— 发现新说说后隔 5~25 分钟才提醒她；
// 高峰时段 / 省钱模式 时完全不看；每天最多提醒 watchMaxPerDay 条；一轮只提醒一条。
const UA_QZONE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
function qzoneWatchCfg() {
  const q = getCfg().socialV2?.qzone ?? {};
  return {
    on: q.watchOwner !== false,
    checkMinMs: Number(q.watchCheckMinMs ?? 15 * 60 * 1000),
    checkMaxMs: Number(q.watchCheckMaxMs ?? 30 * 60 * 1000),
    delayMinMs: Number(q.watchDelayMinMs ?? 5 * 60 * 1000),
    delayMaxMs: Number(q.watchDelayMaxMs ?? 25 * 60 * 1000),
    maxPerDay: Number(q.watchMaxPerDay ?? 3),
    onlyOffPeak: q.watchOnlyOffPeak !== false
  };
}
const qzoneSeenFile = path.join(stateDir, 'qzone-seen.json');
function qzoneSeenRead() {
  try { const v = JSON.parse(fs.readFileSync(qzoneSeenFile, 'utf8')); return { seen: v.seen || [], comments: v.comments || [], pending: v.pending || [], day: v.day || '', delivered: Number(v.delivered || 0), nextAt: Number(v.nextAt || 0) }; }
  catch { return { seen: [], comments: [], pending: [], day: '', delivered: 0, nextAt: 0 }; }
}
function qzoneSeenWrite(v) {
  try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(qzoneSeenFile, JSON.stringify(v)); } catch {}
}
async function qzoneWebAuth() {
  const ck = async (domain) => { try { const r = await getBot().request('get_cookies', { domain }); return String(r?.cookies ?? r?.data?.cookies ?? ''); } catch { return ''; } };
  const cookie = [...new Set([await ck('user.qzone.qq.com'), await ck('h5.qzone.qq.com')].join('; ').split(/;\s*/).filter(Boolean))].join('; ');
  const pSkey = ((/p_skey=([^;]+)/.exec(cookie) || [])[1] || '').replace(/^@/, '');
  if (!pSkey) return null;
  let h = 5381;
  for (let i = 0; i < pSkey.length; i += 1) h += (h << 5) + pSkey.charCodeAt(i);
  return { cookie, gtk: h & 0x7fffffff };
}
let qzoneWatchBusy = false;
async function qzoneWatchTick() {
  if (qzoneWatchBusy) return;
  qzoneWatchBusy = true;
  try {
    const w = qzoneWatchCfg();
    if (!w.on || !helpers.qzoneEnabled() || paused() || helpers.qqIsOff()) return;
    const st = qzoneSeenRead();
    const today = new Date().toISOString().slice(0, 10);
    if (st.day !== today) { st.day = today; st.delivered = 0; }
    const now = Date.now();
    if (!st.nextAt || now >= st.nextAt) {
      st.nextAt = now + w.checkMinMs + Math.floor(Math.random() * Math.max(0, w.checkMaxMs - w.checkMinMs));
      const calm = !(w.onlyOffPeak && (helpers.isPeakNow() || helpers.tokenGuardDowngrade().on));
      const ownerQQ = String(getCfg().ownerQQ ?? '').trim();
      if (calm && ownerQQ) {
        const auth = await qzoneWebAuth();
        if (auth) {
          try {
            const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${ownerQQ}&ftype=0&sort=0&pos=0&num=5&hostUin=${ownerQQ}&inCharset=utf-8&outCharset=utf-8&notice=0&format=json&g_tk=${auth.gtk}`;
            const res = await fetch(url, { headers: { cookie: auth.cookie, 'user-agent': UA_QZONE, referer: `https://user.qzone.qq.com/${ownerQQ}` }, signal: AbortSignal.timeout(15000) });
            const txt = String(await res.text()).trim().replace(/^_Callback\(/, '').replace(/\);?$/, '');
            const data = JSON.parse(txt);
            if (data?.code === 0) {
              for (const m of (data.msglist || [])) {
                if (!m?.tid || st.seen.includes(m.tid) || st.pending.some((p) => p.tid === m.tid)) continue;
                st.pending.push({
                  tid: m.tid,
                  content: String(m.content ?? '').slice(0, 120),
                  at: now,
                  dueAt: now + w.delayMinMs + Math.floor(Math.random() * Math.max(0, w.delayMaxMs - w.delayMinMs))
                });
              }
              // QZONE_WATCH_REPLY：他在这几条说说下的留言（含楼中楼回复她）也算一次「叫我」
              const ownerUin = String(getCfg().ownerQQ ?? '').trim();
              st.comments = Array.isArray(st.comments) ? st.comments : [];
              const seedOnly = st.comments.length === 0; // 首次运行只登记旧评论，不补提醒
              for (const m of (data.msglist || [])) {
                const pool = [];
                for (const c of (m.commentlist || [])) {
                  pool.push({ c, reply: false });
                  for (const rr of (c.list_3 || [])) pool.push({ c: rr, reply: true });
                }
                for (const item of pool) {
                  const c = item.c;
                  if (!c || String(c.uin ?? '') !== ownerUin) continue;
                  // QZONE_WATCH_REPLY_FIX：@ 别人的略过；@ 她本人的要算（那是他在回她）
                  const cText = String(c.content ?? '');
                  if (cText.includes('@{uin:') && !cText.includes(`uin:${selfUserId || ''},`)) continue;
                  const key = `${m.tid}:${c.create_time ?? c.createTime ?? ''}:${String(c.content ?? '').slice(0, 20)}`;
                  if (st.comments.includes(key) || st.pending.some((p) => p.key === key)) continue;
                  if (seedOnly) { st.comments.push(key); continue; }
                  st.pending.push({
                    kind: 'comment',
                    key,
                    tid: m.tid,
                    content: String(c.content ?? '').slice(0, 120),
                    postContent: String(m.content ?? '').slice(0, 60),
                    reply: item.reply,
                    at: now,
                    dueAt: now + w.delayMinMs + Math.floor(Math.random() * Math.max(0, w.delayMaxMs - w.delayMinMs))
                  });
                  st.comments.push(key);
                }
              }
              st.comments = st.comments.slice(-300);
              st.pending = st.pending.slice(-10);
            }
          } catch (error) { log(`[空间] 看说说失败：${error?.message ?? error}`); }
        }
      }
    }
    for (const p of (st.pending || []).filter((x) => x.dueAt <= now)) {
      if (w.onlyOffPeak && (isPeakNow() || tokenGuardDowngrade().on)) break;
      if (st.delivered >= w.maxPerDay) break;
      st.pending = st.pending.filter((x) => x.tid !== p.tid);
      st.seen = [...st.seen, p.tid].slice(-200);
      st.delivered += 1;
      const ownerQQ = String(cfg.ownerQQ ?? '');
      const mins = Math.max(1, Math.round((now - p.at) / 60000));
      const isComment = p.kind === 'comment';
      const prompt = isComment
        ? `【空间留言】${mins} 分钟前他在「${p.postContent}」这条下面${p.reply ? '回了你一句' : '留了一句'}：「${p.content}」。tid=${p.tid}，hostUin=${ownerQQ}。
先判断他是冲着你说的，还是只是随口一句：冲着你说的就回（qq_qzone_comment 带 replyTo=${ownerQQ}），只是感叹就别硬接。`
        : `【空间提醒】${mins} 分钟前他发了一条说说：「${p.content}」。tid=${p.tid}，hostUin=${ownerQQ}。
先用 qq_qzone_feed 看一眼整条说说的评论区（返回里有每条评论是谁说的、他有没有回过你）。然后自己判断：
①他要是明着问你、叫你、或者话题是冲着你说完的，就回——回他的评论用 qq_qzone_comment 带上 reply_to_qq=${ownerQQ}，正文是你的话（简短，一两句）；
②他只是在自言自语、感慨，就别硬评，看过就行；
③评论区别人说的，你愿意接就简短接一句，不想接就当没看见，不跟人抬杠。`;
      try {
        await getDeliverPrompt()(`private:${ownerQQ}`, prompt);
        log(`[空间] 已提醒她看说说 ${p.tid}`);
      } catch (error) {
        log(`[空间] 提醒失败：${error?.message ?? error}`);
      }
      break;
    }
    qzoneSeenWrite(st);
  } finally {
    qzoneWatchBusy = false;
  }
}

  return { tick: qzoneWatchTick };
}
