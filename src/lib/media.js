// R4: media byte parsing moved out of bridge main(); behavior identical.
// All dependencies injected via createMediaFetch (no bridge import, no global cfg).
//   - fetch -> safeFetchBuffer
//   - ffmpeg/ffprobe -> execFile / execFileSync
//   - cache dir = <stateDir>/media-cache (same layout and file names)
import fs from 'node:fs';
import path from 'node:path';

export function createMediaFetch({
  stateDir,
  log,
  getBot,
  maxMediaBytes,
  maxMediaPixels,
  maxMediaCount,
  safeFetchBuffer,
  looksLikeImageBuffer,
  isSafeLocalMediaPath,
  mediaStatsBump,
  execFile,
  execFileSync,
}) {
  const MAX_MEDIA_BYTES = maxMediaBytes;
  const MAX_MEDIA_PIXELS = maxMediaPixels;
  const MAX_MEDIA_COUNT = maxMediaCount;
  const MEDIA_CACHE_DIR = path.join(stateDir, 'media-cache');
  const MEDIA_CACHE_INDEX = path.join(MEDIA_CACHE_DIR, 'index.json');

// ── 图片/表情字节解析（供一代自动内联与二代按需工具） ────────────────────
function mimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return 'image/jpeg';
}

function mimeFromUrl(url, fallback = 'image/jpeg') {
  try {
    const pathname = new URL(String(url)).pathname.toLowerCase();
    if (pathname.endsWith('.png')) return 'image/png';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  } catch {}
  return fallback;
}

// 解析常见图片宽高（PNG/JPEG/GIF；WebP 暂不解析返回 null）。
// 用于限制“图片炸弹”的解码像素量。
function getImageDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) { offset += 1; continue; }
        const marker = buf[offset + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        const len = buf.readUInt16BE(offset + 2);
        if (len < 2) return null;
        // SOF0-SOF15（排除 DHT C4、DAC CC、DNL DC、DRI DD）
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        }
        offset += 2 + len;
      }
    }
    // WebP：解析 VP8X / VP8L / VP8 三种容器，避免“图片炸弹”绕过像素上限。
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fourcc = buf.toString('ascii', 12, 16);
      if (fourcc === 'VP8X' && buf.length >= 30) {
        const width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
        const height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
        return { width, height };
      }
      if (fourcc === 'VP8L' && buf.length >= 25) {
        const bits = [buf[21], buf[22], buf[23], buf[24]];
        const width = 1 + (((bits[1] & 0x3f) << 8) | bits[0]);
        const height = 1 + (((bits[3] & 0x0f) << 10) | (bits[2] << 2) | ((bits[1] & 0xc0) >> 6));
        return { width, height };
      }
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        const width = buf.readUInt16LE(26) & 0x3fff;
        const height = buf.readUInt16LE(28) & 0x3fff;
        return { width, height };
      }
    }
  } catch {}
  return null;
}

function base64FromMaybe(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (s.startsWith('base64://')) return s.slice('base64://'.length).replace(/\s/g, '');
  if (s.startsWith('data:image/')) {
    const idx = s.indexOf(',');
    if (idx >= 0) return s.slice(idx + 1).replace(/\s/g, '');
  }
  // 纯 base64（允许少量空白）
  if (/^[A-Za-z0-9+/=\s]+$/.test(s)) return s.replace(/\s/g, '');
  return null;
}

// OneBot 图片 file 字段只应接受简单缓存文件名；拒绝路径、URL、盘符、协议前缀等，
// 防止把任意本地路径/内网 URL 交给网关 get_image 造成 SSRF/任意文件读取。
function isProbablySafeImageFileRef(file) {
  const s = String(file ?? '').trim();
  if (!s || s.length > 512) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  if (/[\\/]/.test(s)) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;
  if (/^(file|https?|base64|data):/i.test(s)) return false;
  if (s.includes('..')) return false;
  return /^[\w.+=@-]+$/.test(s);
}

// QQ 表情包 CDN 的地址可以只靠 emoji_id 推出来（实测形态：
// https://gxh.vip.qq.com/club/item/parcel/item/<id 前两位>/<id>/raw300.gif）。
// 市场表情不在网关缓存里（get_image 返回 image not found in cache），url 又可能缺失，
// 这条兜底能救回这一类；只接受纯十六进制 id，绝不把任意字符串拼进 URL。
function emojiCdnCandidates(emojiId) {
  const id = String(emojiId ?? '').trim();
  if (!/^[0-9a-f]{16,64}$/i.test(id)) return [];
  return [`https://gxh.vip.qq.com/club/item/parcel/item/${id.slice(0, 2)}/${id}/raw300.gif`];
}

// 有些网关不带 emoji_id，但 file 名里就嵌着它（实测 "f9-<32 位 hex>.gif"）。
function emojiIdFromFileName(file) {
  const match = /(?:^|[^0-9a-f])([0-9a-f]{32})\.(?:gif|png|jpe?g|webp)$/i.exec(String(file ?? '').trim());
  return match ? match[1] : '';
}

/** 校验一张图片字节：格式、大小（调用方已限）、像素上限；不通过返回 null。 */
function acceptImageBuffer(buf, label = '图片') {
  if (!buf || !buf.length) return null;
  if (!looksLikeImageBuffer(buf)) {
    log(`${label}不是有效图片（PNG/JPEG/GIF/WebP），已跳过`);
    return null;
  }
  const dims = getImageDimensions(buf);
  if (dims && dims.width * dims.height > MAX_MEDIA_PIXELS) {
    log(`${label}像素超限，已跳过（${dims.width}x${dims.height}）`);
    return null;
  }
  return { buffer: buf, mimeType: mimeFromBuffer(buf) };
}

function mediaFailReason(failures) {
  const joined = (failures || []).join(' | ');
  if (/图太大|超过大小限制/.test(joined)) return 'too-large';
  if (/404/.test(joined)) return 'http-404';
  if (/timeout|超时/i.test(joined)) return 'timeout';
  if (/不是有效图片/.test(joined)) return 'not-image';
  return 'fetch-failed';
}

function readMediaCache() {
  try { const j = JSON.parse(fs.readFileSync(MEDIA_CACHE_INDEX, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}

function writeMediaCache(list) {
  try { fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true }); fs.writeFileSync(MEDIA_CACHE_INDEX, JSON.stringify(list.slice(-300))); } catch {}
}

async function cacheIncomingMedia(key, msgId, segments) {
  if (!Array.isArray(segments) || !msgId) return;
  const list = readMediaCache();
  let i = 0;
  for (const seg of segments) {
    if (seg?.type !== 'image' && seg?.type !== 'mface') continue;
    const idx = i; i += 1;
    const id = `${msgId}:${idx}`;
    if (list.some((e) => e && e.id === id)) continue;
    const d = seg.data ?? {};
    const media = { kind: seg.type === 'mface' ? 'sticker' : 'image', file: String(d.file ?? ''), url: String(d.url ?? ''), subType: String(d.sub_type ?? d.subType ?? ''), emojiId: String(d.emoji_id ?? d.emojiId ?? ''), summary: String(d.summary ?? '') };
    try {
      const got = await fetchOneBotImage(media);
      if (!got?.buffer?.length) continue;
      fs.mkdirSync(MEDIA_CACHE_DIR, { recursive: true });
      const ext = /gif/i.test(got.mimeType || '') ? 'gif' : /png/i.test(got.mimeType || '') ? 'png' : /webp/i.test(got.mimeType || '') ? 'webp' : 'jpg';
      const file = path.join(MEDIA_CACHE_DIR, `${msgId}-${idx}.${ext}`);
      fs.writeFileSync(file, got.buffer);
      list.push({ id, key, msgId, at: Date.now(), file, size: got.buffer.length, kind: media.kind, summary: media.summary });
      log(`[看图] 已缓存${media.kind === 'sticker' ? '表情' : '图片'} ${msgId}:${idx}（${got.buffer.length} 字节）`);
    } catch {}
  }
  writeMediaCache(list);
}

function findCachedMedia(key) {
  const list = readMediaCache().filter((e) => e && e.key === key);
  return list.length ? list[list.length - 1] : null;
}

// VIEW_STICKER_PATCH（2026-10-31）：把动图/表情抽 3 帧拼成一张横排图，给模型"看"动作
async function stickerFrameSheet(media, cachedFile = '') {
  const fsMod = await import('node:fs');
  // VIEW_STICKER_CACHE：优先用收到时缓存下来的原图（自己发的表情链接多半已失效）
  let got = null;
  if (cachedFile) {
    try {
      const buf = fsMod.readFileSync(cachedFile);
      if (buf?.length) got = { buffer: buf, mimeType: /\.gif$/i.test(cachedFile) ? 'image/gif' : /\.png$/i.test(cachedFile) ? 'image/png' : /\.webp$/i.test(cachedFile) ? 'image/webp' : 'image/jpeg' };
    } catch {}
  }
  if (!got?.buffer) got = await fetchOneBotImage(media);
  if (!got?.buffer) throw new Error('取不到这张图的原始数据');
  const dir = '/home/dsh/napcat/config/_sticker-tmp';
  fsMod.mkdirSync(dir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = /gif/i.test(got.mimeType || '') ? 'gif' : /png/i.test(got.mimeType || '') ? 'png' : /webp/i.test(got.mimeType || '') ? 'webp' : 'jpg';
  const src = `${dir}/src-${stamp}.${ext}`;
  fsMod.writeFileSync(src, got.buffer);
  let duration = 0;
  try {
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src], { encoding: 'utf8', timeout: 15000 });
    duration = Number(String(probe).trim()) || 0;
  } catch {}
  const isAnimated = duration >= 0.12;
  // VIEW_STICKER_FIX3：先按 fps 均匀抽最多 6 帧，再取首/中/尾（-ss 定位到 GIF 末尾会抽出 0 字节）
  const files = [];
  if (!isAnimated) {
    const out = `${dir}/f-${stamp}-0.png`;
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1', '-vf', 'scale=240:-1:flags=lanczos', out], { timeout: 20000 });
      if (fsMod.existsSync(out) && fsMod.statSync(out).size > 0) files.push(out);
    } catch {}
  } else {
    const seq = `${dir}/seq-${stamp}-%02d.png`;
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', 'fps=4,scale=240:-1:flags=lanczos', '-frames:v', '6', seq], { timeout: 25000 });
    } catch {}
    const seqFiles = [];
    for (let i = 1; i <= 6; i += 1) {
      const f = `${dir}/seq-${stamp}-${String(i).padStart(2, '0')}.png`;
      if (fsMod.existsSync(f) && fsMod.statSync(f).size > 0) seqFiles.push(f);
    }
    const wanted = seqFiles.length >= 3
      ? [0, Math.floor(seqFiles.length / 2), seqFiles.length - 1]
      : seqFiles.map((_, i) => i);
    for (const idx of wanted) { if (seqFiles[idx]) files.push(seqFiles[idx]); }
    for (const f of seqFiles) { if (files.includes(f)) continue; try { fsMod.unlinkSync(f); } catch {} }
  }
  if (!files.length) throw new Error('抽帧失败');
  let sheet = files[0];
  if (files.length > 1) {
    const out = `${dir}/sheet-${stamp}.png`;
    const args = [];
    files.forEach((f) => args.push('-i', f));
    args.push('-filter_complex', `hstack=inputs=${files.length}`, '-loglevel', 'error', out);
    try { execFileSync('ffmpeg', ['-y', ...args], { timeout: 30000 }); sheet = out; } catch {}
  }
  try { fsMod.unlinkSync(src); } catch {}
  for (const f of files) { if (f !== sheet) { try { fsMod.unlinkSync(f); } catch {} } }
  const sheetName = sheet.split('/').pop();
  return {
    path: sheet,
    containerPath: `/app/napcat/config/_sticker-tmp/${sheetName}`,
    frames: files.length,
    animated: isAnimated,
    durationSec: Number(duration.toFixed(2)),
    mimeType: 'image/png'
  };
}

// ANIM_STILL_PATCH：动图/表情包只取 3 帧拼成一张静图再送模型（模型看不了循环动画）
async function flattenAnimated(buffer, mime) {
  if (!buffer || !/gif|webp|apng/i.test(String(mime || ''))) return null;
  let tmp = '';
  try {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const pathMod = await import('node:path');
    const cp = await import('node:child_process');
    tmp = pathMod.join(os.tmpdir(), 'anim-' + Date.now() + '-' + process.pid + '.gif');
    fs.writeFileSync(tmp, buffer);
    const out = tmp + '.png';
    await new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-vf', 'fps=1,scale=260:-1,tile=3x1', '-frames:v', '1', out],
        { timeout: 15000 }, (err) => (err ? reject(err) : resolve()));
    });
    const buf = fs.readFileSync(out);
    fs.rmSync(out, { force: true });
    if (!buf || buf.length < 200) return null;
    return { buffer: buf, mimeType: 'image/png' };
  } catch (e) {
    log('[media] 动图取帧失败：' + (e?.message || e));
    return null;
  } finally {
    if (tmp) { try { (await import('node:fs')).rmSync(tmp, { force: true }); } catch {} }
  }
}

// TASK-INPUT #2：超过 8MB 的图先降采样（1600px→960px，JPEG 压缩），仍超限就明确失败。
async function shrinkImageBuffer(buffer, mime) {
  if (!buffer || !buffer.length) return null;
  let tmp = '';
  try {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const pathMod = await import('node:path');
    const cp = await import('node:child_process');
    tmp = pathMod.join(os.tmpdir(), 'shrink-' + Date.now() + '-' + process.pid + '.img');
    fs.writeFileSync(tmp, buffer);
    for (const [size, q] of [[1600, 6], [960, 10]]) {
      const out = tmp + '.' + size + '.jpg';
      try {
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`, '-q:v', String(q), '-frames:v', '1', out],
            { timeout: 20000 }, (err) => (err ? reject(err) : resolve()));
        });
        const buf = fs.readFileSync(out);
        fs.rmSync(out, { force: true });
        if (buf && buf.length && buf.length <= MAX_MEDIA_BYTES) return { buffer: buf, mimeType: 'image/jpeg' };
      } catch {}
    }
    return null;
  } catch (e) {
    log('[media] 降采样失败：' + (e?.message || e));
    return null;
  } finally {
    if (tmp) { try { (await import('node:fs')).rmSync(tmp, { force: true }); } catch {} }
  }
}

async function fetchOneBotImage(media) {
  // TASK-INPUT #2：统一先走 get_image（SnowLuma 本地缓存最可靠），失败再直连 CDN。
  // 市场表情对 get_image 常常失败，但先本地后网络能少一次 404 往返。
  const emojiId = String(media.emojiId || emojiIdFromFileName(media.file) || '');
  const isSticker = media.kind === 'sticker' || !!emojiId || String(media.subType || '') === '1';
  const label = isSticker ? '表情' : '图片';
  const failures = [];
  const urls = [];
  const pushUrl = (raw) => {
    const s = String(raw ?? '').trim();
    if (!/^https?:\/\//i.test(s) || urls.includes(s)) return;
    urls.push(s);
  };
  pushUrl(media.url);
  for (const candidate of emojiCdnCandidates(emojiId)) pushUrl(candidate);

  const tryUrls = async () => {
    let sizeBlocked = false;
    for (const url of urls) {
      try {
        const fetched = await safeFetchBuffer(url, MAX_MEDIA_BYTES);
        const accepted = acceptImageBuffer(fetched.buffer, `${label} URL `);
        if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(url) };
        failures.push(`${url} 不是有效图片`);
      } catch (error) {
        const msg = String(error?.message ?? error);
        if (/超过大小限制/.test(msg) && !sizeBlocked) {
          sizeBlocked = true;
          try {
            const big = await safeFetchBuffer(url, MAX_MEDIA_BYTES * 4);
            const shrunk = await shrinkImageBuffer(big.buffer, big.mimeType || mimeFromUrl(url));
            const accepted = shrunk && acceptImageBuffer(shrunk.buffer, `${label} 降采样`);
            if (accepted) return { ...accepted, mimeType: shrunk.mimeType };
          } catch {}
          failures.push(`${url}: 图太大（>${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)}MB），降采样后仍不行，已放弃`);
          break;
        }
        failures.push(`${url}: ${msg}`);
      }
    }
    return null;
  };
  // 只有 file 是安全缓存文件名时才允许交给网关（防任意路径/内网 URL 注入）。
  const tryGetImage = async () => {
    if (!(media.kind === 'image' || media.kind === 'sticker')) return null;
    if (!media.file || !isProbablySafeImageFileRef(media.file)) return null;
    try {
      const info = await getBot().getImage({ file: String(media.file) });
      const obj = info && typeof info === 'object' ? info : {};
      const base64 = base64FromMaybe(obj.data) || base64FromMaybe(obj.base64) || base64FromMaybe(obj.file);
      if (base64) {
        // 粗略估计 base64 解码后大小，超限直接拒绝，避免超大字符串撑爆内存
        if (base64.length * 3 / 4 <= MAX_MEDIA_BYTES) {
          const accepted = acceptImageBuffer(Buffer.from(base64, 'base64'), 'get_image 返回的图片');
          if (accepted) return accepted;
        } else if (base64.length * 3 / 4 <= MAX_MEDIA_BYTES * 4) {
          const shrunk = await shrinkImageBuffer(Buffer.from(base64, 'base64'), 'image/jpeg');
          const accepted = shrunk && acceptImageBuffer(shrunk.buffer, 'get_image 降采样');
          if (accepted) return { ...accepted, mimeType: shrunk.mimeType };
          failures.push(`get_image: 图太大（${Math.round(base64.length * 3 / 4 / 1024)}KB），降采样后仍不行`);
        } else {
          log(`get_image 返回的图片 base64 超限，已跳过（${Math.round(base64.length * 3 / 4 / 1024)}KB）`);
          failures.push('get_image: 图太大，已跳过');
        }
      }
      if (obj.url) {
        try {
          const fetched = await safeFetchBuffer(String(obj.url), MAX_MEDIA_BYTES);
          const accepted = acceptImageBuffer(fetched.buffer, 'get_image URL 图片');
          if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(obj.url) };
        } catch (error) {
          const msg = String(error?.message ?? error);
          if (/超过大小限制/.test(msg)) {
            try {
              const big = await safeFetchBuffer(String(obj.url), MAX_MEDIA_BYTES * 4);
              const shrunk = await shrinkImageBuffer(big.buffer, big.mimeType || mimeFromUrl(String(obj.url)));
              const accepted = shrunk && acceptImageBuffer(shrunk.buffer, 'get_image URL 降采样');
              if (accepted) return { ...accepted, mimeType: shrunk.mimeType };
            } catch {}
            failures.push('get_image url: 图太大，降采样后仍不行');
          } else {
            failures.push(`get_image url: ${msg}`);
          }
        }
      }
      if (typeof obj.file === 'string' && !obj.file.startsWith('base64://') && fs.existsSync(obj.file) && isSafeLocalMediaPath(obj.file)) {
        const stat = fs.statSync(obj.file);
        if (stat.size > MAX_MEDIA_BYTES && stat.size <= MAX_MEDIA_BYTES * 4) {
          const shrunk = await shrinkImageBuffer(fs.readFileSync(obj.file), 'image/jpeg');
          const accepted = shrunk && acceptImageBuffer(shrunk.buffer, '本地图片 降采样');
          if (accepted) return { ...accepted, mimeType: shrunk.mimeType };
          failures.push('本地图片: 图太大，降采样后仍不行');
        } else if (stat.size > MAX_MEDIA_BYTES) {
          log(`本地图片文件超限，已跳过（${Math.round(stat.size / 1024)}KB）`);
          failures.push('本地图片: 图太大，已跳过');
        } else {
          const accepted = acceptImageBuffer(fs.readFileSync(obj.file), '本地图片');
          if (accepted) return accepted;
        }
      }
    } catch (error) {
      failures.push(`get_image: ${error?.message ?? error}`);
    }
    return null;
  };

  const result = (await tryGetImage()) ?? (await tryUrls());
  if (result) return result;
  if (failures.length) {
    log(`[media] ${label}获取失败（${failures.length} 次尝试）：${failures.slice(0, 3).join(' | ')}`);
    mediaStatsBump('failed', mediaFailReason(failures));
  } else {
    mediaStatsBump('failed', 'no-source');
  }
  return null;
}

async function fetchFaceMedia(media) {
  const faceId = Number(media.faceId);
  // 系统小表情（face 段）：只有数字 id 才有对应实体；拿不到时至少保留 summary 文案。
  const fallbackText = media.summary ? `[表情:${media.summary}]` : `[表情#${media.faceId}]`;
  if (!Number.isInteger(faceId)) return { text: fallbackText };
  try {
    const face = await getBot().fetchFaceEntity(faceId);
    if (face && typeof face === 'object') {
      const desc = face.q_des || (Array.isArray(face.emoji_name_alias) && face.emoji_name_alias[0]) || '';
      if (face.url) {
        try {
          const fetched = await safeFetchBuffer(String(face.url), MAX_MEDIA_BYTES);
          const accepted = acceptImageBuffer(fetched.buffer, '表情图片');
          if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(face.url), text: desc ? `[表情:${desc}]` : '' };
        } catch (error) {
          log(`表情图片抓取失败: ${error?.message ?? error}`);
        }
      }
      return { text: desc ? `[表情:${desc}]` : fallbackText };
    }
  } catch (error) {
    log(`fetchFaceEntity 失败: ${error?.message ?? error}`);
    mediaStatsBump('failed', 'face-entity');
  }
  return { text: fallbackText };
}

async function resolveMediaList(mediaList) {
  const parts = [];
  let index = 0;
  let totalBytes = 0;
  for (const media of Array.isArray(mediaList) ? mediaList : []) {
    index += 1;
    if (index > MAX_MEDIA_COUNT) {
      parts.push({ type: 'text', text: `[图片/表情 ${index}（超过单条上限 ${MAX_MEDIA_COUNT}，已跳过）]` });
      continue;
    }
    if (!media || typeof media !== 'object') continue;
    if (media.kind === 'face') {
      const face = await fetchFaceMedia(media);
      if (face.buffer) {
        if (totalBytes + face.buffer.length > MAX_MEDIA_BYTES) {
          parts.push({ type: 'text', text: `[表情${index}（图片总大小超限，已跳过）]` });
          continue;
        }
        totalBytes += face.buffer.length;
        if (face.text) parts.push({ type: 'text', text: face.text });
        parts.push({ type: 'image', mediaType: face.mimeType || 'image/png', data: face.buffer.toString('base64'), name: `face-${media.faceId}.${(face.mimeType || 'png').split('/')[1]}` });
      } else {
        parts.push({ type: 'text', text: face.text || `[表情#${media.faceId}]` });
      }
    } else {
      const img = await fetchOneBotImage(media);
      const sticker = media.kind === 'sticker';
      const summary = sticker && media.summary ? `:${String(media.summary).slice(0, 20)}` : '';
      const label = sticker ? (summary ? `[表情${summary}]` : `[表情${index}]`) : `[图片${index}]`;
      if (img?.buffer) {
        if (totalBytes + img.buffer.length > MAX_MEDIA_BYTES) {
          parts.push({ type: 'text', text: `${label}（图片总大小超限，已跳过）` });
          continue;
        }
        totalBytes += img.buffer.length;
        parts.push({ type: 'text', text: label });
        parts.push({ type: 'image', mediaType: img.mimeType || 'image/jpeg', data: img.buffer.toString('base64'), name: `qq-${sticker ? 'sticker' : 'image'}-${index}.${(img.mimeType || 'image/jpeg').split('/')[1]}` });
      } else {
        parts.push({ type: 'text', text: `${label}（获取失败）` });
      }
    }
  }
  return parts;
}

async function fetchMediaData(mediaList) {
  const out = [];
  let index = 0;
  let totalBytes = 0;
  for (const media of Array.isArray(mediaList) ? mediaList : []) {
    index += 1;
    if (index > MAX_MEDIA_COUNT) {
      out.push({ index, kind: media?.kind === 'face' ? 'face' : (media?.kind === 'sticker' ? 'sticker' : 'image'), text: `（超过单条上限 ${MAX_MEDIA_COUNT}，已跳过）` });
      continue;
    }
    if (!media || typeof media !== 'object') continue;
    if (media.kind === 'face') {
      const face = await fetchFaceMedia(media);
      if (face.buffer) {
        if (totalBytes + face.buffer.length > MAX_MEDIA_BYTES) {
          out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: '（图片总大小超限，已跳过）' });
          continue;
        }
        totalBytes += face.buffer.length;
        out.push({
          index,
          kind: 'face',
          faceId: media.faceId ? String(media.faceId) : undefined,
          mimeType: face.mimeType || 'image/png',
          data: face.buffer.toString('base64'),
          text: face.text || ''
        });
      } else {
        out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: face.text || `[表情#${media.faceId}]` });
      }
    } else {
      const img = await fetchOneBotImage(media);
      const kind = media.kind === 'sticker' ? 'sticker' : 'image';
      const noun = kind === 'sticker' ? '表情' : '图片';
      const base = {
        index,
        kind,
        ...(media.file ? { file: String(media.file) } : {}),
        ...(media.url ? { url: String(media.url) } : {}),
        ...(media.emojiId ? { emojiId: String(media.emojiId) } : {}),
        ...(media.summary ? { summary: String(media.summary) } : {}),
        ...(media.subType ? { subType: String(media.subType) } : {})
      };
      if (img?.buffer) {
        let buf = img.buffer;
        let mime = img.mimeType || 'image/jpeg';
        if (kind === 'sticker' || /gif|apng|webp/i.test(String(mime))) {
          const flat = await flattenAnimated(buf, mime); // ANIM_STILL_PATCH
          if (flat) { buf = flat.buffer; mime = flat.mimeType; }
        }
        if (totalBytes + buf.length > MAX_MEDIA_BYTES) {
          out.push({ ...base, text: `（${noun}总大小超限，已跳过）` });
          continue;
        }
        totalBytes += buf.length;
        out.push({
          ...base,
          mimeType: mime,
          data: buf.toString('base64'),
          text: ''
        });
      } else {
        out.push({ ...base, text: `（${noun}获取失败）` });
      }
    }
  }
  return out;
}

  return {
    mimeFromBuffer,
    mimeFromUrl,
    getImageDimensions,
    base64FromMaybe,
    isProbablySafeImageFileRef,
    emojiCdnCandidates,
    emojiIdFromFileName,
    acceptImageBuffer,
    readMediaCache,
    writeMediaCache,
    cacheIncomingMedia,
    findCachedMedia,
    stickerFrameSheet,
    flattenAnimated,
    shrinkImageBuffer,
    fetchOneBotImage,
    fetchFaceMedia,
    resolveMediaList,
    fetchMediaData
  };
}
