// QQ 空间：读说说 / 评论 / 发说说 / 删说说。
// M2 第十四步从 bridge 的四个 HTTP 路由里搬出来，逻辑逐行保留（含 p_skey → g_tk 推导、_Callback 剥壳、@ 回复写法）。
// 鉴权与模式闸门仍留在 bridge（那是策略，不是业务）。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const UGC_RIGHTS = [1, 4, 16, 64, 128];

export function qzoneEnabled(cfg) {
  return cfg?.socialV2?.qzone?.enabled !== false;
}

export function qzoneUgcRight(cfg, value) {
  const allowed = UGC_RIGHTS;
  const n = Number(value);
  if (allowed.includes(n)) return n;
  const d = Number(cfg?.socialV2?.qzone?.defaultUgcRight);
  return allowed.includes(d) ? d : 64;
}

async function qzoneCookie(bot) {
  const ck = async (domain) => {
    try { const r = await bot.request('get_cookies', { domain }); return String(r?.cookies ?? r?.data?.cookies ?? ''); } catch { return ''; }
  };
  const parts = [await ck('user.qzone.qq.com'), await ck('h5.qzone.qq.com')].join('; ').split(/;\s*/).filter(Boolean);
  return [...new Set(parts)].join('; ');
}

function qzoneAuth(cookie) {
  const pSkeyRaw = ((/p_skey=([^;]+)/.exec(cookie) || [])[1] || '').replace(/^@/, '');
  if (!pSkeyRaw) return null;
  let h = 5381;
  for (let i = 0; i < pSkeyRaw.length; i += 1) h += (h << 5) + pSkeyRaw.charCodeAt(i);
  return { gtk: h & 0x7fffffff };
}

function unwrap(text) {
  const s = String(text).trim().replace(/^_Callback\(/, '').replace(/\);?$/, '');
  try { return JSON.parse(s); } catch { return null; }
}

/** 读说说列表。返回 { code, payload } */
export async function fetchQzoneFeed({ cfg, bot, body }) {
  const cookie = await qzoneCookie(bot);
  const auth = qzoneAuth(cookie);
  if (!auth) return { code: 502, payload: { ok: false, error: '拿不到 QQ 空间登录态（缺 p_skey），可能 QQ 没登录' } };
  const owner = String(cfg?.ownerQQ ?? '').trim();
  const uin = String(body?.uin ?? owner).trim() || owner;
  const num = Math.min(Math.max(Number(body?.num ?? 10) || 10, 1), 20);
  const url = `https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6?uin=${uin}&ftype=0&sort=0&pos=0&num=${num}&hostUin=${uin}&inCharset=utf-8&outCharset=utf-8&notice=0&format=json&g_tk=${auth.gtk}`;
  const res = await fetch(url, {
    headers: { cookie, 'user-agent': UA, referer: `https://user.qzone.qq.com/${uin}` },
    signal: AbortSignal.timeout(15000),
  });
  const data = unwrap(await res.text());
  if (!data || data.code !== 0) return { code: 502, payload: { ok: false, error: `空间返回 ${data?.code ?? res.status}` } };
  const items = (data.msglist || []).map((m) => ({
    tid: m.tid,
    content: String(m.content ?? ''),
    created: m.createTime ?? m.created_time ?? null,
    comments: (m.commentlist || []).map((c) => ({
      name: String(c.name ?? ''),
      uin: String(c.uin ?? ''),
      commentId: String(c.tid ?? ''),
      isOwner: String(c.uin ?? '') === owner,
      content: String(c.content ?? ''),
      replies: (c.list_3 || []).map((r) => ({ name: String(r.name ?? ''), uin: String(r.uin ?? ''), content: String(r.content ?? '') })),
      replyCount: Number(c.reply_num ?? 0),
    })),
    imageCount: (m.pic || []).length,
  }));
  return { code: 200, payload: { ok: true, uin, count: items.length, items } };
}

/** 在说说下评论（可选回复某人：正文前加 @ 提及）。返回 { code, payload } */
export async function commentQzone({ cfg, bot, body, selfUserId }) {
  const content = String(body?.content ?? '').trim();
  if (!content) return { code: 400, payload: { ok: false, error: 'content 不能为空' } };
  if (content.length > 200) return { code: 400, payload: { ok: false, error: '评论过长（上限 200 字）' } };
  const owner = String(cfg?.ownerQQ ?? '').trim();
  const hostUin = String(body?.hostUin ?? body?.uin ?? owner).trim() || owner;
  const tid = String(body?.tid ?? '').trim();
  if (!tid) return { code: 400, payload: { ok: false, error: 'tid 不能为空（先用 qq_qzone_feed 拿列表）' } };

  const cookie = await qzoneCookie(bot);
  const auth = qzoneAuth(cookie);
  if (!auth) return { code: 502, payload: { ok: false, error: '拿不到 QQ 空间登录态（缺 p_skey），可能 QQ 没登录' } };

  const replyUin = String(body?.replyTo ?? body?.reply_to_qq ?? '').trim();
  const replyNick = String(body?.replyNick ?? body?.reply_to_nick ?? '').trim();
  const cContent = replyUin ? `@{uin:${replyUin},nick:${replyNick || replyUin},who:1,auto:1}${content}` : content;
  const form = new URLSearchParams({
    topicId: `${hostUin}_${tid}`,
    content: cContent,
    hostUin,
    uin: String(selfUserId || ''),
    feedsType: '100',
    inSame: '1',
    format: 'json',
    plat: 'qzone',
    source: 'ic',
    qzreferrer: `https://user.qzone.qq.com/${hostUin}`,
  });
  const res = await fetch(`https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds?g_tk=${auth.gtk}`, {
    method: 'POST',
    headers: { cookie, 'user-agent': UA, referer: `https://user.qzone.qq.com/${hostUin}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const data = unwrap(await res.text());
  if (!data || data.code !== 0) return { code: 502, payload: { ok: false, error: `评论失败 ${data?.code ?? res.status}` } };
  return { code: 200, payload: { ok: true, hostUin, tid, content, replyTo: replyUin || null } };
}

/** 发说说。返回 { code, payload } */
export async function sendQzone({ cfg, bot, body }) {
  const content = String(body?.content ?? '').trim();
  if (!content) return { code: 400, payload: { ok: false, error: 'content 不能为空' } };
  if (content.length > 1500) return { code: 400, payload: { ok: false, error: '正文过长（上限 1500 字）' } };
  const images = Array.isArray(body?.images) ? body.images.map((x) => String(x)).filter(Boolean).slice(0, 9) : [];
  const ugcRight = qzoneUgcRight(cfg, body?.ugcRight);
  const targetUins = Array.isArray(body?.targetUins) ? body.targetUins.map((x) => String(x)).filter(Boolean) : [];
  if ((ugcRight === 16 || ugcRight === 128) && !targetUins.length) {
    return { code: 400, payload: { ok: false, error: 'ugcRight 16/128 需要 targetUins' } };
  }
  const payload = { content, images, ugc_right: ugcRight };
  if (targetUins.length) payload.target_uins = targetUins;
  const res = await bot.request('send_qzone_msg', payload);
  const tid = String(res?.data?.tid ?? res?.tid ?? '');
  return { code: 200, payload: { ok: true, tid, ugcRight, images: images.length }, log: `[qzone] 已发说说 ugc_right=${ugcRight} 图片=${images.length} tid=${tid || '（未返回）'}` };
}

/** 删说说。返回 { code, payload } */
export async function deleteQzone({ bot, body }) {
  const tid = String(body?.tid ?? '').trim();
  if (!tid) return { code: 400, payload: { ok: false, error: 'tid 不能为空' } };
  const res = await bot.request('delete_qzone_msg', { tid });
  return { code: 200, payload: { ok: true, tid, raw: res }, log: `[qzone] 删除说说 tid=${tid}` };
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'qzone', title: 'QQ 空间', kind: 'tool', enabledByDefault: true, hot: false, hooks: [], config: ['socialV2.qzone', 'ownerQQ'], stateFiles: [] };
