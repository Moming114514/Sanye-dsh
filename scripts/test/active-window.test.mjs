// D-3：活跃期 —— 触发后放行、退出后不再放行、过期自动失效
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-'));
process.env.SURFCORE_STATE_DIR = dir;

const aw = await import('../../src/ext/active-window.js');
const createAttention = (await import('../../src/ext/attention.js')).default;

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };
const logs = [];
const att = createAttention({ log: (m) => logs.push(m) });
const cfg = { ownerQQ: '100', socialV2: { attention: { enabled: true, minScore: 2, sample: { default: 0, maxPerDay: 0 } } } };
const low = () => att.onGroupMessage({ key: 'group:1', text: '嗯', uin: '200', cfg });

low();
ok(att.wakeGate({ key: 'group:1', reason: 'wake', cfg })?.allow === false, '无活跃期时低分应被拦');

aw.touchActiveWindow('group:1', 10, 'owner');
const got = aw.getActiveWindow('group:1');
ok(got && got.minutesLeft >= 9 && got.minutesLeft <= 10, '写入后剩余分钟应为 10，实际 ' + JSON.stringify(got));

aw.clearActiveWindow('group:1');
aw.touchActiveWindow('group:1', 10, 'owner');
low();
logs.length = 0;
ok(att.wakeGate({ key: 'group:1', reason: 'wake', cfg }) === true, '活跃期内低分应放行');
ok(logs.some((l) => l.includes('[活跃期] 放行')), '应有活跃期放行日志：' + logs.join(' | '));

ok(aw.clearActiveWindow('group:1') === true, '清除应返回 true');
low();
ok(att.wakeGate({ key: 'group:1', reason: 'wake', cfg })?.allow === false, '退出后低分应重新被拦');

fs.writeFileSync(path.join(dir, 'active-window.json'), JSON.stringify({ 'group:2': { until: Date.now() - 1000, by: 'owner' } }));
ok(aw.getActiveWindow('group:2') === null, '过期记录应自动失效');
ok(aw.listActiveWindows().length === 0, '过期记录应被 prune');

ok(aw.isActiveWindowExit('回去') === true, '「回去」应识别为退出');
ok(aw.isActiveWindowExit(' 睡吧！ ') === true, '带空格/标点应识别');
ok(aw.isActiveWindowExit('回去啦') === false, '「回去啦」不应识别');

fs.rmSync(dir, { recursive: true, force: true });
if (bad) { console.log('ACTIVE_WINDOW_FAIL ' + bad); process.exit(1); }
console.log('ACTIVE_WINDOW_OK');
