// src/console/http.js —— 控制台路由注册器骨架（R9-B 第 0 步，暂不接进 bridge）
// 只做三件事：登记 path→methods→handler；按 path 精确匹配分派；给 handler 一个薄 helper。
// 不依赖 bridge，不读全局状态。接进 bridge 是后续步骤的事。
import { URL } from 'node:url';

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

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
      json(code, obj) {
        res.statusCode = code;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(obj));
      },
      text(code, body, type = 'text/plain; charset=utf-8') {
        res.statusCode = code;
        res.setHeader('content-type', type);
        res.end(body);
      },
    };
    await hit.handler(req, res, ctx);
    return true;
  }

  return api;
}

export default createRouter;
