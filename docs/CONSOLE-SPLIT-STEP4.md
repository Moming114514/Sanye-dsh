# 控制台拆分第 4 步（R9-4）候选清单

> 只读盘点。规则：router 只创建一次，**deps 只能是进程级对象/纯函数**；响应一律 `ctx.json`；
> 注册期 `REQUIRED` 校验，缺依赖直接 throw；原位留 `// moved to src/console/routes/<文件> (R9-4)`。
> 当前 bridge 16,625 行；已搬 tokens/status（6 条）、roles/debug 只读（5 条）、social-read（7 条）。

## 建议本轮搬（7 条，全部 GET）

| 路径 | 依赖（进程级） | 副作用 |
|---|---|---|
| `/api/socialV2/active-members` | `getSocialV2` | 无（只读 state 内存） |
| `/api/socialV2/memory` | `getSocialV2`、`formatMemoryV2` | 无 |
| `/api/socialV2/state` | `getSocialV2`、`computeWakeSafetyV2`、`assessClosureV2`、`closureStatus` | 无（closure 判定是纯计算） |
| `/api/socialV2/snapshot` | `getSocialV2`、`buildContextSnapshot`、`cfg` | 无（`context-snapshot.js` 自述纯函数） |
| `/api/bili/prompt-preview` | `biliMemory`、`currentRoleHint` | 无（`briefBlock`/`recallBlock` 只读内存） |
| `/api/presets` | `api`（DSH RPC client） | 只读 RPC（网络），不写本地 |
| `/api/preset/sim-prompt/backups` | `knownPresetName`、`PRESET_NAMES`、`listPresetBackups` | 读 `presets/backups` 目录 |

共同点：都不发 QQ、不写 state、不写 config、不触发定时器；依赖都能在 bridge 的闭包里以纯函数/只读对象形式注入。

## 本轮不搬（有副作用或依赖太深）

| 路径 | 原因 |
|---|---|
| `/api/socialV2/recent` | 带 `x-agent-token` 时调 `noteModelMessagesV2`，会写 `readThroughSeq` |
| `/api/socialV2/unread` | 同上；还会调 `stickerMatchFor`（读 recent，仍属写路径的一部分） |
| `/api/purpose/status` | `ensurePurposeDay` 会做日切（改内存 state），不是纯读 |
| `/api/socialV2/selfcheck` | 会 spawn 子进程探测端口（外部副作用） |
| `/api/socialV2/style-list` | 读样式库文件 + 依赖 style-lib 若干内部函数，留到下一组 |
| `/api/socialV2/message-images` 等媒体 | 走 `fetchMediaData`（网络 + 缓存写盘） |
| `/api/debug/frames` | 已在 R9-2 判为不可搬（bot 帧队列） |

## 为什么先搬这 7 条

1. 全部 GET + 无写，回归风险最低；
2. 依赖都能以「纯函数或只读对象」传入，不涉及按请求闭包（R9-3 的坑）；
3. 覆盖 4 个不同读域（会话状态、记忆、快照、B站/预设），能顺带验证 `ctx.json` 的通用性；
4. 预计可减 80~110 行，且不改变任何响应字段。

## 回滚

`git revert <commit>` 即可；bridge 内 7 个 marker 一次还原，router 注册块删掉即恢复原链。
