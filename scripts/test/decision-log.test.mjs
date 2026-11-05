import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDecisionLog } from '../../src/ext/decision-log.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declog-'));
const logs = [];
const dl = createDecisionLog({ stateDir: dir, log: (m) => logs.push(String(m)) });

const text = '这是一条足够长的消息，用来验证只保存前 40 个字而不会把全文落盘，后面的内容不应该出现在文件里。';
const id = dl.record({ key: 'group:1', reason: 'poke', text, score: 7, allow: false, source: 'mute', layers: [{ id: 'mute', allow: false, reason: '[静音]' }] });
if (!id) throw new Error('record 没有返回 id');
const file = path.join(dir, 'decision', dl.dayOf() + '.jsonl');
const raw = fs.readFileSync(file, 'utf8');
if (!raw.includes('"type":"decision"')) throw new Error('没有写入 decision');
if (raw.includes('后面的内容不应该出现在文件里')) throw new Error('全文被写进日志');
const rec = JSON.parse(raw.split('\n')[0]);
if (rec.text.length > 40) throw new Error('text 没有截断到 40 字');
if (!/^[0-9a-f]{40}$/.test(rec.textHash)) throw new Error('textHash 不是 sha1');

dl.markOutcome('group:1', { replied: true, outbound: 1 });
const items = dl.read(dl.dayOf());
if (items.length !== 1) throw new Error('read 应合并 outcome，实际 ' + items.length);
if (items[0].replied !== true) throw new Error('outcome 没有合并');
if (!(items[0].latencyMs >= 0)) throw new Error('latencyMs 无效');

const st = dl.stats(dl.dayOf());
if (st.total !== 1 || st.block !== 1 || st.replied !== 1) throw new Error('stats 不对：' + JSON.stringify(st));
if (!st.topSources.length || st.topSources[0][0] !== 'mute') throw new Error('topSources 不对');

// 过期清理：造一个 20 天前的文件
const old = path.join(dir, 'decision', '2000-01-01.jsonl');
fs.writeFileSync(old, '{}\n');
dl.record({ key: 'group:2', allow: true, text: 'x' });
if (fs.existsSync(old)) throw new Error('14 天前的文件没有被清理');

// stateDir 为空时返回 null，调用方零开销
const off = createDecisionLog({ stateDir: '', log: () => {} });
if (off !== null) throw new Error('stateDir 为空应返回 null');
console.log('DECISION_LOG_OK');
