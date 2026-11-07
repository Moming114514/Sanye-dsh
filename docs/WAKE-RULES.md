> 最后更新：2026-11-07 20:32

# 唤醒规则

## mode 默认值

- `active`：**强制** `infinite=true`、`sleepUntil=null`；`anyMessage` 默认 true，**调用方显式给 false 时保留 false**。
- `diving`：**强制** `infinite=false`、`sleepUntil` 最长 30 分钟（DIVE_CAP）；从 active 切 diving 且未显式给 anyMessage 时置 false；同一群 1 小时内最多切 2 次（DIVE_LIMIT）。
- 其它 mode：不写这些默认值，字段按调用方传入。

## 强制 vs 默认

| 字段 | 性质 | 说明 |
|---|---|---|
| active.infinite | 强制 | 代码写死 true |
| active.sleepUntil | 强制 | 代码写死 null |
| diving.infinite | 强制 | 代码写死 false |
| diving.sleepUntil | 强制 | clamp 到 now+30min 以内 |
| active.anyMessage | 默认 | 缺省 true，显式可覆盖 |
| diving.anyMessage（切换时） | 默认 | 缺省 false，显式可覆盖 |
| 其余 triggers.* | 调用方 | 缺省沿用当前值 |

## 当前各群（state 实读）

| 群 | mode | @我 | 叫名字 | 拍一拍 | 任意消息 | 问句 | 概率 | 关键词数 | sleepUntil |
|---|---|---|---|---|---|---|---|---|---|
| `group:1043145514` | active | ✓ | ✓ | ✓ | ✗ | ✗ | 0.05 | 5 | — |
| `group:1025377431` | active | ✓ | ✓ | ✓ | ✗ | ✗ | 0.05 | 5 | — |
| `group:680787260` | active | ✓ | ✓ | ✓ | ✗ | ✗ | 0.05 | 5 | — |
| `group:389834620` | active | ✓ | ✓ | ✓ | ✗ | ✗ | 0.05 | 5 | — |

> 面板：群规则页每群下方「叫醒条件」一行；读 `/api/socialV2/states`，读不到显示「未知」。
