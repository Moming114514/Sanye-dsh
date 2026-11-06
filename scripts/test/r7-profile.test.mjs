import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfile } from '../../src/ext/profile.js';
import { createProfileOps } from '../../src/ext/profile-ops.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r7p-'));
const sent = [];
const logs = [];
const calls = [];
const cfg = { ownerQQ: '999' };
const sendToQQ = async (k, m) => { sent.push([k, m]); };
const profile = createProfile({ getCfg: () => cfg, log: (m) => logs.push(m), stateDir: dir, sendToQQ });
const ops = createProfileOps({
  log: (m) => logs.push(m),
  sendToQQ,
  appendActivity: () => {},
  getBot: () => ({ request: async (action, params) => { calls.push([action, params]); } }),
  profile,
  stickerTempPath: (_b, mime) => '/tmp/stub.' + (mime === 'image/png' ? 'png' : 'jpg'),
  safeFetchBuffer: async () => ({ buffer: Buffer.from('x') }),
  maxMediaBytes: 8 * 1024 * 1024,
  mimeFromUrl: () => 'image/jpeg',
});

const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };

// 1) 头像来源：base64 与 URL 都落成文件路径
assert((await ops.resolveAvatarFile('base64://' + Buffer.from('png').toString('base64'))) === '/tmp/stub.png', 'base64 → png');
assert((await ops.resolveAvatarFile('https://example.com/a.png')) === '/tmp/stub.jpg', 'url → fetched file');

// 2) 好友列表：空态与有条目
await ops.handleFriendList('private:999');
assert(String(sent.at(-1)[1]).includes('没有待处理'), 'empty list');
profile.writeFriendReqs([{ flag: 'f1', userId: '10086', nickname: '小明', comment: '你好', at: Date.now() }]);
await ops.handleFriendList('private:999');
assert(String(sent.at(-1)[1]).includes('待处理的好友申请（1 条）'), 'list count');
assert(String(sent.at(-1)[1]).includes('小明(10086)'), 'list shape');

// 3) 同意好友：flag 原样透传、列表移除
await ops.handleFriendDecision('private:999', true, '/同意好友 10086');
assert(calls.at(-1)[0] === 'set_friend_add_request', 'friends action');
assert(calls.at(-1)[1].flag === 'f1' && calls.at(-1)[1].approve === true, 'flag + approve');
assert(profile.readFriendReqs().length === 0, 'list cleared');
assert(String(sent.at(-1)[1]).includes('同意了'), 'agree reply');

// 4) 头像确认：set_qq_avatar file 原样、待确认清空
profile.writeAvatarPend({ file: '/tmp/avatar.png', at: Date.now() });
await ops.handleAvatarDecision('private:999', true);
assert(calls.at(-1)[0] === 'set_qq_avatar' && calls.at(-1)[1].file === '/tmp/avatar.png', 'avatar file');
assert(profile.readAvatarPend() === null, 'avatar cleared');
assert(String(sent.at(-1)[1]).includes('换好了'), 'avatar reply');

// 5) 收到好友申请：字段形状
ops.onFriendRequest({ flag: 'f2', user_id: '20000', nickname: '阿花', comment: 'hi' });
const list = profile.readFriendReqs();
assert(list.length === 1 && list[0].flag === 'f2' && list[0].userId === '20000' && list[0].nickname === '阿花', 'request shape');

console.log('R7_PROFILE_OK');
