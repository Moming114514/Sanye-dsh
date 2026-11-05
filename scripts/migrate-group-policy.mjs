// 迁移：把 5 个旧来源合成 state/group-policy.json（P2-1）。
// 用法：
//   node scripts/migrate-group-policy.mjs --dry-run   # 只打印差异表，不写任何文件
//   node scripts/migrate-group-policy.mjs             # 备份旧文件后写入策略
// 冲突规则：silent > mention > normal；不在白名单的群 present=false。
import fs from 'node:fs';
import path from 'node:path';
import { buildFromLegacy, POLICY_FILE } from '../src/ext/group-policy.js';

const HOME = process.env.HOME || '/home/dsh';
const ROOT = process.env.SURFCORE_DIR || path.join(HOME, 'apps', 'surfcore');
const STATE = process.env.SURFCORE_STATE_DIR || path.join(HOME, '.dsh', 'surfcore', 'state');
const BACKUP = path.join(STATE, 'group-policy-backup');
const DRY = process.argv.includes('--dry-run');

const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const cfg = readJson(path.join(ROOT, 'config.json'), {});
const policy = buildFromLegacy(cfg);

const gids = Object.keys(policy.groups).sort();
const rows = gids.map((g) => {
  const v = policy.groups[g];
  const rate = v.rate.level === 'custom' ? `custom ${v.rate.minGapMin}/${v.rate.perDay}` : `${v.rate.level} ${v.rate.minGapMin || '-'}/${v.rate.perDay || '-'}`;
  return {
    gid: g,
    present: v.present ? 'YES' : 'no',
    mode: v.mode,
    rate,
    replyOnly: v.replyOnly.length ? v.replyOnly.join(',') : '-',
    sample: v.sample ? `${v.sample}%` : '-',
  };
});

const w = (s, n) => {
  let len = 0;
  for (const ch of s) len += ch.charCodeAt(0) > 255 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - len));
};
console.log('群号        present  mode      rate            replyOnly         sample');
console.log('-'.repeat(84));
for (const r of rows) console.log(w(r.gid, 12) + w(r.present, 9) + w(r.mode, 10) + w(r.rate, 16) + w(r.replyOnly, 18) + r.sample);
console.log('-'.repeat(84));
console.log(`共 ${rows.length} 群 / ${Object.keys(policy.private).length} 私聊`);

if (DRY) {
  const cur = readJson(POLICY_FILE, null);
  console.log(cur ? `已有 ${POLICY_FILE}（${Object.keys(cur.groups || {}).length} 群），--dry-run 不覆盖` : `尚未生成 ${POLICY_FILE}`);
  process.exit(0);
}

fs.mkdirSync(BACKUP, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const name of ['muted-keys.json', 'learn-mode.json', 'group-rate.json']) {
  const src = path.join(STATE, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BACKUP, `${name}.${stamp}.bak`));
}
const cfgBak = path.join(BACKUP, `config.json.${stamp}.bak`);
fs.copyFileSync(path.join(ROOT, 'config.json'), cfgBak);

const tmp = POLICY_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(policy, null, 1));
fs.renameSync(tmp, POLICY_FILE);
console.log(`已写入 ${POLICY_FILE}`);
console.log(`旧文件备份在 ${BACKUP}`);
