// R7: B站同步的启动装配，从 bridge main() 搬出。
// 动态拉取/去重、每日分享、记忆刷新分别由 bili-dynamics.js / bili-share-scheduler.js /
// bili-memory.js 负责；这里只做「按 config.biliBridge 决定谁启动、群清单怎么落」。
import { createBiliDynamicsSync } from '../bili-dynamics.js';
import { createBiliShareScheduler } from '../bili-share-scheduler.js';

export function startBiliSync({
  cfg,
  log,
  platformStateDir,
  sendToQQ,
  deliverPrompt,
  memory,
  isSnowlumaReady,
  isDshReady,
  currentMode,
  sendBiliCard,
  isUnifiedEnabled,
  createDynamics = createBiliDynamicsSync,
  createShare = createBiliShareScheduler,
}) {
  let dynamics = null;
  let share = null;
  const groupList = (list) => (Array.isArray(list) ? list : [])
    .map((v) => String(v).trim())
    .filter((v) => /^\d+$/.test(v));

  if (!cfg.biliBridge?.enabled) return { dynamics, share };

  const shareGroups = groupList(cfg.biliBridge.share.groups.length ? cfg.biliBridge.share.groups : cfg.allow.groups);
  const dynamicsGroups = groupList(cfg.biliBridge.dynamics.groups.length ? cfg.biliBridge.dynamics.groups : cfg.allow.groups);

  if (cfg.biliBridge.memory.enabled) {
    void memory.refresh({ force: true });
    const t = setInterval(() => { void memory.refresh(); }, cfg.biliBridge.memory.refreshIntervalMs);
    t.unref?.();
  }
  if (cfg.biliBridge.dynamics.enabled && dynamicsGroups.length) {
    dynamics = createDynamics({
      stateDir: platformStateDir,
      log,
      sendToQQ,
      groups: dynamicsGroups,
      isReady: isSnowlumaReady,
      intervalMs: cfg.biliBridge.dynamics.pollIntervalMs,
      selfName: memory.selfName?.() ?? '',
    });
    dynamics.start();
  } else if (cfg.biliBridge.dynamics.enabled) {
    log('[B站动态] 没有白名单群，未启动');
  }
  if (cfg.biliBridge.share.enabled && shareGroups.length) {
    share = createShare({
      stateDir: platformStateDir,
      log,
      deliverPrompt,
      groups: shareGroups,
      memory,
      isReady: isDshReady,
      times: cfg.biliBridge.share.times,
      gapMs: cfg.biliBridge.share.gapMs,
      getMode: currentMode,
      sendCard: sendBiliCard,
      isEnabled: () => cfg.biliBridge?.enabled !== false && isUnifiedEnabled(),
    });
    share.start();
  } else if (cfg.biliBridge.share.enabled) {
    log('[B站分享] 没有白名单群，未启动');
  }
  return { dynamics, share };
}

export const manifest = {
  id: 'bili',
  layer: '感知',
  title: 'B站同步装配',
  kind: 'tool',
  enabledByDefault: true,
  hot: false,
  hooks: [],
  config: ['biliBridge'],
  stateFiles: [],
};