# 副手模式（TASKS-SIDECAR）

> 目的：后台学习/整理类任务不再背人格四层与记忆卡，只给「工具 + 任务 + 最小输出要求」。
> 改动范围：`src/bridge.js` 一处旁路 + `src/ext/sidecar-task.js`；不改 DSH、不加会话、不发 QQ 消息。

## 一、哪些任务走副手

默认四个 `reason`：

| reason | 触发场景 |
| --- | --- |
| `study` | B 站学习任务（挑视频、看完记 `note_tech`） |
| `style-learn` | 手动学说法 |
| `style-learn-auto` | 自动学说法 |
| `github-learn` | GitHub 每周学习 |

命中时 `buildWakePromptV2` 在函数最开头返回：

```
【会话令牌】…（工具要用）
【副手模式】本次是后台任务（<reason>），不在和任何人聊天。
只做下面这件事：用工具取需要的数据，按任务要求整理结果；不扮演角色、不提人格与记忆、不寒暄、不主动发 QQ 消息。
输出要求：纯文本，1~3 句或条目式要点；工具报错就把错误原文附上；不需要引用设定或回忆过去。
```

同时日志打一行：`[task] 副手模式（无persona）reason=study promptChars=123`。

## 二、加/减任务

配置项（不写就用默认四个）：

```json
{ "socialV2": { "tasks": { "noPersona": ["study", "style-learn", "style-learn-auto", "github-learn"] } } }
```

- 加：把对应 `reason` 写进数组。
- 减：从数组里删掉；数组为空/缺省时回到默认四个（`sidecarReasons()` 的行为）。
- 只影响 `buildWakePromptV2` 这条链路；`reason=message` 等聊天唤醒完全不受影响（旁路在任何人格段落组装之前）。

## 三、回滚

1. 单任务回滚：把该 `reason` 从 `socialV2.tasks.noPersona` 移除并重启桥接。
2. 整体回滚：删掉 `src/bridge.js` 里 `// SIDECAR_PATCH` 开头的早期返回块（3 行 + 注释），`node --check` 后重启。
3. 配置误写：`noPersona` 不是数组时按默认四个处理，不会把聊天任务误判成副手。

## 四、验证

```bash
node scripts/test/sidecar-task.test.mjs   # SIDECAR_OK
npm run verify                            # VERIFY_PASS
```

单测覆盖：副手提示词不含人格/记忆/语气/反AI味段落；默认四个 reason；`message` 不命中；配置覆盖生效；bridge 里只有一处旁路且位于人格段落之前。

> 注意：桥接需重启后 `[task] 副手模式` 才会出现；本改动未重启。
