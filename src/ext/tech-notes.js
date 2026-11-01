// src/ext/tech-notes.js
// 技术笔记库：B站技术视频的沉淀，给以后升级 dsh 时用。
// 逻辑仍在 ../tech-notes.js，这里只做「扩展声明」：状态键 + 提示词块 + 路由。
import fs from 'node:fs';
import { addTechNote, forgetTechNote, searchTechNotes, techNotesBlock, techNotesPath } from '../tech-notes.js';

export default {
  id: 'tech-notes',

  stateKey() {
    try { return String(fs.statSync(techNotesPath()).mtimeMs); } catch { return ''; }
  },

  promptBlock(cfg) {
    return techNotesBlock(cfg.socialV2?.techNotes);
  },

  routes: [
    {
      path: '/api/socialV2/tech-notes',
      handle({ body, log, sendJson }) {
        const action = String(body?.action || 'list');
        if (action === 'list' || action === 'search') {
          const items = searchTechNotes({ q: body?.q, tag: body?.tag, limit: body?.limit });
          return sendJson({ ok: true, items, total: items.length });
        }
        if (action === 'forget') {
          const r = forgetTechNote(body?.id);
          log('[技术笔记] ' + (r.ok ? `删了一条（剩 ${r.total}）` : '失败：' + r.error));
          return sendJson(r, r.ok ? 200 : 400);
        }
        const r = addTechNote({
          title: body?.title, url: body?.url, bv: body?.bv, up: body?.up,
          summary: body?.summary, points: body?.points, tools: body?.tools, tags: body?.tags,
        });
        log('[技术笔记] ' + (r.ok ? `${r.updated ? '合并' : '记了'}「${String(body?.title || '').slice(0, 30)}」（共 ${r.total}）` : '失败：' + r.error));
        return sendJson(r, r.ok ? 200 : 400);
      },
    },
  ],
};
