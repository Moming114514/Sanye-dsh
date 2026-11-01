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
      targetQQ: String(c.targetQQ || '2000000000'),
      strictTarget: c.strictTarget !== false,
      perRound: Math.max(1, Math.min(4, Number(c.perRound) || 2)),
    };
  }

  function buildTask(gid, c) {
    return '【学说法】去烤研群（群 ' + gid + '）看看：先用 qq_read_group_recent 拉最近 40 条（只用这一个工具，别用 qq_get_recent / qq_get_unread / qq_get_prompt，跨群一定报凭证错误）。'
      + '**只学 QQ ' + c.targetQQ + '（群昵称以「亚托莉」开头）这一个人的说话方式**，群里其他人的话只当上下文，不许学。按 QQ 号认人最准；找不到他就只记通用框架，别硬认人。'
      + '只提炼「说话框架」：怎么起句、怎么接话、怎么求人、怎么拒绝、怎么吐槽但不伤人；**不要抄口头禅和梗**，也别整段模仿。'
      + '记 ' + c.perRound + ' 条，每条都要写框架层面的「好在哪」（例：先用一句软话把事说清，再给结论）。脏话、攻击、阴阳怪气、贬低别人一律不学。'
      + '记完不改人格卡、不在群里发言、不私聊汇报。';
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
      // 只要今天该轮的时间已过、且还没做，就补跑（重启/错过 10 分钟窗口都不丢）
      let round = -1;
      const minsNow = now.getHours() * 60 + now.getMinutes();
      (c.rounds || []).forEach((r, i) => {
        const at = Number(r?.[0]) * 60 + Number(r?.[1]);
        if (Number.isFinite(at) && minsNow >= at) round = i;
      });
      if (round < 0) return;
      const doneKey = day + '#' + round;
      if (st?.done && st.done[doneKey]) return;
      if (isPeakNow()) { log('[学样] 跳过（高峰时段）：' + doneKey); return; }
      if (tokenGuardDowngrade().on) { log('[学样] 跳过（省钱模式）：' + doneKey); return; }
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
