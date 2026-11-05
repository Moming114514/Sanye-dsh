// 静音名单：面板上「先不跟这个群/这个人聊」，不删白名单，随时恢复。
// 与「只听主人 / 只跟我私聊」正交：模式管整体，静音管单个会话。
import fs from 'node:fs';
import path from 'node:path';

const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'muted-keys.json');

let cache = { sig: '', keys: new Set() };

function loadKeys() {
  let sig = '';
  try {
    const st = fs.statSync(FILE);
    sig = `${st.mtimeMs}:${st.size}`;
  } catch {
    cache = { sig: '', keys: new Set() };
    return cache.keys;
  }
  if (sig === cache.sig) return cache.keys;
  const keys = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const items = raw && typeof raw.items === 'object' && raw.items ? raw.items : {};
    for (const [k, v] of Object.entries(items)) {
      if (v !== false) keys.add(String(k));
    }
  } catch {
    // 文件坏了就当没有静音，不阻塞唤醒
  }
  cache = { sig, keys };
  return keys;
}

function saveKeys(keys) {
  fs.mkdirSync(STATE, { recursive: true });
  const items = {};
  for (const k of keys) items[k] = { at: new Date().toISOString() };
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ items }, null, 1));
  fs.renameSync(tmp, FILE);
  cache = { sig: '', keys: new Set() };
}

export function isMuted(key) {
  return loadKeys().has(String(key || ''));
}

export function mutedKeys() {
  return [...loadKeys()];
}

export default {
  id: 'mute',
  title: '静音名单',

  // 状态键：名单变了要让提示词缓存失效
  stateKey() {
    try {
      const st = fs.statSync(FILE);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'none';
    }
  },

  // 唤醒闸门：静音的会话不唤醒（manual/admin 始终放行）
  wakeGate({ key, reason }) {
    const k = String(key || '');
    const why = String(reason || '');
    if (!k) return true;
    if (why === 'manual' || why === 'admin' || why.startsWith('style-learn')) return true; // MUTE_LEARN_PASS：学样只看不聊，静音不拦
    // F1_OWNER_CALL：主人亲自叫（ownerMention/ownerCall）时不拦；别人 @ 仍是 atMention，照拦
    if (['ownerMention', 'ownerCall'].includes(why)) return { allow: true, reason: `[静音·主人直呼放行] ${k}（${why}）` };
    if (!isMuted(k)) return true;
    return { allow: false, reason: `[静音] 跳过唤醒 ${k}（${why}）：面板里设了先不理这个会话` };
  },

  routes: [
    {
      path: '/api/socialV2/mute',
      async handle({ body, log, sendJson }) {
        const action = String(body?.action || 'list');
        if (action === 'list') {
          sendJson({ ok: true, keys: mutedKeys() });
          return;
        }
        const key = String(body?.key || '').trim();
        if (!/^(group|private):\d+$/.test(key)) {
          sendJson({ ok: false, error: 'key 必须是 group:群号 或 private:QQ号' }, 400);
          return;
        }
        const keys = loadKeys();
        if (action === 'mute') keys.add(key);
        else if (action === 'unmute') keys.delete(key);
        else {
          sendJson({ ok: false, error: 'action 只能是 list / mute / unmute' }, 400);
          return;
        }
        saveKeys(keys);
        log(`[静音] ${action === 'mute' ? '已静音' : '已恢复'} ${key}`);
        sendJson({ ok: true, keys: [...keys] });
      },
    },
  ],
};

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'mute', layer: '判断',
  title: '静音名单',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 20,
  hooks: ['wakeGate', 'routes', 'stateKey'],
  config: [],
  stateFiles: ['muted-keys.json'],
};
