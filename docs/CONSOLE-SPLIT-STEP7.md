# 控制台拆分第 7 步（R9-7）盘点

> 只读盘点。当前 bridge 16,342 行；已搬 38 条。剩余 inline GET 共 15 个（含 2 个 `/`）。

## 本轮搬（3 条，全在 `/api/voice/packs` 前缀块内）

| 路径 | 方法 | 依赖（等价原调用） | 副作用 |
|---|---|---|---|
| `/api/voice/packs` | GET | `getVoicePacksCached()` → `vp.list()` | 只读（扫描语音包目录） |
| `/api/voice/packs/cloud-stats` | GET | `vp.cloudStats(id='voice-cloud')` | 只读（本地统计文件） |
| `/api/voice/packs/cloud-config` | GET | `vp.readCloudConfig(id='voice-cloud')` | 只读 |

说明：`vp` 是 `getVoicePacksCached()` 进程级实例，必须用 getter 注入，绝不能在注册期固定实例（安装进度 `activeInstalls` 会随实例丢失，2026-10-28 已踩过）。

## 留原链（12 条）

| 路径 | 原因 |
|---|---|
| `/api/voice/packs/sample` | 返回二进制音频（`content-type: audio/wav` + `content-disposition`），当前 router 只有 `ctx.json`；要搬得先给 router 加 `ctx.send`，本轮不动 |
| `/api/socialV2/sticker-list`、`/sticker-image`、`/self-image`、`/images/message` | 依赖 bot 网络/缓存写盘 |
| `/api/socialV2/forward-message` | `reserved2` 专用 + `bot.get_forward_msg` |
| `/api/stickers` | 走 ext 分发 + 同步副作用 |
| `/api/debug/frames` | bot 帧队列 |
| `/api/debug/sticker-prune` | 默认会删文件（破坏性） |
| `/api/socialV2/prompt` | 每次 `syncStickerLibrary(false)` + 20 多个闭包拼装 |
| `/api/preset/sim-prompt` | 依赖 `buildWakePromptV2` 模拟链路 |
| `/`（2 处） | 端口探活/控制台首页，含 HTML 与 401 分支 |

## 你点名的其余路径

- `/api/socialV2/style-*`：**不在 bridge 的 GET 表里**，由 `extDispatchRoute` 交给 `src/ext/style.js`（`style-list`/`style-note`），bridge 只做鉴权前置。
- `/api/socialV2/sticker*`：同上，或走 bot（见上表）。
- `/api/human-stats`、`/api/decision-stats`、`/api/media-stats`：**桥接里没有这三个路由**，它们只存在于面板 `/opt/her-console/server.mjs`（端口 7800）。桥接对应的是 `/api/socialV2/media-stats` 的写入逻辑与 `state/media-stats.json`。
- `/api/debug/*`：`frames`（搬不了，bot）、`sticker-prune`（破坏性）、`prompt`（POST 投递）、`stylelearn`（POST 触发）。
