# 升级上游（UPGRADE）

surfcore 上游是 `Mieksido/surfcore`。我们是它的个人魔改版：功能进了 `src/ext/`，但 `src/bridge.js` 里仍有约 70 处策略层补丁。

## 一句话流程

```bash
node scripts/upgrade.mjs v0.8.2   # 在 /tmp 里准备合并，不动线上目录
# 解决冲突 → node scripts/verify.mjs → 重启桥接验收 → 合回 main
```

## 为什么不在服务器直接拉 GitHub

服务器出网被墙（`curl https://github.com` 超时、`git ls-remote` 挂死），只有 `gh-proxy.com` 能下。所以：

- **取上游**：`scripts/upgrade.mjs` 里用 `curl https://gh-proxy.com/https://github.com/Mieksido/surfcore/archive/refs/tags/<tag>.tar.gz`。
- **推 GitHub**：服务器 `git bundle create` → 拉回本机 → `git clone --bare` → `git push`（bundle clone 会把 origin 指向 bundle，记得 `git remote set-url`）。

## 合并取舍规则

| 位置 | 策略 |
| --- | --- |
| `src/ext/**` | **永远保留我们的版本**（上游不认识这些文件，冲突说明上游新增了同名文件，逐行对） |
| `src/bridge.js` 的 `_PATCH` 标记处 | 保留本地实现；若上游改了同一段，先看上游意图再决定合或弃 |
| `src/persona-*`、`src/memory-card.js`、`src/question-answers.js` | 我们改过口径（人称、语气层、记忆预算），冲突时保留我们的人话，但吸收上游的新字段 |
| `scripts/`、`docs/` | 优先跟上游；我们的 `snapshot.mjs`、`verify.mjs`、`upgrade.mjs` 保留 |
| `config.json` | **不要提交线上配置**（含 token），上游的 `config.example.json` 可以跟 |

判断标准只有一条：**升级后三份提示词和 49 个 MCP 工具的行为要和升级前一致**，除非你确定要改行为。不一致就回滚这一段。

## 验收顺序（缺一不可）

1. `node --check src/bridge.js`（以及改动到的 ext 文件）
2. `node scripts/verify.mjs` —— 语法 + 单测 + 快照 diff + 五个接口探活
3. 重启桥接：`bash scripts/restart-bridge.sh`，看 `/var/log/surfcore-bridge.log` 有没有 `ReferenceError` / `TypeError`
4. 手动发一条私聊，确认她回得动、工具能发出去
5. `git log --oneline` 记下这次合并的 commit，写进 `state/RESUME.md`

## 回滚

```bash
cd /home/dsh/apps/surfcore
git log --oneline | head          # 找到升级前的 commit
git checkout <commit> -- src/     # 只回滚代码
bash scripts/restart-bridge.sh
```

备份习惯：动 `bridge.js` 前 `cp src/bridge.js /tmp/bridge.js.bak.<批次>`；大树升级前 `tar czf /home/dsh/backups/surfcore-live-<时间>.tar.gz .`（含 state）。

## 已知需要复查的补丁

升级后 `grep -o '[A-Z0-9_]*_PATCH' src/bridge.js | sort -u` 对照这份清单，少了的要补回来：

- `TONE_PATCH`（`src/character-persona.js`：语气层分支，0.8.1 上游漏了）
- `MEMCARD_ALIGN_PATCH`（记忆卡预算 2800）
- `RELATEDMEM_*`、`PROMISE_*`、`STYLE_*`、`OWNERONLY_GATE_PATCH`、`PRIVATEONLY_PATCH`
- `QUIET_PATCH`（重启/断线静默）、`CACHEORDER_PATCH`（提示词顺序）
- `WALLET_PATCH`（80% 钱包提醒）、`MID_FALLBACK_PATCH`（B 站 mid 回退）
