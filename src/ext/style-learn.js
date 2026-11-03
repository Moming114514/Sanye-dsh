// 学说法：每天固定轮次让她去群里「学别人的说话框架」（只记句式，不改人格卡）。
// M2 第十三步从 bridge 内联迁出；bridge 只保留工厂调用与 setInterval。
import fs from 'node:fs';
import path from 'node:path';
import { styleTick } from '../style-lib.js';

/**
 * @param {{
 *   getCfg: () => any,
 *   log: (m: string) => void,
 *   deliverPrompt: (key: string, text: string, opts?: any) => void,
 *   stateDir: string,
 *   isPeakNow: (at?: Date) => boolean,
 *   tokenGuardDowngrade: () => { on: boolean },
 * }} deps
 */
// HOT_ENABLED_PATCH：enabled 每次从磁盘读，改开关不用重启桥接
function readEnabledFromDisk(fallback) {
  try {
    const fs = require('node:fs');
    const raw = fs.readFileSync(process.env.SURFCORE_CONFIG || '/home/dsh/apps/surfcore/config.json', 'utf8');
    const c = JSON.parse(raw);
    const v = c?.socialV2?.styleLearn?.enabled;
    return v === undefined ? fallback : !!v;
  } catch { return fallback; }
}

export function createStyleLearn({ getCfg, log, deliverPrompt, stateDir, isPeakNow, tokenGuardDowngrade }) {
  function cfgNow() {
    const cfg = getCfg() || {};
    const c = cfg.socialV2?.styleLearn ?? {};
    const groups = Array.isArray(c.groups) && c.groups.length
      ? c.groups.map(String)
      : (Array.isArray(cfg.allow?.groups) ? cfg.allow.groups.map(String) : []);
    const rounds = Array.isArray(c.rounds) && c.rounds.length
      ? c.rounds.map((r) => [Number(r?.[0]) || 0, Number(r?.[1]) || 0])
      : [[Number.isFinite(c.hour) ? c.hour : 20, Number.isFinite(c.minute) ? c.minute : 30]];
    return {
      enabled: c.enabled !== false,
      hour: Number.isFinite(c.hour) ? c.hour : 20,
      minute: Number.isFinite(c.minute) ? c.minute : 30,
      groups,
      rounds,
      targetQQ: String(c.targetQQ || ''),
      strictTarget: c.strictTarget !== false,
      perRound: Math.max(1, Math.min(4, Number(c.perRound) || 2)),
    };
  }

  function buildTask(gid, c) {
    return '【学说法】去烤研群（群 ' + gid + '）看看：调 qq_read_group_recent，参数 count=300、uin=' + String(c.targetQQ || '') + ' —— **只把她一个人的消息拉回来**，别人的不用看（只用这一个工具，别用 qq_get_recent / qq_get_unread / qq_get_prompt，跨群一定报凭证错误）。'
      + '**只学 QQ ' + c.targetQQ + '（群昵称以「亚托莉」开头）这一个人的说话方式**，群里其他人的话只当上下文，不许学。按 QQ 号认人最准；找不到他就只记通用框架，别硬认人。'
      + '只提炼「说话框架」：怎么起句、怎么接话、怎么求人、怎么拒绝、怎么吐槽但不伤人；**不要抄口头禅和梗**，也别整段模仿。'
      + '记 ' + c.perRound + ' 条，每条都要写框架层面的「好在哪」（例：先用一句软话把事说清，再给结论）。脏话、攻击、阴阳怪气、贬低别人一律不学。'
      /* STYLE_LEARN_UIN_HINT */
      + '调用 qq_style_note 时 uin 必须填 "' + String(c.targetQQ || '') + '"，from 必须填 "亚托莉"；填「群友」或留空会被直接拒收，别自己编名字。'      + '记完不改人格卡、不在群里发言、不私聊汇报。';
  }

  async function tick() {
    try {
      const cfg = getCfg() || {};
      const c = cfgNow();
      if (!c.enabled || !c.groups.length) return;
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      const stFile = path.join(stateDir, 'style-learn.json');
      let st = {};
      try { st = JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch {}
      // STYLE_NOW_PATCH：面板点「立刻学一轮」会写这个标记，2 分钟内有效
      let force = false;
      try {
        const nf = path.join(stateDir, 'style-learn-now.json');
        const n = JSON.parse(fs.readFileSync(nf, 'utf8'));
        force = Date.now() - (Number(n.at) || 0) < 120000;
        fs.unlinkSync(nf);
      } catch {}
      // 只要今天该轮的时间已过、且还没做，就补跑（重启/错过 10 分钟窗口都不丢）
      let round = -1;
      const minsNow = now.getHours() * 60 + now.getMinutes();
      (c.rounds || []).forEach((r, i) => {
        const at = Number(r?.[0]) * 60 + Number(r?.[1]);
        if (Number.isFinite(at) && minsNow >= at) round = i;
      });
      if (round < 0 && !force) return;
      const doneKey = day + '#' + round;
      if (st?.done && st.done[doneKey] && !force) return;
      if (isPeakNow() && !force) { log('[学样] 跳过（高峰时段）：' + doneKey); return; }
      if (c.exemptEconomy === false && tokenGuardDowngrade().on) { log('[学样] 跳过（省钱模式）：' + doneKey); return; } // STYLE_EXEMPT_PATCH：默认省钱模式也照学
      if (!cfg.ownerQQ) return;
      const gid = c.groups[Math.floor(Math.random() * c.groups.length)];
      const doneMap = Object.assign({}, st && st.done ? st.done : {}, { [doneKey]: true });
      fs.writeFileSync(stFile, JSON.stringify({ day, done: doneMap, lastRound: round, group: gid, at: new Date().toISOString() }));
      deliverPrompt('private:' + cfg.ownerQQ, buildTask(gid, c), { reason: 'style-learn', silentOutbound: true });
      log('[学样] 已排定今天的学习任务：' + gid);
    } catch (e) {
      log('[学样] 定时任务出错：' + String(e?.message || e));
    }
  }

  /** 候选样本过期清理（正式样本不动） */
  function tickCandidates() {
    try { styleTick(getCfg()); } catch {}
  }

  return { tick, tickCandidates, styleLearnCfgNow: cfgNow, buildTask };
}
