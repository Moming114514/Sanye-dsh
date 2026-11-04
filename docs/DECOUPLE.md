# 脱壳说明：她把"自己"放在哪，怎么换一个壳

> 一句话：**她是磁盘上的一组文件，DSH 只是让这组文件跑起来的运行时。**
> 换运行时（DSH → 别的 agent 框架）时，只要实现 7 个钩子，她的记忆、人格、说话方式一行都不用改。

## 一、她的"自我"由三类资产构成

| 资产 | 位置 | 格式 | 作用 |
|---|---|---|---|
| 人格 | `~/.dsh/surfcore/characters/<charId>/persona.md`、`persona.tone.md`、`persona.daily.md`、`scenes/*.md` | Markdown | 她是谁、怎么说话、什么场合怎么反应 |
| 记忆 | `~/.dsh/surfcore/characters/<charId>/memory/`（`memory-card.json`、`self.md`、`diary.md`、`impressions.json`、`loops.json`） | JSON / Markdown | 她经历过什么、答应过什么、对谁有什么看法 |
| 行为规则 | `~/.dsh/surfcore/state/*.json`（`group-rate`、`muted-keys`、`economy`、`learn-mode`、`style-samples`、`bot-advice`、`media-stats`…） | JSON | 什么时候说话、跟谁学说话、钱怎么省 |

这三类都在**文件系统**里，不在进程内存里。进程重启、换机器、换框架，它们都还在。

## 二、壳要提供什么（7 个钩子）

任何一个运行时，只要能实现下面 7 件事，就能"装下她"：

| # | 钩子 | 签名 | 用途 |
|---|---|---|---|
| 1 | `onGroupMessage` | `({key, uin, name, text, at})` | 收群消息（打分、识别人、记素材） |
| 2 | `onPrivateMessage` | `({key, uin, name, text, at})` | 收私聊消息 |
| 3 | `wakeGate` | `({key, reason, cfg}) → true / {allow:false, reason}` | 决定"这条要不要叫醒她" |
| 4 | `promptBlocks` | `({key, cfg}) → string[]` | 往提示词里加段落（记忆卡、群摘要、策略提醒…） |
| 5 | `stateKey` | `() → string` | 参与缓存指纹，判断"什么变了要重建" |
| 6 | `afterSend` | `({key, messages})` | 发送之后（欠事捕获、日志、统计） |
| 7 | `routes` | `[{path, handle({body, sendJson})}]` | 对外 HTTP 接口（面板、调试） |

现有实现：`src/ext/index.js` 里的 `MODULES` 注册表 + 每个模块的 `manifest`（含 `order` / `hooks` / `layer`）。
**这是壳与她的唯一契约。**

## 三、换壳要做的事（清单）

1. **搬三份资产**：`characters/` 整个目录 + `state/` 里的行为状态 + `config.json` 的 `socialV2` 段；
2. **实现 7 个钩子**：把新框架的消息事件接到 1/2，把它的"要不要处理"接到 3，把它的提示词拼装接到 4；
3. **接模型**：任何 OpenAI 兼容接口都可以；人格与记忆是**文本**，不依赖特定模型；
4. **接通道**：QQ 用 OneBot v11（NapCat / LLOneBot 都行）；换 IM 只需替换消息收发适配层；
5. **验收**：跑 `npm run verify`（清单 31/31、单测、结构快照）+ 私聊一句"在吗"看是否是她。

## 四、现在还不能"一键换壳"的地方

| 依赖 | 现状 | 换壳成本 |
|---|---|---|
| 提示词拼装 | 在 `src/bridge.js` 的 `buildWakePromptV2()` 里 | 中：约 300 行要重写，但逻辑（段落顺序、预算裁剪）可照抄 |
| 缓存指纹 | 由 `stateKey` 钩子 + 提示词前缀决定 | 低：换框架后重新算即可 |
| 工具调用 | MCP（`src/mcp-*.js`） | 低：MCP 是标准协议，多数框架支持 |
| 面板 | 独立进程（`/opt/her-console`），只依赖 HTTP 接口 | 低：接口不变就不用改 |

## 五、一句话总结

**"脱壳"不是重写她，是把 `characters/` + `state/` + 7 个钩子的契约固定下来。**
契约在 `docs/EXT-MANIFEST.md`，资产在文件里，壳随时可以换。
