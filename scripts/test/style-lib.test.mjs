// 学说法：梗句降级、候选不注入、两人复用自动转正、面板手动转正
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sty-'));
process.env.STYLE_STATE_DIR = dir;
const L = await import('../../src/style-lib.js');

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };

ok(L.__test.classifySample('转起来又能破防还能蓄力附体').kind === 'quote', '梗句降级为 quote');
ok(L.__test.classifySample('我先去问问，回头告诉你结果').kind === 'framework', '正常说法是 framework');
ok(L.__test.classifySample('好').kind === 'junk', '太短是 junk');

const a = L.appendStyleSample({ text: '你先别急，我这边查一下再回你', from: '小助手', uin: '2000000000', why: '先稳情绪再给动作' });
ok(a.status === 'candidate', '新样本进候选');
ok(L.styleSamplesBlock(520, 6) === '', '候选不注入');

// 同一个人复用不算验证
L.styleObserve('1000000001', '111', '你先别急啊，我这边查一下再回你');
ok(L.styleCandidates().counts.active === 0, '一个人复用还不转正');

// 第二个人复用 → 自动转正
L.styleObserve('1000000001', '222', '你先别急，我查一下再回你');
ok(L.styleCandidates().counts.active === 1, '两个人复用后自动转正');

const blk = L.styleSamplesBlock(520, 6);
ok(blk.includes('你先别急'), '转正后进提示词');
ok(blk.startsWith('- 「'), '块格式正确');

// 面板手动转正
const g = L.appendStyleSample({ text: '我明天帮你留意一下那个视频', from: '小助手', uin: '2000000000', why: '给承诺' });
L.styleSetStatus(g.id, 'active');
ok(L.styleCandidates().counts.active === 2, '面板手动转正');

console.log(bad === 0 ? 'STYLE_LIB_TESTS_OK' : `STYLE_LIB_TESTS_FAIL(${bad})`);
process.exit(bad === 0 ? 0 : 1);
