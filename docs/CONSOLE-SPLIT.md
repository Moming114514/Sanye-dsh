# CONSOLE-SPLIT：控制台区拆分设计（R9-A，只读）

> 依据：`docs/HANDOFF-REFACTOR.md` R0 盘点 + 对 `src/bridge.js` 的实测（2026-11-06 19:2x，HEAD `8019e87`）。
> 本文件只做设计与盘点，没有改任何 `.js`。

## 0. 实测口径

| 项 | 值 |
|---|---|
| 控制台区位置 | `src/bridge.js` **3831–8857**（`http.createServer` → `server.listen` 回调） |
| 行数 | **5,027 行**（R0 时的 5,177 是重构前） |
| bridge 总行数 | 16,769 |
| 占比 | 30.0% |
| `/api/` 字面量出现次数 | **246** |
| 去重后的路径 | **176** |
| 方法 | 绝大多数 `GET`；`POST` 集中在写操作（mute/learnmode/grouprate/feature/send/…） |

路径计数按「字面量」算：同一路径在鉴权白名单、CORS 预检、实际分派里可能各出现一次，所以 246 > 176。

## 1. 按领域分组（176 条去重路径）

| # | 领域 | 路径数 | 代表路径 | 依赖 |
|---|---|---|---|---|
| 1 | 发送 / 语音 | 8 | `/api/socialV2/send`、`/send-voice`、`/send-sticker`、`/forward-media`、`/sticker-list` | bot.request、sendChain、voice lib、media lib、ledger |
| 2 | 规则 / 资料 | 8 | `/mute`、`/learnmode`、`/grouprate`、`/attn-set`、`/attention`、`/people` | cfg、state 文件、group-policy、profile |
| 3 | 状态 / 配置 | 9 | `/states`、`/mood`、`/memory`、`/mem`、`/loops`、`/reminders`、`/config`、`/plugins` | socialV2、state 文件、ext registry |
| 4 | 媒体 / 图片 / 表情 | 30 | `/api/images/*`、`/api/stickers*`、`/api/voice*`、`/api/audio*` | mediaFetch、sticker lib、voice lib、缓存目录 |
| 5 | socialV2 其余 | 50 | `/active-members`、`/advice`、`/close`、`/collect-sticker`、`/feedback`、`/proactive*` | socialV2 状态机、bot、sendToQQ |
| 6 | slang（黑话） | 9 | `/api/slang`、`/batch-confirm`、`/batch-reject`、`/clear` | slang 状态文件、cfg |
| 7 | debug | 7 | `/api/debug/prompt`、`/frames`、`/guard`、`/related`、`/promise` | 会话/队列/bot 实时快照 |
| 8 | roles（角色） | 7 | `/api/roles`、`/create`、`/delete`、`/limit`、`/rename` | 角色目录、人格文件、current.json |
| 9 | tokens | 7 | `/api/tokens/daily`、`/recent`、`/series`、`/summary`、`/reset` | tokenLedger、预算、daily 快照 |
| 10 | 状态 / 运维 | 5 | `/api/status`、`/pending`、`/plugins`、`/console/token`、`/console/notify-ai` | cfg、selfcheck、ext、console token |
| 11 | send（另一套入口） | 5 | `/api/send/group`、`/private`、`/reply`、`/voice` | bot、发送链、审计 |
| 12 | bili | 5 | `/api/bili/status`、`/dynamics/poll`、`/share-now`、`/memory/refresh` | bili-*.js、biliMemory |
| 13 | preset / 仿真 | 3 | `/api/preset/sim-prompt`、`/backups`、`/restore` | 提示词构建、备份目录 |
| 14 | purpose | 3 | `/api/purpose/status`、`/preview`、`/run` | purpose 状态机 |
| 15 | social（队列） | 3 | `/api/social`、`/state`、`/flush` | 会话队列、pumpMux |
| 16 | dsh | 2 | `/api/dsh/model`、`/effort` | DSH 设置文件 |
| 17 | 单条杂项 | 约 20 | `/api/mode`、`/api/security`、`/api/greeting/test`、`/api/whitelist`、`/api/sessions`、`/api/test-send`、`/api/restart`、`/api/workspace/reset` 等 | 各自直接读写状态或 bot |

> 第 5 组偏大，是因为 `/api/socialV2/*` 里还有 feed、feedback、proactive、bootstrap、persona、activity、check-send 等；拆分时这一组还要按「读状态 / 改状态 / 触发回合」再分一次。

## 2. 文件拆分方案

目录：`src/console/`，总目标是把 5,027 行压到 **≤2,200 行**（bridge 内只留路由表 + 3 个薄适配器）。

| 新文件 | 预计行数 | 导出 | 需要注入 |
|---|---|---|---|
| `console/http.js` | ~260 | `sendJson`、`readJsonBody`、`cors`、`isAuthorized(req, deps)`、`parseCookies`、`serveStatic`（如果静态资源仍在桥接） | `cfg`、`consoleToken` 校验函数、`log` |
| `console/router.js` | ~120 | `createRouter(routes)`、`matchRoute(method, pathname)`、`listRoutes()` | 无（纯函数） |
| `console/routes/status.js` | ~180 | `registerStatus(router, deps)`：`/api/status`、`/pending`、`/plugins`、`/health`、`/console/token` | selfcheck、ext registry、cfg |
| `console/routes/tokens.js` | ~160 | `/api/tokens/*` | `ledger`、`bridgeDailyUsage`、`readBudget` |
| `console/routes/roles.js` | ~220 | `/api/roles/*`、`/api/role`、`/api/role-mode`、`/api/presets` | 角色目录、`readPersona`、`cfg` |
| `console/routes/debug.js` | ~200 | `/api/debug/*`、`/api/owner-audit` | 会话快照、`getSocialV2State`、bot 状态 |
| `console/routes/bili.js` | ~110 | `/api/bili/*` | `biliMemory`、`biliDynamics`、`biliShare`、`deliverPrompt` |
| `console/routes/rules.js` | ~420 | `/api/socialV2/{mute,learnmode,grouprate,attention,attn-set,people,profile,friends}`、`/api/whitelist`、`/api/security` | state 文件、group-policy、profile、`saveConfig` |
| `console/routes/media.js` | ~520 | `/api/images/*`、`/api/stickers/*`、`/api/voice*`、`/api/audio*` | `mediaFetch`、sticker lib、`voiceLibrary`、缓存目录 |
| `console/routes/social-state.js` | ~520 | `/api/socialV2/{states,mood,mem,memory,loops,reminders,names,config,activity,initial-prompt,history-catchup}` | `socialV2`、`get/saveSocialV2State`、`loadConfig` |
| `console/routes/social-flow.js` | ~420 | `/api/socialV2/{check-send,close,collect-sticker,feedback,proactive*,advice,active-members,persona}` | 状态机、`scheduleWakeV2`、`sendToQQ` |
| `console/routes/send.js` | ~360 | `/api/send/*`、`/api/socialV2/{send,send-sticker,forward-media,send-voice,sticker-list}` | `bot`、`sendChain`、voice/media lib、审计 |
| `console/routes/misc.js` | ~200 | `/api/mode`、`/api/social`、`/api/social/flush`、`/api/dsh/*`、`/api/purpose/*`、`/api/greeting/test`、`/api/sessions`、`/api/preset/sim-prompt*` | 各自状态 |

**留在 `bridge.js` 的**：`http.createServer` 本体（~40 行）、路由表装配（~60 行）、以及第 5 节列出的薄适配器（每个 5–15 行）。

## 3. 迁移顺序

原则：先纯读、后写；先无 bot 依赖、后有 bot 依赖；每一步都能用「路径集合不变」证明没漏。

| 步 | 搬什么 | 为什么先做 | 每步验收 |
|---|---|---|---|
| 0 | 只加 `console/router.js` + `scripts/check-routes.mjs` + 基准 `scripts/snap-base/routes.json`，路由仍走老 if/else | 先有对照工具，后面每步都能自动证明「没少路径」 | `node scripts/check-routes.mjs` = `ROUTES_OK`；`npm run verify` |
| 1 | `console/http.js`（鉴权/CORS/sendJson/body） | 所有路由共用，先抽最底层的 | 同上 + `curl` 5 条只读接口仍 200 |
| 2 | `tokens` + `roles` | 纯文件/账本读取，不碰 bot，最容易回滚 | `check-routes` + `npm run verify` + `curl /api/tokens/daily` `/api/roles` |
| 3 | `debug` + `bili` | 只读快照 + 已有 bili 模块，无写操作 | 同上 + `curl /api/bili/status` |
| 4 | `rules` | 写 state 文件，但接口封闭，已有单测覆盖 mute/learnmode/group-rate | 同上 + `curl -X POST /api/socialV2/mute`（list，不改状态） |
| 5 | `media` | 依赖 `mediaFetch`/voice lib，接口多但都是「取/发/看」，失败可单点回滚 | 同上 + `/api/stickers` 列表 200 |
| 6 | `social-state` | 读写 `social-v2.json`，要小心 `saveSocialV2State` 的副作用 | 同上 + `/api/socialV2/states` `/mood` `/mem` |
| 7 | `social-flow` + `send` + `misc` | 依赖 bot/队列/发送链，最后搬；留薄适配器在 bridge | 同上 + 3 条发送接口 dry-run（不真发） |

每一步的「没坏」证明固定三件套：

```bash
node scripts/check-routes.mjs --base 8019e87   # 路径+方法集合完全一致
npm run verify                                  # 单测/符号审计/清单/快照
node scripts/replay-hooks.mjs --diff            # 行为金丝雀 diffs=0
```

## 4. `scripts/check-routes.mjs` 设计

目标：旧代码 vs 新代码的「路径集合 + 方法集合」必须完全一致，少一个即失败。

```
用法：
  node scripts/check-routes.mjs                 # 基准 = 工作区当前 HEAD，对照 src/bridge.js + src/console/**
  node scripts/check-routes.mjs --base <rev>    # 从 git show <rev>:src/bridge.js 取基准
  node scripts/check-routes.mjs --save-base     # 生成 scripts/snap-base/routes.json（只允许一次）
  node scripts/check-routes.mjs --json          # 机器可读
  node scripts/check-routes.mjs --live 3100     # 可选：对运行中的桥接做 405/404 探针（只探已知只读 GET）
```

实现要点：

1. **抽取**：正则 `['"](\/api\/[A-Za-z0-9_./:-]*)['"]`，只扫控制台区（`http.createServer` → `server.listen`）；对每个命中向上看 6 行判定方法（`req.method === 'POST'` / `'GET'` / `startsWith('/api/...')` 分派），判不出就记 `*`。
2. **归并**：同一路径的多方法合并成 `path -> {GET,POST}`；`*` 视为「方法未知」，不参与方法比对，但参与路径比对。
3. **落基准**：`--save-base` 只允许基准文件不存在时执行，写 `scripts/snap-base/routes.json`（`{schema,at,base,count,paths:{...}}`），之后所有改动都与它比。
4. **比对**：只报三类差异：`missing`（基准有、新代码没有）、`extra`（新代码多出来）、`method-mismatch`。前两类任一非空 → exit 1；方法差异打印但不阻断（避免 GET/POST 归一化误报），改为 `--strict-methods` 时阻断。
5. **跨文件**：新代码的路径从 `src/bridge.js` + `src/console/**/*.js` + 路由表 `listRoutes()` 三处合并；三处并集应等于基准。
6. **失败输出**：先打 `ROUTES_DIFF missing=… extra=… methods=…`，再逐条列 `path @ file:line`，最后 exit 1；通过时打 `ROUTES_OK count=<n>`。

为什么不做运行时全量探针：写接口会改状态（发送、删记忆、重启），而且 sleep/队列类接口不能随便打。运行时只保留 `--live` 的只读白名单。

## 5. 不能搬 / 只能留薄适配器的

| 路径或函数 | 原因 |
|---|---|
| `/api/restart` | 依赖 `process.exit` + 外层 systemd 生命周期，搬出去也只能是回调 |
| `/api/test-send`、`/api/greeting/test` | 会真的发 QQ，且依赖 `sendToQQ`/发送链的即时状态 |
| `/api/session/reset`、`/api/workspace/reset` | 要操 `socialV2.conversations`/`state.sessions` 的内存对象与 `sessionEpoch`，Mutex 级依赖 |
| `/api/social`、`/api/social/flush`、`/api/social/state` | 依赖 `pumpMux` 的队列/在途状态，搬走会拿到过期快照 |
| `/api/send/*`、`/api/socialV2/send*`、`/send-voice` | 依赖 `bot`、`sendChain`、`turnGuard`、审计上下文；建议只搬「参数解析 + 校验」，真正发送留 bridge 回调 |
| `/api/debug/frames` | 读 `bot` 的实时帧缓冲与连接状态 |
| `/api/console/notify-ai` | 写 DSH 会话通知，依赖 `dshReady`/当前回合 |
| `/api/console/token` 的**写**分支 | 会改 `cfg.consoleToken` 并热更新鉴权，和 `http.js` 初始化顺序耦合 |

这些仍是 `/api/...` 路由，只是 handler 留在 bridge，通过 `router.get(path, handler)` 注册；`check-routes` 从 bridge 里也能抽到它们，所以路径集合不会少。

## 6. 预期收益

- bridge 从 16,769 → **约 12,000**（控制台区 −4,800，加回适配器 +200，加路由表 +120）。
- 控制台区以后按领域加功能，只动对应的 `console/routes/*.js`，不用再在 5,000 行 if/else 里找锚点。
- `check-routes` 一旦入库，就是「路由没少」的硬门禁；配合 `verify` 的符号审计，可以覆盖「搬了但没接线」这类静默失败。
