// D-2：抽样放行默认按正常档（不落「只值一句」）；sampleTier=oneLine 可退回旧行为
import createAttention from '../../src/ext/attention.js';

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };

function make(cfg) {
  const logs = [];
  const att = createAttention({ log: (m) => logs.push(m) });
  att.onGroupMessage({ key: 'group:111', text: '嗯', uin: '10001', cfg });
  const gate = att.wakeGate({ key: 'group:111', reason: 'wake', cfg });
  return { att, logs, gate, block: att.promptBlock(cfg) };
}

const base = { socialV2: { attention: { enabled: true, minScore: 2, sample: { default: 100, maxPerDay: 5 }, log: true } } };

const a = make(base);
ok(a.gate === true, '抽样应放行，实际 ' + JSON.stringify(a.gate));
ok(a.block === null, '默认 sampleTier=normal 不应只回一句，实际 ' + JSON.stringify(a.block));
ok(a.logs.some((l) => /\[抽样\].*sampled=true/.test(l)), '日志应带 sampled=true：' + a.logs.join(' | '));

const b = make({ socialV2: { attention: { ...base.socialV2.attention, sampleTier: 'oneLine' } } });
ok(b.gate === true, 'oneLine 档也应放行');
ok(typeof b.block === 'string' && b.block.includes('只值一句'), 'oneLine 应返回一句档，实际 ' + JSON.stringify(b.block));

if (bad) { console.log('ATTENTION_SAMPLE_FAIL ' + bad); process.exit(1); }
console.log('ATTENTION_SAMPLE_OK');
