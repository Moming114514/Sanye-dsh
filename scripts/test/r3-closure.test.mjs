// R3：对话收尾判断抽离后，12 条真实会话样本的判分必须与迁移前完全一致。
// fixtures 由迁移前 bridge 使用的同一 conversation-closure.js 生成并固化（verdict/score）。
import fs from 'node:fs';
import { createClosureClassifier } from '../../src/lib/closure.js';

const fixturePath = new URL('./fixtures/closure-samples.json', import.meta.url);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const make = (sample, { sendFailed = false } = {}) => {
  const cfg = { socialV2: { closure: fixtures.config } };
  const states = new Map([[sample.key, sample.st]]);
  return createClosureClassifier({
    cfg,
    now: () => sample.now,
    getState: (key) => states.get(key),
    canonicalKey: (key) => key,
    hasSendFailed: () => sendFailed,
    readThroughSeq: () => 0,
    requestedReadThroughSeq: () => 0,
    acknowledge: () => 0,
    redact: (s) => s,
    ensureWakeable: () => {},
    markReadCalled: () => {},
    cancelReplyCheck: () => {},
    saveState: () => {},
    computeWakeSafety: () => ({ guaranteed: true }),
    log: () => {},
    appendActivity: () => {},
  });
};

let pass = 0;
for (const sample of fixtures.samples) {
  const c = make(sample);
  const a = c.assessClosureV2(sample.key, sample.st);
  if (a.verdict !== sample.expect.verdict || a.score !== sample.expect.score) {
    console.error('R3_FAIL', sample.name, 'expect', sample.expect, 'got', { verdict: a.verdict, score: a.score });
    process.exit(1);
  }
  pass += 1;
}

const base = fixtures.samples.find((s) => s.expect.verdict !== 'close') || fixtures.samples[0];
const liveSt = { ...base.st, closure: null, unread: [], wakeConfig: { noActionCount: 2 } };
const live = make({ ...base, st: liveSt });
const result = live.closeConversationV2(base.key, { summary: '测试收尾' });
if (!result.ok || !liveSt.closure || liveSt.closure.summary !== '测试收尾') {
  console.error('R3_FAIL close result', JSON.stringify(result).slice(0, 200), !!liveSt.closure);
  process.exit(1);
}
if (liveSt.wakeConfig.noActionCount !== 0) { console.error('R3_FAIL noActionCount'); process.exit(1); }

const failed = make({ ...base, st: { ...liveSt, closure: null, wakeConfig: { noActionCount: 0 } } }, { sendFailed: true });
try {
  failed.closeConversationV2(base.key);
  console.error('R3_FAIL sendFailed not blocked');
  process.exit(1);
} catch (e) {
  if (e.statusCode !== 409 || e.code !== 'CLOSE_AFTER_SEND_FAILED') {
    console.error('R3_FAIL sendFailed status', e.statusCode, e.code);
    process.exit(1);
  }
}

const disabled = createClosureClassifier({
  cfg: { socialV2: { closure: { ...fixtures.config, enabled: false } } },
  getState: () => liveSt,
  canonicalKey: (k) => k,
});
try {
  disabled.closeConversationV2(base.key);
  console.error('R3_FAIL disabled not blocked');
  process.exit(1);
} catch (e) {
  if (e.statusCode !== 403) { console.error('R3_FAIL disabled status', e.statusCode); process.exit(1); }
}

console.log(`R3_OK samples=${pass}`);
