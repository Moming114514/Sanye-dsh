// 学习模式：对某个群「只看不聊」——她自己不接话，学说法照样能进去学。
// 与静音的区别：静音是「整个会话先不理」，学习模式是「留着看、不发言」，专门给学说法用。
// 与模式（全开/只听主人/只跟我私聊/关机）正交：模式管全局，学习模式管单个群。
import fs from 'node:fs';
import path from 'node:path';

const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'learn-mode.json');

let cache = { sig: '', groups: new Set() };

function loadGroups() {
  let sig = '';
  try {
    const st = fs.statSync(FILE);
    sig = `${st.mtimeMs}:${st.size}`;
  } catch {
    cache = { sig: '', groups: new Set() };
    return cache.groups;
  }
  if (sig === cache.sig) return cache.groups;
  const groups = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const items = raw && typeof raw.groups === 'object' && raw.groups ? raw.groups : {};
    for (const [gid, v] of Object.entries(items)) {
      if (v !== false) groups.add(String(gid).replace(/\D/g, ''));
    }
  } catch {
    // 文件坏了就当没开，不影响正常聊天
  }
  cache = { sig, groups };
  return groups;
}

function saveGroups(groups) {
  fs.mkdirSync(STATE, { recursive: true });
  const out = {};
  for (const gid of groups) out[gid] = { at: new Date().toISOString() };
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ groups: out }, null, 1));
  fs.renameSync(tmp, FILE);
  cache = { sig: '', groups: new Set() };
}

export function isLearnGroup(gid) {
  return loadGroups().has(String(gid || '').replace(/\D/g, ''));
}

export function learnGroups() {
  return [...loadGroups()];
}

export default {
  id: 'learnmode',
  title: '学习模式',

  // 名单变了要让提示词缓存失效（虽然它不进提示词，但状态口径要一致）
  stateKey() {
    try {
      const st = fs.statSync(FILE);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'none';
    }
  },

  // 唤醒闸门：学习模式里的群，只有「学说法」这类任务放行，普通接话一律不醒
  wakeGate({ key, reason }) {
    const k = String(key || '');
    const why = String(reason || '');
    if (!k.startsWith('group:')) return true;
    if (why === 'manual' || why === 'admin') return true;
    if (/style-learn/.test(why)) return true;
    const gid = k.slice('group:'.length).replace(/\D/g, '');
    if (!isLearnGroup(gid)) return true;
    return { allow: false, reason: `[学习模式] 跳过唤醒 ${k}（${why}）：这个群现在只看不聊` };
  },

  routes: [
    {
      path: '/api/socialV2/learnmode',
      async handle({ body, log, sendJson }) {
        const action = String(body?.action || 'list');
        if (action === 'list') {
          sendJson({ ok: true, groups: learnGroups() });
          return;
        }
        const gid = String(body?.group || '').replace(/\D/g, '');
        if (!gid) {
          sendJson({ ok: false, error: 'group 必须是群号' }, 400);
          return;
        }
        const groups = loadGroups();
        if (action === 'on') groups.add(gid);
        else if (action === 'off') groups.delete(gid);
        else {
          sendJson({ ok: false, error: 'action 只能是 list / on / off' }, 400);
          return;
        }
        saveGroups(groups);
        log(`[学习模式] ${action === 'on' ? '开启' : '关闭'} 群 ${gid}（${action === 'on' ? '只看不聊' : '恢复正常' }）`);
        sendJson({ ok: true, groups: [...groups] });
      },
    },
  ],
};
