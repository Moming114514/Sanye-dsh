// VOICE_PATCH：把 QQ 语音条变成文字。链路：get_record(mp3/wav base64) → ffmpeg 16k 单声道 → 本地 ASR。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const voiceCache = new Map(); // key = 语音文件名，value = 转写文本

function asrCfg() {
  try {
    const p = path.join(os.homedir(), '.dsh', 'asr.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { baseUrl: String(j.baseUrl || '').replace(/\/$/, ''), model: j.model || 'paraformer-zh-int8', language: j.language || 'zh', key: j.key || '' };
  } catch {
    return { baseUrl: '', model: 'paraformer-zh-int8', language: 'zh', key: '' };
  }
}

export function voiceTextOf(name) {
  return voiceCache.get(String(name || '')) || '';
}

export async function transcribeRecord(bot, seg) {
  try {
    const file = String(seg?.data?.file || '');
    if (!file) return '';
    const cached = voiceCache.get(file);
    if (cached !== undefined) return cached;

    const r = await bot.request('get_record', { file, out_format: 'mp3' });
    const b64 = r?.data?.base64 || r?.base64 || '';
    if (!b64) { voiceCache.set(file, ''); return ''; }

    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const raw = path.join(os.tmpdir(), `qqv-${stamp}.mp3`);
    const wav = path.join(os.tmpdir(), `qqv-${stamp}.wav`);
    fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-ar', '16000', '-ac', '1', wav], { timeout: 30000 });

    const cfg = asrCfg();
    if (!cfg.baseUrl) { voiceCache.set(file, ''); return ''; }
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(wav)], { type: 'audio/wav' }), 'v.wav');
    form.append('model', cfg.model);
    form.append('response_format', 'verbose_json');
    form.append('language', cfg.language);
    const res = await fetch(cfg.baseUrl + '/audio/transcriptions', {
      method: 'POST', body: form, signal: AbortSignal.timeout(120000),
      headers: cfg.key ? { authorization: 'Bearer ' + cfg.key } : {},
    });
    const j = await res.json();
    const text = String(j?.text || (Array.isArray(j?.segments) ? j.segments.map((s) => s.text).join('') : '') || '').trim();
    voiceCache.set(file, text);

    try { fs.unlinkSync(raw); } catch {}
    try { fs.unlinkSync(wav); } catch {}
    if (voiceCache.size > 60) {
      const first = voiceCache.keys().next().value;
      if (first) voiceCache.delete(first);
    }
    return text;
  } catch {
    return '';
  }
}
