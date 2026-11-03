// 建议收集（ADVICE_CAPTURE）：把指定 QQ（比如群里那只很会出主意的机器人）说的话里
// 带「方法论/建议」味道的句子，落盘到 state/bot-advice.jsonl，方便以后用。
// 不调模型、不进提示词，纯收集。
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME || '/home/dsh';
const FILE = path.join(HOME, '.dsh/surfcore/state/bot-advice.jsonl');
const MAX_LINES = 500;
const KW = /(建议|可以|应该|别|最好|优化|思路|方案|架构|试试|推荐|不如|为什么不|改成|关键|注意|瓶颈|成本|实现)/;

export default function createAdviceCapture({ log }) {
  return {
    id: 'advice',
    title: '建议收集',
    onGroupMessage({ key, uin, text, cfg }) {
      try {
        const c = cfg?.socialV2?.adviceCapture ?? {};
        if (c.enabled === false) return;
        const uins = (c.uins || []).map(String).filter(Boolean);
        if (!uins.length) return; // 没配名单就不收
        if (!uins.includes(String(uin || ''))) return;
        const t = String(text || '').trim();
        const minLen = Number(c.minLen || 15);
        if (t.length < minLen || t.length > 800) return;
        if (!KW.test(t)) return;
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), group: key, uin: String(uin || ''), text: t }) + '\n', 'utf8');
        // 只留最近 MAX_LINES 行
        const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
        if (lines.length > MAX_LINES) fs.writeFileSync(FILE, lines.slice(-MAX_LINES).join('\n') + '\n');
        log(`[建议] 收到一条（${key}）：${t.slice(0, 30)}`);
      } catch {}
    },
    routes: [
      {
        path: '/api/socialV2/advice',
        handle({ body, sendJson }) {
          const act = String(body?.action || 'list');
          if (act === 'clear') {
            try { fs.writeFileSync(FILE, ''); } catch {}
            return sendJson({ ok: true, cleared: true });
          }
          let lines = [];
          try { lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean); } catch {}
          const items = lines.slice(-40).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          return sendJson({ ok: true, total: lines.length, items });
        },
      },
    ],
  };
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'advice',
  title: '建议收集',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 70,
  hooks: ['routes', 'onGroupMessage'],
  config: ['socialV2.adviceCapture'],
  stateFiles: ['bot-advice.jsonl'],
};
