import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVoice } from '../../src/lib/voice.js';
import { listAudioFiles, safeJoinLibrary, resolveAudioSource, AUDIO_EXTS } from '../../src/voice-core.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r5voice-'));
const root = path.join(tmp, 'root');
const stateDir = path.join(tmp, 'state');
fs.mkdirSync(path.join(root, 'audio', 'mix'), { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.writeFileSync(path.join(root, 'audio', 'a.mp3'), 'x');
fs.writeFileSync(path.join(root, 'audio', 'mix', 'b.silk'), 'y');

const cfg = {
  ownerQQ: '1001',
  snowluma: { httpUrl: 'http://127.0.0.1:3999' },
  socialV2: { voice: { enabled: true, dir: 'audio', autoReadback: true } }
};
const logs = [];
const activity = [];
const cleaned = [];
const sent = [];
const state = {
  recentMessages: [],
  wakeConfig: { noActionCount: 3 },
  lastAiReplyAt: 0,
  lastActionAt: 0
};
let lastFetch = null;
const fetchStub = async (url, opts) => {
  lastFetch = { url, opts, body: JSON.parse(opts.body) };
  if (String(url).endsWith('/get_msg')) {
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { message: [{ type: 'record', data: { duration: 3 } }] } }) };
  }
  if (String(url).endsWith('/fetch_ptt_text')) {
    return { ok: true, json: async () => ({ status: 'ok', retcode: 0, data: { text: '读回来的字' } }) };
  }
  return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 4242 } }) };
};

const voice = createVoice({
  cfg,
  root,
  stateDir,
  log: (m) => logs.push(String(m)),
  fetch: fetchStub,
  enqueueSend: (fn) => fn(),
  maps: { sendTimes: new Map(), lastSpeaker: new Map(), lastSentAt: new Map(), ownerAt: new Map() },
  appendActivity: (m) => activity.push(String(m)),
  shouldAuditKey: () => true,
  SENSITIVE_RE: /C:\\Users\\/i,
  KNOWN_AGENT_TOKENS: new Set(),
  getSocialV2State: () => state,
  saveSocialV2State: () => {},
  truncateText: (s, n) => String(s).slice(0, n),
  captureSendGuard: () => () => {},
  classifyVoiceError: () => null,
  synthesizeToFile: async () => ({ ok: true, path: path.join(root, 'audio', 'tts.silk') }),
  pickFallbackRoute: () => null,
  listAudioFiles,
  safeJoinLibrary,
  resolveAudioSource,
  AUDIO_EXTS,
  inspectAudio: async () => ({ ok: true, size: 1234, duration: 2, codec: 'silk', warnings: [] }),
  processAudioVolume: async (file) => ({ path: file, detail: 'original', volume: 1, loudness: 'normal', mode: 'original', converted: false }),
  describeAudio: () => '2 秒，silk，1.2KB',
  cleanupTemp: (f) => cleaned.push(f),
  resolveAudioProcessing: () => ({})
});

// 1) 语音库形状不变
const lib = voice.voiceLibrary();
assert.deepEqual(lib.map((x) => x.name).sort(), ['a.mp3', 'mix/b.silk']);
assert.equal(typeof lib[0].bytes, 'number');
assert.equal(typeof lib[0].mtimeMs, 'number');

// 2) record 段与现在一致：{type:'record',data:{file}}
const r = await voice.sendVoiceV2('group:555', path.join(root, 'audio', 'a.mp3'), { audit: false });
assert.equal(r.messageId, 4242);
assert.equal(lastFetch.url, 'http://127.0.0.1:3999/send_group_msg');
assert.deepEqual(lastFetch.body, { group_id: 555, message: [{ type: 'record', data: { file: path.join(root, 'audio', 'a.mp3') } }] });
assert.equal(cleaned.at(-1), path.join(root, 'audio', 'a.mp3'));

// 3) 失败时 reject 且仍清临时文件
const failVoice = createVoice({
  cfg, root, stateDir, log: () => {}, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  enqueueSend: (fn) => fn(), maps: { sendTimes: new Map(), lastSpeaker: new Map(), lastSentAt: new Map(), ownerAt: new Map() },
  appendActivity: () => {}, shouldAuditKey: () => false, SENSITIVE_RE: /zzz/, KNOWN_AGENT_TOKENS: new Set(),
  getSocialV2State: () => state, saveSocialV2State: () => {}, truncateText: (s, n) => String(s).slice(0, n),
  captureSendGuard: () => () => {}, classifyVoiceError: () => null, synthesizeToFile: async () => ({}),
  pickFallbackRoute: () => null, listAudioFiles, safeJoinLibrary, resolveAudioSource, AUDIO_EXTS,
  inspectAudio: async () => ({ ok: true, size: 1, duration: 1, codec: 'silk', warnings: [] }),
  processAudioVolume: async (f) => ({ path: f, detail: 'original', volume: 1, loudness: 'normal', mode: 'original', converted: false }),
  describeAudio: () => '', cleanupTemp: () => {}, resolveAudioProcessing: () => ({})
});
await assert.rejects(() => failVoice.sendVoiceV2('private:1001', path.join(root, 'audio', 'a.mp3'), { audit: false }), /OneBot send_private_msg 失败/);

// 4) 回读校验只回 confirmed/duration，不泄露 path/url
const v = await voice.verifyVoiceMessageSent(4242);
assert.deepEqual(v, { confirmed: true, duration: 3 });

// 5) 回执写入会话状态：字段名不变
voice.recordVoiceSentV2('group:555', { messageId: 4242, detail: '2 秒，silk' }, '');
assert.equal(state.recentMessages.length, 1);
assert.equal(state.recentMessages[0].messageId, '4242');
assert.equal(state.recentMessages[0].isSelf, true);
assert.equal(state.recentMessages[0].sender, '我');
assert.equal(state.recentMessages[0].plain, '[语音 2 秒，silk]');
assert.equal(state.wakeConfig.noActionCount, 0);

// 6) 文件名词审仍生效
assert.throws(() => voice.assertOutboundAuditOk('group:555', '[语音:C:\\Users\\a.mp3]'), /疑似包含敏感信息/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('R5_VOICE_OK lib=%d', lib.length);
