// G4：工具调用入口守卫（参数校验 + 可重试错误有限重试）
//
// 只负责「调用这一层」：不改任何工具实现，也不改 config。
// - 参数校验：SDK 先按 zod schema 校验，校验失败会抛 -32602；
//   这里把它翻译成模型看得懂的结构化 JSON（invalid_arguments + schema_hint）。
// - 重试：只对网络超时 / 5xx / ECONNRESET 之类可重试错误重试，最多 2 次，间隔 300/800ms。
// - 日志写 stderr（MCP stdio 的 stdout 是协议通道，不能污染）。
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const RETRIES = 2;

// P2：红级工具——只允许「主人私聊」会话调用。名单与 docs/PERMISSIONS.md 一致。
export const RED_TOOLS = new Set([
  // RED 只放「不可逆/身份/关系」类：发送与评论是她的日常工作，不属于红级（2026-11-07 修正）
  'qq_memory_clear', 'qq_set_profile', 'qq_set_avatar',
  'qq_delete_qzone_msg', 'qq_handle_friend_request',
]);

// resolveKey(token) 由调用方注入（MCP 侧用 /api/status 反查会话 key）。
export function createPermGuard({ resolveKey, ownerQQ, log = console.error } = {}) {
  const ownerPrivate = ownerQQ ? `private:${ownerQQ}` : '';
  return async function permCheck(name, args) {
    const tool = String(name || '');
    if (!RED_TOOLS.has(tool)) return null;
    const token = String(args?.token || '');
    let key = '';
    try { key = String((await resolveKey(token)) || ''); } catch { key = ''; }
    if (ownerPrivate && key === ownerPrivate) return null;
    log(`[权限] 拒绝 ${tool} key=${key || '-'}（红工具）`);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'forbidden', detail: '该工具仅主人私聊可用', tool }) }],
      isError: true,
    };
  };
}
export const YELLOW_TOOLS = new Set([
  'qq_mark_read', 'qq_close_conversation', 'qq_memory_append', 'qq_memory_remove',
  'qq_slang_submit', 'qq_learn_from_owner', 'qq_collect_sticker', 'qq_sticker_note',
  'qq_set_sticker_remark', 'qq_style_note', 'qq_person_note', 'qq_report_feedback', 'note_tech',
]);

export const DEFAULT_TOOL_LIMITS = {
  qq_send_poke: 50,
  qq_like_message: 30,
  qq_set_group_card: 10,
};

// 黄级工具日限额：~/.dsh/surfcore/state/tool-calls.json { day, counts:{tool:n} }，东八区日切。
export function createToolLimiter({ stateDir, getCfg = () => ({}), now = () => Date.now(), log = console.error } = {}) {
  const file = path.join(stateDir, 'tool-calls.json');
  const dayKey = (ms) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const load = (day) => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
      if (raw && raw.day === day && raw.counts && typeof raw.counts === 'object') return raw;
    } catch {}
    return { day, counts: {} };
  };
  const save = (obj) => {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = file + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(obj));
      fs.renameSync(tmp, file);
    } catch (err) { log(`[权限] 计数写盘失败 ${err?.message ?? err}`); }
  };
  const limitOf = (name) => {
    const cfg = getCfg() || {};
    const custom = cfg?.socialV2?.toolLimits;
    if (custom && Number(custom[name]) > 0) return Number(custom[name]);
    if (DEFAULT_TOOL_LIMITS[name]) return DEFAULT_TOOL_LIMITS[name];
    if (YELLOW_TOOLS.has(name)) return 100;
    return 0;
  };
  return function toolLimit(name) {
    const tool = String(name || '');
    if (RED_TOOLS.has(tool)) return null; // 红级走 perm 原逻辑，不叠加限额
    const limit = limitOf(tool);
    if (!limit) return null;
    const day = dayKey(now());
    const st = load(day);
    const n = Number(st.counts[tool] || 0);
    if (n >= limit) {
      log(`[权限] 限额 ${tool} ${n}/${limit}`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ ok: false, error: 'rate_limited', detail: `今日已达上限 ${limit} 次`, tool }),
        }],
        isError: true,
      };
    }
    st.counts[tool] = n + 1;
    save(st);
    return null;
  };
}

export const RETRY_DELAYS = [300, 800];

export function isRetryableError(err) {
  const code = String(err?.code ?? '');
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  const msg = String(err?.message ?? err ?? '');
  if (status >= 500 && status <= 599) return true;
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;
  return /timed? out|timeout|ECONNRESET|socket hang up|fetch failed|network error|HTTP 5\d\d/i.test(msg);
}

export async function withRetry(fn, {
  name = '',
  retries = RETRIES,
  delays = RETRY_DELAYS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  log = console.error,
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryableError(err)) throw err;
      attempt += 1;
      log(`[tool] 重试第 ${attempt} 次 ${name} ${String(err?.message ?? err)}`);
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)]);
    }
  }
}

function unwrapField(field) {
  let f = field;
  for (let i = 0; i < 5; i += 1) {
    const n = f?.constructor?.name || '';
    if (n === 'ZodOptional' || n === 'ZodNullable' || n === 'ZodDefault' || n === 'ZodEffects' || n === 'ZodReadonly') {
      f = f._def?.innerType ?? f._def?.schema ?? f;
      continue;
    }
    break;
  }
  return f;
}

function typeNameOf(field) {
  const f = unwrapField(field);
  const n = f?._def?.typeName || f?.constructor?.name || '';
  const t = String(n).replace(/^Zod/, '').toLowerCase();
  const map = {
    string: 'string', number: 'number', boolean: 'boolean', array: 'array', object: 'object',
    enum: 'enum', literal: 'literal', record: 'object', union: 'union', tuple: 'array',
    date: 'date', any: 'any', unknown: 'unknown', bigint: 'bigint',
  };
  return map[t] || 'any';
}

export function schemaHint(schema) {
  const shape = schema?.shape ?? schema?._def?.shape?.() ?? {};
  const parts = Object.entries(shape).map(([k, v]) => {
    let optional = false;
    try { optional = typeof v?.isOptional === 'function' && v.isOptional(); } catch { optional = false; }
    return `${k}: ${typeNameOf(v)}${optional ? '?' : ''}`;
  });
  return parts.join(', ');
}

export function describeInvalid(schema, args) {
  if (!schema) return { missing: [], types: [], detail: 'invalid arguments', hint: '' };
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) return null;
  const missing = [];
  const types = [];
  for (const issue of parsed.error.issues || []) {
    const p = Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : '(root)';
    if (issue.code === 'invalid_type' && /undefined|required/i.test(String(issue.message))) missing.push(p);
    else types.push(`${p}: ${issue.message}`);
  }
  const detail = [
    missing.length ? `missing: ${missing.join(', ')}` : '',
    types.length ? `invalid: ${types.join('; ')}` : '',
  ].filter(Boolean).join(' | ') || 'invalid arguments';
  return { missing, types, detail, hint: schemaHint(schema) };
}

// 在 MCP server 构造完之后调用：包住 SDK 已注册的 tools/call 处理函数。
export function installToolGuard(server, { log = console.error, schemas = new Map(), perm = null, limit = null } = {}) {
  const handlers = server?.server?._requestHandlers;
  if (!handlers || typeof handlers.get !== 'function' || !handlers.has('tools/call')) {
    return { schemas, installed: false };
  }
  const prev = handlers.get('tools/call');

  function structuredInvalid(name, args) {
    const info = describeInvalid(schemas.get(name), args);
    log(`[tool] 参数无效 ${name} missing=${info?.missing?.length ? info.missing.join(',') : '-'}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: 'invalid_arguments',
          detail: info?.detail || 'invalid arguments',
          schema_hint: info?.hint || '',
        }),
      }],
      isError: true,
    };
  }

  handlers.set('tools/call', async (request, extra) => {
    if (perm) {
      const denied = await perm(request?.params?.name, request?.params?.arguments);
      if (denied) return denied;
    }
    if (limit) {
      const limited = limit(request?.params?.name, request?.params?.arguments);
      if (limited) return limited;
    }
    let result;
    try {
      result = await prev(request, extra);
    } catch (err) {
      const name = String(request?.params?.name ?? '');
      const invalid = err?.code === -32602 && /Input validation error/i.test(String(err?.message ?? ''));
      if (!invalid) throw err;
      return structuredInvalid(name, request?.params?.arguments);
    }
    // SDK 1.30 会把参数校验错误包成 isError 结果（文本以 MCP error -32602 开头），
    // 这里翻译成模型看得懂的结构化 JSON。
    const text = String(result?.content?.find?.((c) => c?.type === 'text')?.text ?? '');
    if (result?.isError && /MCP error -32602|Input validation error/i.test(text)) {
      return structuredInvalid(String(request?.params?.name ?? ''), request?.params?.arguments);
    }
    return result;
  });
  return { schemas, installed: true };
}

export function buildToolSchema(shape) {
  try {
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) return null;
    return z.object(shape);
  } catch {
    return null;
  }
}
