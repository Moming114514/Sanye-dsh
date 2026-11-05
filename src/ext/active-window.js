// D-3 活跃期：主人在某个会话叫醒她后，该会话进入 N 分钟「正常对话」，不必反复叫。
// 只读写一个状态文件；触发/退出在 bridge 里，这里不做业务判断。
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '', '.dsh', 'surfcore', 'state');
const FILE = path.join(DIR, 'active-window.json');
const EXIT_RE = /^(回去|安静|别说了|睡吧|闭嘴)[。！!…]*$/;

function readAll() {
  try {
    const o = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

function prune(o) {
  const now = Date.now();
  for (const k of Object.keys(o)) if (!(Number(o[k] && o[k].until) > now)) delete o[k];
  return o;
}

function writeAll(o) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(o), 'utf8');
  fs.renameSync(tmp, FILE);
}

export function getActiveWindow(key) {
  const v = prune(readAll())[key];
  if (!v) return null;
  return { until: Number(v.until), by: v.by || 'owner', minutesLeft: Math.max(0, Math.ceil((Number(v.until) - Date.now()) / 60000)) };
}

export function touchActiveWindow(key, minutes, by = 'owner') {
  const mins = Math.max(1, Math.min(60, Number(minutes) || 10));
  const o = prune(readAll());
  o[key] = { until: Date.now() + mins * 60000, by };
  writeAll(o);
  return o[key];
}

export function clearActiveWindow(key) {
  const o = prune(readAll());
  if (!o[key]) return false;
  delete o[key];
  writeAll(o);
  return true;
}

export function listActiveWindows() {
  const o = prune(readAll());
  return Object.keys(o).map((key) => ({
    key, until: Number(o[key].until), by: o[key].by || 'owner',
    minutesLeft: Math.max(0, Math.ceil((Number(o[key].until) - Date.now()) / 60000)),
  }));
}

export function isActiveWindowExit(text) {
  return EXIT_RE.test(String(text || '').replace(/\s+/g, '').trim());
}

// v1 manifest（D-3）：纯状态读取模块，由 bridge 直接调用，未注册进 EXTENSIONS
export const manifest = {
  id: 'active-window',
  title: '活跃期（叫醒后 10 分钟）',
  kind: 'tool',
  enabledByDefault: true,
  hot: true,
  layer: '判断',
  order: 190,
  hooks: [],
  config: ['socialV2.activeWindow'],
  stateFiles: ['active-window.json']
};
