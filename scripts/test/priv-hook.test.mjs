// 私聊钩子：认「学一下她/看看亚托莉」，普通闲聊不触发，超长不触发
import { extOnPrivateMessage } from '../../src/ext/index.js';

const cfg = { socialV2: { styleLearn: { groups: ['1000000001'], targetQQ: '2000000000', perRound: 2 } } };
const got = [];
const log = (m) => got.push('log:' + m);
const deliverPrompt = (key, text, opts) => got.push(`deliver:${key}:${opts?.reason}:${text.includes('QQ 2000000000') ? 'okTxt' : 'badTxt'}`);

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };

ok(extOnPrivateMessage({ id: '1000000000', text: '看看亚托莉刚才说了啥', cfg, log, deliverPrompt }) === true, '「看看亚托莉」命中');
ok(extOnPrivateMessage({ id: '1000000000', text: '学一下她说话', cfg, log, deliverPrompt }) === true, '「学一下她」命中');
ok(extOnPrivateMessage({ id: '1000000000', text: '今天天气不错', cfg, log, deliverPrompt }) === false, '普通闲聊不触发');
ok(extOnPrivateMessage({ id: '1000000000', text: '学说法'.repeat(8), cfg, log, deliverPrompt }) === false, '超 20 字不触发');
const delivered = got.filter((x) => x.startsWith('deliver:')).length;
ok(delivered === 2, `只有命中时派任务（派了 ${delivered} 次）`);

console.log(bad === 0 ? 'PRIV_HOOK_TESTS_OK' : `PRIV_HOOK_TESTS_FAIL(${bad})`);
process.exit(bad === 0 ? 0 : 1);
