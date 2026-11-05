# TASK-SIMPLIFY 设计稿（D-5）

> 目标：把面板里「7 个闸门 + 一堆滑杆」收成 3 个用户能说清楚的开关。
> 原则：**只加映射层，不删旧字段**；旧面板/旧配置照旧能用，随时一键退回。

## 1. 三个开关

### 1.1 每群 3 态（替代 level + triggers 组合）

| 新开关 | 现在的等价物 | 行为 |
|---|---|---|
| 正常 | `level: 2（活跃）` + `atMention/nameMention/question/poke` 全开 | 被叫到会回；有概率主动搭话 |
| 只听叫 | `level: 1（正常）` + 只留 `atMention/nameMention/question/poke` | 只在被叫到/被问/被戳时回 |
| 只看不说 | `level: 0（保守）` + `enabled` 保留 | 消息照常入库、打分、记忆；不唤醒、不发送 |

「正常」内部的频率仍由第 2 个开关的档位决定，不再要求用户理解 15/6/2 分钟。

### 1.2 活跃度 3 档（同时映射频率 + 抽样 + 注意力阈值）

| 档位 | group-rate（minGap / 每天） | attention.minScore | attention.sample.default | 说明 |
|---|---|---|---|---|
| 安静 | 15 分钟 / 12 次 | 3 | 0% | 一天最多说十几次 |
| 正常 | 6 分钟 / 40 次 | 2 | 沿用现网 `socialV2.attention.sample` | 默认 |
| 热闹 | 2 分钟 / 120 次 | 1 | 在当前 sample 上 +5%（上限 20%） | 群很活跃、她也在兴头上 |

夜间的 `group-rate` 冷却、`fishGuard`、`safe-talk`、活跃期（D-3）**全部保留，只是不暴露给用户**。

### 1.3 每天花费上限

`tokens.daily.limit` 一个字都不动，只是挪到「三个开关」区变成第 3 个输入框；`tokenGuardWakeBlock` 与降级逻辑照旧。

### 1.4 旧 7 闸门 → 新 3 开关

```
owner-only / mute / learn / replyOnly / economy / rate / attention / sample / fishGuard / safe
   ↑ 前 4 个保留为「高级」折叠区，后 6 个不再暴露
```

保留但不暴露的：`fishGuard`（鱼群保护）、`safe-talk`（敏感降温）、`active-window`（活跃期）、`closure`（收尾冷却）、`tokenGuard`（花费/额度）、`wakeRate`（唤醒限频）、`quiet hours`。

## 2. 权限分级（12 个关键动作）

| 动作 | 档位 | 现在的入口 | 说明 |
|---|---|---|---|
| 给会话发文字 | 绿·自动 | `qq_send_message` / `qq_reply` | 已受频率/花费/静默三重约束 |
| 发表情 | 绿·自动 | `qq_send_sticker`（D-4） | 不能带文字；失败要说出来 |
| 看图/抽帧 | 绿·自动 | `qq_get_message_images` / `qq_view_sticker` | 只读 |
| 记一条记忆 | 绿·自动 | `qq_memory_append` | 可被 `qq_memory_remove` 撤回 |
| 发语音 | 黄·半自动 | `qq_send_voice` | 发出前在会话里标注「我现在说话」；失败改打字 |
| 发 QQ 空间 | 黄·半自动 | `qq_send_qzone_msg` | 默认仅自己可见；改范围需主人 |
| 删自己的说说 | 黄·半自动 | `qq_delete_qzone_msg` | 只能删自己发的，动作记审计 |
| 撤回消息 | 黄·半自动 | 现有 recall 能力 | 只允许撤回自己 2 分钟内的消息 |
| 改群名片/头像/资料 | 红·人工确认 | `qq_set_avatar` / `qq_set_profile` | 面板确认后才生效 |
| 加好友/处理好友申请 | 红·人工确认 | `qq_handle_friend_request` | 一律进主人私聊确认 |
| 删除/清空记忆 | 红·人工确认 | `qq_memory_remove` / `qq_memory_clear` | 面板二次确认 + 可恢复窗口 |
| 全局暂停/关机/改闸门 | 红·人工确认 | 面板「开关」 | 按钮二次点击 + 10 秒可撤销 |

### 2.1 面板最小交互（不引入弹窗组件）

- 黄档：动作旁显示「待发」徽标，点一次进入倒计时条「3 秒后发出 · 撤销」，不点自动发。
- 红档：列表项下方展开一行确认条——「这会改头像，确定？（再次点击确认）」；确认后写入审计日志 `auditOwner`。
- 任何黄/红动作都在「她说的话」页留一条记录，带「撤销」入口（能撤回的才显示）。

## 3. 风险与回滚

| 改动 | 风险 | 回滚 |
|---|---|---|
| 面板三开关（只写旧字段） | 映射错 → 她该说话时不说 | 关 `socialV2.simple.enabled` 即回旧面板行为；旧字段没删 |
| 活跃度档位覆盖 sample | 热闹档抽样偏高，可能多说话 | 档位改回「正常」即恢复原 sample |
| 只看不说 | 用户以为她坏了 | 按钮旁文案写清「消息仍会记，只是不回」；一键切回正常 |
| 权限红档 | 确认条被误点 | 红档动作全部写 `auditOwner`，5 分钟内可撤销（头像/资料立即回滚为旧值） |
| D-4 表情发送 | 表情库被刷屏 | `socialV2.sticker.enabled=false` 一键关；MCP 工具按 `sendSticker` 开关隐藏 |
| D-3 活跃期 | 主人叫醒后别人也享受 10 分钟 | `socialV2.activeWindow.minutes=0`（或删该段）即关闭 |

### 3.1 实施顺序建议

1. 先做**只读预览**：面板把当前 `level/triggers/attention` 换算成「将映射为 安静/正常/热闹」显示出来，不写。
2. 用户确认映射无误后，再开写入（写的是旧字段，不新增状态）。
3. 最后才把旧滑杆收进「高级（不常用）」折叠区，留一个「回到旧面板」的入口。

## 4. 这次不做的

- 不合并 `fishGuard`/`safe-talk`/`active-window` 的判断逻辑，只做展示层映射。
- 不动 `speak-policy`（W5-C）的判定顺序；三开关只是给它喂不同的快照值。
- 不上弹窗组件，红档确认用行内确认条。
