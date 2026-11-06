// 纯文本工具：CQ 转义、JSON 字符串去引号、OneBot 消息段转文字。无 bot/state/fs 依赖。
import { voiceTextOf } from '../voice-lib.js';
import { forwardIdFromData } from '../forward.js';
import { sanitizeMediaSummary } from './media-segments.js';

// 防止底层网关把文本中的 [CQ: 当作 CQ 码解析：替换为全角冒号。
export function escapeCqText(text) {
  return String(text ?? '').replace(/\[CQ:/gi, '[CQ：');
}

// 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
export function unquoteJsonString(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('"')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'string') return parsed;
    } catch {}
  }
  return value;
}

export async function segmentsToText(segments, options = {}) {
  const { resolveAtName, resolveReply, includeReply = true } = options ?? {};
  // 有些 OneBot 实现直接把纯文本消息放在 message 字段里（string）
  if (typeof segments === 'string') return segments.trim();
  const out = [];
  for (const seg of segments ?? []) {
    const d = seg?.data ?? {};
    switch (seg?.type) {
      case 'text': out.push(d.text ?? ''); break;
      case 'at': {
        if (d.qq === 'all') {
          out.push('@全体成员');
        } else {
          // 优先把 @ 对象解析成群名片/昵称，解析不到再回退成 QQ 号
          let name = null;
          try { name = resolveAtName ? await resolveAtName(String(d.qq)) : null; } catch { name = null; }
          out.push(name ? `@${name}` : `@${d.qq}`);
        }
        break;
      }
      // FACE_NAME_PATCH QQ 小表情：客户端会带 raw.faceText（如 "/捂脸"），老代码只看 id 所以模型只见到 [表情264]
      case 'face': {
        const rawText = String(d?.raw?.faceText ?? d?.raw?.faceName ?? '').replace(/^\//, '').trim();
        const faceName = String(d.summary ?? '').trim() || rawText;
        out.push(faceName ? `[表情:${faceName}]` : (d.id != null && d.id !== '' ? `[表情#${d.id}]` : '[表情]'));
        break;
      }
      // 市场表情（mface）在部分网关实现里出现：有 summary 就用它，别让模型只看到 "[mface]"。
      case 'mface': { const n = String(d.summary ?? d?.raw?.faceName ?? '').trim(); out.push(n ? `[表情:${n}]` : '[表情]'); break; }
      case 'image': {
        // 表情包在网络上常常也是 image 段：sub_type=1 是表情，.gif/.apng/.webp 可能只是动图。
        // 分清楚，她才不会把别人的照片当表情，也不会把自己的表情包当照片。
        const st = String(d.sub_type ?? d.subType ?? '');
        const name = String(d.file ?? d.url ?? '');
        if (st === '1') out.push('[表情包]');
        else if (/\.(gif|apng|webp)$/i.test(name)) out.push('[动图]');
        else out.push('[图片]');
        break;
      }
      case 'record': { // VOICE_PATCH
        const vt = voiceTextOf(d?.file);
        out.push(vt ? '[语音转写]' + vt : '[语音]');
        break;
      }
      case 'video': out.push('[视频]'); break;
      case 'file': out.push(`[文件${d.name ?? ''}]`); break;
      case 'reply': {
        // 引用/回复段：默认解析成「被引用人 + 原文」，让 AI 能判断这句话是对谁说的；
        // includeReply=false 时跳过该段，得到“当前消息自己的文字”（用于指令/指向性判断）。
        if (!includeReply) break;
        let replyText = '';
        if (resolveReply) {
          try {
            const info = await resolveReply(String(d.id));
            if (info?.sender || info?.text) {
              const parts = [];
              if (info.sender) parts.push(info.sender);
              if (info.text) parts.push(info.text);
              replyText = `[引用 ${parts.join('：')}]`;
            }
          } catch {}
        }
        out.push(replyText || '[引用消息]');
        break;
      }
      case 'json': out.push('[卡片消息]'); break;
      // markdown：SnowLuma 1.14.9 的线上段落是 `{type:'markdown',data:{content}}`。
      // 上游 1.14.17+（commit 1934e4e7「include text alongside received markdown」）
      // 起还会带上 `data.text`。两个形状都读，这样将来升级 SnowLuma 运行时不会退化成
      // 字面量 `[markdown]` 被喂给模型。SDK 的 KnownMessageSegment 联合里没有 markdown，
      // 所以段类型是运行时多出来的 —— 这正是 default 分支原来会命中的情况。
      case 'markdown': out.push(String(d.text ?? d.content ?? '[Markdown]')); break;
      case 'forward': {
        const fid = forwardIdFromData(d);
        out.push(fid ? `[转发消息 id=${fid}]` : '[转发消息]');
        break;
      }
      default: out.push(`[${seg?.type ?? '未知'}]`); break;
    }
  }
  return out.join('').trim();
}


// 群消息行渲染：主人的消息署名「他」，其他成员保持昵称（不改消息正文）。
export function contextLines(list, hint = null) {
  const hintOf = typeof hint === 'function' ? hint : () => '';
  return (list || [])
    .map((m) => `${m && m.isOwner ? '他' : String(m?.sender ?? '')}：${m?.text ?? ''}${hintOf(m) || ''}`)
    .join('\n') || '（无）';
}
