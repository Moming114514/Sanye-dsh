# R9-E 阶段 A：控制台第 3 步候选清单

> 只读盘点，不含任何代码改动。目标：从 `src/bridge.js` 剩余控制台分支里，筛出「GET / 纯读 / 不碰 bot / 不在不可搬清单」的路由，按风险从低到高排序，挑 6~8 条给第 3 步。
>
> 扫描口径：`url.pathname === '/api/...'` 或 `p === '/api/...'` 作为路由起点；块内出现 `sendJson(` / `res.end(` 才算处理器；同一路径多次出现取最后一次（前面的多为白名单判定）。共 137 个处理器，其中 34 个初筛为「无 bot、无显式写」。

## 不计入的（说明为什么）

| 路由 | 原因 |
|---|---|
| `/api/debug/frames` | 不可搬清单（bot 帧） |
| `/api/debug/prompt` | POST 投递 |
| `/api/debug/sticker-prune` | 默认会删，破坏性 |
| `/api/socialV2/recall` | 写状态（回忆命中计数） |
| `/api/socialV2/voices`、`/self-image`、`/sticker-image`、`/images/message` | 走 `bot.*` 取媒体 |
| `/api/socialV2/qzone-feed`、`/qzone-comment` | `fetchQzoneFeed/commentQzone` 内部用 bot |
| `/api/stickers`、`/api/stickers/sync` | `syncStickerLibrary()` 有同步副作用 |
| `/api/dsh/model` | 走 DSH RPC，读写边界不清，本轮不碰 |
| `/api/tokens/*`、`/api/status` | R9-1 已搬 |
| `/api/roles`、`/api/roles/content`、`/api/debug/{promise,related,guard}` | R9-2 已搬 |

## 候选表（风险从低到高）

| # | 路径 | 方法 | 依赖 | 约行数 | 风险 | 说明 |
|---|---|---|---|---|---|---|
| 1 | `/api/socialV2/tool-log` | GET | file（`readToolLog`） | 5 | 低 | 只读 tool-log 文件，`limit≤500` |
| 2 | `/api/owner-audit` | GET | file（`ownerAudit.readTail`） | 7 | 低 | 尾巴 + health + path，纯读 |
| 3 | `/api/bili/status` | GET | cfg + bili 模块 status | 14 | 低 | 三个 status() 只读拼接 |
| 4 | `/api/sessions` | GET | state（`state.sessions`） | 9 | 低 | 会话表快照 |
| 5 | `/api/pending` | GET | state（`pending` Map） | 15 | 低 | 挂起审批/提问列表 |
| 6 | `/api/socialV2/states` | GET | state（`socialV2.conversations`） | 16 | 低 | 每会话汇总，不返回正文 |
| 7 | `/api/plugins` | GET | file（`docs/generated/manifests.json`）+ `extList()` | 11 | 低-中 | 三路鉴权 + 合并 routes |
| 8 | `/api/socialV2/recent` | GET | state（`getSocialV2State`） | 16 | 低-中 | 有 key 校验与 agent-token 校验 |
| 9 | `/api/socialV2/unread` | GET | state | 24 | 中 | 同上，另有分页 |
| 10 | `/api/bili/prompt-preview` | GET | role + biliMemory | 13 | 中 | 依赖 `currentRoleHint()` |
| 11 | `/api/presets` | GET | DSH RPC（`api.agentPresets.list`） | 9 | 中 | 依赖外部 api 客户端 |
| 12 | `/api/socialV2/state` | GET | state | 25 | 中 | 单会话完整状态 |
| 13 | `/api/socialV2/memory` | GET | state（记忆卡） | 26 | 中 | 分类过滤 |
| 14 | `/api/socialV2/snapshot` | GET | cfg + state | 25 | 中 | 复合快照 |
| 15 | `/api/socialV2/active-members` | GET | state | 24 | 中 | 活跃成员统计 |
| 16 | `/api/purpose/status` | GET | state（`ensurePurposeDay` 会翻日） | 14 | 中 | 读接口带一次日切副作用 |
| 17 | `/api/preset/sim-prompt/backups` | GET | file | 10 | 中 | 依赖 `PRESET_NAMES`、`listPresetBackups` |

## 建议本轮搬这 7 条（`src/console/routes/social-read.js`）

1. `/api/socialV2/tool-log`
2. `/api/owner-audit`
3. `/api/bili/status`
4. `/api/sessions`
5. `/api/pending`
6. `/api/socialV2/states`
7. `/api/plugins`

**理由**
- 全都不碰 `bot`、不写状态；依赖都能通过 `deps` 注入（file 读取器、cfg、`getSocialV2()`、`pending` Map、`extList()`）。
- 除 `/api/plugins` 外都没有鉴权分支；`/api/plugins` 的三路鉴权（agent token / console token / 本机回环）与 `/api/status` 同款，可以复用 R9-1 的 `auth` 辅助。
- 预计行数：bridge −60~−75，新文件 ≈130~160（含路由注册与四个小 render 函数）。
- 收益：这几条都在面板/DDG 高频轮询上（tool-log、states、bili/status、pending），搬出去后 bridge 的编辑面更干净。

**备选**（如果 `/api/plugins` 的鉴权想留到下一轮）：换 `/api/socialV2/recent`。

## 迁移注意
- `sendJson()` 是 bridge 里的局部函数（带安全头、字节限流），搬走后要在 `src/console/http.js` 提供同等 `sendJson` 或由 deps 注入；R9-1 已经在 `tokens.js` 里带了一份实现，本轮复用同一份。
- `/api/states` 这类「Map → 数组」的渲染函数建议留在 route 文件里，deps 只给 `getSocialV2()`。
- 路由对照基准（176 条）不变；`check-routes.mjs` 会对 `register(...)` 行推断方法，新文件用 `router.register(path, ['GET'], fn)` 写法即可。
- 原位注释统一 `// moved to src/console/routes/social-read.js (R9-3)`。

## 待确认
- 是否就按上面 7 条开始；如果要先搬更少的（比如 5 条），建议保留 1~5 加 `/api/plugins`。
