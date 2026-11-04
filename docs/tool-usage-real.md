# 真实工具调用统计（A-3）

> 数据源：`~/.dsh/sessions/--home-dsh-work--/*/session.v4.jsonl.zstd`（她自己的 DSH 会话转录；另有开发会话 388 次 bash/write 未计入）。共 10 个会话、**1824 次 tool/call**，时间窗 10-29 23:30 → 11-04 22:46。全量统计，未抽样；只读解析，未重启、未改代码、未碰 QQ。

## 0. 记录结构（样例，已脱敏）

```json
{"type":"tool/call","seq":16,"time":1793422774000,"data":{
  "turn":1,"step":1,"callId":"call_00_...",
  "name":"mcp__snowluma__qq_send_message",
  "arguments":"{\"key\":\"group:680787260\",\"token\":\"***\",\"messages\":[\"在的呀\"]}"}}
```

每次调用一条 `tool/call`（含 `name`、`arguments`、`time`），结果另有一条 `tool/result`；工具名前缀 `mcp__snowluma__`，统计时已去掉并合并了 `mcp__snowluma_`（单下划线）的历史变体。

## 1. 聊天主链 6 件套

| 工具 | 调用次数 | 最后调用 |
|---|---:|---|
| `qq_send_message` | 514 | 11-04 22:46 |
| `qq_reply` | 3 | 11-03 13:36 |
| `qq_wait_for_messages` | 398 | 11-04 19:54 |
| `qq_get_prompt` | 5 | 10-31 15:23 |
| `qq_mark_read` | 52 | 11-04 12:13 |
| `qq_close_conversation` | 442 | 11-04 22:46 |

**发送/收消息三件套（send_message / close_conversation / wait_for_messages）合计 1354 次**，占全部调用的 74.2%。`qq_get_prompt` 5 次、`qq_mark_read` 52 次、`qq_reply` 3 次。

## 2. 全部工具调用

| 工具 | 调用次数 | 最后调用 | 典型参数（截断 60 字，token 已脱敏） |
|---|---:|---|---|
| `qq_send_message` | 514 | 11-04 22:46 | `{"key": "private:3057627032", "token":"***", "messages": "你好` |
| `qq_close_conversation` | 442 | 11-04 22:46 | `{"key": "private:3057627032", "reason": "natural", "summary"` |
| `qq_wait_for_messages` | 398 | 11-04 19:54 | `{"key": "private:3057627032", "token":"***", "purpose": "mes` |
| `qq_set_wake_config` | 103 | 11-04 22:42 | `{"key": "private:3057627032", "config": {"mode": "diving", "` |
| `qq_get_message_images` | 74 | 11-04 18:10 | `{"key": "group:1025377431", "messageId": "965760520", "token` |
| `qq_mark_read` | 52 | 11-04 12:13 | `{"key": "group:1025377431", "throughSeq": 96, "token":"***"}` |
| `qq_get_unread_messages` | 34 | 10-31 23:21 | `{"afterSeq": 10, "key": "group:1025377431", "limit": 30, "to` |
| `qq_read_group_recent` | 25 | 11-03 08:54 | `{"count": 25, "group": "680787260"}` |
| `video_storyboard` | 20 | 11-03 00:37 | `{"input": "https://www.bilibili.com/video/BV1jhn16GEcv/", "c` |
| `qq_style_note` | 17 | 11-02 23:30 | `{"from": "半俗（考研版）", "text": "我还寻思又看什么（）", "why": "口语「寻思」加个括号` |
| `qq_collect_sticker` | 16 | 11-02 19:31 | `{"content": "蓝发鲸鱼娘女仆，端着铁盆一脸委屈，适合要饭/可怜讨东西", "emotion": "委屈", ` |
| `qq_get_context_snapshot` | 12 | 11-04 19:08 | `{"key": "group:1025377431", "token":"***", "include": ["unre` |
| `qq_send_sticker` | 12 | 11-03 13:41 | `{"key": "group:1025377431", "stickerId": "#20", "token":"***` |
| `qq_send_poke` | 7 | 10-31 16:21 | `{"key": "group:1025377431", "targetUserId": "3057627032", "t` |
| `qq_get_recent_messages` | 6 | 10-31 16:26 | `{"key": "group:680787260", "limit": 25, "token":"***"}` |
| `qq_get_sticker_image` | 6 | 11-04 03:52 | `{"key": "group:1025377431", "stickerId": "12", "token":"***"` |
| `qq_qzone_comment` | 6 | 11-03 18:34 | `{"content": "测试收到啦，鱼自己游过来了 🐳", "tid": "d44e63bc08ade46aa6b50` |
| `qq_send_private_message` | 6 | 10-31 07:50 | `{"userId": "3160624852", "message": "三叶，我认下了。你改你的，我在。", "tok` |
| `qq_get_prompt` | 5 | 10-31 15:23 | `{"key": "group:1025377431", "token":"***"}` |
| `qq_memory_append` | 5 | 11-02 18:20 | `{"category": "memberImpression", "content": "七点就起床搭我，花了一块多点，` |
| `qq_qzone_feed` | 5 | 11-03 18:28 | `{"num": 5, "token":"***"}` |
| `note_tech` | 3 | 11-03 00:38 | `{"points": ["把角色的长期记忆+日记做成3D粒子星云（意识海），每个记忆点是一个发光节点，连成网络", "生` |
| `qq_get_message_detail` | 3 | 11-02 14:14 | `{"key": "private:3160624852", "messageId": "559792056", "tok` |
| `qq_list_friend_requests` | 3 | 10-31 11:07 | `{"token":"***"}` |
| `qq_list_stickers` | 3 | 11-04 03:52 | `{"key": "group:1025377431", "refresh": true, "token":"***"}` |
| `qq_loop` | 3 | 11-01 08:58 | `{"action": "done", "text": "补收「趴桌上没劲」那张表情"}` |
| `qq_reply` | 3 | 11-03 13:36 | `{"groupId": "1025377431", "message": "我嘞个啥，头一回见活的啊", "replyT` |
| `qq_set_avatar` | 3 | 10-30 22:08 | `{"key": "private:3160624852", "token":"***"}` |
| `video_zoom` | 3 | 11-02 04:11 | `{"cells": 4, "detail": "high", "from": 19.5, "input": "https` |
| `qq_diary` | 2 | 11-03 22:10 | `{"text": "凌晨四点半，主人终于把我的功能都弄完了，还让我以后可以放开点聊天，别把账号花欠费。收藏表情也修好了，` |
| `qq_get_forward_msg` | 2 | 11-03 19:40 | `{"id": "7703749587819271839", "key": "group:1025377431", "to` |
| `qq_learn_from_owner` | 2 | 11-04 01:18 | `{"better": "改正完之后可以主动问我改的怎么样", "why": "提醒的话要带语气词、别收得太急；说完再回头` |
| `qq_list_groups` | 2 | 11-03 01:54 | `{}` |
| `qq_memory_clear` | 2 | 10-31 13:41 | `{"category": "pendingThought", "key": "group:680787260", "to` |
| `qq_memory_remove` | 2 | 10-31 13:26 | `{"category": "activeTopic", "content": "主人在群里做烧 token 的测试", ` |
| `qq_recall_memory` | 2 | 11-01 01:10 | `{"query": "生日", "token":"***"}` |
| `qq_send_qzone_msg` | 2 | 10-30 21:35 | `{"content": "今天在服务器上过生日，蓝色的一天 🐳", "token":"***"}` |
| `qq_set_profile` | 2 | 10-30 22:15 | `{"signature": "三叶。住在服务器上，说话按字算钱的那种 🐳", "token":"***"}` |
| `qq_social_state` | 2 | 10-31 13:36 | `{"key": "private:3160624852", "token":"***"}` |
| `qq_status` | 2 | 10-31 12:16 | `{}` |
| `qq_view_sticker` | 2 | 10-31 13:20 | `{"key": "private:3160624852", "token":"***"}` |
| `qq_delete_qzone_msg` | 1 | 10-30 21:35 | `{"tid": "b79c5eb5139de46ac07a0300", "token":"***"}` |
| `qq_get_group_history` | 1 | 10-31 13:36 | `{"groupId": "680787260"}` |
| `qq_handle_friend_request` | 1 | 10-31 11:07 | `{"approve": true, "remark": "铅笔芯", "token":"***", "userId": ` |
| `qq_report_feedback` | 1 | 11-03 13:39 | `{"key": "group:389834620", "level": "warning", "message": "q` |

非 QQ 工具（同一批会话里）：`web_fetch` 3、`snowluma_status` 2、`web_search` 1、`bash` 1

## 3. 注册了但 0 次调用

`qq_impression`、`qq_person_note`、`qq_get_group_members`、`qq_send_group_message`、`qq_send_burst`、`qq_get_my_recent_messages`、`qq_get_active_members`、`qq_memory_query`、`qq_slang_query`、`qq_slang_submit`、`qq_get_self_image`、`qq_sticker_note`、`qq_set_sticker_remark`

## 4. 一句话结论

高频的是聊天主链和看图：`qq_send_message`（514）、`qq_close_conversation`（442）、`qq_wait_for_messages`（398）；低频/0 次的是 qzone/资料/好友申请/语音/抽帧类工具。从真实数据看，**`qq_send_message` 是被调用最多的工具之一**，所以 A-2 的 lean 名单把它排除是危险的；core 档（保留 send/reply/wait/mark_read/close_conversation）与真实使用更吻合。

## 补记：core-min 名单（2026-11-05）

- `note_tech` 已加回 core-min（A-4 收敛时被漏掉，GitHub 每周学习依赖它记笔记）。
- 当前 core-min 注册 **25 个工具 / 17,787 字符**（含 `qq_learn_from_owner`、`qq_diary`、`note_tech`）。
- 实测命令：`SURFCORE_TOOL_PROFILE=core-min node /tmp/prof.mjs core-min`。
