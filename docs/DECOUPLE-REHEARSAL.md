# 脱壳演练（Portable Rehearsal）

> 目标：证明「她」可以从这台机器完整打包、换一台机器还原，而不带走运行痕迹。
> 演练时间：2026-11-05 22:19–22:21（Asia/Shanghai）。全程只读源码/状态，写操作只落在 `/tmp` 与 `/home/dsh/backups/portable/`。

## 一、命令

```bash
# 1. 先看会打包什么（不写文件）
node scripts/portable-export.mjs --dry-run

# 2. 真导出（输出 tar.gz + 同名 manifest.json）
node scripts/portable-export.mjs

# 3. 校验（解到 /tmp/portable-verify-<pid>，按「新家」结构还原）
node scripts/portable-verify.mjs /home/dsh/backups/portable/sanye-202611052220.tar.gz
```

## 二、本次包

| 项 | 值 |
| --- | --- |
| 包路径 | `/home/dsh/backups/portable/sanye-202611052220.tar.gz` |
| 包大小 | 329 KB（源 2.19 MB，gzip 后 0.32 MB） |
| 文件数 | 35 |
| 顶层目录 | `characters/` 13 个（1.84 MB）、`state/` 22 个（394 KB） |
| manifest | 同名 `.manifest.json`：版本、文件数、总字节、每个顶层目录的 sha256、导出时间 |

> 为什么不是文档里预估的 5~30MB：`characters/` 里 66 个 `.bak*`、`memory-card-full.jsonl` 之外的派生文件，以及 `state/media-cache/`（286MB）、日志、token ledger、session 数据全部按「运行痕迹」排除。留下的是「她」本身：人格四层 + 场景 + 记忆卡 + 长期状态。

## 三、校验结果（`portable-verify.mjs`，退出码 0）

| 资产 | 文件 | 可解析 | 条数/字数 | 结论 |
| --- | --- | --- | --- | --- |
| 人格核心 | characters/char-mvugwthv/persona.md | ✔ | 1053 字 | OK |
| 语气层 | characters/char-mvugwthv/persona.tone.md | ✔ | 1933 字 | OK |
| 场景 | characters/char-mvugwthv/persona.scenes | ✔ | 4 个 | OK |
| 记忆卡 | characters/char-mvugwthv/memory/memory-card.json | ✔ | 600 条 | OK |
| 心情 | state/mood.json | ✔ | 6 键 | OK |
| 学样 | state/style-samples.json | ✔ | 9 条 | OK |
| 欠事 | state/loops.json | ✔ | 10 条 | OK |
| 印象 | state/impressions.json | ✔ | 2 条 | OK |
| 技术笔记 | state/tech-notes.json | ✔ | 1 条 | OK |
| 群策略 | state/group-policy.json | ✔ | 4+4 条 | OK |

- JSON 全量可解析：✔
- 绝对路径 `/home/dsh` 命中：`characters/current.json`（字段 `dir` 存的是本机绝对路径；换机器后改这一行，或让桥接按 `characters/<id>/` 重建）
- 解包结构：`/tmp/portable-verify-<pid>/` 下就是 `characters/…`、`state/…`，等价 `~/.dsh/surfcore/` 的相对路径，可直接搬进新家。

## 四、可迁移 vs 不可迁移

**可迁移（包里就有）**
1. 人格四层：`persona.md` / `persona.tone.md` / `persona.daily.md` / `character.json`
2. 场景：`persona.scenes/*.md`（群聊 / 私聊 / B 站 / 宠物）
3. 记忆卡：`memory/memory-card.json`（600 条）+ `self.md` / `diary.md`
4. 心情：`state/mood.json`
5. 学样：`state/style-samples.json(.md)` / `state/style-prefs.md`
6. 欠事与人物：`state/loops.json` / `state/people.json` / `state/alerts.json`
7. 印象与技术笔记：`state/impressions.json` / `state/tech-notes.json`
8. 表情与群策略：`state/bot-ids.json` / `state/group-policy.json` / `state/muted-keys.json` / `state/learn-mode.json` / `state/group-rate.json`
9. 其它长期状态：`state/owner-teach.json` / `state/safe-talk.json` / `state/economy.json` / `state/human-marks.json`

**不可迁移（换机器要重做）**
1. NapCat 登录态：扫码登录、`token`、QQ 客户端环境
2. `config.json` 里的密钥/令牌：`consoleToken`、`ownerQQ`、各 MCP/B 站令牌、代理
3. 桥接二进制与 systemd 单元：`surfcore-bridge.service`、node 路径、`WorkingDirectory`
4. 面板服务：`/opt/her-console`（含 `token.txt`）、`her-console.service`
5. 运行痕迹：`media-cache/`、`*.log`、`decision/*.jsonl`、`snap/`、`session`、token ledger
6. `characters/current.json` 的 `dir` 绝对路径（换机器改指到新路径）

## 五、还原步骤（新机器）

1. `tar -xzf sanye-<stamp>.tar.gz -C ~/.dsh/surfcore/`
2. 改 `characters/current.json` 的 `dir` 为新机器上的 `~/.dsh/surfcore/characters/<id>`
3. 重新写 `config.json`（密钥/令牌），按需重装 systemd 单元与面板
4. `node scripts/portable-verify.mjs <包>` 在新机器上再跑一次，全 OK 再启动桥接

## 六、附带修复

- `/api/names`：不传 `groups/users` 时直接返回 `state/names.json` 缓存里的全部名字（`cached:true`），面板决策页/群名不再显示成「群 123」。桥接改动需下次重启生效；面板侧 `/api/names` 代理本身已能从本地缓存读到名字。
