// channel.js —— QQ 通道能力探测（NapCat / SnowLuma / 其它 OneBot v11 实现通用）
//
// 背景：桥接本身是 @snowluma/sdk（WS 3001）+ OneBot v11 HTTP（3000），
// 「用 SnowLuma」还是「用 NapCat」只差这两个地址指向谁。差异只在于
// 某些 OneBot 扩展 API 是否实现：get_cookies / add_custom_face /
// modify_custom_face / fetch_custom_face_detail / *_msg_history。
//
// 这里在启动后探测一遍，结果写 state/channel-caps.json，并给上层提供 has()。
// 探测失败不抛错、不阻塞启动；不可用的功能由调用方自动跳过并只记一条日志。
import fs from 'node:fs';
import path from 'node:path';

const PROBE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms = PROBE_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout')), ms)),
  ]);
}

export function createChannel({ getBot, log, stateDir }) {
  const file = path.join(stateDir, 'channel-caps.json');
  let caps = null;
  let probedAt = 0;

  function save(payload) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(payload, null, 1));
    } catch (e) {
      log?.(`[通道] 能力快照没能落盘：${String(e?.message || e)}`);
    }
  }

  async function tryAction(action, params) {
    const bot = getBot?.();
    if (!bot || typeof bot.request !== 'function') return { ok: false, why: 'no-bot' };
    try {
      const r = await withTimeout(bot.request(action, params));
      // OneBot 实现通常返回 { status:'ok' } 或直接数据；后者视为支持
      const status = r && typeof r === 'object' ? r.status : undefined;
      if (status && status !== 'ok' && status !== 'async') return { ok: false, why: String(status) };
      return { ok: true };
    } catch (e) {
      const msg = String(e?.message || e);
      const unsupported = /不支持|not support|unsupported|unknown action|未知|404|400|invalid/i.test(msg);
      return { ok: false, why: unsupported ? 'unsupported' : msg.slice(0, 80) };
    }
  }

  async function probe() {
    probedAt = Date.now();
    // get_cookies：必须带 domain，且要真的返回非空 cookie 才算支持（很多实现不带 domain 会报错）
    let cookies = { ok: false, why: 'no-bot' };
    const bot = getBot?.();
    if (bot && typeof bot.request === 'function') {
      try {
        const r = await withTimeout(bot.request('get_cookies', { domain: 'qzone.qq.com' }));
        const ck = String(r?.cookies ?? r?.data?.cookies ?? '');
        cookies = ck ? { ok: true } : { ok: false, why: 'empty' };
      } catch (e) {
        const msg = String(e?.message || e);
        cookies = { ok: false, why: /不支持|unsupported|unknown action/i.test(msg) ? 'unsupported' : msg.slice(0, 60) };
      }
    }
    // 表情收藏：不做假参数探测（会把「参数不对」误判成「不支持」），
    // 由真实调用失败后回写（见 markUnsupported），未知就先当作可用。
    caps = {
      cookies: cookies.ok,
      stickerFavorites: caps?.stickerFavorites ?? null,
      probedAt,
      detail: { cookies: cookies.why || 'ok' },
    };
    save(caps);
    log?.(
      `[通道] get_cookies=${caps.cookies ? '✅' : '❌'}`
        + (caps.cookies ? '' : `（${cookies.why}；QQ 空间自动看说说将停用）`),
    );
    return caps;
  }

  // 真实调用发现某个能力不可用时调用（只影响对应功能，不误伤）
  function markUnsupported(name, why) {
    if (!caps) caps = { cookies: null, stickerFavorites: null, probedAt: 0, detail: {} };
    if (caps[name] === false) return;
    caps[name] = false;
    caps.detail = { ...(caps.detail || {}), [name]: String(why || 'unsupported').slice(0, 60) };
    save(caps);
    log?.(`[通道] 标记 ${name} 不可用（${why || 'unsupported'}），相关功能将跳过`);
  }

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') caps = raw;
    } catch {}
    return caps;
  }

  function has(name) {
    if (!caps) load();
    if (!caps) return null; // 还没探测过：不拦，交给运行时报错
    return caps[name] === true;
  }

  function data() {
    return { caps, probedAt, file };
  }

  return { probe, load, has, data, markUnsupported };
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'channel',
  layer: '感知', title: '通道能力探测', kind: 'tool', enabledByDefault: true, hot: false, hooks: [], config: [], stateFiles: ['channel-caps.json'] };
