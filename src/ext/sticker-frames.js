// 看表情/动图：从最近的聊天记录里挑出最后一张图，抽 3 帧拼成横排图给模型看。
// M2 第十五步从 bridge 的两条路由里搬出来（VIEW_STICKER_PATCH / VIEW_STICKER_GXH）。
// 依赖（拉历史、找缓存、抽帧）由 bridge 注入，这样扩展不碰 bridge 内部状态。

const KEY_RE = /^(group|private):(\d+)$/;

export function parseMediaKey(key) {
  const m = KEY_RE.exec(String(key ?? '').trim());
  if (!m) return null;
  return { kind: m[1], id: Number(m[2]) };
}

/** 从消息数组里倒着找最后一张图/表情。 */
export function pickLastMedia(messages) {
  for (const msg of [...messages].reverse()) {
    for (const seg of [...(msg?.message ?? [])].reverse()) {
      if (seg?.type === 'image' || seg?.type === 'mface') {
        const d = seg.data ?? {};
        return {
          kind: seg.type === 'mface' ? 'sticker' : 'image',
          file: String(d.file ?? ''),
          url: String(d.url ?? ''),
          subType: String(d.sub_type ?? d.subType ?? ''),
          summary: String(d.summary ?? ''),
          emojiId: String(d.emoji_id ?? d.emojiId ?? ''),
        };
      }
    }
  }
  return null;
}

/** gxh.vip 直链会 404：从历史里找同一张图（同文件名或同 emojiId）的可下载链接。 */
export function fixGxhUrl(target, messages, log) {
  if (!target || !String(target.url || '').includes('gxh.vip')) return target;
  const wantFile = String(target.file || '').split('/').pop();
  const wantEmoji = String(target.emojiId || '');
  for (const msg of [...messages].reverse()) {
    for (const seg of msg?.message ?? []) {
      if (seg?.type !== 'image' && seg?.type !== 'mface') continue;
      const d = seg.data ?? {};
      const u = String(d.url ?? '');
      if (!u.startsWith('http') || u.includes('gxh.vip')) continue;
      const f = String(d.file ?? '').split('/').pop();
      const eid = String(d.emoji_id ?? d.emojiId ?? '');
      if ((wantFile && f === wantFile) || (wantEmoji && eid === wantEmoji)) {
        target.url = u;
        log('[看图] gxh 直链失效，改用历史里的可下载链接');
        return target;
      }
    }
  }
  return target;
}

/**
 * 抽帧主流程（两条路由共用）。
 * @returns {Promise<{code:number, payload:any}>}
 */
export async function stickerFrames({ key, count, findCached, frameSheet, fetchHistory, log }) {
  const parsed = parseMediaKey(key);
  if (!parsed) return { code: 400, payload: { ok: false, error: 'key 必须是 group:群号 或 private:QQ号' } };
  const hist = await fetchHistory(parsed.kind, parsed.id, count);
  const msgs = Array.isArray(hist) ? hist : (Array.isArray(hist?.messages) ? hist.messages : []);
  const target = fixGxhUrl(pickLastMedia(msgs), msgs, log);
  if (!target) return { code: 404, payload: { ok: false, error: '最近 20 条里没有图片/表情' } };
  const cached = findCached(key);
  const sheet = await frameSheet(target, cached?.file ?? '');
  log(`[看图] 已抽 ${sheet.frames} 帧${sheet.animated ? '（动图）' : ''} → ${sheet.path}`);
  return { code: 200, payload: { ok: true, key, ...sheet, summary: target.summary || '' } };
}
