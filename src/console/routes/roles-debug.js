// src/console/routes/roles-debug.js —— R9-2：roles 只读 + debug 只读
// 从 src/bridge.js 搬出；JSON 结构 / 状态码 / 404 文案 / 令牌校验与原来逐字节一致。
import fs from 'node:fs';
import { roleCharStats, roleSectionReport } from '../../role-card.js';

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res, obj, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj, null, 2));
}

export function registerRolesDebug(router, deps) {
  const R = deps.roles;
  const D = deps.debug;

  // ── 人格管理（只读两条；5 条 POST 写接口仍在 bridge）──────────────────
  router.register('/api/roles', 'GET', (req, res) => {
    const rs = R.readRoleState();
    const summaries = R.roleSummaries();
    send(res, {
      roles: summaries.map((role) => role.name),
      summaries,
      current: rs.role ?? null,
      limits: { nameMax: R.nameMax, contentMaxBytes: R.contentMaxBytes, injectMaxChars: R.getInjectMaxChars() },
    });
  });

  router.register('/api/roles/content', 'GET', (req, res, ctx) => {
    let name;
    try { name = R.validateRoleName(ctx.query.get('name')); } catch (error) { send(res, { ok: false, error: error.message }, 400); return; }
    if (!fs.existsSync(R.roleFilePath(name))) { send(res, { ok: false, error: `人格「${name}」不存在` }, 404); return; }
    const content = R.readRoleContent(name);
    send(res, {
      ok: true,
      name,
      content,
      chars: content.length,
      bytes: Buffer.byteLength(content, 'utf8'),
      warnings: R.roleWarnings(content),
      limits: { injectMaxChars: R.getInjectMaxChars() },
      stats: roleCharStats(content),
      sections: { v1: roleSectionReport(content, 'v1'), v2: roleSectionReport(content, 'v2') },
    });
  });

  // ── 调试只读三条 ─────────────────────────────────────────────────────
  const tokenOk = (ctx) => {
    const want = String(ctx.query.get('token') || '');
    return !!want && want === String(D.getConsoleToken() || '');
  };

  router.register('/api/debug/promise', 'GET', (req, res, ctx) => {
    if (!tokenOk(ctx)) { send(res, { ok: false, error: '令牌无效' }, 403); return; }
    const a = D.analyzePromise(ctx.query.get('text') || '');
    send(res, { ok: true, text: a.text, will: a.will, when: a.when, act: a.act, selfPromise: a.selfPromise, done: a.done, captured: a.captured });
  });

  router.register('/api/debug/related', 'GET', (req, res, ctx) => {
    if (!tokenOk(ctx)) { send(res, { ok: false, error: '令牌无效' }, 403); return; }
    const q = String(ctx.query.get('text') || '');
    const block = D.relatedMemoryBlock(q, { cfg: D.cfg, paths: D.memoryCardPaths });
    send(res, { ok: true, text: q, chars: block.length, block });
  });

  router.register('/api/debug/guard', 'GET', (req, res, ctx) => {
    const info = D.tokenGuardDowngrade();
    const notify = ctx.query.get('notify') === '1';
    if (notify) D.notifyDowngradeOnce(info);
    send(res, { ok: true, now: new Date().toISOString(), todayCost: Number(info.cost || 0), cap: info.cap, ratio: info.ratio, downgraded: info.on, notified: notify });
  });

  return router;
}

export default registerRolesDebug;
