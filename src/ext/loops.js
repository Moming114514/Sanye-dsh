// 欠事（loops）与人物备注（people）：从 bridge.js 的 LOOPS_PATCH / NEXT_PATCH 迁出（M2 第六步）
import { addLoop, doneLoop, listLoops } from '../loops-lib.js';
import { parseDue, notePerson } from '../next-lib.js';

// manifest：声明「我是什么、挂哪些钩子、排第几、写哪些文件」（契约 docs/EXT-MANIFEST.md）
// 只加声明，不改任何调用路径；order = index.js 里第 16 位（下标 15）×10+10
export const manifest = {
  id: 'loops', layer: '记忆',
  title: '欠事与人物',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 160,
  stateFiles: ['loops.json', 'people.json'],
  hooks: ['routes'],
};

export default {
  id: 'loops',
  title: '欠事与人物',
  routes: [
    {
      path: '/api/socialV2/person',
      handle({ body, log, sendJson }) {
        const pr = notePerson({ qq: body?.qq, alias: body?.alias, note: body?.note });
        log('[人物] ' + (pr.ok ? '记了 ' + pr.qq : '失败：' + pr.error));
        return sendJson(pr, pr.ok ? 200 : 400);
      },
    },
    {
      path: '/api/socialV2/loop',
      handle({ body, cfg, log, sendJson }) {
        const action = String(body?.action || 'add');
        if (action === 'list') return sendJson({ ok: true, items: listLoops(cfg) });
        if (action === 'done') return sendJson(doneLoop({ id: body?.id, text: body?.text, raw: cfg }));
        const due = parseDue(body?.due || body?.dueText || '');
        const r = addLoop({ text: body?.text, by: body?.by, due, raw: cfg });
        log('[欠事] ' + (r.ok ? `记了一条（共 ${r.total}）` : '失败：' + r.error));
        return sendJson(r, r.ok ? 200 : 400);
      },
    },
  ],
};
