# SYSTEM-MAP —— 五层体系图与模块归属

> 目的：以后加功能先在这里找「它属于哪一层、入口在哪、开关叫什么」，再动代码。
> 维护规矩：新增 `src/ext/*.js` 必须在 manifest 里写 `layer`（校验器 `dump-manifests --strict` 会拦），并补进本文的归属表。
> 生成口径：30 个 ext 模块来自 `docs/generated/manifests.json`（2026-11-04），bridge 侧功能按代码入口人工登记。

## 1. 五层图

```
                          ┌──────────────────────────────┐
    QQ 消息/媒体 ────────► │ 感知  消息接入 + 段解析 + 看图 │
                          └──────────────┬───────────────┘
                                         │ 文本 + media + 活跃度
                          ┌──────────────▼───────────────┐
                          │ 判断  唤醒打分 + 闸门 + 安全   │
                          └──────────────┬───────────────┘
                                         │ 醒 / 不醒 / 说什么
                          ┌──────────────▼───────────────┐
                          │ 表达  提示词拼装 + 发送       │
                          └──────────────┬───────────────┘
                                         │ 说话 / 空间动作
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
┌───────▼────────┐              ┌────────▼────────┐              ┌────────▼────────┐
│ 记忆 存什么取什么│              │ 运维 花费/任务/接入│            │ 诊断 面板/日志   │
└────────────────┘              └─────────────────┘              └─────────────────┘
```

各层**唯一入口**（所有流量都必须从这里过）：

| 层 | 唯一入口 | 代码位置 |
|---|---|---|
| 感知 | 消息事件回调 → `segmentsToText()` → `extractMediaFromSegments()` | `src/bridge.js:17901` / `:17908`（onPrivate/onGroup）→ `:1641` → `:1740` |
| 判断 | `evaluateWakeTriggerV2()` + ext `wakeGate` 链 | `src/bridge.js:14670`；ext 按 order 10→170 依次过闸 |
| 表达 | `buildWakePromptV2()` → `sendWakePromptV2()` → `deliverPrompt()` | `src/bridge.js:14913` → `:15104` → `:13094` |
| 记忆 | `MEMV2_MEM` 分层记忆块（self → 记忆卡 → 日记） | `src/bridge.js:13410`；上限在 `src/ext/memory-card.js` |
| 运维 | 控制台 HTTP（3100）+ `tokenGuard*` + 定时器 | `src/bridge.js` 的 `/api/*` 路由与 `setInterval`；面板在 `/opt/her-console`（7800）独立 |

> 一句话记法：**感知进、判断闸、表达出、记忆垫、运维管。**

## 2. 归属表（30 个 ext 模块）

「层」列带 ⚑ 的是跨层模块，括号里是主层。

| 模块 | title | 层 | 对外开关 | 状态文件 | 一句话职责 |
|---|---|---|---|---|---|
| `bot-detect` | 机器识别 | 感知 ⚑（主感知） | —（总是开） | `bot-ids.json` `human-marks.json` | 本地判断这条是不是机器人，兼人群档案数据源 |
| `channel` | 通道能力探测 | 感知 ⚑（主感知） | —（自动探测） | `channel-caps.json` | 探测 NapCat/OneBot 实现了哪些扩展 API |
| `sticker-frames` | 表情帧 | 感知 | —（工具触发） | — | 从聊天记录挑最后一张图，抽 3 帧拼图给模型看 |
| `qzone-watch` | 空间巡查 | 感知 ⚑（主感知） | `socialV2.qzone` | `qzone-seen.json` | 看他的说说但不秒评，隔 5~25 分钟提醒 |
| `people` | 人群档案 | 感知 ⚑（主感知） | —（面板只读） | — | 按群看今天最活跃的人 + 我的标记 |
| `attention` | 该不该接话 | 判断 | `socialV2.attention` | — | 本地打分决定这条值不值得叫醒她 |
| `owner-only` | 只听主人 | 判断 | `ownerQQ` | — | 群里只在他说话后才醒 |
| `mute` | 静音名单 | 判断 | 面板「静音名单」 | `muted-keys.json` | 单个群/人先不理，随时恢复 |
| `learnmode` | 学习模式 | 判断 | 面板「学习模式」 | `learn-mode.json` | 某个群只看不聊，专供学说法 |
| `group-rate` | 群聊频率 | 判断 | 面板「群发言频率」 | `group-rate.json` | 每群一档（保守/正常/活跃）控次数 |
| `safe-talk` | 敏感话题 | 判断 | `socialV2.safeTalk` | `safe-talk.json` `muted-keys.json` | 反复试探 AI/钱/住址时记录/降温/冷处理 |
| `economy` | 省钱模式 | 判断 ⚑（主判断） | `socialV2.economy` | `economy.json` | 少说话只回 @，全局或按群 |
| `style` | 学说话 | 表达 | `socialV2.styleLearn` `socialV2.tools` | — | 只学目标的人怎么说话，进提示词当参考 |
| `style-learn` | 学说话任务 | 表达 | `socialV2.styleLearn` `ownerQQ` | `style-learn.json` `style-learn-now.json` | 每天固定轮次去群里学说话框架 |
| `owner-teach` | 主人教的说法 | 表达 | —（工具写入） | `owner-teach.json` | 私聊里他纠正/示范时，记「该怎么说」 |
| `tech-notes` | 技术笔记 | 表达 | `socialV2.techNotes` | — | B 站技术视频的沉淀，进提示词 |
| `stickers` | 贴纸待办 | 表达 | `socialV2.sticker` | — | 生成【表情待补】提示行 |
| `utterances` | 她说的话 | 表达 ⚑（主表达） | —（面板只读） | `utterance-marks.json` | 汇总她所有发言供人工打标 |
| `qzone` | QQ 空间 | 表达 ⚑（主表达） | `socialV2.qzone` `ownerQQ` | — | 读/评/发/删说说 |
| `memory-card` | 记忆卡片上限 | 记忆 | `memoryCard` | — | 记忆卡预算 2800 字，防页脚规则被切 |
| `memory-scope` | 记忆可见范围 | 记忆 | —（总是开） | — | 群聊只给群记忆，私聊只给这个人 |
| `related-memory` | 相关记忆 | 记忆 | `socialV2.relatedMemories` | — | 按这一句挑最相关的旧记忆挂进私聊 |
| `loops` | 欠事与人物 | 记忆 | `socialV2.loops` | `loops.json` `people.json` | 欠着的事与人物备注，进提示词 |
| `promises` | 欠事捕获 | 记忆 | `socialV2.loops` | — | 从她刚说的话里认出「欠下的事」 |
| `impressions` | 她的看法 | 记忆 ⚑（主记忆） | `socialV2.impressions`（当前未配置） | — | 她对他/对世界的看法，自己攒的 |
| `profile` | 档案与好友 | 记忆 | `socialV2.profile` | `friend-requests.json` `avatar-pending.json` `friend-notify.json` | 好友申请/头像待确认的状态与通知 |
| `advice-capture`（id=advice） | 建议收集 | 记忆 ⚑（主记忆） | `socialV2.adviceCapture` | `bot-advice.jsonl` | 收集别的机器人说的「方法论」，落盘备用 |
| `reminders` | 提醒与汇报 | 运维 ⚑（主运维） | `socialV2.reminders` `socialV2.report` | — | 提醒/告警/日报的定时任务 |
| `github-learn` | GitHub 学习 | 运维 ⚑（主运维） | `socialV2.githubLearn` | `github-learn.json` | 每周从高星项目学 3 条做法 |
| `blackbox` | 黑箱静默 | 运维 ⚑（主运维） | —（内部调用） | — | 内部任务（如学说法）的回复不发 QQ |

## 3. 归属表（bridge 里的散装功能）

这些还没搬进 ext，先登记归属，波 2 再迁。

| 功能 | 层 | 对外开关 | 状态文件 | 一句话职责 |
|---|---|---|---|---|
| 消息接入 + 段解析 | 感知 | `socialV2.enabled`、`socialV2.paused` | `social-v2.json` | CQ 段 → 文本/媒体占位，永远不为空 |
| 看图取图 `qq_get_message_images` | 感知 | `socialV2.tools.getImages` | `apps/surfcore/state/media-cache/` | 取图、8MB 降采样、动图抽帧 |
| 唤醒判定 `evaluateWakeTriggerV2` | 判断 | `socialV2.wake`、`attention`、`tokenGuard` | — | 综合判断这条醒不醒 |
| 模式切换（全开/只听主人/只私聊/关机） | 判断 | `social-v2.json` 的 `paused`/`mode` | `social-v2.json` | 全局行为模式 |
| 费用闸门 `tokenGuard*` | 运维 | `socialV2.tokenGuard` | 用量统计 | 日预算、降级、每日唤醒上限 |
| 提示词拼装 `buildWakePromptV2` | 表达 | `socialV2.context`、`initialPromptMaxChars` | — | 人格 + 记忆 + 上下文 + 媒体提示 |
| 发送 `sendWakePromptV2`/`deliverPrompt` | 表达 | `socialV2.send` | — | 调模型、分片、发 QQ |
| 命令系统（`/帮助` `/花费` …） | 表达 | `socialV2.command` | — | 主人/管理员的文本指令 |
| 记忆注入 `MEMV2_MEM` | 记忆 | `memoryCard` | `self.md` `diary.md` 记忆卡 | 骨架 → 记忆卡 → 日记 |
| 情绪 `mood-lib` | 表达 ⚑（主表达） | `socialV2.mood` | `mood.json` | 6 情绪影响语气，只读不可调 |
| 控制台 HTTP 3100 | 运维 | `consolePort` / `consoleToken` | — | 面板/调试的只读与动作接口 |
| 定时任务（自检/日报/学习调度） | 运维 | `socialV2.report`、`githubLearn`、`styleLearn` | 各自 state | 周期任务 |
| 面板 `/opt/her-console` :7800 | 运维 | `token.txt` | — | 独立进程的展示面 |

## 4. 统计（2026-11-04）

| 层 | ext 模块 | bridge 散装 | 合计 |
|---|---|---|---|
| 感知 | 5 | 2 | 7 |
| 判断 | 7 | 2 | 9 |
| 表达 | 7 | 4 | 11 |
| 记忆 | 8 | 2 | 10 |
| 运维 | 3 | 3 | 6 |
| **合计** | **30** | **13** | **43** |

## 5. 加新功能时怎么落层

1. 先问：它是「收进来的」→ 感知；「决定要不要做」→ 判断；「说出去/写出去」→ 表达；「存下来/查出来」→ 记忆；「怎么跑/花多少」→ 运维。
2. 新 ext 模块的 `manifest.layer` 填它**主层**；跨层的在本文第 2 节标 ⚑ 并写主层，不要为了跨层造第六层。
3. 面板加页：只改 `app.js` 的 `PAGES` + `NAV_GROUPS`，归到上面某一组；页面内容不动体系。
4. 开关：能进 `features.json` 的就进（面板自动出现），写清楚是 `hot` 还是 `bridge`（要重启）。
