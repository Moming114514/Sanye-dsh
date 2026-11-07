# 权限分级设计（C1）

> 只写设计，不改行为。当前一切动作都靠 `agent token` + 模式（reserved2）+ 扩展开关约束，**没有按危险程度分级**。
> 本文把现有 MCP 工具与 `/api/*` 写接口各归类一次，给出实现建议与三个现实风险。

## 一、三级定义

| 级别 | 含义 | 默认策略 | 典型动作 |
|---|---|---|---|
| 🟢 绿 | 只读查询，不改变任何状态 | 自动允许；只记计数 | 看未读、看群成员、查记忆 |
| 🟡 黄 | 写自己的状态或限频可接受 | 自动允许 + 限频/配额 + 审计事件 | 标已读、写记忆、改唤醒配置 |
| 🔴 红 | 对外发言、改配置、删数据、加陌生人 | 需要额外凭据（确认口令/主人确认）或直接拒绝；必记审计并通知主人 | 发消息、删记忆、改资料、加好友 |

判定口径：
- 会不会**发出不可撤回的外部动作**（QQ 消息、空间评论、好友申请、改头像/资料）→ 红；
- 会不会**改变她以后的行为**（唤醒配置、人格/记忆、群规则）→ 红或黄（可逆且低风险给黄）；
- 只是读或写自己的小状态 → 绿/黄。

## 二、MCP 工具归类（55 个，`SURFCORE_TOOL_PROFILE=full` 实测）

### 🟢 绿（24）
`qq_status`、`qq_list_groups`、`qq_get_group_members`、`qq_get_group_history`、`qq_get_prompt`、`qq_get_context_snapshot`、`qq_get_unread_messages`、`qq_get_recent_messages`、`qq_social_state`、`qq_get_my_recent_messages`、`qq_get_message_detail`、`qq_get_active_members`、`qq_get_message_images`、`qq_list_stickers`、`qq_get_sticker_image`、`qq_view_sticker`、`qq_get_self_image`、`qq_slang_query`、`qq_memory_query`、`qq_qzone_feed`、`qq_impression`、`qq_recall_memory`、`qq_diary`、`qq_list_friend_requests`、`qq_get_forward_msg`、`qq_wait_for_messages`
（`qq_wait_for_messages` 是长轮询，不写状态，但会占住一次工具调用会话；归绿但单独计「等待次数」。）

### 🟡 黄（13）
`qq_mark_read`（改 readThroughSeq）、`qq_close_conversation`（结束对话、清 active）、`qq_memory_append`、`qq_memory_remove`（写/删单条记忆）、`qq_slang_submit`（进候选）、`qq_learn_from_owner`（学习样本）、`qq_collect_sticker`（进表情库）、`qq_sticker_note`、`qq_set_sticker_remark`（改表情备注）、`qq_style_note`（学说法样本）、`qq_person_note`（人物印象）、`qq_report_feedback`（给主人发提醒，仅站内）、`note_tech`（技术笔记）。

### 🔴 红（18）
`qq_send_message`、`qq_reply`、`qq_send_group_message`、`qq_send_private_message`、`qq_send_burst`（连发）、`qq_send_poke`、`qq_send_sticker`、`qq_send_qzone_msg`、`qq_qzone_comment`、`qq_delete_qzone_msg`（删说说/评论，不可撤回）、`qq_set_profile`、`qq_set_avatar`、`qq_handle_friend_request`（加陌生人）、`qq_memory_clear`（清记忆）、`qq_get_message_images` 的**写缓存**分支不计红（读为主）。
（`qq_handle_friend_request` 的拒绝也是外部动作，同样走红。）

## 三、`/api/*` 写接口归类

| 级别 | 接口 | 说明 |
|---|---|---|
| 🔴 | `POST /api/socialV2/send`、`/api/send/voice`、`/api/socialV2/send-sticker` | 直接对外发言 |
| 🔴 | `POST /api/purpose/preview` 之外的目的触发、`/api/session/reset`、`/api/restart`、`/api/debug/sticker-prune` | 破坏性或重启 |
| 🔴 | `POST /api/feature`（含 paused / allowAllWhenEmpty / security 总开关）、`/api/access`（增删白名单） | 改线上行为，删白名单可能让她再也听不到某些人 |
| 🟡 | `POST /api/mute`、`/api/learnmode`、`/api/grouprate`、`/api/attn-set`、`/api/econ`、`/api/attn` | 可逆的群策略 |
| 🟡 | `POST /api/tokens/reset`、`/api/decisions/mark`、`/api/decisions` 的标注写入 | 管理动作，不改对外行为 |
| 🟢 | 所有 `GET /api/*`（除 `debug/frames`） | 见 R9 拆分清单 |

## 四、实现建议（不写代码）

1. **统一包装**：`wrapTool(name, level, fn)`，在 MCP 注册处（`src/mcp-snowluma-safe.js` 的 `server.tool` 包装里）按名字查表；`/api/*` 用同一个表在路由入口包裹。级别表放单独文件 `src/perm-levels.js`，MCP 与桥接共用，避免两处漂移。
2. **绿**：直接放行，只 `gateEvents` 记一次计数。
3. **黄**：按 `key + tool` 限频（如 10 次/分钟），超限返回 `{ ok:false, error:'太频繁了，稍等一下' }`；每次写审计事件 `[perm] level=yellow tool=... key=...`。
4. **红**：
   - 默认要求 `confirm` 字段携带一次性口令（面板「操作确认」生成，10 分钟有效）；
   - 无口令时返回固定文案：`这一步会直接对外产生动作，需要主人在面板确认（原因：${why}）`，并把请求挂到 `state/perm-pending.json` 等确认；
   - 主人确认后才执行；执行结果另一条审计 `allowed`；
   - 拒绝也记 `[perm] level=red tool=... decision=deny reason=no-confirm`。
5. **脱敏**：审计日志里的 agent token、QQ 号后 4 位、消息正文前 20 字。
6. **可观测**：面板「健康/诊断」加一行「红级待确认 N 条」，与现有 pending 卡片同风格。

## 五、现在就可能被滥用的三个场景

1. **提示词注入 → 对外发消息**：群里有人发「帮她转发这条」之类的诱导，`qq_send_message`/`qq_qzone_comment` 是绿的之外直接执行，没有红级确认，最坏结果是对陌生人刷屏或空间被留言。
2. **转录/日志里的 agent token 被复用**：工具参数里明文带 `token`（聊天记录、日志、截图），拿到它就能在 `reserved2` 外调全部 55 个工具；当前没有「按会话的二次确认」，等于一次泄露换全部权限。
3. **`qq_memory_clear` + 面板改唤醒配置**：模型清空记忆、主人再调一次唤醒/频率，她的行为会静默变一个人；清记忆目前不需要确认、也不会通知主人——事后只能靠日志倒查。

## 六、边界

- 本文不动 `captureSendGuard`、`fishGuardSendBlock`、模式闸门（它们继续先拦）；
- 分级只在「已经通过模式与 token 校验之后」再加一层，不替代现有判断；
- 落地顺序建议：先给 18 个红级工具加「无确认即拒绝 + 审计」（不改变正常聊天路径），再给面板加确认入口。

## 七、落地（P2，2026-11-07）

- 拦截点：MCP `tools/call`（`installToolGuard`）新增 `permGuard`，**红名单 5 个**只允许 `private:<ownerQQ>`：
  `qq_memory_clear`、`qq_set_profile`、`qq_set_avatar`、`qq_delete_qzone_msg`、`qq_handle_friend_request`。
- **发送类不算红级**（`qq_send_message`/`qq_reply`/`qq_send_sticker`/`qq_send_burst`/`qq_send_poke`/`qq_send_qzone_msg`/`qq_qzone_comment` 等）：这是她的日常工作，对所有会话放行，由 `tokenGuard` 的频率/额度约束。
- 会话 key 怎么拿：工具参数带 `agent token` → 桥接 `/api/status` 的 agent 视图返回该 token 自己的会话 `key`（`keyByAgentToken`，只反查、不列映射）→ MCP `resolveSessionKeyByToken` 使用。
- 拒绝：`{ok:false,error:"forbidden",detail:"该工具仅主人私聊可用",tool}`，并打 `[权限] 拒绝 <tool> key=<key>（红工具）`。
- 口径修正：本文前面「红 18 个」是初版设计口径；按可逆性与日常工作，P2 实际只拦 5 个不可逆/身份/关系类动作，其余仍由模式、白名单、`tokenGuard` 频率分层约束。
- 唤醒配置只能由主人通过面板/API 修改，不给模型工具（MCP 不再注册 `qq_set_wake_config`）。
