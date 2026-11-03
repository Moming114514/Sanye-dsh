// 主人教的说法：他在私聊里纠正/示范时，让她自己记下「原来怎么说 → 该怎么说」，
// 下次照着这个口径来。和「学说法」（学群里那位）分开存，避免污染「只学一个人」的规则。
//
// 为什么单开一份（2026-11-02 用户原话）：「我私聊教的东西最好让她也知道要学习，
// 不能光你这样硬交上去」——所以入口是**她自己调用工具**，不是我把规则写死进人格卡。
import fs from 'node:fs';
import path from 'node:path';

const STATE = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE, 'owner-teach.json');
const MAX = 60;

let cache = { sig: '', items: [] };

function sigOf() {
  try {
    const st = fs.statSync(FILE);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

function readAll() {
  const sig = sigOf();
  if (sig === cache.sig) return cache.items;
  let items = [];
  if (sig) {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      items = Array.isArray(raw?.items) ? raw.items.filter((x) => x && x.better) : [];
    } catch {
      items = [];
    }
  }
  cache = { sig, items };
  return items;
}

function writeAll(items) {
  fs.mkdirSync(STATE, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ items: items.slice(-MAX) }, null, 1));
  fs.renameSync(tmp, FILE);
  cache = { sig: '', items: [] };
}

export function addTeach({ wrong = '', better = '', why = '' } = {}) {
  const b = String(better || '').trim().slice(0, 120);
  if (!b) return { ok: false, error: '要记「该怎么说」那句话' };
  const items = readAll().slice();
  const rec = {
    id: `ot-${Date.now().toString(36)}`,
    wrong: String(wrong || '').trim().slice(0, 120),
    better: b,
    why: String(why || '').trim().slice(0, 80),
    at: new Date().toISOString(),
  };
  // 同一句「该怎么说」重复教就覆盖，不叠加（避免提示词里出现三条一样的）
  const i = items.findIndex((x) => x.better === b);
  if (i >= 0) items[i] = { ...rec, id: items[i].id };
  else items.push(rec);
  writeAll(items);
  return { ok: true, total: Math.min(items.length, MAX), item: rec };
}

export function listTeach() {
  return readAll();
}

export function teachBlock() {
  const items = readAll();
  if (!items.length) return '';
  const rows = items
    .slice(-6)
    .map((x) => `- 别说「${x.wrong || '…'}」，说「${x.better}」${x.why ? `（${x.why}）` : ''}`);
  const text = `【主人教过你的说法｜照这个口径说，别解释、别复读他的原句、也别写「我记住了」这种话】\n${rows.join('\n')}`;
  return text.length > 620 ? `${text.slice(0, 620)}…` : text;
}

export default {
  id: 'owner-teach',
  title: '主人教的说法',

  stateKey() {
    return sigOf() || 'none';
  },

  promptBlock() {
    return teachBlock();
  },

  routes: [
    {
      path: '/api/socialV2/owner-teach',
      async handle({ body, log, sendJson }) {
        const action = String(body?.action || 'list');
        if (action === 'list') {
          sendJson({ ok: true, items: listTeach(), max: MAX });
          return;
        }
        if (action === 'add') {
          const r = addTeach({ wrong: body?.wrong, better: body?.better, why: body?.why });
          if (!r.ok) {
            sendJson(r, 400);
            return;
          }
          log(`[主人教说法] 记下：${String(r.item.better).slice(0, 40)}`);
          sendJson(r);
          return;
        }
        if (action === 'clear') {
          writeAll([]);
          sendJson({ ok: true, items: [] });
          return;
        }
        sendJson({ ok: false, error: 'action 只能是 list / add / clear' }, 400);
      },
    },
  ],
};

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'owner-teach',
  title: '主人教的说法',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 130,
  hooks: ['promptBlock', 'routes', 'stateKey'],
  config: [],
  stateFiles: ['owner-teach.json'],
};
