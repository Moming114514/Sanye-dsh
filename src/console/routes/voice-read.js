// src/console/routes/voice-read.js —— R9-7：语音包 3 条只读 GET
// 迁移来源：src/bridge.js 的 /api/voice/packs 前缀块。
// getVoicePacks 必须是 getter（进程级实例）；注册期固定实例会丢安装进度 activeInstalls。
export function registerVoiceRead(router, deps) {
  const REQUIRED = ['getVoicePacks'];
  const missing = REQUIRED.filter((k) => deps == null || deps[k] == null);
  if (missing.length) throw new Error('voice-read 依赖缺失：' + missing.join(', '));
  const { getVoicePacks } = deps;

  // 等价：原实现同在一个大 try 里，非 ImportError 的异常统一 400 + message
  const fail = (ctx, error) => ctx.json(400, { ok: false, error: String(error?.message || error) });

  router.register('/api/voice/packs', ['GET'], async (req, res, ctx) => {
    try {
      // 等价：原调用 vp.list()
      ctx.json(200, await getVoicePacks().list());
    } catch (error) { fail(ctx, error); }
  });

  router.register('/api/voice/packs/cloud-stats', ['GET'], async (req, res, ctx) => {
    try {
      // 等价：原调用 vp.cloudStats(String(url.searchParams.get('id') || 'voice-cloud'))
      ctx.json(200, await getVoicePacks().cloudStats(String(ctx.query.get('id') || 'voice-cloud')));
    } catch (error) { fail(ctx, error); }
  });

  router.register('/api/voice/packs/cloud-config', ['GET'], async (req, res, ctx) => {
    try {
      // 等价：原调用 vp.readCloudConfig(String(url.searchParams.get('id') || 'voice-cloud'))
      ctx.json(200, await getVoicePacks().readCloudConfig(String(ctx.query.get('id') || 'voice-cloud')));
    } catch (error) { fail(ctx, error); }
  });
}
