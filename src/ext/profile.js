// 好友申请 / 头像待确认的状态与通知（M2 第十六步从 bridge 的 PROFILE_PATCH 搬出）。
// 只做「存哪、怎么描述、什么时候打扰主人」，不含 QQ 调用；发请求/换头像由 bridge 的路由与命令执行。

import fs from 'node:fs';
import path from 'node:path';

export function createProfile({ getCfg, log, stateDir, sendToQQ }) {
  const FRIEND_REQ_FILE = path.join(stateDir, 'friend-requests.json');
  const AVATAR_PEND_FILE = path.join(stateDir, 'avatar-pending.json');
  const FRIEND_NOTIFY_FILE = path.join(stateDir, 'friend-notify.json');

  function readFriendReqs() {
    try {
      const o = JSON.parse(fs.readFileSync(FRIEND_REQ_FILE, 'utf8'));
      return Array.isArray(o) ? o : [];
    } catch {
      return [];
    }
  }

  function writeFriendReqs(list) {
    try {
      fs.writeFileSync(FRIEND_REQ_FILE, JSON.stringify(list.slice(-50), null, 2) + '\n', 'utf8');
    } catch (error) {
      log('[好友] 写申请列表失败：' + (error?.message ?? error));
    }
  }

  function readAvatarPend() {
    try {
      const o = JSON.parse(fs.readFileSync(AVATAR_PEND_FILE, 'utf8'));
      return o && typeof o === 'object' ? o : null;
    } catch {
      return null;
    }
  }

  function writeAvatarPend(obj) {
    try {
      if (!obj) {
        fs.rmSync(AVATAR_PEND_FILE, { force: true });
        return;
      }
      fs.writeFileSync(AVATAR_PEND_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    } catch (error) {
      log('[头像] 写待确认状态失败：' + (error?.message ?? error));
    }
  }

  function describeFriendReq(r) {
    const who = r.nickname ? `${r.nickname}(${r.userId})` : String(r.userId);
    const note = r.comment ? `，附言：${r.comment}` : '';
    return `${who}${note}`;
  }

  // FRIEND_BATCH_PATCH：好友申请太多时别一条一条轰炸主人。
  // 规则：冷却期内只发一条（默认 10 分钟），一天最多 8 条；待处理超过 3 条时只发汇总。
  function friendNotifyCfg() {
    const f = getCfg()?.socialV2?.friends ?? {};
    return {
      cooldownMs: Math.max(60000, Number(f.notifyCooldownMs) || 10 * 60 * 1000),
      maxPerDay: Math.max(1, Math.min(50, Number(f.notifyMaxPerDay) || 8)),
    };
  }

  function readFriendNotify() {
    try {
      const o = JSON.parse(fs.readFileSync(FRIEND_NOTIFY_FILE, 'utf8'));
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }

  function writeFriendNotify(o) {
    try {
      fs.writeFileSync(FRIEND_NOTIFY_FILE, JSON.stringify(o, null, 2) + '\n', 'utf8');
    } catch (error) {
      log('[好友] 写通知状态失败：' + (error?.message ?? error));
    }
  }

  function ymdOf(ts) {
    const d = new Date(ts);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  }

  function notifyFriendBatched() {
    const { cooldownMs, maxPerDay } = friendNotifyCfg();
    const today = ymdOf(Date.now());
    const st = readFriendNotify();
    const sent = st.date === today ? Number(st.sent) || 0 : 0;
    const lastAt = Number(st.lastAt) || 0;
    const pending = readFriendReqs();
    const now = Date.now();
    if (sent >= maxPerDay) {
      log(`[好友] 今天已通知 ${sent} 次，不再打扰主人（待处理 ${pending.length} 条）`);
      return;
    }
    if (now - lastAt < cooldownMs) {
      log(`[好友] 冷却中（还剩 ${Math.round((cooldownMs - (now - lastAt)) / 1000)}s），待处理 ${pending.length} 条，先不打扰`);
      return;
    }
    const ownQQ = String(getCfg()?.ownerQQ ?? '');
    if (!ownQQ) return;
    let msg;
    if (pending.length <= 3) {
      const lines = pending.map((r) => '· ' + describeFriendReq(r)).join('\n');
      msg = `【好友申请】\n${lines}\n同意发 /同意好友 QQ号，拒绝发 /拒绝好友 QQ号。`;
    } else {
      msg = `【好友申请】现在有 ${pending.length} 个人想加她，我不一条条问了。\n发 /好友 看整个列表，一次处理完；不想管就放着，会一直留着。`;
    }
    void sendToQQ(`private:${ownQQ}`, msg);
    writeFriendNotify({ date: today, sent: sent + 1, lastAt: now });
    log(`[好友] 已通知主人（第 ${sent + 1} 次/今日，待处理 ${pending.length} 条）`);
  }

  return { readFriendReqs, writeFriendReqs, readAvatarPend, writeAvatarPend, describeFriendReq, notifyFriendBatched };
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'profile',
  layer: '记忆', title: '档案与好友', kind: 'tool', enabledByDefault: true, hot: false, hooks: [], config: ['socialV2.profile'], stateFiles: ['friend-requests.json', 'avatar-pending.json', 'friend-notify.json'] };
