#!/usr/bin/env node
// scripts/upgrade.mjs —— 把上游新版本合并进来，但不在线上目录里动手
//
//   node scripts/upgrade.mjs v0.8.2
//
// 做的事（全部在 /tmp 的 worktree 里，线上目录不动）：
//   1. 检查线上 git 是否干净
//   2. 经 gh-proxy 下载上游 tag 的 tarball（服务器直连 GitHub 不通）
//   3. 建临时 worktree + 分支 upgrade/<tag>，把上游文件覆盖上去，提交成 "upstream: <tag>"
//   4. 把我们 main 合并进来，列出冲突文件
//   5. 打印「我们这边有哪些补丁标记」清单，提醒人工复查
//
// 之后你自己：解决冲突 → 跑 `node scripts/verify.mjs` → 重启桥接验证 → 
//  `git checkout main && git merge upgrade/<tag>`
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TAG = process.argv[2];
if (!TAG || !/^v?\d/.test(TAG)) {
  console.error('用法：node scripts/upgrade.mjs v0.8.2');
  process.exit(2);
}

const ROOT = process.cwd();
const UP = `/tmp/up-${TAG}`;
const TGZ = `/tmp/up-${TAG}.tgz`;
const WT = `/tmp/mg-${TAG}`;
const BRANCH = `upgrade/${TAG}`;
const PROXY = 'https://gh-proxy.com';
const REPO = 'Mieksido/surfcore';

const run = (cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { code: r.status ?? -1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const die = (msg) => { console.error('✗ ' + msg); process.exit(1); };
const info = (msg) => console.log('· ' + msg);

// 1) 干净检查
{
  const r = run('git', ['status', '--porcelain']);
  if (r.code !== 0) die('这里不是 git 仓库');
  if (r.out) die(`工作区不干净，先提交或 stash：\n${r.out}`);
  info('git 工作区干净');
}

// 2) 下载
{
  info(`下载 ${TAG} …`);
  const url = `${PROXY}/https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz`;
  const r = run('curl', ['-fsSL', '--max-time', '180', '-o', TGZ, url]);
  if (r.code !== 0) die(`下载失败（${r.err || r.code}）。可换代理：https://ghproxy.net/https://github.com/...`);
  info(`已下载 ${(fs.statSync(TGZ).size / 1e6).toFixed(1)} MB`);
}

// 3) 解包
{
  fs.rmSync(UP, { recursive: true, force: true });
  fs.mkdirSync(UP, { recursive: true });
  const r = run('tar', ['-xzf', TGZ, '-C', UP, '--strip-components=1']);
  if (r.code !== 0) die('解包失败：' + r.err);
  info(`已解包到 ${UP}`);
}

// 4) 临时 worktree
{
  run('git', ['worktree', 'remove', '--force', WT]);
  fs.rmSync(WT, { recursive: true, force: true });
  run('git', ['branch', '-D', BRANCH]);
  const r = run('git', ['worktree', 'add', '-b', BRANCH, WT, 'main']);
  if (r.code !== 0) die('建 worktree 失败：' + r.err);
  info(`worktree 就绪：${WT}（分支 ${BRANCH}）`);
}

// 5) 覆盖上游文件并提交
{
  const r = run('rsync', ['-a', '--delete',
    '--exclude', '.git', '--exclude', 'node_modules', '--exclude', 'state',
    '--exclude', 'logs', '--exclude', 'backups', '--exclude', '.cache',
    UP + '/', WT + '/']);
  if (r.code !== 0) die('rsync 失败：' + r.err);
  run('git', ['add', '-A'], WT);
  const c = run('git', ['-c', 'user.name=upgrade', '-c', 'user.email=upgrade@local',
    'commit', '-q', '-m', `upstream: ${REPO} ${TAG}`], WT);
  if (c.code !== 0) info('（上游与本地上一次基线相同，跳过提交）');
  else info(`已提交 upstream: ${TAG}`);
}

// 6) 合并我们的 main
{
  const r = run('git', ['-c', 'user.name=upgrade', '-c', 'user.email=upgrade@local', 'merge', '--no-edit', 'main'], WT);
  const conflicts = run('git', ['diff', '--name-only', '--diff-filter=U'], WT).out.split('\n').filter(Boolean);
  console.log('');
  if (r.code === 0) {
    console.log('✅ 自动合并成功，没有冲突');
  } else {
    console.log(`⚠️  有 ${conflicts.length} 个文件冲突：`);
    for (const f of conflicts) console.log('   - ' + f);
  }
}

// 7) 补丁标记清单（提醒哪些本地改造必须保住）
{
  const ours = run('git', ['show', 'main:src/bridge.js']).out;
  const markers = [...new Set((ours.match(/[A-Z0-9_]+_PATCH/g) || []))].sort();
  console.log('');
  console.log(`我们这边的补丁标记（${markers.length} 种）：`);
  console.log('   ' + markers.join(' '));
  console.log('');
  console.log('下一步：');
  console.log(`   1. cd ${WT} && git status            # 看冲突`);
  console.log('   2. 解决冲突：功能层尽量跟上游走，我们的标记处保持本地实现');
  console.log('   3. node scripts/verify.mjs          # 语法 + 单测 + 快照 + 接口');
  console.log('   4. 重启桥接后手动发一条私聊验收');
  console.log(`   5. git checkout main && git merge ${BRANCH} && git worktree remove ${WT}`);
}
