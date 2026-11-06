# TASK-W2：用户点名的 6 件事（按顺序做，每条自验）

> 起手：`cd /home/dsh/apps/surfcore && git status`，确认在 `dev` 分支、工作区干净或只有本次改动。
> 规则：**改 bridge 前先备份**；能热加载就别重启；必须重启时先问我（本会话由用户转达）。
> 每做完一条：`node --check` + 相关 curl 自验 + 一句话结论，再做下一条。

## 0. 环境事实（别重复踩）

- bridge：systemd `surfcore-bridge` 托管，pid 见 `systemctl show -p MainPID --value surfcore-bridge`；日志 `/var/log/surfcore-bridge.log`（**不是** journal，`grep -a`）。
- 面板：`/opt/her-console`（server.mjs + public/assets/app.js + style.css），端口 7800，token 在 `/opt/her-console/token.txt`。
- 配置：`/home/dsh/apps/surfcore/config.json`；状态在 `/home/dsh/.dsh/surfcore/state/*.json`。
- 桥接**只在启动时读 config**（这就是下面第 1 条要解决的）。
- `node --check` 查不出未定义标识符；改长 OR 白名单后必须 curl 一次相关接口。

## 1. 配置热加载（最高优先级）

**问题**：面板改了配置（如 `tokenGuard.maxWakesPerDay`），config.json 确实变了，但桥接不读 → 必须重启才生效，用户体感是"调了没用"。

**做法**：在 bridge 里加一个 `refreshCfgFromDisk()`：用 `statSync('config.json').mtimeMs + size` 做缓存键，变化时重新 `loadConfig()` 并更新内存里的 `cfg`（注意 `cfg` 目前是 `const`，要改成 `let` 或原地 `Object.assign`，别破坏闭包引用）。在两个高频入口调用：
- `evaluateWakeTriggerV2()` 开头
- `tokenGuardDowngrade()` / `tokenGuardTodayCost()` 之前

**验收**：
```bash
TOK=$(python3 -c "import json;print(json.load(open('config.json'))['consoleToken'])")
# 改前
curl -s -H "x-console-token: $TOK" http://127.0.0.1:3100/api/socialV2/prompt?key=private:<owner> | head -c 120
# 把 maxWakesPerDay 改一次（120→121），**不重启**
# 再触发一次唤醒，日志里应出现新值（或加一行 log('[cfg] reloaded') 便于确认）
```
**不通过就不要往下做。**

## 2. 情绪砍到 6 个

SC（surfcore 自带）是 6 个：`excited 兴奋 / happy 开心 / calm 平静 / focused 专注 / proud 小得意 / curious 好奇`。

我们现在 12 个（多出：annoyed 烦躁、tired 有点累、sympathy 心疼、awkward 别扭的甜、like 喜欢、lonely 孤单）。

**做法**：
1. `src/mood-lib.js`：`MOODS` 只留 6 个，基线分与观测规则重写（参考 SC 的 `MOOD_BASE`/`MOOD_HINTS`，在 `plugins/surfcore/lib/` 里找）。
2. 面板 `pageMemory()` 的心情卡：只画这 6 个（`MOOD_CN`、`MOODSTAR_UI`、曲线五条线一并改）。
3. 迁移：`state/mood.json` 里旧键值合并到最接近的新键（tired→focused、annoyed→calm、lonely→calm 等），别让历史曲线断档。
4. 提示词 `moodLine()` 输出只允许这 6 个。

**验收**：`/api/socialV2/mood` 只返回 6 个键；面板心情卡 6 条；私聊提示词里【今天的感觉】只出现 6 个名词之一。

## 3. README 精简

现在 README 太长、功能清单一眼看不出重点。要求：
- 首屏 30 行内说清：**这是什么、给谁用、怎么跑起来、需要什么**；
- 功能清单压到 **12 行以内**（每行一句，不写实现细节）；
- 细节全部移到 `docs/FEATURES.md`（新建，把现在的清单原样搬过去）；
- README 里留一行链接「完整功能列表 → docs/FEATURES.md」。

**验收**：`wc -l README.md` ≤ 120 行；项目符号 ≤ 40 个；`docs/FEATURES.md` 存在且链接不 404。

## 4. 人格卡精简（保留边界，删解释）

原则：**删解释，不删边界**。保留 8 条铁律（`## 〇`）、群/私聊称呼规则、三个"绝不"、例子各留 1 个；删掉重复解释、说明书式长句。

目标：`persona.tone.md` 6000 → **≤ 3800 字**；`persona.md` 保持不动。

**验收**：`python3 -c "import io;print(len(io.open(path,encoding='utf-8').read()))"` ≤ 3800；提示词里 8 条铁律与例子仍在（grep 3 个关键词）。
**注意**：改人格文件 = 一次缓存重建（≈¥0.1），改完告诉用户。

## 5. 7788 花费面板（本机，已由我修好启动器，你只验证）

- 启动器已换成 `C:\Users\31606\her\cost-panel-start.ps1`（检测端口 → 用 node 直接起，不依赖 DSH 的 Electron），当前 7788 已在跑。
- 你只需要：用 curl 确认 `http://127.0.0.1:7788/api/data` 返回 200 且含 `sessions`；页面打开是 2 个会话；切换会话后表格刷新。
- 如还有 bug，记录现象 + 复现步骤，**不要大改**（这是用户自己的本机工具）。

## 6. 精细回归排查（避免返工）

逐项打印/curl 结论，输出一张「功能 → 状态 → 证据」表，不要只写"正常"：

| 功能 | 怎么验 |
|---|---|
| QQ 在线 | 日志最近一条 `发送 ->` 或 `收到` |
| 群唤醒 | `/api/socialV2/grouprate` list 有今日计数 |
| 注意力 | 日志 grep `[注意力]`，应能出现跳过记录 |
| 只回鱼小七 | config `attention.replyOnly` 与日志 |
| 抽样 | 日志 grep `[抽样]` |
| 群摘要 | 私聊提示词含【各群在聊什么】 |
| 学样 | `style-samples.json` 条数与 mtime |
| 建议收集 | `state/bot-advice.jsonl` 行数 |
| 记忆注入 | 私聊提示词 `记忆卡` 段字节数 |
| 情绪 | `/api/socialV2/mood` 6 键 + 数值不饱和 |
| 花费 | `/api/cost` 今日金额与 `/api/tokens/daily` 一致 |
| 自检 | `/api/selfcheck` ok=true bad=0 |

完成后把这张表贴回来。

## 交付

- 每条一个 commit（`feat:` / `fix:` / `docs:`），不要一次大提交。
- 全部做完：`npm run verify` → `VERIFY_PASS`，然后告诉用户"可以推送"。
