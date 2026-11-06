# TASK-W3：机器人侧的「大脑 + 无记忆副手」

> 前置：用户已同意方向。**W2 完成并通过重启验收后再开工。**
> 规则同 W2：改 bridge 先备份；能不动运行时就不动；重启等主会话统一执行。

## 为什么要做

现在所有"学习类后台任务"都是**塞进她的私聊会话**跑的：

| 任务 | 现在怎么跑 | 问题 |
|---|---|---|
| `github-learn` | `deliverPrompt('private:<owner>')` | 占她的上下文，她要"亲自读仓库" |
| `biliStudy` | 同上（`silentOutbound`） | 同上，且带全量人格与记忆 |
| `style-learn` | 同上 | 学说法需要判断力，可保留 |
| `group-digest` | 纯本地规则（不进模型） | 没问题 |
| `advice-capture` | 只存不调模型 | 没问题 |

结果：她的对话上下文被"学习任务"打断，说话带播报腔；每次都要重读 1 万多字人格与记忆（贵）。

## 目标架构

- **大脑（她本人）**：人格 + 记忆 + 聊天，只负责"说话这件事"；
- **副手（sidecar）**：无记忆一次性调用，输入「任务 + 材料」，输出 JSON，写完即销毁；
- 副手**不得**写 `memory-card.json` / `impressions.json`（那是她的自我认知，只能她写）。

## 第一步：先探明调用路径（只读，不改代码）

1. `grep -n "buildWakePromptV2\|deliverPrompt\|sendWakePromptV2" src/bridge.js | head -30`，看一次唤醒最终怎么打到模型（HTTP 到 dsh-web？还是 MCP？）：
   - 若是 HTTP（如 `127.0.0.1:3080` + token），找出端点与请求体；
   - 记录：**能不能发起一次不带历史的新会话**（`session: new` / 独立 conversationId）。
2. 若 DSH 没有"一次性会话"接口，退路：直接在 bridge 里用 OpenAI 兼容方式调模型（`config.json` 里应已有 provider 配置；没有就加 `socialV2.sidecar.provider`）。
3. 把结论写进本文件末尾「调用路径结论」。

## 第二步：实现 `src/ext/sidecar.js`

```js
// 约定（伪代码）
export function createSidecar({ getCfg, log, stateDir }) {
  async function run(name, { system, input, schema, maxOut = 800 }) { ... }
  return { id: 'sidecar', run };
}
```

要求：
- 每次调用写 `state/sidecar-log.jsonl`：`{at, name, ms, tokens, ok, err}`（**不记内容**，避免隐私落盘）；
- 失败重试 1 次，再失败只记日志，**绝不抛到主流程**；
- 超时 90s；
- 输出强制 JSON，解析失败算失败（不猜）。

## 第三步：迁移（一次一个，每个一 commit）

1. `github-learn`：改为 sidecar 读 README → 输出 `{tips: [{title, body, source}]}` → 主流程写 `tech-notes.json` 候选（不再进入她的对话）；
2. `biliStudy`：sidecar 做字幕摘要 → 写 `tech-notes` 候选；
3. `style-learn`：**先不迁**（需要判断"像不像人"，副手做不好）。

## 验收

- 触发一次 GitHub 学习：她的私聊**没有**出现学习任务消息；`tech-notes` 增加候选；日志有 `[sidecar] github-learn ok …ms`。
- 她再被唤醒时，提示词里**没有**学习任务段落（grep 提示词）。
- `npm run verify` 绿。

## 成本预期

副手不带人格/记忆（约 1.2 万字符），单次调用输入从 ~3 万 token 降到 ~2~4 千 token。按每天 3 次后台任务估：**约省 ¥0.15~0.3/天**，并显著减少她上下文里的杂质。

## 调用路径结论

（待填）
