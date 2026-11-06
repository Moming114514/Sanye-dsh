# 控制台拆分：收尾报告（R9 系列，2026-11-06）

## 一、结果

| 步骤 | 搬出内容 | bridge 行数 |
|---|---|---|
| 起点 | — | 18,632 |
| R1~R8 | 文本/媒体/语音/发送/token/closure/history 等纯函数 | 16,769 |
| R9-1 | `/api/status` + 5 条 tokens | 16,703 |
| R9-2 | roles / debug 5 条 | 16,677 |
| R9-3 | social-read 7 条 | 16,625 |
| R9-4 | session-detail 7 条 | 16,520 |
| R9-5 | misc-read 7 条 | 16,488 |
| R9-6 | agent-read 7 条 | 16,342 |
| R9-7 | voice 3 条 | **16,337** |

**净减 2,295 行（−12.3%）**，`src/lib/` 下新增 9 个模块，`src/console/routes/` 下 6 个路由文件。

## 二、为什么停在这里

R9-7 只搬动 **5 行**，说明「可安全搬出的路由」已经搬完。剩下的分四类：

1. **要 bot 实例**：`sticker-list`、`sticker-image`、`self-image`、`images/message`、`debug/frames`；
2. **写接口/破坏性**：`/api/restart`、`/api/test-send`、`session|workspace/reset`、`sticker-prune`、`prompt`（POST）；
3. **走 ext 插件分发**：`style-*`、`slack`（`extDispatchRoute` 处理）；
4. **控制台骨架本身**：`/api/console/*`、SSE、静态页、会话选择等 ~5,000 行，与运行状态强耦合。

继续拆这四类，每拆一条都要新增 `ctx.send`（二进制）、给 router 加能力、或把状态注入做得更复杂——**风险上升、收益递减**。

## 三、留下的资产（以后要拆就用这些）

- `scripts/check-routes.mjs` + `scripts/snap-base/routes.json`：176 条路由快照，方法+路径级对比；
- `src/console/http.js`：router 契约（未命中不写 / 命中写一次 / 抛错写一次 500 并 `return true` / 405）；
- `src/console/routes/*.js`：6 个已迁文件，可作为新路由的模板；
- `AGENTS.md` 里两条硬规矩：**依赖必须是进程级稳定对象**、**搬迁后判空兜底 + 真实 fixture 单测**；
- 每个迁移点原位留 `// moved to src/console/routes/xxx.js (R9-n)`，可 grep 追溯。

## 四、如果以后还要继续

按这个顺序，每条都必须过 `verify` + `routes` + 三类探针（搬走的 / 没搬的 / 不存在的）：

1. 给 router 加 `ctx.send(buf, headers)`，搬 `/api/voice/packs/sample` 这类二进制；
2. 给 router 注入 `getBot()`，搬 `sticker-*` 与 `images/message`（注意：bot 必须在调用时才取，不能注册时固定）；
3. `/api/console/*` 单独一轮，先抽「SSE + 静态页」再抽「会话管理」。

## 五、验收口径（保持）

```
npm run verify        → VERIFY_PASS（语法 / 单测 / 清单 / 代码快照）
npm run routes        → ROUTES_OK count=176
node scripts/replay-hooks.mjs → hooks=12 diffs=0 nondet=0
```
