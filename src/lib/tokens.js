// R2：从 src/bridge.js 抽出的 Token 账本/额度守卫（逻辑逐行等价，仅把闭包依赖显式化）。
// 不 import bridge、不读全局变量；state 路径由 stateDir / surfcoreDir 拼。
import fs from 'node:fs';
import path from 'node:path';
import { blockMessage, evaluateBudget, localDayKey, readBudget, readDailyUsage } from '../token-budget.js';
import { evaluateOutbound, evaluateWakeBudget, localDayStart } from '../token-guard.js';

export function createTokenGuard({
  cfg,
  stateDir,
  surfcoreDir = stateDir,
  log = () => {},
  now = () => Date.now(),
  sendToQQ = null,
  refreshCfg = null,
  reportLimitEvent = null,
  ledger = null,
} = {}) {
  const STATE_DIR = stateDir;
  const SURFCORE_DIR = surfcoreDir;

  function tokenGuardCfg() {
    const g = cfg.socialV2?.tokenGuard;
    return g && typeof g === 'object' ? g : {};
  }

  // 花费降级：当日花费达到额度的一定比例后，群里自动降级成「只回 @」（等同高峰策略）。
  let guardCostCache = { at: 0, cost: 0 };
  function tokenGuardTodayCost() {
    if (typeof refreshCfg === 'function') refreshCfg('cost');
    if (now() - guardCostCache.at < 60000) return guardCostCache.cost;
    let cost = 0;
    try {
      const u = bridgeDailyUsage();
      cost = Number(u?.qq?.cost || 0) + Number(u?.bili?.cost || 0) + Number(u?.other?.cost || 0);
      if (!(cost > 0) && u?.total?.cost) cost = Number(u.total.cost) || 0;
    } catch (error) {
      log('[降级] 读取当日花费失败：' + (error && error.message ? error.message : error));
    }
    guardCostCache = { at: now(), cost };
    return cost;
  }
  // 降级当天私聊通知管理员一次（写 state/downgrade-notified.json，重启不重复）
  const DOWNGRADE_MARK_FILE = path.join(STATE_DIR, 'downgrade-notified.json');

  // BOOST_PATCH —— /加油 N：今天额外再加 N 元额度（只影响降级线，不落配置文件）
  const TOKEN_BOOST_FILE = path.join(SURFCORE_DIR, 'token-boost.json');
  function tokenBoostExtra() {
    try {
      const j = JSON.parse(fs.readFileSync(TOKEN_BOOST_FILE, 'utf8')) || {};
      const today = localDayKey(now());
      if (j.day !== today) return 0;
      const n = Number(j.extra);
      return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    } catch { return 0; }
  }
  function tokenBoostAdd(cny) {
    const day = localDayKey(now());
    let j = {};
    try { j = JSON.parse(fs.readFileSync(TOKEN_BOOST_FILE, 'utf8')) || {}; } catch {}
    const base = j.day === day && Number.isFinite(Number(j.extra)) ? Number(j.extra) : 0;
    const extra = Math.round((base + Number(cny)) * 100) / 100;
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(TOKEN_BOOST_FILE, JSON.stringify({ day, extra, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
    } catch (error) {
      log('[加油] 写入失败：' + (error && error.message ? error.message : error));
    }
    return extra;
  }
  let downgradeNotifiedDay = '';
  function notifyDowngradeOnce(info) {
    try {
      const day = localDayKey(now());
      let mark = {};
      try { mark = JSON.parse(fs.readFileSync(DOWNGRADE_MARK_FILE, 'utf8')) || {}; } catch {}
      if (downgradeNotifiedDay === day || mark.day === day) return;
      downgradeNotifiedDay = day;
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(DOWNGRADE_MARK_FILE, JSON.stringify({ day, at: new Date().toISOString() }) + '\n', 'utf8');
      const owner = cfg.ownerQQ;
      const gc0 = tokenGuardCfg();
      const notifyOwner = gc0.downgradeNotifyOwner !== false; // DG_NOTIFY_SWITCH
      if (!owner || !notifyOwner) { log('[降级] 已降级（不通知主人，开关关闭）'); } else {
      const text = '【省钱模式】今天已经花了 ¥' + Number(info.cost || 0).toFixed(2)
        + '（额度 ¥' + info.cap + '，到 ' + Math.round(info.ratio * 100) + '% 就降级）。'
        + '群里的消息我暂时只回 @ 了，私聊照常。想临时放开就发 /谷价。';
      if (typeof sendToQQ === 'function') void sendToQQ('private:' + owner, text).catch((e) => log('[降级] 通知失败：' + (e?.message ?? e)));
      log('[降级] 已私聊通知管理员：¥' + Number(info.cost || 0).toFixed(2) + ' / ¥' + info.cap);
      }
      /* QBW_GROUP_NOTICE —— 降级时在群里说一句，避免大家以为她突然不理人 */
      try {
        const gc = tokenGuardCfg();
        if (gc.downgradeGroupNotice !== false) {
          const groups = Array.isArray(cfg.allow?.groups) ? cfg.allow.groups.slice(0, 3) : [];
          const notice = String(gc.downgradeGroupNoticeText || '').trim()
            || '今天开销有点高，我先省着点说话啦，有事 @ 我就行。';
          for (const gid of groups) {
            const gkey = 'group:' + gid;
            if (typeof sendToQQ === 'function') void sendToQQ(gkey, notice).catch((e) => log('[降级] 群通知失败 ' + gkey + '：' + (e?.message ?? e)));
          }
          if (groups.length) log('[降级] 已在群里说了一句：' + groups.join(','));
        }
      } catch (e) { log('[降级] 群通知异常：' + (e?.message ?? e)); }
    } catch (error) {
      log('[降级] 通知异常：' + (error?.message ?? error));
    }
  }

  function tokenGuardDowngrade() {
    if (typeof refreshCfg === 'function') refreshCfg('downgrade');
    const g = tokenGuardCfg();
    if (g.enabled === false) return { on: false, cost: 0, cap: 0, ratio: 0 };
    const capRaw = Number(g.maxDailyCostCNY);
    const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : (capRaw === 0 ? 0 : 8);
    if (cap <= 0) return { on: false, cost: 0, cap: 0, ratio: 0 };
    const ratioRaw = Number(g.downgradeAtRatio);
    const ratio = Number.isFinite(ratioRaw) && ratioRaw > 0 && ratioRaw <= 1 ? ratioRaw : 0.5;
    const extra = tokenBoostExtra();
    const capEff = Math.round((cap + extra) * 100) / 100;
    const cost = tokenGuardTodayCost();
    return { on: cost >= capEff * ratio, cost, cap: capEff, baseCap: cap, extra, ratio };
  }

  // ── 每日 token 额度（2026-10-23 用户要求）────────────────────────────
  // 权威用量由插件用 session/event 采集并写 token-usage-daily.json（含 B站）；
  // 桥接只读快照，快照超过 10 分钟没更新才回落到自己的 tokenLedger。
  // 这样 QQ 的唤醒闸门也能看到「B站 今天花了多少」，总额度才是真的总额度。
  function bridgeBudgetLimits() {
    const g = tokenGuardCfg();
    const raw = g.maxDailyCostCNY;
    const n = Number(raw);
    // 没填过 → 默认 ¥8；明确 0 → 不限（尊重旧配置语义）。
    const cnyBase = raw === undefined || raw === null || !Number.isFinite(n) ? 8 : (n > 0 ? n : null);
    const cny = cnyBase == null ? null : Math.round((cnyBase + tokenBoostExtra()) * 100) / 100;
    return readBudget(SURFCORE_DIR, {
      qq: { cny, tokens: null },
      bili: { cny: null, tokens: null },
      other: { cny: null, tokens: null },
      total: { cny: null, tokens: null },
    });
  }

  function bridgeDailyUsage() {
    const day = localDayKey(now());
    const snapshot = readDailyUsage(SURFCORE_DIR, day);
    const fresh = snapshot.day === day && !snapshot.stale
      && snapshot.at > 0 && now() - snapshot.at < 10 * 60 * 1000;
    if (fresh) return { ...snapshot, source: snapshot.source ?? 'plugin' };
    let used = null;
    try {
      used = ledger ? ledger.dailyUsage({ since: localDayStart(now()) }) : null;
    } catch (error) {
      log(`[token-budget] 读取桥接账本失败：${String(error?.message ?? error).slice(0, 120)}`);
    }
    const qq = used?.qq ?? { cost: 0, tokens: 0 };
    const other = used?.other ?? { cost: 0, tokens: 0 };
    const bili = snapshot.day === day ? snapshot.bili : { cost: 0, tokens: 0 };
    return {
      day,
      at: snapshot.at,
      qq,
      bili,
      other,
      total: {
        cost: (qq.cost ?? 0) + (bili.cost ?? 0) + (other.cost ?? 0),
        tokens: (qq.tokens ?? 0) + (bili.tokens ?? 0) + (other.tokens ?? 0),
      },
      source: 'bridge-ledger',
      stale: true,
    };
  }

  let lastLearnerBudgetLogAt = 0;
  /** 黑话学习属于「其他」：总额或「其他」额度到顶就先不学，避免后台偷烧。 */
  function learnerBudgetBlock() {
    const usage = bridgeDailyUsage();
    const limits = bridgeBudgetLimits();
    const result = evaluateBudget(usage, limits, { scopes: ['other', 'total'] });
    if (!result.blocked) return null;
    if (now() - lastLearnerBudgetLogAt > 10 * 60 * 1000) {
      lastLearnerBudgetLogAt = now();
      log(`[token-budget] 黑话学习暂停：${blockMessage(result.hits, 'Token 额度')}`);
    }
    return result;
  }

  function tokenGuardWakeBlock(key, st, { direct = false } = {}) {
    const g = tokenGuardCfg();
    // 额度是独立的（设置页「Token 额度」），不随「Token 防爆破」总开关一起关掉。
    const usage = bridgeDailyUsage();
    const limits = bridgeBudgetLimits();
    const budget = evaluateBudget(usage, limits, { scopes: ['qq', 'total'] });
    if (budget.blocked) {
      return {
        error: blockMessage(budget.hits, 'Token 额度'),
        retryAfterMs: 0,
        reason: 'budget',
        hits: budget.hits,
        usage,
      };
    }
    if (g.enabled === false) return null;
    const r = evaluateWakeBudget({ key, wakeTimes: st?.wakeTimes, now: now(), guard: g, cost: null, direct });
    return r.blocked ? { error: r.error, retryAfterMs: r.retryAfterMs || 0, reason: r.reason } : null;
  }

  function tokenGuardSendBlock(key, st, count = 1) {
    const g = tokenGuardCfg();
    if (g.enabled === false) return null;
    const r = evaluateOutbound({ used: Number(st?.tokenTurnSent) || 0, count, guard: g });
    if (r.blocked) {
      const block = { error: r.error, reason: 'outbound', code: 'TOKEN_GUARD_SEND_LIMIT', setting: 'socialV2.tokenGuard.maxOutboundPerTurn', hint: '去 QQ → 高级设置 → Token 防爆破 → 调整每次醒来最多发送条数。' };
      if (typeof reportLimitEvent === 'function') reportLimitEvent(key, { ...block, ok: false, path: 'QQ → 高级设置 → Token 防爆破', current: Number(st?.tokenTurnSent) || 0, limit: g.maxOutboundPerTurn });
      return block;
    }
    // 先占额度：即使后续网络失败也不放开，防止失败重试刷 token。
    st.tokenTurnSent = r.next;
    return null;
  }

  function resetTokenTurn(st) {
    if (st && typeof st === 'object') st.tokenTurnSent = 0;
  }

  return {
    tokenGuardCfg,
    tokenGuardTodayCost,
    tokenBoostExtra,
    tokenBoostAdd,
    notifyDowngradeOnce,
    tokenGuardDowngrade,
    bridgeBudgetLimits,
    bridgeDailyUsage,
    learnerBudgetBlock,
    tokenGuardWakeBlock,
    tokenGuardSendBlock,
    resetTokenTurn,
  };
}
