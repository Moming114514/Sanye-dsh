// R5: voice sending cluster moved out of bridge main(); behavior identical.
// All dependencies injected via createVoice (no bridge import, no global cfg/STATE_DIR).
//   - record segment -> { type: 'record', data: { file: sendPath } } (unchanged)
//   - voice library dir -> ROOT/<socialV2.voice.dir> (unchanged)
//   - error log -> <stateDir>/voice-errors.log (unchanged)
import fs from 'node:fs';
import path from 'node:path';

export function createVoice({
  cfg,
  root,
  stateDir,
  log,
  fetch: fetchImpl = globalThis.fetch,
  enqueueSend,
  maps,
  appendActivity,
  shouldAuditKey,
  SENSITIVE_RE,
  KNOWN_AGENT_TOKENS,
  getSocialV2State,
  saveSocialV2State,
  truncateText,
  captureSendGuard,
  classifyVoiceError,
  synthesizeToFile,
  pickFallbackRoute,
  listAudioFiles,
  safeJoinLibrary,
  resolveAudioSource,
  AUDIO_EXTS,
  inspectAudio,
  processAudioVolume,
  describeAudio,
  cleanupTemp,
  resolveAudioProcessing,
}) {
  const ROOT = root;
  const STATE_DIR = stateDir;
  const fetch = fetchImpl;
  const {
    sendTimes: voiceSendTimes,
    lastSpeaker: voiceLastSpeaker,
    lastSentAt: voiceLastSentAt,
    ownerAt: voiceOwnerAt,
  } = maps;

/**
 * 出站语音的内容审计：与文本一致，凡是「疑似敏感信息 / 含会话令牌」的**文件名**
 * 都不允许外发（语音的音频内容本身无法审计，但文件名同样会泄露路径与项目信息）。
 */
function assertOutboundAuditOk(key, subject) {
  const text = String(subject ?? '');
  const hasKnownToken = [...KNOWN_AGENT_TOKENS].some((t) => t && text.includes(t));
  if (shouldAuditKey(key) && (SENSITIVE_RE.test(text) || hasKnownToken)) {
    log(`⚠️ 语音发送被安全策略拦截 (${key})：${hasKnownToken ? '文件名含会话令牌' : '文件名疑似含敏感信息'}`);
    appendActivity(`${key} [voice] 发送被拦截（文件名疑似敏感信息${hasKnownToken ? '/会话令牌' : ''}）`);
    throw new Error('音频文件名疑似包含敏感信息（路径/凭据/会话令牌），已阻止发送；请重命名后再发');
  }
}

function voiceTriggerBlock(key, kind, id) {
  const cfgVoice = voiceCfg();
  const who = cfgVoice.trigger.who;
  if (who === 'anyone') return null;

  const owner = String(cfg.ownerQQ ?? '');
  if (kind === 'private') {
    // 私聊：对方就是主人才能触发（别人私聊机器人不该出声）
    if (who === 'owner' && String(id) !== owner) return '仅主人可触发语音（当前私聊对象不是主人）';
    if (who === 'list' && !cfgVoice.trigger.members.includes(String(id)) && String(id) !== owner) {
      return '该成员不在语音触发名单里';
    }
    return null;
  }

  // 群聊：只要主人在最近 10 分钟内开过口就放行。
  // 别人说话/发表情/转发**不会**取消这个授权（这是之前最反人类的一条）。
  const ownerAt = Number(voiceOwnerAt.get(String(key)) ?? 0);
  if (!ownerAt) return '仅主人可触发语音（这个群还没有主人发言记录）';
  const WINDOW = 10 * 60 * 1000;
  if (Date.now() - ownerAt > WINDOW) {
    return '最近 10 分钟主人都没说话，不能主动发语音';
  }
  // 一条主人消息最多换一条语音：发过之后要等主人再说一句
  if ((voiceLastSentAt.get(String(key)) ?? 0) >= ownerAt) {
    return '这条消息已经发过语音了，等主人再说一句';
  }
  if (who === 'list') {
    const ok = last.isOwner === true || cfgVoice.trigger.members.includes(String(last.userId));
    if (!ok) return '该成员不在语音触发名单里';
  }
  return null;
}

function voiceCfg() {
  const v = cfg.socialV2?.voice ?? {};
  return {
    enabled: v.enabled !== false,
    dir: path.resolve(ROOT, String(v.dir ?? 'audio')),
    maxSeconds: Number(v.maxSeconds) > 0 ? Number(v.maxSeconds) : 300,
    maxBytes: Number(v.maxBytes) > 0 ? Number(v.maxBytes) : 20 * 1024 * 1024,
    maxPerMinute: Number(v.maxPerMinute) >= 0 ? Number(v.maxPerMinute) : 2,
    maxPerHour: Number(v.maxPerHour) >= 0 ? Number(v.maxPerHour) : 10,
    allowAbsolutePath: v.allowAbsolutePath === true,
    defaultVolume: Number(v.defaultVolume) > 0 ? Number(v.defaultVolume) : 1,
    loudness: v.loudness || 'normal',
    ffmpegPath: process.env.FFMPEG_PATH || v.ffmpegPath || null,
    autoReadback: v.autoReadback !== false,
    // 谁能触发 AI 发语音：owner（默认）/ anyone / list
    trigger: {
      who: ['owner', 'anyone', 'list'].includes(String(v.trigger?.who)) ? String(v.trigger.who) : 'owner',
      members: Array.isArray(v.trigger?.members) ? v.trigger.members.map(String) : [],
      groups: Array.isArray(v.trigger?.groups) ? v.trigger.groups.map(String) : []
    },
    // 文字直接合成语音（本地 voxd）。和「语音库文件」是两条来源：
    //   voice 参数 → 读 audio/ 里的现成音频；text 参数 → 现场合成。
    // 默认关闭：没装 voxd 时打开只会得到一串 502。
    tts: {
      enabled: v.tts?.enabled === true,
      baseUrl: String(v.tts?.baseUrl || 'http://127.0.0.1:8765'),
      timeoutMs: Number(v.tts?.timeoutMs) > 0 ? Number(v.tts.timeoutMs) : 60000,
      maxChars: Number(v.tts?.maxChars) > 0 ? Number(v.tts.maxChars) : 120,
      character: String(v.tts?.character || ''),
      // 走哪个语音服务：local（8765）/ cloud（8767）。单条消息可以用 body.route 临时覆盖。
      route: ['local', 'cloud'].includes(String(v.tts?.route)) ? String(v.tts.route) : 'local',
      endpoints: {
        local: String(v.tts?.endpoints?.local || 'http://127.0.0.1:8765'),
        cloud: String(v.tts?.endpoints?.cloud || 'http://127.0.0.1:8767')
      },
      // 音色映射变了就 +1，让旧音频失效（否则"换了声音还在放老的"）
      cacheVersion: Number(v.tts?.cacheVersion) || 0,
      dir: path.join(STATE_DIR, 'voice-tts')
    }
  };
}

/** 语音失败留痕（JSONL）：以前失败只抛一句人话、不进日志，事后无法判断谁的锅。 */
function logVoiceError(record) {
  try {
    const file = path.join(STATE_DIR, 'voice-errors.log');
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...record }) + String.fromCharCode(10));
  } catch {}
}

/** 给错误补上 code/hint/stage，让上层接口能把「谁的锅」写清楚（AGENTS 1.7）。 */
function codedVoiceError(error, info = null) {
  const message = error?.message ?? String(error);
  const meta = info ?? classifyVoiceError(message);
  const err = error instanceof Error ? error : new Error(message);
  err.code = meta.code;
  err.stage = meta.stage;
  err.hint = meta.hint;
  return err;
}

/**
 * text → 本地 wav。AI 通道与操作者通道共用，抛出的错误已经是可直接展示的句子。
 */
async function synthesizeVoiceText(text, { character = '', voice = '', route = '' } = {}) {
  const vc = voiceCfg();
  const say = String(text ?? '').trim();
  if (!say) throw codedVoiceError(new Error('要合成的内容是空的'));
  if (!vc.tts.enabled) {
    const err = new Error('语音合成未开启（socialV2.voice.tts.enabled）');
    err.code = 'voice.tts-disabled'; err.stage = 'config';
    err.hint = '设置 → SurfCore → 全部参数 → socialV2.voice.tts.enabled 打开';
    throw err;
  }
  if (say.length > vc.tts.maxChars) throw codedVoiceError(new Error(`要说的话最多 ${vc.tts.maxChars} 字（收到 ${say.length}）`));

  const primary = ['local', 'cloud'].includes(String(route)) ? String(route) : vc.tts.route;
  const endpointOf = (r) => String(vc.tts.endpoints?.[r] || vc.tts.baseUrl || '').replace(/\/+$/, '');

  const attempt = (r) => synthesizeToFile({
    text: say,
    character: voice ? '' : character || vc.tts.character,
    voice: voice || '',
    baseUrl: endpointOf(r),
    timeoutMs: vc.tts.timeoutMs,
    cacheVersion: vc.tts.cacheVersion ?? null,
    outDir: vc.tts.dir
  });

  let first = null;
  try {
    first = await attempt(primary);
  } catch (error) {
    const info = classifyVoiceError(error?.message ?? error);
    const fallback = pickFallbackRoute(primary, vc.tts.endpoints, info.code);
    logVoiceError({
      scope: 'synth', route: primary, code: info.code, stage: info.stage,
      message: String(error?.message ?? error).slice(0, 400), fallback: fallback || '',
    });
    if (fallback) {
      // 云端抖动时换到本地另一条路（或反过来），别让整条语音失败。
      try {
        const second = await attempt(fallback);
        logVoiceError({ scope: 'synth', route: fallback, code: 'voice.recovered', stage: 'fallback', message: `主路 ${primary} 失败后已用 ${fallback} 合成成功` });
        return { path: second.path, via: 'tts', ttsCached: second.cached, ttsDurationMs: second.durationMs, degraded: true, degradedFrom: primary, route: fallback };
      } catch (error2) {
        const info2 = classifyVoiceError(error2?.message ?? error2);
        logVoiceError({ scope: 'synth', route: fallback, code: info2.code, stage: info2.stage, message: String(error2?.message ?? error2).slice(0, 400), fallback: '' });
        const err = codedVoiceError(error2, info2);
        err.message = `${err.message}（主路 ${primary} 也失败：${String(error?.message ?? error).slice(0, 160)}）`;
        throw err;
      }
    }
    throw codedVoiceError(error, info);
  }
  return { path: first.path, via: 'tts', ttsCached: first.cached, ttsDurationMs: first.durationMs, route: primary };
}

function voiceLibrary() {
  const dir = voiceCfg().dir;
  const files = listAudioFiles(dir);
  return files.map((f) => {
    let stat = null;
    try { stat = fs.statSync(f); } catch {}
    return { name: path.relative(dir, f).split(path.sep).join('/'), bytes: stat?.size ?? 0, mtimeMs: stat?.mtimeMs ?? 0 };
  });
}

/**
 * 把「AI 给的语音引用」解析成可发送的本地绝对路径。
 *
 * 安全边界：**AI 只能从语音库目录里取文件**（防 prompt injection 拿任意本地文件当语音外发）。
 *
 * 历史坑（已修）：这里曾经在 `socialV2.voice.allowAbsolutePath: true` 时直接把 AI 给的
 * 绝对路径交给 resolveAudioSource 解析，于是「AI 传 C:\Users\x\Music\任意.mp3」
 * 就能把本机任意音频（< 20 MB）发到群里 —— 而 inspectAudio 对「没有音频流」或
 * ffprobe 不可用的情况是放行的，等于把开关变成了任意文件外发通道。
 * 现在即使开了这个开关，也要求绝对路径**必须落在语音库目录之内**；
 * 真要从库外发文件请走操作者通道（resolveVoicePathForOperator / CLI）。
 */
function voicePathInsideLibrary(vc, absPath) {
  const rel = path.relative(vc.dir, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
  return safeJoinLibrary(vc.dir, rel);
}

function resolveVoicePathForV2(input) {
  const vc = voiceCfg();
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('缺少音频：给语音库里的文件名（可用 qq_list_voices 查看）');
  if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) {
    throw new Error('语音只接受语音库里的本地文件；不接受 base64://、data: 或 http(s):// 来源');
  }
  const isAbs = path.isAbsolute(raw) || /^file:\/\//i.test(raw) || raw.startsWith('~');

  let resolved = null;
  if (isAbs) {
    const r = resolveAudioSource(raw, {});
    const confined = r.path ? voicePathInsideLibrary(vc, r.path) : null;
    if (confined) {
      resolved = { path: confined, via: `${r.via}+library-confined` };
    } else {
      // 只报目录名，不报绝对路径：这条消息会经 MCP 工具错误回给模型，
      // 而模型面对的是不可信的群聊内容（prompt injection 可能诱导它复述本机路径）。
      throw new Error(`语音只能从语音库取文件（语音库目录：${path.basename(vc.dir)}）；即使是绝对路径也必须位于语音库之内（socialV2.voice.allowAbsolutePath 已不再放宽 AI 通道）。请把音频放进语音库，或用操作者通道（CLI / 控制台）发送库外文件。`);
    }
  } else {
    // ⚠️ 安全关键：相对路径**只能**在语音库内解析。
    //
    // 不能直接丢给 resolveAudioSource —— 它会**先用 process.cwd() 解析相对路径**
    // （voice-core.js 的 cwd 分支），于是 AI 传 `..\..\某个\本机文件.mp3` 就能读库外文件，
    // 把 allowAbsolutePath=false 这个闸门整个绕过去（实测可复现）。
    // 相对路径一律先过 safeJoinLibrary（含 realpath 复核，挡 symlink 逃逸）。
    const joined = safeJoinLibrary(vc.dir, raw);
    if (joined && fs.existsSync(joined) && fs.statSync(joined).isFile()) {
      resolved = { path: joined, via: 'voice-dir-safe' };
    } else {
      // 允许省略扩展名：逐个补常见扩展名再在库内试一次（仍然不越出语音库）
      if (!path.extname(raw)) {
        for (const ext of AUDIO_EXTS) {
          const cand = safeJoinLibrary(vc.dir, `${raw}${ext}`);
          if (cand && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            resolved = { path: cand, via: 'voice-dir-safe+ext' };
            break;
          }
        }
      }
      if (!resolved) {
        // 库内没找到：检查是不是"想读库外文件"（这条错误要说清楚，避免误以为是名字写错）
        const looksLikeEscape = /(^|[\\/])\.\.([\\/]|$)/.test(raw) || path.isAbsolute(raw);
        if (looksLikeEscape) {
          throw new Error('语音只能从语音库取文件：路径里出现了「..」或绝对路径，已拒绝（防止读到库外的本机文件）');
        }
      }
    }
  }

  if (resolved) return { path: resolved.path, via: resolved.via, resolvedFrom: raw };

  // 模糊提示：只列库内文件（绝不回显库外路径）
  const library = voiceLibrary();
  const hint = library.length
    ? `语音库里现有：${library.slice(0, 12).map((x) => x.name).join('、')}${library.length > 12 ? ` 等 ${library.length} 个` : ''}`
    : `语音库（${path.basename(vc.dir)}）目前是空的，先把音频文件放进去`;
  // 按 basename 去扩展名做近似匹配（只用于提示）
  const want = path.basename(raw).toLowerCase();
  const wantNoExt = want.replace(/\.[^.]+$/, '');
  const fuzzyHits = library
    .filter((x) => {
      const base = path.basename(x.name).toLowerCase();
      return base === want || base.replace(/\.[^.]+$/, '') === wantNoExt;
    })
    .map((x) => x.name);
  const fuzzy = fuzzyHits.length ? `；近似匹配：${fuzzyHits.join('、')}` : '';
  throw new Error(`语音库里找不到「${raw}」${fuzzy}。${hint}`);
}

/**
 * 操作者通道（CLI）的路径解析：允许绝对路径（操作者本来就能读本机文件），
 * 相对路径先按「语音库」解析，再按当前工作目录解析 —— 这样两种直觉写法都成立。
 * base64/http 来源仍然禁止：语音应来自本地文件，别让 CLI 变成任意 URL 的外发口子。
 */
function resolveVoicePathForOperator(input) {
  const vc = voiceCfg();
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('缺少音频路径');
  if (/^(base64:\/\/|data:|https?:\/\/)/i.test(raw)) {
    throw new Error('语音只接受本地文件；不接受 base64://、data: 或 http(s):// 来源');
  }
  const r = resolveAudioSource(raw, { voiceDir: vc.dir });
  if (r.path) return { path: r.path, via: r.via, resolvedFrom: raw };
  const fuzzy = r.candidates?.length ? `；语音库近似匹配：${r.candidates.map((c) => path.basename(c.path)).join('、')}` : '';
  throw new Error(`找不到音频「${raw}」${fuzzy}`);
}

/**
 * 语音发送限流：与文本发送分开计数，避免语音吃掉聊天额度（也避免聊天把语音额度耗光）。
 *
 * 只**检查**不占额度：额度在真正发出去之后才由 voiceBudgetCommit 记账 ——
 * 这样参数错、被审计拦截、网关失败都不会白白吃掉配额（否则连失败几次就被假 429 卡住）。
 */
function voiceBudgetCheck(scopeKey, cfgV) {
  const now = Date.now();
  const bucket = voiceSendTimes.get(scopeKey) ?? [];
  const inMinute = bucket.filter((t) => now - t < 60000);
  const inHour = bucket.filter((t) => now - t < 3600000);
  // 限流不是故障：带上 code/hint，避免被转述成“TTS 掉线”（2026-10-30 实测踩到）。
  const limited = (per, n) => {
    const err = new Error(`语音发送频率超限（每${per}最多 ${n} 条），请稍后再试`);
    err.code = 'voice.rate-limited';
    err.stage = 'send';
    err.hint = '这是发送限流，不是 TTS 故障：等一会儿再发，或调大 socialV2.voice.maxPerMinute / maxPerHour';
    return err;
  };
  if (cfgV.maxPerMinute > 0 && inMinute.length + 1 > cfgV.maxPerMinute) throw limited('分钟', cfgV.maxPerMinute);
  if (cfgV.maxPerHour > 0 && inHour.length + 1 > cfgV.maxPerHour) throw limited('小时', cfgV.maxPerHour);
}

/** 语音真正发出后记账（顺带裁掉超过 1 小时的旧时间戳，避免数组无界增长）。 */
function voiceBudgetCommit(scopeKey, at = Date.now()) {
  const bucket = (voiceSendTimes.get(scopeKey) ?? []).filter((t) => at - t < 3600000);
  bucket.push(at);
  voiceSendTimes.set(scopeKey, bucket);
}

/**
 * 底层发送：把音频作为 record 段交给 SnowLuma。
 * guard=true（agent 通道）时，发送前必须通过 captureSendGuard —— 会话/模式/白名单任一变
 * 就放弃发送；guard=false（操作者通道）时不套会话闸门（操作者可能不在任何会话里）。
 *
 * audio 可传音量设置 { volume, normalize, loudness }：SnowLuma 的 record 段没有增益字段，
 * 所以音量必须在本地用 ffmpeg 调好再发（临时文件发完即删）。
 */
async function sendVoiceV2(key, filePath, { guard = false, audit = true, audio = null } = {}) {
  const vc = voiceCfg();
  // 注意：这里**不检查** vc.enabled —— 那是「AI 能不能发语音」的开关，判定放在
  // AI 路由（/api/socialV2/send-voice）与 sendVoiceForV2 里。底层只管发，
  // 否则"默认不启用"会连操作者通道（CLI / 控制台面板 / 图形界面）一起封死。
  if (audit) assertOutboundAuditOk(key, `[语音:${path.basename(filePath)}]`);
  let info;
  try {
    info = await inspectAudio(filePath, { maxBytes: vc.maxBytes, maxSeconds: vc.maxSeconds });
  } catch (error) {
    throw new Error(`音频检查失败：${error?.message ?? error}`);
  }
  if (!info.ok) throw new Error(`音频不可发送：${info.error}`);

  // 音量处理（默认原样 → 不产生临时文件）
  let processed;
  try {
    processed = await processAudioVolume(filePath, {
      volume: audio?.volume ?? vc.defaultVolume,
      normalize: audio?.normalize === true,
      loudness: audio?.loudness ?? vc.loudness,
      ffmpegPath: vc.ffmpegPath
    });
  } catch (error) {
    throw new Error(`音量处理失败：${error?.message ?? error}`);
  }
  const sendPath = processed.path;

  const assertSendAllowed = guard ? captureSendGuard(key) : null;
  const [kind, id] = key.split(':');
  const recordSegment = { type: 'record', data: { file: sendPath } };
  let resolveSend;
  let rejectSend;
  const sendPromise = new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; });
  enqueueSend(async () => {
    try {
      if (assertSendAllowed) assertSendAllowed();
      // 语音条比图片大、要过一次 SILK 转码，给 60s 预算（文本/图片共用同一 sendChain，
      // 所以这条语音发完之前后面的文本会自然排队，不会插队到语音前面）。
      const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
      const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
      const params = kind === 'private'
        ? { user_id: Number(id), message: [recordSegment] }
        : { group_id: Number(id), message: [recordSegment] };
      const res = await fetch(`${httpUrl}/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {})
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(60000)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
        const hint = res.status === 426 ? '（HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口）' : '';
        throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
      }
      resolveSend(body.data);
    } catch (error) {
      rejectSend(error);
    }
  });
  try {
    const data = await sendPromise;
    return {
      messageId: data?.message_id ?? null,
      bytes: info.size,
      duration: info.duration ?? null,
      codec: info.codec ?? '',
      warnings: info.warnings ?? [],
      detail: describeAudio(info),
      // 音量处理信息：mode='original' 表示没动过（没产生临时文件）
      audioProcessing: processed.detail,
      volume: processed.volume,
      loudness: processed.loudness,
      audioMode: processed.mode
    };
  } finally {
    // 音量处理产物是一次性的：发完（或失败）就删，别把 temp 撑大
    cleanupTemp(sendPath, processed.converted);
  }
}

/** 把「我发了条语音」写进二代会话的 recentMessages，让 AI 自己知道刚发过什么。 */
function recordVoiceSentV2(key, sent, label) {
  const st = getSocialV2State(key);
  const display = label || `[语音 ${sent.detail}]`;
  const entry = {
    messageId: sent.messageId ? String(sent.messageId) : null,
    sender: '我',
    text: truncateText(display, 200),
    plain: truncateText(display, 200),
    quoteTargetIsSelf: false,
    isOwner: true,
    ownerLabel: '我',
    isSelf: true,
    at: Date.now()
  };
  st.recentMessages.push(entry);
  if (st.recentMessages.length > 200) st.recentMessages = st.recentMessages.slice(-200);
  st.lastAiReplyAt = entry.at;
  st.lastActionAt = entry.at;
  st.wakeConfig.noActionCount = 0;
  saveSocialV2State();
}

/**
 * 发完语音后的**落地验证**：把这条消息从网关读回来，确认它真的带着 record 段。
 *
 * 为什么不用 fetch_ptt_text 做这件事：那个动作依赖 QQ 侧的语音转写结果，
 * 而**自己发出去的**语音根本不会产生转写（实测 retcode=100「消息中不包含语音」）。
 * 想让 AI 确认「语音真的发出去了」，唯一可靠的证据是 get_msg 回读到的 record 段。
 * 返回 { confirmed, file, duration } 或 null（读不回来不影响"已发送"这个事实）。
 */
async function verifyVoiceMessageSent(messageId) {
  if (!messageId) return null;
  try {
    const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const res = await fetch(`${httpUrl}/get_msg`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {})
      },
      body: JSON.stringify({ message_id: Number(messageId) }),
      signal: AbortSignal.timeout(30000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'ok' || body.retcode !== 0) return null;
    const segments = Array.isArray(body.data?.message) ? body.data.message : [];
    const record = segments.find((s) => s?.type === 'record');
    if (!record) return null;
    // 注意：只回报「确认成功 + 时长」，**不回传 file/url**。
    // 私聊消息里 get_msg 会把源文件路径塞进 url（如 D:\...\audio\xxx.mp3），
    // 回给 AI 就等于把本机路径写进模型上下文（也会被敏感信息审计拦）。
    return {
      confirmed: true,
      duration: record.data?.duration != null ? Number(record.data.duration) : null
    };
  } catch (error) {
    log(`[voice] 发送后回读校验失败（不影响已发送）：${error?.message ?? error}`);
    return null;
  }
}

/**
 * AI 通道入口：解析引用 → 限流 → 发送 → 记账 → 回读校验。
 * 返回 { messageId, detail, verified, readback }。
 */
async function sendVoiceForV2(key, voiceRef, { label = '', verify = null, readback = false, audio = null, resolved = null } = {}) {
  const vc = voiceCfg();
  if (!vc.enabled) throw new Error('语音功能已关闭（socialV2.voice.enabled=false）');
  // resolved：调用方已经拿到文件（如 text→TTS），就跳过「语音库查找」这一步。
  const target = resolved ?? resolveVoicePathForV2(voiceRef);
  // 音量参数校验前置（AI 传错时给出可读错误，而不是让 ffmpeg 报奇怪的错）
  if (audio) resolveAudioProcessing({ volume: audio.volume ?? vc.defaultVolume, normalize: audio.normalize === true, loudness: audio.loudness ?? vc.loudness });
  voiceBudgetCheck(key, vc);
  const sent = await sendVoiceV2(key, target.path, { guard: true, audit: true, audio });
  voiceBudgetCommit(key);
  recordVoiceSentV2(key, sent, label);
  log(`[voice] ${key} 已发送语音 ${path.basename(target.path)} (${sent.detail}, messageId=${sent.messageId ?? '?'})`);
  appendActivity(`${key} [voice] 发送语音 ${path.basename(target.path)} (${sent.detail})`);
  let readbackText = null;
  const wantReadback = readback === true;
  if (wantReadback && sent.messageId) {
    try {
      const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
      const res = await fetch(`${httpUrl}/fetch_ptt_text`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cfg.snowluma?.accessToken ? { authorization: `Bearer ${cfg.snowluma.accessToken}` } : {})
        },
        body: JSON.stringify({ message_id: String(sent.messageId) }),
        signal: AbortSignal.timeout(30000)
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.status === 'ok' && body.retcode === 0) readbackText = body.data?.text ?? '';
    } catch (error) {
      log(`[voice] 语音转写回读失败（不影响已发送）：${error?.message ?? error}`);
    }
  }
  // 默认做「回读到 record 段」的落地校验；转写按需（自己发的语音通常没有转写）。
  const wantVerify = verify === true || (verify !== false && vc.autoReadback);
  const verification = wantVerify ? await verifyVoiceMessageSent(sent.messageId) : null;
  return { ...sent, key, file: target.path, via: target.via, verification, readback: readbackText };
}

  return {
    assertOutboundAuditOk,
    voiceTriggerBlock,
    voiceCfg,
    logVoiceError,
    codedVoiceError,
    synthesizeVoiceText,
    voiceLibrary,
    voicePathInsideLibrary,
    resolveVoicePathForV2,
    resolveVoicePathForOperator,
    voiceBudgetCheck,
    voiceBudgetCommit,
    sendVoiceV2,
    recordVoiceSentV2,
    verifyVoiceMessageSent,
    sendVoiceForV2
  };
}
