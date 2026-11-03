# 改动记录（人类可读）

> 规则：**每次改动都记一条**，按时间倒序。写清「改了什么 / 为什么 / 影响面 / 怎么回滚」。
> 给别人接手时，看这个文件就知道最近动了哪些地方，不用翻 commit。
> 更细的实现细节在 `state/CHANGELOG-bridge.md`（不进仓库，服务器上）。

## 版本与发布（2026-11-02 起）

- **日常改动只提交到 `dev` 分支**，不推送。别人在 GitHub 上看到的 `main` 停在「你上次同意发布的那一版」。
- 你说「发布」时运行 `bash scripts/publish.sh <tag>`：`dev` 合进 `main` → 打 tag → 生成 `/tmp/publish.bundle` → 本机推送。
- 线上跑的一直是服务器工作区（当前所在分支），跟是否发布无关。
- 首个已发布版本：`v1.0-20261102`（`c8422f7`）。

## 版本标记

- **线上运行的版本 = `v1.0-20261102`**（tag），对应 commit `5f8f342`。
- 以后每完成一批功能打一个 tag；`main` 始终是最新（别人看 main 就是最新）。
- 想知道线上跑的是哪个版本：看这里最后一条 tag，或 `git describe --tags`。

## 2026-11-03（v1.1）

**一句话**：把「代码结构」和「面板」各翻了一版地基——插件有了单一事实源，面板能按页看/按页调，桥接重新回到 systemd 管理。

### 插件化地基（波 1，8/8）
- `manifest` 契约（`docs/EXT-MANIFEST.md`）：每个 ext 声明 `id/order/hooks/stateFiles/config/hot`；30 个模块 100% 覆盖（17 注册 + 13 由 bridge 直接调用的 lib）。
- loader 改造（`src/ext/index.js`）：按 `manifest.order` 装配、缺声明回退下标×10、重复 order 报错、`extManifests()` 导出。
- 钩子隔离 `guardHook()`：7 个钩子全部 try/catch，单个 ext 炸不影响主流程（5 分钟一条日志）。
- `scripts/replay-hooks.mjs`：12 模块 × 钩子 89 用例的行为金丝雀。
- `scripts/snap-split.mjs`：代码快照与人格快照拆开，人格易变小节用 `stableSha256`；`verify` 全绿（清单 30/30）。

### 面板（布局与该页能调什么）
- 侧栏 5 组（状态 / 她的言行 / 记忆与心情 / 花费 / 系统），手机端组名隐藏、底部导航保留。
- 每页首卡前一行「本页能调：…」；功能开关「立即 / 需重启」徽标。
- 新页「系统 → 插件」（读 `/api/plugins`，30 条，含 wave 与 hooks/routes 数）。
- 心情改只读（删掉点一下 +5）。

### 行为修复
- **情绪恒 100**：每条消息先向基线回落 5% 再按规则加分（`MOOD_SETTLE`），修后 100 条模拟 calm 24 / happy 45 / tired 12。
- **命令前缀可配置**：私聊 `/`、`#`、`！` 归一；群里只认 `#`、`！`（`/` 落回普通聊天），帮助文案按会话前缀渲染。
- **bridge 双实例**：插件启停改为委托 `systemctl`（有 unit 时），杜绝 dsh-web spawn 第二实例；unit 的 `StartLimit*` 移回 `[Unit]`。
- **ASR 按需**：socket 激活、空闲 300s 退出；自检把「socket active」视为正常。
- **内存**：zram 1G + `vm.swappiness=60` + dsh-web 内存上限（1200/1800M），常驻 used 2370→1963M。

### 已知遗留
- 13 个模块尚未迁到 loader 钩子（只有清单，行为不变）。
- 群「限制总览 + 一键恢复默认」、`mface` 动图抽帧、待生效偶发仍待做。

## 2026-11-02

### 00:25 修「白名单加成功但没加上」
- 改了什么：面板 `server.mjs` 的 `/api/access` GET 分支加方法判断；桥接 `allowed()` 加 `config.json` 热读（`ALLOW_HOT_PATCH`）。
- 为什么：POST 被 GET 分支吞掉（返回 ok 但没写）；桥接只在启动时读白名单，改了要重启才生效。
- 影响面：白名单（群/私聊）增删改；现在改完立刻生效，不用重启。
- 回滚：`/tmp/bridge.js.bak.allowhot`、`/tmp/server.mjs.bak.access`。

### 00:15 省钱模式补「完全不发」
- 改了什么：`src/ext/economy.js` 加 `replyAt`；闸门里省钱模式下 `atMention` 也拦。
- 为什么：用户要一个「省钱时连 @ 都不回」的总开关。
- 影响面：群聊；私聊不受影响。
- 回滚：面板「省钱模式」改回「还回 @」。

### 00:10 学习模式允许主人 @ 她
- 改了什么：`src/ext/learnmode.js` 加 `noteLearnSpeaker`/`onGroupMessage`，主人 @ 放行（10 分钟窗口）。
- 为什么：只学习不聊天的群，用户自己 @ 她时应该能出来说话。
- 影响面：学习模式里的群；别人 @ 仍然拦。
- 回滚：删掉 `onGroupMessage` 里的记账 + 闸门里那段判断。

### 00:05 省钱模式（可精确到群）
- 改了什么：新增 `src/ext/economy.js` + `/api/socialV2/economy` + 面板「安全」页卡片。
- 为什么：用户要能控制「群里少说话省点钱」，并且能单独对某个群开关。
- 影响面：群聊唤醒；私聊不影响。
- 回滚：删 `src/ext/economy.js` 并在 `src/ext/index.js` 取消注册。

## 2026-11-01

### 22:35 记忆召回改倒排索引
- 改了什么：`src/ext/related-memory.js` 的 `index()` 建 `postings`，召回改走倒排。
- 为什么：590 条记忆每次召回 6.93ms，随条数线性增长。
- 影响面：相关记忆召回性能；**输出逐字节一致**（md5 校验过）。
- 回滚：`git revert` 对应提交。

### 22:20 V2 路线与定位
- 改了什么：`docs/V2-ROADMAP.md` 新建；README 顶部标注「参考实现 / Linux 优先 / 非开箱即用」；`docs/FAQ.md` 12 问。
- 为什么：仓库要给别人看，先说清定位，避免被当成一键部署产品。
- 影响面：纯文档。

### 记忆注入瘦身（待做）
- 计划：24 条 → 4 常驻 + 2 动态；见 `docs/V2-ROADMAP.md`。
