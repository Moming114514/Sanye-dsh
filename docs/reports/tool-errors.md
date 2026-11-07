> 最后更新：2026-11-07 20:24

# 今日工具调用失败统计（只读）

- 日期：2026-11-07（东八区）
- 数据源：`~/.dsh/sessions/--home-dsh-work--/*/session.v4.jsonl.zstd`（她自己的会话，共 8 个）
- 工具调用 202 次 / 结果 205 条 / 失败 3 次

## Top 5（按失败次数）

| # | 工具 | 失败次数 | 主要原因 |
|---|---|---|---|
| 1 | `qq_close_conversation` | 3 | Error: 收尾失败：对方最后一句是在提问/求助，还没回答；先用 qq_send_message 回完再收尾。如果已经×3 |

## 判定口径

- `isError=true`；
- 结果文本含 `unknown tool` / `工具不存在` / `tool not found`；
- 结果文本是 JSON 且 `ok:false`；
- 超时（`timed out`）按失败计。

> 说明：只统计会话转录里能看到的调用/结果；网关层未落到转录的错误不在内。

