# 我的改造：SurfCore → 一个有记忆、有性子、能自愈的 QQ 伙伴

> 这个仓库是 [SurfCore](https://github.com/Mieksido/surfcore)（MIT）的改造分支。
> 原版解决「把 DSH agent 接进 QQ / B站 / 桌宠」；我在它上面补了 **人格分层、记忆分层与会话隔离、
> 印象库、技术笔记、学说话、表情管理、成本面板、通道自愈** 这些东西。
> 上游 README 见 [`docs/upstream-README.md`](upstream-README.md)，安装依赖以它为准。

---

## 一句话

原本 SurfCore 给她的是一个「身份 + 两只手」。我补的是**这个身份怎么长出来、怎么记得住、怎么花钱、怎么自己爬起来**。

---

## 我加了什么（10 项）

| # | 改造 | 解决什么问题 | 关键位置 |
|---|---|---|---|
| 1 | **人格分两层**（核心 / 语气） | 群聊和私聊注入同一张卡，token 全浪费在同一份人设上；而且她在群里会撒娇 | `src/character-persona.js` `readPersonaLayerText()`、`src/persona-layers.js` `composePersonaLayers()`；群用 `tone`、私聊用 `full` |
| 2 | **记忆按会话隔离** | 记忆卡是全局一份，群友能看到主人的私事；多私聊之间互相串 | `src/ext/memory-scope.js` 的 `filterCardForSession()` / `scopedMemoryText()` |
| 3 | **相关记忆自动召回** | 她「记得」但从不主动想起来（回忆工具调用次数为 0） | `src/ext/related-memory.js`：CJK bigram + `log(1+N/df)` 打分，同一次交流（同会话 15 分钟内）再补 1~2 条 |
| 4 | **印象库**（对她的看法） | 被问「我是什么人」时只会复述聊天记录 | `src/ext/impressions.js` + MCP 工具 `qq_impression` |
| 5 | **技术笔记** | 看视频的结论零留存，学完就忘 | `src/ext/tech-notes.js` + 工具 `note_tech`，同步出 `docs/TECH-NOTES.md` |
| 6 | **学说话**（只学一个人） | 不能照抄人格卡，只能学「说话框架」 | `src/ext/style.js` `style-lib.js`：硬规则分类（框架/引用/垃圾）+ 候选→正式 + 复用 ≥2 人才转正 + 机器人腔过滤 |
| 7 | **表情管理** | 表情库全是没有描述的「盲盒」，匹配阈值永远不过 | `src/ext/stickers.js`：收录（只收主人）、待补描述提示、情绪权重、`[表情包]/[动图]/[图片]` 分类 |
| 8 | **花费面板 + 诊断** | 不知道一天烧多少、钱花在哪 | her-console 面板（独立仓库/服务）+ `/api/tokens/*`、`/api/diagnose`、每日快照定时器 |
| 9 | **运行控制**（模式/静音/学习模式/频率） | 一个开关管所有场景太粗 | `src/ext/owner-only.js`、`mute.js`、`learnmode.js`、`group-rate.js` |
| 10 | **通道自愈** | 断了自己不会爬，要人盯着 | `bridge` 交给 systemd + `surfcore-bridge-watch.timer`（探 3001/3100/3080）+ 面板「通道健康」 |

顺便把 **60 处内联补丁收敛成了 6 个钩子 + 29 个扩展模块**（`src/ext/`），
从 106 个 `_PATCH` 标记降到 ~89，新增功能只需要写一个文件注册进去。详见 [`src/ext/ARCHITECTURE.md`](../src/ext/ARCHITECTURE.md)。

---

## 结构

```
src/
  bridge.js              # 接线层：路由、会话、发送；只剩钩子调用
  ext/
    index.js             # 6 个钩子 + 扩展注册表
    ARCHITECTURE.md      # 钩子表 / 工厂约定 / 状态文件归属 / 怎么加一个扩展
    owner-only.js mute.js learnmode.js group-rate.js safetalk.js   # 运行控制
    memory-scope.js related-memory.js impressions.js tech-notes.js # 记忆
    style.js style-learn.js                                        # 学说话
    stickers.js sticker-frames.js                                  # 表情
    loops.js reminders.js profile.js qzone.js qzone-watch.js        # 角色/社交
    blackbox.js memory-card.js                                     # 基础设施
    tools/               # 每个文件注册一组 MCP 工具
scripts/
  verify.mjs             # 一键验收：语法 + 单测 + 结构快照 + 路由
  snapshot.mjs           # 提示词/工具/接口快照
  upgrade.mjs            # 从上游拉新版并合并（经 gh-proxy，服务器直连不了 GitHub）
  test/*.test.mjs        # 5 组单测（人格闸门/学说法/记忆隔离/…）
docs/
  MY-BUILD.md            # 就是本文
  LEARN-FROM-ME.md       # 给别的 DSH 看的索引
  UPGRADE.md             # 升级与合并取舍
  V1-BASELINE.md         # V1 定版体检清单
```

---

## 快速开始

```bash
# 1) 基础环境：Node >= 22.13、DSH（DeepSeek Harness）、NapCat（QQ 协议端）
# 2) 拉代码
git clone https://github.com/Moming114514/sanye-dsh.git && cd sanye-dsh
npm install --omit=dev

# 3) 配置：把 config.example.json 复制成 config.json 再改
#    - bot / oneBot 地址与 token
#    - ownerQQ
#    - socialV2.styleLearn.targetQQ（学谁说话）、groups（在哪学）
#    - socialV2.tokenGuard.maxDailyCostCNY（每日上限）
chmod 600 config.json          # 里面是令牌，别提交

# 4) 起服务
node src/bridge.js             # 或交给 systemd（见 docs/UPGRADE.md 末尾的 unit 示例）
```

验收：`npm run verify`（语法 + 单测 + 提示词结构 + 工具数 + 路由）。

---

## 隐私边界（重要）

这个仓库**不含**任何真实运行数据：

- 角色卡（人格）、记忆卡、印象库、技术笔记、聊天记录 —— 运行时都在你自己的 `~/.dsh/` / `state/` 下，**已被 `.gitignore` 排除**；
- `config.json`（含令牌、QQ 号）、`state/`、`logs/` 一律不入库；
- 代码里的会话 key、QQ 号、服务器 IP 都是占位符（`private:1000000000` 这种），要跑起来得自己配。

---

## 升级

上游更新后，用 `node scripts/upgrade.mjs <tag>` 拉新版并自动三方合并，冲突按
[`docs/UPGRADE.md`](UPGRADE.md) 的取舍表处理（`src/ext/**` 永远保我方；`bridge.js` 的钩子调用保我方）。

---

## 致谢

- [SurfCore](https://github.com/Mieksido/surfcore)（MIT）：底座、QQ/B站/桌宠桥接、记忆与人格的原始实现
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)：QQ 协议端
- DeepSeek Harness：agent 运行时

License 沿用上游 MIT，保留原作者版权声明。
