# V1 基线（2026-11-01 20:45 定版）

> 从今天起进入稳定期：**只修 bug、只做安全/稳定性补丁**，不再加新功能。
> 新功能一律先记到「待办」里，等 V1 观察期结束（建议至少 3–5 天）再议。

## 一、跑在哪

| 项 | 值 |
|---|---|
| 云服务器 | <你的服务器 IP>（root，SSH 密钥自备），Ubuntu，2 核 / 3.6G 内存 / 40G 盘（已用 26%） |
| 代码主目录 | `/home/dsh/apps/surfcore`（surfcore **0.8.1** + 本地扩展） |
| 状态目录 | `/home/dsh/.dsh/surfcore`（角色包 `characters/char-mvugwthv/`、`state/`） |
| 面板 | `/opt/her-console`（`http://127.0.0.1:7800`，只绑本机，进站要口令 `#t=<token>`） |
| 仓库 | `<本仓库地址>`（公开；`config.json` 不进库） |

## 二、服务与自愈

| 单元 | 状态 | 兜底 |
|---|---|---|
| `dsh-web.service` | active | systemd `Restart=always`，3 秒重起 |
| `surfcore-bridge.service` | active（**V1 起改为 systemd 托管**） | `Restart=always`、5 秒重起、5 次/5 分钟限流 |
| `her-console.service` | active | `Restart=always` |
| `asr-shim.service` | active | `Restart=always` |
| `snowluma.service` | active | `Restart=always` |
| `napcat`（docker） | running | restart policy `always` |
| `surfcore-bridge-watch.timer` | active，每 2 分钟 | 探活 3080 / 3100 / 3001；异常先 `systemctl restart surfcore-bridge`，再不行重启 `dsh-web`；10 分钟防抖 |
| `token-snapshot.timer` | active，每天 00:05 | 把当天用量写进 `token-daily-history.json`（保留 400 天） |

**仍然需要人动的三种**：QQ 掉线/被踢（要扫码登录 NapCat 6099）；配置文件改坏导致反复崩溃（看 `/var/log/surfcore-bridge.log`）；磁盘满/OOM。

## 三、能力清单（V1 冻结）

- **人格**：核心（`persona.md`，约 1.2k 字）+ 语气层（`persona.tone.md`，十三节，约 3k 字），群聊只装语气层；身份底座统一 QQ/B站/桌宠。
- **记忆**：记忆卡 570 条、三档清晰度、艾宾浩斯衰减、按会话隔离（`MEMSCOPE`：群不见私聊私事）、相关记忆注入（关键词 + 同会话 15 分钟邻接）、「只展示不进上下文」区、印象库、技术笔记库。
- **学说话**：只学 <学习目标的 QQ>（小助手），候选→正式两段式，机器人腔过滤，学习模式（某群只看不聊）。
- **表情**：11 张带描述；自动收录只认 owner；`[表情/表情包/动图/图片]` 分类标签。
- **运行控制**：四态模式（全开/只听主人/只跟我私聊/关机）、白名单、静音、学习模式、分群发言频率（保守/正常/活跃）、敏感话题守门（记录/提醒/降温/冷处理）。
- **安全**：`config.json` 600 且不入库、控制台令牌、面板只绑 127.0.0.1。
- **成本**：上限 ¥7/天、80% 提醒、诊断卡（缓存命中率 / 最贵步骤 / 按会话）、CSV 导出、每日快照。

## 四、验收方式

```bash
cd /home/dsh/apps/surfcore
node scripts/verify.mjs          # 语法 + 单测 + 结构快照 + 路由，期望 VERIFY_PASS
```

面板「设置」页顶部有「通道健康」卡：DSH(3080)/桥接(3100)/OneBot(3001)/看门狗 四项 + 各服务状态。

## 五、已知限制（V1 不修）

1. 桥接进程「活着但事件循环卡死」只能靠 3100 探活间接发现，HTTP 探活要等 timer 下一轮（≤2 分钟）。
2. 学说法只能看最近 60 条，够不到更早的群消息（要翻历史得另做）。
3. 表情「收藏到 QQ 收藏夹」与「本地库」靠同步收口，极端情况下会差一张。
4. `B站动态` 默认关闭（`biliBridge.dynamics.enabled=false`），开启需确保 B 站凭据有效。
5. 面板只绑本机，手机端要访问需额外做反代 + 鉴权。
