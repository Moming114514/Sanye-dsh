# 交接包 · 三叶（surfcore 改造分支）

> 给接手的 AI：先读完本文件 + `AGENTS.md` + `docs/DECISIONS.md` + `docs/PLUGIN-CONTRACT.md`，再动手。
> 这份包的目标：把「一个人一周堆出来的能跑的东西」变成「能长期加功能的架构」。

## 1. 这是什么

一个 QQ 机器人（DeepSeek 驱动）的**个人改造分支**：底座是上游 **SurfCore v0.8.1**（`Mieksido/surfcore`），跑在阿里云 Ubuntu 上，通过 **NapCat / OneBot v11** 接 QQ，DSH 提供 agent 运行时。

仓库：`Moming114514/Sanye-dsh`（分支：`dev` 日常 / `main` 只发布）
服务器：`/home/dsh/apps/surfcore`（代码）、`/home/dsh/.dsh/surfcore/`（状态与人格卡）
面板：`/opt/her-console`（Node 单文件服务，7800）

## 2. 现在的真实状态（2026-11-03）

- 功能**能跑**：群里聊天、私聊、记忆卡、情绪、学说法、B站/QQ空间、表情、定时提醒、省钱、面板 15 页。
- 但**结构是坏的**（数字为 2026-11-03 19:4x 实测，勿用旧值）：
  - `src/bridge.js` **18091 行**，里面 **126 处 `_PATCH` 标记 / 66 个不同名字**（比 D-002 记录时又涨了 52）；
  - `src/ext/` 有 **31 个 .js**，但 `index.js` 注册表只收 **17 个**，bridge 另直接 import **15 个**，其中 `stickers.js` / `promises.js` **两条路都在**；
  - `npm run verify -- --no-api` 绿（115 文件 + 5 单测）；**完整 `verify` 红 1 项**：结构快照，因为人格卡被改过（提示词 9984→13568 等），不是代码坏了；
  - 面板是**写死的页面**（每加功能改 `app.js` 一个大文件），且**大量重复/冲突开关**；
  - 面板与桥接多处**各自维护一份状态**（如心情），导致"能改但不准"。
- 结论（用户原话）：「V1 是伪命题，这种不完善的状态不可能稳定运行」。→ 所以下一步不是修 bug，是**一次结构性整理**。

## 3. 硬规则（违反会直接坏事）

1. **禁止整文件重写**。改一个函数就只改那个函数；必须改大范围时先在 `docs/` 写方案给我（用户）确认。
2. **先搜现有实现再动手**：`grep -rn` 仓库；优先复用上游代码与已有模块，不要另写一套。
3. **先验后端再接界面**：改完接口先 `curl` 拿到真实数据，再动 UI。页面空白第一步是**显示错误**，不是截图猜。
4. **同一问题最多迭代 3 次**，第 3 次失败必须停下来报告并换思路。
5. **COST GATE**：要读图 / 全量扫描 / 重写 >500 行 / 预计 >15 步 / 需要多次重启 → 先报「约 N 步、¥X，做吗」并等确认。
6. **TODO-FIRST**：跨一步以上的活，第一句先给编号 TODO（3~6 条）+ 代价，收尾逐条打勾。
7. **不许删的六条底线**：身份称呼（永不叫主人）、边界（不承认是 AI）、记忆规则（想不起来查工具不编）、群聊约束（没 @ 不插话、一次一条）、纠错规则（15 字内改口）、三个绝不（不背设定/不列三条/不评论自己上一句）。详见 `AGENTS.md`。
8. **隐私**：`config.json`、`state/`、`characters/` 已在 `.gitignore`，**永不提交**；截图给用户前必须打码（QQ 号/群号/令牌/真实对话）。

## 4. 文件地图（服务器）

| 路径 | 作用 |
|---|---|
| `src/bridge.js` | 主程序（1.7 万行，96 处补丁）—— **要拆的就是它** |
| `src/ext/` | 26 个扩展模块（已是模块化，但入口写死） |
| `src/ext/index.js` | 扩展注册表（**真插件化的起点**） |
| `src/character-persona.js` | 人格分层读取（`TONE_PATCH` 在这） |
| `src/memory-card.js` | 记忆卡渲染与检索 |
| `src/mood-lib.js` | 情绪（面板应只读它的 `state/mood.json`） |
| `/opt/her-console/server.mjs` | 面板后端（手写路由，非框架） |
| `/opt/her-console/public/assets/app.js` | 面板前端（单文件，8000+ 行） |
| `~/.dsh/surfcore/characters/char-mvugwthv/` | 人格卡（英文为主，中文只留例子） |
| `~/.dsh/surfcore/state/` | 全部运行时状态（JSON） |
| `docs/` | 文档（本目录） |

## 5. 下一步：一次结构大改（分 3 段，每段可验证）

**不要一口气全做完** —— 一次大改 = 一次大坏。按下面三段走，每段跑完 `npm run verify` + 面板冒烟。

### 第 1 段：接口分离（插件化地基）
- 定 `src/ext/` 契约：`export default function createX({ getCfg, log, ...deps })` 返回 `{ id, title, hooks, routes }`；
- bridge 只保留：加载 ext、分派 hooks（prompt/stateKey/wakeGate/groupMsg/privateMsg/afterSend/route）、少量核心逻辑；
- 目标：**bridge 从 1.7 万行降到 8000 行以内**，新增功能 = 新增一个目录，不改 bridge。

### 第 2 段：面板重构（只读优先 + 数据驱动）
- 面板改成**读插件清单**渲染（每个 ext 声明自己的页面与开关）；
- 心情等状态**只读展示**，不再由面板自己维护；
- 开关元数据化：`implies`（开 A 就自动开 B）、`conflicts`（互斥）、`hot`（是否需重启）；
- 运行状态合并成一个：全开 / 只听主人 / 只跟我私聊 / 关机（`paused` 并入）。

### 第 3 段：清理与验收
- 合并重复开关、删除失效功能（如面板自管心情的加减）；
- 修完 14 条已知问题（见 `TODO.md`）；
- 打 tag `v1.1-arch`，README 更新架构图。

## 6. 怎么验证（每次改完必跑）

```bash
cd /home/dsh/apps/surfcore
node --check src/bridge.js          # 语法（查不出未定义变量！）
npm run verify                      # 结构快照 + 单测 + 路由
node scripts/snapshot.mjs --diff    # 提示词字节数对比
systemctl restart surfcore-bridge && sleep 12 && systemctl is-active surfcore-bridge
grep -a "Error\|error" /var/log/surfcore-bridge.log | tail -5
```

面板冒烟：`http://<服务器地址>:7800/#t=<口令>`（口令在 `/opt/her-console/token.txt`）

## 7. 参考实现（可复用，别重写）

见 `REFS.md`：上游 SurfCore、GitHub PR #1（four-point-hooks）、AstrBot / AuraBot（只读参考）、DSH 官方扩展机制。

## 8. 与用户协作方式

- 用户是学生，时间少；**每天只处理小 bug**，大改集中做；
- 用户要的是「她像他想要的样子」+「稳定不折腾」，不是功能多；
- 每次交付给一张表：改了什麼 / 影响谁 / 要他验证什么；
- 不确定的地方**先问**，不要赌。
