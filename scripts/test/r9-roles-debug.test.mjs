// R9-2：roles/debug 只读路由搬出后的形状与状态码
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRouter } from '../../src/console/http.js';
import { registerRolesDebug } from '../../src/console/routes/roles-debug.js';

function mockRes() {
  const r = { code: 0, headers: {}, body: '' };
  r.writeHead = (code, headers) => { r.code = code; r.headers = headers || {}; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = (b) => { r.body = String(b ?? ''); };
  return r;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r9r-'));
const roleA = path.join(dir, 'A.md');
fs.writeFileSync(roleA, '## 语气\n说话自然一点。\n', 'utf8');

let notified = 0;
const deps = {
  roles: {
    readRoleState: () => ({ role: 'A', mode: 'active' }),
    roleSummaries: () => [{ name: 'A' }, { name: 'B' }],
    nameMax: 40,
    contentMaxBytes: 65536,
    getInjectMaxChars: () => 120,
    validateRoleName: (raw) => {
      const s = String(raw ?? '').trim();
      if (!s) throw new Error('人格名字不能为空');
      return s;
    },
    roleFilePath: (n) => (n === 'A' ? roleA : path.join(dir, n + '.md')),
    readRoleContent: () => fs.readFileSync(roleA, 'utf8'),
    roleWarnings: () => ['w1'],
  },
  debug: {
    getConsoleToken: () => 'tok',
    analyzePromise: (t) => ({ text: t, will: true, when: 'w', act: 'a', selfPromise: false, done: false, captured: ['c'] }),
    relatedMemoryBlock: () => 'BLOCK',
    cfg: {},
    memoryCardPaths: [],
    tokenGuardDowngrade: () => ({ cost: 1.5, cap: 8, ratio: 0.1875, on: false }),
    notifyDowngradeOnce: () => { notified++; },
  },
};

const router = createRouter({ log: () => {} });
registerRolesDebug(router, deps);

async function call(p, headers = {}) {
  const res = mockRes();
  const matched = await router.handle({ method: 'GET', url: p, headers, socket: { remoteAddress: '127.0.0.1' } }, res);
  return { matched, res, body: res.body ? JSON.parse(res.body) : null };
}

const fails = [];
const check = (n, c, x) => { if (!c) fails.push(n + (x ? ' :: ' + JSON.stringify(x).slice(0, 150) : '')); };

const roles = await call('/api/roles');
check('roles 200', roles.res.code === 200);
check('roles 列表', JSON.stringify(roles.body?.roles) === '["A","B"]');
check('roles current', roles.body?.current === 'A');
check('roles limits', roles.body?.limits?.injectMaxChars === 120);

const content = await call('/api/roles/content?name=A');
check('content 200', content.res.code === 200, content.res.code);
check('content ok', content.body?.ok === true);
check('content chars', content.body?.chars > 0);
check('content bytes', content.body?.bytes > 0);
check('content sections', content.body?.sections?.v1 !== undefined && content.body?.sections?.v2 !== undefined);

const badName = await call('/api/roles/content?name=');
check('content 空名 400', badName.res.code === 400, badName.res.code);

const missing = await call('/api/roles/content?name=Missing');
check('content 404', missing.res.code === 404, missing.res.code);
check('content 404 文案', missing.body?.error === '人格「Missing」不存在', missing.body);

const noToken = await call('/api/debug/promise?text=hi');
check('promise 无令牌 403', noToken.res.code === 403, noToken.res.code);
check('promise 403 文案', noToken.body?.error === '令牌无效');

const promise = await call('/api/debug/promise?token=tok&text=hi');
check('promise 200', promise.res.code === 200);
check('promise 字段', promise.body?.text === 'hi' && promise.body?.will === true && promise.body?.when === 'w');

const related = await call('/api/debug/related?token=tok&text=q');
check('related 200', related.res.code === 200);
check('related block', related.body?.block === 'BLOCK' && related.body?.chars === 5);

const guard = await call('/api/debug/guard');
check('guard 200', guard.res.code === 200);
check('guard 数值', guard.body?.todayCost === 1.5 && guard.body?.cap === 8 && guard.body?.notified === false);
check('guard 未误发通知', notified === 0);
const guardNotify = await call('/api/debug/guard?notify=1');
check('guard notify 调用一次', guardNotify.body?.notified === true && notified === 1);

const miss = await call('/api/nope');
check('未命中回落', miss.matched === false);

fs.rmSync(dir, { recursive: true, force: true });
if (fails.length) {
  console.error('R9_ROLES_DEBUG_FAIL\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('R9_ROLES_DEBUG_OK routes=' + router.routes().length);
