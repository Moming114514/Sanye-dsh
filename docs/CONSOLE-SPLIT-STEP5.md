# 控制台拆分第 5 步（R9-5）候选清单

> 只读盘点。规则：deps 只收进程级对象/纯函数；响应一律 `ctx.json`；注册期 `REQUIRED`；
> 原位留 `// moved to src/console/routes/<文件> (R9-5)`；每条加判空兜底。
> 当前 bridge 16,520 行；已搬 25 条（tokens/status 6、roles/debug 5、social-read 7、session-detail 7）。

## 建议本轮搬（7 条，全 GET，全无写）

| 路径 | 依赖（进程级） | 等价原调用 |
|---|---|---|
| `/api/whitelist` | `getCfg` | `cfg.allow` / `cfg.deny` / `cfg.ownerQQ` |
| `/api/security` | `getCfg`、`getStateDirHardened`、`stateDir`、`manualDirCommand` | `stateDirHardened`、`STATE_DIR` |
| `/api/socialV2/config` | `getCfg` | `cfg.socialV2` |
| `/api/socialV2/activity` | `getSocialV2Root` | `socialV2.paused` |
| `/api/socialV2/feedback` | `readFeedbackEntries` | `readFeedbackEntries()` |
| `/api/slang` | `getCfg`、`getSlangEntries`、`getSlangWritable` | `slangEntries`、`slangStoreWritable` |
| `/api/social` | `getCfg`、`getSocial` | `social.pendingSummaries` / `social.states` / `social.recentMessages` |

全部只读内存或只读文件；没有 `save*`、`writeJson`、`appendActivity`。

## 本轮不搬（副作用/依赖形态不适合）

| 路径 | 原因 |
|---|---|
| `/api/purpose/status` | `ensurePurposeDay()` 会改内存日切（副作用） |
| `/api/selfcheck` | spawn 子进程探端口（外部副作用） |
| `/api/socialV2/recent`、`/api/socialV2/unread` | 带 `x-agent-token` 时 `noteModelMessagesV2` 写 `readThroughSeq`，留到最后 |
| `/api/dsh/model` | 依赖 `fetchModelCatalog` + in-flight 缓存 + 错误去重三件状态，单独一组 |
| `/api/socialV2/style-list` | 由 `extDispatchRoute` 的扩展插件处理（不在 bridge 内联），不属本步 |
| `/api/debug/sticker-prune` | 默认会删文件（破坏性） |
| `/api/voice/packs*`、`/api/socialV2/sticker-list`、`/api/stickers`、`/api/images/message` | 走 bot / 网络 / 缓存写盘，下一组再评估 |

## 风险与回滚

- 依赖全是「读一个变量」级别，签名已逐条写明；注册处注释 `等价：原调用 …`。
- 回滚：`git revert <commit>`；bridge 内 7 个 marker 一次还原。
