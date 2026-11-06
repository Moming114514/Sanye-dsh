# TASK-B1（面板 2.1 / 表情清理 / 人味周报 + 两份设计）

> 推理强度：high（不要升 max）。预算闸门：预计单步 > ¥0.4 先停下报告。
> 规矩：一任务一 commit；`node --check`；面板改动同步 `panel/`；**不要重启桥接**（面板重启可以）。

## B1｜面板页面由插件清单生成（manifest 加 `pages`）
目标：以后新增一个 ext，只要在 manifest 里写 `pages: [{id, title}]`，面板导航就自动多一项，不用改两处。

1. 给 manifest 契约加**可选**字段 `pages`（数组，元素 `{id, title}`），更新 `docs/EXT-MANIFEST.md`；
2. 给已有页面的模块补 `pages`（按 `panel/public/assets/app.js` 里现有 PAGES 对照，能对上几条是几条，对不上的不要硬编）；
3. 面板：启动时读 `/api/plugins`，把带 `pages` 的模块合并进侧栏「她的言行/系统」对应分组（分组按 manifest.layer）；**内置 PAGES 优先级更高**，冲突时以内置为准；
4. 无 `pages` 或接口失败时，行为与现在**完全一致**（这是硬要求，回归不能变）；
5. 验收：`node scripts/dump-manifests.mjs --require-all --strict` 通过；面板 12 页 pageerror 0；临时给一个模块加 `pages` → 刷新后导航多一项 → 去掉后消失。

## B2｜表情库 404 清理（先 dry-run）
1. 写 `scripts/sticker-audit.mjs`：读 `apps/surfcore/state/stickers.json`，对每个 `url` 发 HEAD（3 秒超时，失败重试 1 次），输出 `{id, no, desc, url, status}` 清单；
2. 默认 **dry-run** 只打印；`--apply` 才把 404/410 的条目移到 `state/stickers.removed.json`（不直接删，保留可恢复）；
3. 输出汇总：总数 / 失效 / 可用 / 超时；并写入 `state/sticker-audit.json` 供面板展示；
4. 面板「记忆与情绪」或「系统→维护」加一行只读摘要（可选，若时间够）；
5. 验收：先跑 dry-run 给出真实数字，`--apply` 后 `stickers.json` 条数减少、`stickers.removed.json` 增加同数。

## B3｜人味指标周报
1. 写 `scripts/human-report.mjs`：复用面板 `/api/human-stats` 的算法（同一套停用词与实词重合度定义），按**自然周**聚合，输出 Markdown 到 `docs/reports/human-YYYY-Www.md`，含：句长中位数（群/私聊）、实词重合度、标点分布、总结句比例、样本数、与上周对比；
2. 生成脚本要能离线跑（不依赖面板进程），数据源 `state/social-v2.json`；
3. 面板「说话 → 人味指标」页底部加「最近 4 周」小表（读 `docs/reports/` 目录或 `/api/human-report`）；
4. 验收：手工跑一次生成本周报告，数字与面板当前值一致（允许 ±1% 舍入）。

## C1｜权限分级设计（只写文档，不改行为）
`docs/PERMISSIONS.md`：
- 三级定义：**绿**（只读查询，自动允许）/ **黄**（写操作，需要限频或确认）/ **红**（危险：改配置、清数据、发消息给陌生人、执行命令）；
- 把现有 MCP 工具（约 50 个）与 `/api/*` 写接口各归类一次，列成表；
- 给出实现建议（如 `wrapTool(name, level)`、拒绝时的日志与提示文案），**不写代码**；
- 末尾列出 3 个「现在就可能被滥用」的具体场景。

## C2｜脱壳演练设计（只写文档，不改行为）
`docs/DECOUPLE-DRILL.md`：
- 用现成 `sanye-archive/portable/` 包 + `rebuild-prompt.mjs` 在**一台干净环境**（新容器/新机器）里重建她；
- 步骤：准备 Node 22 → 解包 → 装依赖 → 配 config → 起 bridge（不连 QQ，干跑）→ 用 `rebuild-prompt.mjs` 重建提示词 → 与服务器版本对比结构（段落顺序/字数）；
- 验收标准：重建出的提示词段落顺序一致、字数差 < 5%、`DECOUPLE.md` 里列出的 7 个钩子都有实现；
- 明确「这次不连 QQ、不接 NapCat」的原因（避免双实例抢号）。

## 交付顺序建议
B2（最快、可立即看到数字）→ B1 → B3 → C1 → C2。
