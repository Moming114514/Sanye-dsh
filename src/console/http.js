// src/console/http.js —— 控制台路由注册器
// 只做三件事：登记 path→methods→handler；按 path 精确匹配分派；给 handler 一个薄 ctx。
//
// handle(req, res) 的契约（四种情况，每种只做一件事）：
//   1) 未命中路径            → 不写任何字节，return false（调用方继续走原路由链）
//   2) 命中且方法不符        → 写 405 + Allow，return true
//   3) 命中且 handler 正常    → handler 自己写且只写一次，return true
//   4) 命中但 handler 抛错    → 若 res.headersSent 为 false，本函数写一次 500；否则不动。
//                              无论如何都 return true，异常不再冒泡，主流程不会再写第二遍。
// 注意：绝不能出现「handle 已经写过响应、又返回 false」——那会让调用方再写一次，触发
// ERR_HTTP_HEADERS_SENT（R9-3 回归就是这么来的）。
import { URL } from 'node:url';

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

// 与 bridge 内层的 SECURITY_HEADERS 保持一致；放在这里是为了让 ctx.json 写出的
// 响应头与搬走前逐字相同（不依赖任何按请求创建的闭包）。
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function norm(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) throw new Error('path 必须以 / 开头：' + p);
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function createRouter({ log = () => {} } = {}) {
  const table = new Map();

  function register(p, methods, handler) {
    const key = norm(p);
    const ms = (Array.isArray(methods) ? methods : [methods]).map((m) => String(m).toUpperCase());
    for (const m of ms) if (!METHODS.includes(m)) throw new Error('未知方法：' + m);
    if (typeof handler !== 'function') throw new Error('handler 必须是函数：' + key);
    if (table.has(key)) throw new Error('路径重复注册：' + key);
    table.set(key, { methods: new Set(ms), handler });
    return api;
  }

  const api = { register, handle, routes, has, get size() { return table.size; } };

  function routes() {
    return [...table.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([p, v]) => ({ path: p, methods: [...v.methods].sort() }));
  }

  function has(p, method) {
    const e = table.get(norm(p));
    return !!e && e.methods.has(String(method).toUpperCase());
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const hit = table.get(url.pathname);
    if (!hit) {
      // 未命中：不写任何字节，交给调用方继续走原来的路由链。
      return false;
    }
    const method = String(req.method || 'GET').toUpperCase();
    if (!hit.methods.has(method)) {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: [...hit.methods].join(', ') });
      res.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
      return true;
    }
    const ctx = {
      url,
      query: url.searchParams,
      log,
      // 与 bridge 的 sendJson 逐字等价：同样的 content-type + SECURITY_HEADERS + 2 空格缩进。
      // 必须走这里的 res（按请求创建），不能把 bridge 里按请求创建的 sendJson 塞进 deps ——
      // router 是缓存复用的，那样会把第一个请求的 res 闭包一直用下去（R9-3 回归根因）。
      json(code, obj) {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
        res.end(JSON.stringify(obj, null, 2));
      },
      text(code, body, type = 'text/plain; charset=utf-8') {
        res.writeHead(code, { 'content-type': type, ...SECURITY_HEADERS });
        res.end(body);
      },
    };
    try {
      await hit.handler(req, res, ctx);
    } catch (e) {
      // 契约：命中且 handler 抛错 —— 这里写且只写一次 500，然后吞掉异常，
      // 保证调用方不会再写第二遍（否则会 ERR_HTTP_HEADERS_SENT）。
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
      if (typeof log === 'function') log('[console] handler 失败 ' + url.pathname + '：' + String(e?.message || e));
    }
    return true;
  }
  return api;
}

export default createRouter;
