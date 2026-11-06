# 控制台拆分第 6 步（R9-6）候选清单

> 只读盘点。规则：deps 只收进程级对象/纯函数（带 getter）；响应 `ctx.json`；注册期 `REQUIRED`；
> 有副作用的保持**同样的调用次数**并在注释里写明；原位留 `// moved to src/console/routes/agent-read.js (R9-6)`。
> 当前 bridge 16,488 行；已搬 32 条。

## 本轮搬（7 条）

| 路径 | 方法 | 依赖（等价原调用） | 副作用 |
|---|---|---|---|
| `/api/socialV2/recent` | GET | `getSocialV2State(key)`、`noteModelMessagesV2(st,msgs)`、`readThroughSeqV2(st)` | 带 `x-agent-token` 时写 `readThroughSeq`（次数=1，同原实现） |
| `/api/socialV2/unread` | GET | 同上 + `stickerMatchFor(msgs)` | 同上（写 1 次 + 表情推荐） |
| `/api/socialV2/my-recent` | GET | `getSocialV2State(key)`、`readThroughSeqV2` | 无（只读） |
| `/api/socialV2/slang/query` | GET | `confirmedSlangListV2()`、`buildSlangContext(slangEntries, cfg.slang.injectMax)` | 无 |
| `/api/socialV2/message-detail` | GET | `getSocialV2State(key)`、`resolveReplyInfo(kind,id,messageId)` | 只读；必要时查 OneBot（网络，不写） |
| `/api/purpose/status` | GET | `ensurePurposeDay(purposeState)`、`summarizePurposeState`、`purposeOwnerId()`、`adminIdentity()` | **日切**：每请求调 1 次 `ensurePurposeDay`，与原来完全一致 |
| `/api/dsh/model` | GET | `fetchModelCatalog()`、`withTimeout`、`unwrap`、`REASONING_EFFORT_OPTIONS`、共享缓存对象 `{inflight, errors}` | 只读 RPC；失败原因去重集合由 bridge 持有（同一份 Set） |

## 留原链（本轮不搬）

| 路径 | 原因 |
|---|---|
| `/api/selfcheck` | spawn 探端口，进程副作用不在路由层 |
| `/api/socialV2/prompt` | 每次调用前 `syncStickerLibrary(false)`（网络 + 缓存写），且拼装依赖 20+ 个闭包 |
| `/api/debug/frames`、`/api/socialV2/sticker-image`、`/api/socialV2/self-image`、`/api/socialV2/sticker-list`、`/api/stickers`、`/api/images/message` | 走 bot / 网络 / 缓存写盘 |
| `/api/voice/packs*` | 读语音库（fs），下一组单独搬，避免和 bot 语音发送混在一起 |
| `/api/debug/sticker-prune` | 默认会删文件（破坏性） |
| `/api/preset/sim-prompt` | 依赖 `buildWakePromptV2` 的模拟链路，动了容易破坏提示词对照 |

## 风险与回滚

- 两个带副作用的（recent/unread 写 readThroughSeq；purpose/status 日切）**保持每请求一次**，单测里用计数断言。
- 回滚：`git revert <commit>`；7 个 marker 一次还原。
