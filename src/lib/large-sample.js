// 大群抽样接话（2026-11-07）：
// 大群不再无条件跳过「任意消息」，改为按概率抽样，但必须两道闸：
//   · 同群 3 分钟内最多 1 次
//   · 每天最多 60 次（东八区日切）
// 状态 ~/.dsh/surfcore/state/large-sample.json: { "group:<gid>": { lastAt, day, count } }
import fs from 'node:fs';
import path from 'node:path';

export const LARGE_SAMPLE_GAP_MS = 3 * 60 * 1000;
export const LARGE_SAMPLE_DAILY_CAP = 60;

function dayOf(ts) {
  return new Date(Number(ts) + 8 * 3600e3).toISOString().slice(0, 10);
}

export function createLargeSampler({ stateDir, now = () => Date.now(), log = () => {}, gapMs = LARGE_SAMPLE_GAP_MS, dailyCap = LARGE_SAMPLE_DAILY_CAP }) {
  const file = path.join(stateDir, 'large-sample.json');
  const read = () => {
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch { return {}; }
  };
  const write = (obj) => {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, file);
    } catch {}
  };
  function trySample(key, probability, rng = Math.random, at = now()) {
    const p = Number(probability);
    if (!(p > 0)) return false;
    const t = Number(at) || now();
    const day = dayOf(t);
    const all = read();
    const cur = all[key] && typeof all[key] === 'object' ? all[key] : {};
    let count = Number(cur.count) || 0;
    if (cur.day !== day) count = 0;
    if (count >= dailyCap) {
      log(`[抽样] 今日已达上限 ${key}`);
      return false;
    }
    const lastAt = Number(cur.lastAt) || 0;
    if (lastAt && t - lastAt < gapMs) return false;
    if (!(Number(rng()) < p)) return false;
    const next = { ...all, [key]: { lastAt: t, day, count: count + 1 } };
    write(next);
    log(`[抽样] 大群命中 ${key}（今日 ${count + 1}/${dailyCap}）`);
    return true;
  }
  return { trySample, file };
}
