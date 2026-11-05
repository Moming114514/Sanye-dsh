# 脱壳说明：她把"自己"放在哪，怎么换一个壳

> 一句话：**她是磁盘上的一组文件，DSH 只是让这组文件跑起来的运行时。**
> 换运行时（DSH → 别的 agent 框架）时，只要实现 7 个钩子，她的记忆、人格、说话方式一行都不用改。

## 一、她的"自我"由三类资产构成

| 资产 | 位置 | 格式 | 作用 |
|---|---|---|---|
| 人格 | `~/.dsh/surfcore/characters/<charId>/persona.md`、`persona.tone.md`、`persona.daily.md`、`scenes/*.md` | Markdown | 她是谁、怎么说话、什么场合怎么反应 |
| 记忆 | `~/.dsh/surfcore/characters/<charId>/memory/`（`memory-card.json`、`memory-card-prompt-qq.md`、`self.md`、`diary.md`、`memory-inbox.jsonl`） | JSON / JSONL / Markdown | 她经历过什么、答应过什么、对谁有什么看法 |
| 状态 | `~/.dsh/surfcore/state/*.json`（`mood`、`loops`、`people`、`impressions`、`group-rate`、`muted-keys`、`learn-mode`、`active-window`、`safe-talk`、`economy`、`style-samples`、`bot-advice`、`media-stats`…） | JSON | 此刻的心情、欠事、频率、静音、活跃期、学说话素材 |

注入顺序（`src/bridge.js` 的 `MEMV2_MEM`）：骨架 `self.md` → 记忆卡（截断 ~1800 字）→ 最近两天日记 → 印象/欠事等；易变内容放尾部，静态前缀不重排（缓存命中靠这个）。

这三类都在**文件系统**里，不在进程内存里。进程重启、换机器、换框架，它们都还在。

## 二、壳要提供什么（7 个钩子）

任何一个运行时，只要能实现下面 7 件事，就能"装下她"：

| # | 钩子 | 签名 | 用途 |
|---|---|---|---|
| 1 | `onGroupMessage` | `({key, uin, name, text, at})` | 收群消息（打分、识别人、记素材） |
| 2 | `onPrivateMessage` | `({key, uin, name, text, at})` | 收私聊消息 |
| 3 | `wakeGate` | `({key, reason, cfg}) → true / {allow:false, reason}` | 决定"这条要不要叫醒她" |
| 4 | `promptBlock` | `(cfg) → string` | 往提示词里加段落（记忆卡、群摘要、策略提醒…） |
| 5 | `stateKey` | `() → string` | 参与缓存指纹，判断"什么变了要重建" |
| 6 | `afterSend` | `({key, messages})` | 发送之后（欠事捕获、日志、统计） |
| 7 | `routes` | `[{path, handle({body, sendJson})}]` | 对外 HTTP 接口（面板、调试） |

现有实现：`src/ext/index.js` 里的 `MODULES` 注册表 + 每个模块的 `manifest`（含 `order` / `hooks` / `layer`）。
**这是壳与她的唯一契约。**

## 三、壳是什么

| 壳 | 职责 | 换掉时失去什么 |
|---|---|---|
| **bridge**（`src/bridge.js`） | OneBot 事件接收、唤醒判断、提示词组装、7 钩子、发送、定时任务 | 所有"何时开口"的策略与提示词拼装 |
| **DSH** | agent 循环、模型调用、MCP 工具、会话与缓存 | 工具 schema、提示词缓存命中、会话上下文管理 |
| **NapCat / OneBot v11** | QQ 协议、群/私聊消息、图片与语音、空间与好友接口 | 账号连接与私有接口 |
| **面板**（`/opt/her-console`） | 只走 HTTP 看状态、改配置 | 可观测性与开关 |

## 四、换壳清单

### 换 DSH（模型 / agent 运行时）

需要实现两件事：
1. **prompt 组装**：把 `buildWakePromptV2` 的产物（人设 + 记忆卡 + 今日感觉 + 学说话样本 + 媒体提示 + 策略提示）交给新运行时，保持「静态前缀稳定、易变内容在尾部」的顺序（缓存命中的前提）。
2. **工具执行**：把 MCP 工具（`src/mcp-snowluma-safe.js` 注册的 51 个，其中 core-min 25 个）映射到新运行时的 tool 调用；`enabledTools` 的开关语义要保留。

### 换 NapCat（QQ 实现）

需要 OneBot v11 的这些事件与接口：
- 事件：`message.group` / `message.private`、`notice.group_increase`、`notice.friend_request`、`meta_event.lifecycle`。
- 消息：`send_msg`、`get_msg`、`get_image`、`get_record`、`mark_msg_as_read`、`get_forward_msg`、`send_poke`。
- 数据：`get_group_list`、`get_group_member_info`、`get_stranger_info`、`get_friend_list`。
- **私有 / 非标准**（换实现要自己补）：
  - 空间：`get_cookies`（QQ 空间 cookie）与 qzone 相关接口（看说说、评论、删除）；
  - 头像：公开接口 `https://q1.qlogo.cn/g?b=qq&nk=<uin>&s=100`，不需要私有接口；
  - 好友申请：`get_friend_requests` / `set_friend_request`（不同实现名字不同）；
  - 表情：`fetch_custom_face` / `get_sticker_image` / `set_sticker_remark`（收藏表情元数据）；
  - 原图：`get_image`；表情包与动图抽帧依赖 `get_image` 返回的本地文件。

## 五、不可迁移清单（壳的特性，换壳会重新产生成本）

- **提示词缓存命中**：依赖「静态前缀 + 稳定 stateKey + 尾部易变内容」的排列；换壳或改 prompt 顺序都会让缓存失效（一次全量重建约 ¥0.1）。
- **工具 schema 与描述**：模型调用准确率与描述文本强相关；换壳后要重新调描述，不能直接复用旧 schema 里的隐式约定。
- **定时器语义**：`sanye-digest`（17 分钟）、`sanye-selfcheck`（30 分钟 + 随机延迟）、空间巡检（60 秒）、情绪 tick（3~6 小时）；换壳要重接，否则她「不主动」。
- **可观测性**：`/api/*` 控制台、媒体统计、花费账本、媒体缓存目录；换壳后要重建，否则出问题只能看日志。

## 六、一页迁移步骤

1. **打包**：`characters/`（人格 + 记忆）、`state/`（状态，可选择性带走）、`config.json`（去掉 `consoleToken` 与任何密钥）、`docs/`（契约与决策记录）。
2. **装壳**：新宿主部署 bridge 等价物（事件 → 唤醒 → prompt → 模型 → 工具 → 发送），接上 OneBot 实现；把 owners / 白名单 / 群列表搬到新配置。
3. **接线**：模型运行时注册 MCP 工具（先 core-min 25 个），把 `enabledTools` 映射成开关；保留 `/api/status`、`/api/socialV2/prompt` 两个只读接口用于验收。
4. **验收**（按顺序）：
   - `GET /api/socialV2/prompt?key=private:<owner>` 能拿到完整提示词（人格 / 记忆 / 感觉 / 学说话都在）；
   - 私聊发一句 → 能回；群里 @ → 能回；发一张图 → 说得出图里的东西；
   - `state/active-window.json`、`state/group-rate.json` 的计数会动；
   - 面板或日志能看到今日花费与失败计数。
5. **回滚**：旧壳保留 `state/` 备份与 `config.json.bak`，新壳异常时切回旧进程即可；`characters/` 不动，自我不丢。

## 七、一句话总结

**"脱壳"不是重写她，是把 `characters/` + `state/` + 7 个钩子的契约固定下来。**
契约在 `docs/EXT-MANIFEST.md`，资产在文件里，壳随时可以换。
