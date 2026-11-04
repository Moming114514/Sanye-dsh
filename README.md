# sanye-dsh —— 把 QQ 机器人养得「更像人一点」

> SurfCore 的个人改造分支，不是新框架。上游负责「把模型接进 QQ / B 站 / 桌宠」，
> 我在这上面只做三件事：**像人、省心、能管住**。
> 上游：[Mieksido/surfcore](https://github.com/Mieksido/surfcore)（MIT）

**给谁用**：想自己搭一个长期在线的 QQ 机器人、又不想被它烦到的人。
**不是什么**：不是开箱即用的产品，不含任何真实群号 / QQ 号 / 令牌；要自己装 NapCat + DSH + Node 22，并手写 `config.json` 和人格卡。
**支持**：Linux 优先（Debian 12 实测）。Windows / SnowLuma 桌面版未逐一验证。

---

## 30 秒跑起来

```bash
git clone https://github.com/Moming114514/Sanye-dsh && cd Sanye-dsh
npm install
cp config.example.json config.json      # 只填 4 处：snowluma.*、ownerQQ、allow.*、consoleToken
node scripts/verify.mjs --no-api        # 先确认本地语法/单测没坏
npm start                               # 或 systemctl start surfcore-bridge
```

需要：**Node ≥ 22**、**NapCat（OneBot v11）**、**DSH**。装好 QQ 通道后，在群里 @ 她一次，
DSH 里出现对应会话、回复回到 QQ，就算跑通了。详细步骤见 [`docs/OPERATIONS.md`](docs/OPERATIONS.md)。

---

## 功能清单

- **人格分层**：核心卡只给私聊，群里只装语气层——省 token，也不出戏。
- **记忆按会话隔离**：群聊拿不到私聊记忆，多个人私聊也不串台；相关记忆自动挑 1~3 条注入。
- **唤醒闸门收口**：模式 / 静音 / 学习模式 / 分群频率 / 敏感话题，全部走同一个入口裁决。
- **看得懂表情**：图片分类成 `[表情]` / `[表情包]` / `[动图]`，表情库带画面与情绪描述。
- **学说话**：只学指定的一个人，样本分「候选 → 正式」，被多人复用才转正，14 天没人用就退休。
- **情绪只有 6 种**：平静 / 开心 / 好奇 / 专注 / 兴奋 / 得意，按消息内容加减，注入时只给一句语气提示。
- **花钱看得见**：按天 / 会话 / 步骤算钱，缓存命中率、最贵的 5 步、每日自动快照。
- **管理面板**：13 个页面，改开关自动判断「立刻生效 / 需重启」，待生效项顶栏可见。

完整功能、实现细节、已验证环境、通道差异 → [`docs/FEATURES.md`](docs/FEATURES.md)。

![面板：花费](docs/screenshots/panel-cost.png)

---

## 常用命令

| 做什么 | 命令 |
|---|---|
| 全量验收（语法 / 单测 / 提示词结构 / 工具 / 路由） | `npm run verify` |
| 只跑静态部分（不连桥接） | `npm run verify -- --no-api` |
| 看桥接日志 | `tail -f /var/log/surfcore-bridge.log` |
| 重启桥接 | `systemctl restart surfcore-bridge` |
| 面板 | `http://127.0.0.1:7800`（口令在 `/opt/her-console/token.txt`） |

---

## 文档

| 想看什么 | 去哪 |
|---|---|
| 完整功能清单 | [`docs/FEATURES.md`](docs/FEATURES.md) |
| 我到底改了什么 | [`docs/MY-BUILD.md`](docs/MY-BUILD.md) |
| 日常运维 / 出事 5 分钟定位 | [`docs/OPERATIONS.md`](docs/OPERATIONS.md) |
| 扩展层怎么写 | [`docs/EXT-MANIFEST.md`](docs/EXT-MANIFEST.md) + `src/ext/ARCHITECTURE.md` |
| 升级上游怎么合 | [`docs/UPGRADE.md`](docs/UPGRADE.md) |
| 踩过的坑 | [`docs/PITFALLS.md`](docs/PITFALLS.md) |
| 还没做、为什么、代价 | [`docs/V2-ROADMAP.md`](docs/V2-ROADMAP.md) |

---

## 隐私与边界

- 仓库里没有任何真实数据：角色卡是脱敏示例，群号 / QQ / IP / 令牌全是占位符。
- `config.json`、`state/`、`characters/` 不进 git（`.gitignore` 已挡）。
- 面板默认只监听 `127.0.0.1`，只接受本机回环访问。
- 不代登录、不绕过平台风控、不做多用户。

---

## 许可

MIT。上游 SurfCore（MIT）负责通道与骨架，本仓库只叠加个人改造。
SnowLuma 是第三方专有运行时，不随本仓库分发。
