// R7: 好友申请 / 资料 / 头像的操作簇，从 bridge main() 搬出。
// 只做「命令分支与 request 事件的处理」，状态存取仍走 src/ext/profile.js。
import fs from 'node:fs';

export function createProfileOps({
  log,
  sendToQQ,
  appendActivity,
  getBot,
  profile,
  stickerTempPath,
  safeFetchBuffer,
  maxMediaBytes,
  mimeFromUrl,
}) {
  const { readFriendReqs, writeFriendReqs, readAvatarPend, writeAvatarPend, describeFriendReq, notifyFriendBatched } = profile;

  // 把 base64 / URL 落成「容器内可读」的绝对路径（NapCat 只认它能 stat 到的文件）
  async function resolveAvatarFile(src) {
    const s = String(src ?? '').trim();
    if (!s) throw new Error('头像来源为空');
    if (s.startsWith('base64://')) {
      const buf = Buffer.from(s.slice('base64://'.length), 'base64');
      return stickerTempPath(buf, 'image/png');
    }
    if (/^https?:\/\//i.test(s)) {
      const fetched = await safeFetchBuffer(s, maxMediaBytes);
      return stickerTempPath(fetched.buffer, mimeFromUrl(s));
    }
    return s;
  }

  async function handleFriendList(key) {
    const list = readFriendReqs();
    if (!list.length) {
      await sendToQQ(key, '现在没有待处理的好友申请。');
      return;
    }
    const lines = list.map((r, i) => `${i + 1}. ${describeFriendReq(r)}`).join('\n');
    await sendToQQ(key, `待处理的好友申请（${list.length} 条）：\n${lines}\n同意发 /同意好友 QQ号，拒绝发 /拒绝好友 QQ号。`);
  }

  async function handleFriendDecision(key, approve, cmdLine) {
    const arg = String(cmdLine ?? '').trim().replace(/^\/(同意|拒绝)好友\s*/, '').trim();
    const list = readFriendReqs();
    const item = list.find((r) => String(r.userId) === arg) || (list.length === 1 ? list[0] : null);
    if (!item) {
      await sendToQQ(key, arg ? `没找到 ${arg} 的好友申请。发 /好友 看看。` : '没找到好友申请。发 /好友 看看。');
      return;
    }
    try {
      await getBot().request('set_friend_add_request', { flag: item.flag, approve });
      writeFriendReqs(list.filter((r) => String(r.flag) !== String(item.flag)));
      appendActivity(`${key} [好友] 管理员${approve ? '同意' : '拒绝'}了 ${item.userId}`);
      await sendToQQ(key, approve ? `同意了，她已经是 ${item.userId} 的好友。` : `好，拒绝了 ${item.userId}。`);
    } catch (error) {
      await sendToQQ(key, `处理失败了：${error?.message ?? error}`);
    }
  }

  async function handleAvatarDecision(key, approve) {
    const pend = readAvatarPend();
    if (!pend) {
      await sendToQQ(key, '现在没有等她换的头像。');
      return;
    }
    if (!approve) {
      writeAvatarPend(null);
      await sendToQQ(key, '好，这次不换。');
      return;
    }
    try {
      await getBot().request('set_qq_avatar', { file: pend.file });
      writeAvatarPend(null);
      appendActivity(`${key} [头像] 管理员批准了换头像`);
      await sendToQQ(key, '换好了。');
    } catch (error) {
      await sendToQQ(key, `换头像失败了：${error?.message ?? error}`);
    }
  }

  // 好友/群申请事件：之前这里完全没人处理 request 事件，别人加她会被静默丢弃。
  function onFriendRequest(event) {
    try {
      const flag = String(event.flag ?? '');
      const userId = String(event.user_id ?? '');
      if (!flag || !userId) return;
      const req = {
        flag,
        userId,
        nickname: String(event.nickname ?? event.comment ?? '').replace(/^.*?昵称[:：]\s*/, ''),
        comment: String(event.comment ?? ''),
        at: Date.now(),
      };
      const list = readFriendReqs().filter((r) => String(r.userId) !== userId);
      list.push(req);
      writeFriendReqs(list);
      appendActivity(`[好友] 收到好友申请：${describeFriendReq(req)}`);
      log(`[好友] 收到好友申请 ${userId} flag=${flag}`);
      notifyFriendBatched();
    } catch (error) {
      log('[好友] 处理好友申请异常：' + (error?.message ?? error));
    }
  }

  return {
    resolveAvatarFile,
    handleFriendList,
    handleFriendDecision,
    handleAvatarDecision,
    onFriendRequest,
    // 兼容 API 路由里直接用到的两个 setter
    readFriendReqs,
    writeFriendReqs,
    readAvatarPend,
    writeAvatarPend,
    describeFriendReq,
  };
}

export const manifest = {
  id: 'profile-ops',
  layer: '判断',
  title: '资料 / 头像 / 好友操作',
  kind: 'tool',
  enabledByDefault: true,
  hot: false,
  hooks: [],
  config: ['socialV2.profile', 'ownerQQ'],
  stateFiles: ['friend-requests.json', 'avatar-pending.json', 'friend-notify.json'],
};