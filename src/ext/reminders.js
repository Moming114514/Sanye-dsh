// 提醒 / 告警 / 日报：从 bridge 内联块迁出（M2 第十一步）
import { dueReminders, markReminded, lastEventAgo, alertState, setAlert, reportState, markReported, fmtReport } from '../next-lib.js';

export function createReminders({ getCfg, log, sendToQQ, readStudyState, isConnected, isQuietHour, tookRestartMark, tokenGuardDowngrade }) {
  async function reminderTick() {
    try {
      const cfg = getCfg();
      if (cfg.socialV2?.reminders?.enabled === false) return;
      const due = dueReminders();
      if (!due.length) return;
      const owner = cfg.ownerQQ;
      if (!owner) return;
      const take = due.slice(0, 3);
      for (const it of take) {
        await sendToQQ('private:' + owner, '⏰ 提醒你：' + it.text);
        log('[提醒] 已发出：' + it.text);
      }
      markReminded(take.map((x) => x.id));
    } catch {}
  }

  async function alertTick() {
    try {
      const cfg = getCfg();
      const c = cfg.socialV2?.alerts ?? {};
      if (c.enabled === false) return;
      const gapMs = (Number(c.gapMin) || 25) * 60000;
      const ago = lastEventAgo();
      if (ago < 0 || ago < gapMs) return;
      const st = alertState();
      if (st.alertedAt && Date.now() - st.alertedAt < (Number(c.cooldownMin) || 60) * 60000) return;
      const owner = cfg.ownerQQ;
      if (!owner) return;
      // QUIET_PATCH：链路真断才提醒；夜里和主动重启时不打扰
      if (isConnected() === true || isQuietHour() || tookRestartMark()) {
        log('[告警] 静默跳过（连接正常/夜间/主动重启），事件中断 ' + Math.round(ago / 60000) + ' 分钟');
        setAlert({ alertedAt: Date.now() });
        return;
      }
      await sendToQQ('private:' + owner, '我这边已经 ' + Math.round(ago / 60000) + ' 分钟没收到消息了，可能断了，我在自己恢复。');
      setAlert({ alertedAt: Date.now() });
      log('[告警] 事件中断 ' + Math.round(ago / 60000) + ' 分钟');
    } catch {}
  }

  async function reportTick() {
    try {
      const cfg = getCfg();
      const rc = cfg.socialV2?.report ?? {};
      if (rc.enabled === false) return;
      const now = new Date();
      const target = (Number(rc.hour ?? 23)) * 60 + Number(rc.minute ?? 30);
      if (now.getHours() * 60 + now.getMinutes() < target) return;
      const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      if (reportState().day === day) return;
      const owner = cfg.ownerQQ;
      if (!owner) return;
      const info = tokenGuardDowngrade();
      let study = '';
      try {
        const st = readStudyState();
        if (st && st.count) study = String(st.count) + ' 条' + (st.lastBvid ? '（' + st.lastBvid + '）' : '');
      } catch {}
      const text = fmtReport({ day, cost: Number(info.cost || 0), cap: info.cap, study });
      await sendToQQ('private:' + owner, text);
      markReported(day);
      log('[日报] 已发送');
    } catch {}
  }

  return { reminderTick, alertTick, reportTick };
}

// manifest：见 docs/EXT-MANIFEST.md（声明用，不改变任何调用路径；本模块未注册进 EXTENSIONS，由 bridge 直接调用）
export const manifest = { id: 'reminders',
  layer: '运维', title: '提醒与汇报', kind: 'tool', enabledByDefault: true, hot: false, hooks: [], config: ['socialV2.reminders', 'socialV2.alerts', 'socialV2.report', 'ownerQQ'], stateFiles: [] };
