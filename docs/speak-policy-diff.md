# speak-policy 与现状的差异对照（W5-C 第 3 步）

> 2026-11-04 生成。现状 = 按真实顺序调用各 ext 的 wakeGate（mute 20 → learn 30 → economy 40 → rate 50 → attention 60 → safe 100）+ 鱼群 until；目标 = `src/ext/speak-policy.js` 的纯函数。
> 状态文件全部写在临时目录，抽样随机源固定，不连 QQ、不碰线上状态。

| 场景 | 现状 (allow/source) | 目标 (allow/source) | 是否一致 |
|---|---|---|---|
| 静音 | false / mute | false / mute | 一致 |
| 学习(非主人@) | false / learn | false / learn | 一致 |
| 学习(主人@) | true / pass | true / attention | **不一致** |
| 只回别人 | false / attention | false / replyOnly | **不一致** |
| 省钱 | false / economy | false / economy | 一致 |
| 频率超限 | false / rate | false / rate | 一致 |
| 注意力不够 | false / attention | false / attention | 一致 |
| 抽样命中 | true / pass | true / sample | **不一致** |
| 鱼群冷却 | false / fishGuard | false / fishGuard | 一致 |
| 敏感降温 | false / safe | false / safe | 一致 |
| 私聊 | true / pass | true / attention | **不一致** |
| 全部通过 | true / pass | true / attention | **不一致** |

差异 5 条，其中会导致行为不同（allow 不同）的 0 条。
- 学习(主人@): 现状=pass → 目标=attention（判断结果相同，仅来源标签/时机不同）
- 只回别人: 现状=attention → 目标=replyOnly（判断结果相同，仅来源标签/时机不同）
- 抽样命中: 现状=pass → 目标=sample（判断结果相同，仅来源标签/时机不同）
- 私聊: 现状=pass → 目标=attention（判断结果相同，仅来源标签/时机不同）
- 全部通过: 现状=pass → 目标=attention（判断结果相同，仅来源标签/时机不同）

补充探针（不计入 12 组）：
- P1 分数过期 + replyOnly 名单：现状 allow=true（分数过期直接放行） / 目标 allow=false source=replyOnly → **行为不同**
- P2 同一分钟连判两次：现状 \[true/pass, false/rate\] / 目标 \[true/attention, true/attention\] → **行为不同**（现状会 bump 消耗额度，目标只读）

## 结论

- 12 组主用例：差异 5 条，全部是来源标签/判定时机不同，allow 一致（0 条行为不同）。
- 补充探针另发现 2 条真实差异：
  - **P1（行为不同）**：分数超过 10 分钟过期时，现状直接放行、不再看 replyOnly 名单；目标仍按名单拦。后果：冷场一段时间后，名单外的人 @ 她也可能被接话。
  - **P2（会改变后续判断）**：频率闸门放行时现状会 bump 计数，同一分钟第二次同群唤醒被拦；目标只读，不消耗额度。后果：接入目标实现后，频控需要由调用方另行记账。
- 另有一条已知限制：抽样每日上限由 attention 内存计数，目标侧不复核（note 已标注）。
