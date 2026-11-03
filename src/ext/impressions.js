// 印象库：她对他/对世界的看法（自己攒的，不是设定）
// 从 bridge.js 的 IMPR_PATCH 内联补丁迁出（M2 第二步）
import fs from 'node:fs';
import { impressionsBlock, impressionsData, addImpression, forgetImpression, impressionsPath } from '../impressions.js';

export default {
  id: 'impressions',
  title: '印象库',
  // 提示词缓存键：文件 mtime 变了才重建提示词
  stateKey() {
    try { return String(fs.statSync(impressionsPath()).mtimeMs); } catch { return ''; }
  },
  promptBlock(cfg) {
    return impressionsBlock(cfg?.socialV2?.impressions);
  },
  routes: [
    {
      path: '/api/socialV2/impression',
      handle({ body, log, sendJson }) {
        const action = String(body?.action || 'list');
        if (action === 'list') return sendJson({ ok: true, ...impressionsData() });
        if (action === 'forget') {
          const r = forgetImpression(body?.id);
          log('[印象] ' + (r.ok ? `删了一条（剩 ${r.total}）` : '失败：' + r.error));
          return sendJson(r, r.ok ? 200 : 400);
        }
        const r = addImpression({ text: body?.text, about: body?.about, confidence: body?.confidence });
        log('[印象] ' + (r.ok ? `记了一条（共 ${r.total}）` : '失败：' + r.error));
        return sendJson(r, r.ok ? 200 : 400);
      },
    },
  ],
};

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径）
export const manifest = {
  id: 'impressions',
  title: '她的看法',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 120,
  hooks: ['promptBlock', 'routes', 'stateKey'],
  config: ['socialV2.impressions'],
  stateFiles: [],
};
