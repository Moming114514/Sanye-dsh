// 学说法调度：到点派一次、同轮不重复、高峰不派
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStyleLearn } from '../../src/ext/style-learn.js';

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };

const cfg = { ownerQQ: '1000000000', socialV2: { styleLearn: { groups: ['1000000001'], rounds: [[0, 0]], targetQQ: '2000000000', perRound: 2 } } };
const got = [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));
const sl = createStyleLearn({
  getCfg: () => cfg,
  log: (m) => got.push('log:' + m),
  deliverPrompt: (k, t, o) => got.push(`deliver:${k}:${o?.reason}:${/QQ 2000000000/.test(t) ? 'okTxt' : 'badTxt'}`),
  stateDir: dir,
  isPeakNow: () => false,
  tokenGuardDowngrade: () => ({ on: false }),
});

await sl.tick();
const delivered1 = got.filter((x) => x.startsWith('deliver:')).length;
ok(delivered1 === 1, `第一轮派一次（实际 ${delivered1}）`);

const st = JSON.parse(fs.readFileSync(path.join(dir, 'style-learn.json'), 'utf8'));
ok(st.group === '1000000001', '记住群号');
ok(Object.keys(st.done || {}).length === 1, '记录已做的轮次');

await sl.tick();
const delivered2 = got.filter((x) => x.startsWith('deliver:')).length;
ok(delivered2 === 1, `同一天同一轮不重复派（实际 ${delivered2}）`);

// 高峰不派
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sl2-'));
const got2 = [];
const peak = createStyleLearn({
  getCfg: () => cfg,
  log: () => {},
  deliverPrompt: () => got2.push('peak-deliver'),
  stateDir: dir2,
  isPeakNow: () => true,
  tokenGuardDowngrade: () => ({ on: false }),
});
await peak.tick();
ok(got2.length === 0, '高峰时段不派任务');

console.log(bad === 0 ? 'STYLE_LEARN_TESTS_OK' : `STYLE_LEARN_TESTS_FAIL(${bad})`);
process.exit(bad === 0 ? 0 : 1);
