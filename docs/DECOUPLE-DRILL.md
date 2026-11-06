# 脱壳演练设计（C2）

> 只写设计，不改行为。目标：用现成的 `sanye-*.tar.gz` 包，在**一台干净机器/容器**里把「她」重建出来，证明她不只是活在这台服务器的进程里。

## 一、演练输入

| 输入 | 位置 | 说明 |
|---|---|---|
| portable 包 | `/home/dsh/backups/portable/sanye-202611052220.tar.gz`（329 KB，35 文件） | 含 `characters/`（四层人格 + 场景）、`memory/`、22 个 `state/*.json` |
| 包清单 | 同目录 `sanye-202611052220.manifest.json` | 文件数/字节数/顶层目录 sha256，用于核对完整性 |
| 重建脚本 | `sanye-archive/` 里的 `rebuild-prompt.mjs` | **当前不在 surfcore 仓库里**（演练第 0 步先把它拷进演练环境）；它只做「读 characters + state → 拼提示词」这一件事，不连 QQ |
| 目标版本 | 本机 `GET /api/socialV2/prompt?key=private:<ownerQQ>` 的结构快照 | 段落标题序列 + 字数，作为对照基准 |

> 如果 `rebuild-prompt.mjs` 找不到，退路是：在演练机起一个「干跑」bridge（见下），直接用 `/api/socialV2/prompt` 取结构——两条路的验收标准一样。

## 二、干净环境准备

1. **Node 22**（`node -v` 应 ≥ v22.0.0；服务器是 v22.23.4）。不需要 pnpm 之外的新依赖。
2. 一个空目录，例如 `/srv/drill`；`chown` 给执行用户。
3. 只装运行依赖：`npm ci --omit=dev`（或直接拷 `node_modules` 的 offline 缓存）。
4. **不装 NapCat、不配置 OneBot 连接**。

## 三、步骤

| # | 动作 | 期望 |
|---|---|---|
| 1 | 解包：`tar -xzf sanye-202611052220.tar.gz -C /srv/drill` | `characters/`、`memory/`、`state/` 三个目录出现 |
| 2 | 校验：`sha256sum` 对照 manifest 的每个顶层目录 | 三个目录哈希一致 |
| 3 | 配 `config.json`：拷服务器版本，**只改** `consolePort`（如 3199）、`onebot.ws`（如 `ws://127.0.0.1:3198`）、`ownerQQ` 保持原值 | 不引入新字段 |
| 4 | 起桥接（干跑）：`node src/bridge.js` | HTTP 先起来；日志会有「连不上 OneBot」之类告警，**属预期** |
| 5 | 取提示词：`GET /api/socialV2/prompt?key=private:<ownerQQ>&token=<consoleToken>` | 返回 200，含 `role.hint` |
| 6 | 抽结构：把 `role.hint` 按 `^【…】|^## ` 切段，记录「标题序列 + 每段字数 + 总字数」 | 与服务器版本同格式 |
| 7 | 对照：标题序列**逐项相等**；总字数差 **< 5%**；每段字数差记录成表 | 通过即证明人格/记忆主链可迁移 |
| 8 | 钩子实现检查：`docs/DECOUPLE.md` 列的 7 个钩子（`onGroupMessage`/`onPrivateMessage`/`afterSend`/`routes`/`wakeGate`/`promptBlock`/`stateKey`）在主仓 `src/ext/**` manifest 与 `src/ext/index.js` 导出里都能找到 | 7/7 存在 |
| 9 | 收尾：停进程、删 `/srv/drill`（或留作快照） | — |

## 四、验收标准

- [ ] 解包文件数 35、目录哈希与 manifest 一致；
- [ ] 段落标题序列**完全一致**（增/减一段即失败）；
- [ ] 总字数差 < 5%（人格卡或记忆注入顺序变动会超出）；
- [ ] 7 个钩子在代码里都有实现且能被 `extManifests()` 报出来；
- [ ] 演练机**没有**任何 NapCat/OneBot 连接记录，演练进程监听 3199 后即关闭。

## 五、为什么这次不连 QQ / 不接 NapCat

1. **抢号**：NapCat 以 QQ 登录态工作，同一账号第二个实例会把第一个顶下线，服务器上的她立刻掉线；
2. **不可撤回的外部动作**：一旦连上，任何唤醒/回复都可能真的发出去，和「验证她能不能重建」这个目标无关；
3. **成本**：真连上后会触发模型调用与提示词缓存重建（一次约 ¥0.1），演练应零成本；
4. **可重复**：干跑不依赖登录态，换机器/容器都能重复。

## 六、风险与回滚

| 风险 | 处置 |
|---|---|
| 演练机误连 3001 | 步骤 3 把 `onebot.ws` 指到不存在的端口；开跑前 `ss -lntp` 确认没有 3001 监听 |
| 提示词差 5% 以上 | 先比对 `characters/` 四层是否齐（缺 `persona.tone.md` 会明显变短），再比对 `state/memory-card.json` 条数 |
| 有人把演练配置写回生产 | 演练只在 `/srv/drill` 内操作；`config.json` 拷出来改端口，不反向覆盖 |
| `rebuild-prompt.mjs` 丢失 | 用第 4–6 步的干跑 bridge 兜底；两条路结构一致即算通过 |

## 七、现状

- portable 包已生成并验证过（`docs/DECOUPLE-REHEARSAL.md`）；
- `rebuild-prompt.mjs` 尚未进仓库，属于本演练的**第 0 步**（从 `sanye-archive/` 拷入），本轮只出设计、不搬运代码。
