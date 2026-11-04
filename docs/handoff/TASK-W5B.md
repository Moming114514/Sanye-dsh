# TASK-W5B｜学习任务移出人格会话（设计稿，不实现）

> 状态：设计，2026-11-05。目标是先把「看视频 / 读 GitHub 仓库」两类学习任务从**她的会话**里挪走，
> 改成一次性调用（不带人格、不带记忆、不进她的上下文），结果仍然落到 tech-notes / 学样候选。
> 本文只做设计，不动代码。

## 0. 一句话

现在学习任务是「在她的会话里派一条 prompt」，所以每一次都要付人格 + 记忆 + 工具 schema 的全额上下文；
改成独立进程 + 极简 system prompt，只把材料和结果带进带出。

## 1. 现状链路

两类任务都走 `deliverPrompt()`（`src/bridge.js:13195`）→ `deliverPromptNow()` → `api.sessions.prompt`
（`src/bridge.js:13164`，DSH Web API，preset `qq-chat` / `qq-chat-v2`）。

| 任务 | 派发点 | 调用方式 | 每轮携带 |
|---|---|---|---|
| GitHub 每周学习 | `src/ext/github-learn.js:124` `await deliverPrompt(task, { reason: 'github-learn' })` | 私聊 `private:<ownerQQ>` 的**她的会话** | preset 前缀 ≈11.1K + `role.hint` ≈9.1K + memoryCard ≈2.8K + 工具 schema（core-min 17.8K）≈ **40K 字符/轮** |
| 视频学习（看完汇报） | `src/bridge.js:13916`（「刚才那条视频你还没看吧」提醒）、`13942`（学习任务正文）、`16702`（私聊视频命令的回复） | 同上，同一个会话 | 同上 |
| 其它同类 | `7917`（style-learn-manual）、`16702`（视频）、`3923`（队列）、`15454`（唤醒） | 同上 | 同上 |

后果：
1. 学习任务和聊天共用一个会话 → 学习轮会写进她的历史，挤占后面聊天的上下文；
2. 每轮都重新装配人格 + 记忆 + 工具（40K 字符），而任务本身只需要 README / 字幕；
3. 任务提示词里要求她「用 note_tech 记」「回我 2~3 句」，把工具调用和汇报也塞进人格会话；
4. 一旦任务里的工具调用失败，她会把错误当聊天内容说出来，污染会话。

## 2. 目标链路

```
调度器（github-learn.tick / 视频待看检查）
      │  只负责「选什么材料」
      ▼
scripts/oneshot-learn.mjs  （独立 Node 进程，不连 DSH、不建会话）
      │  极简 system prompt（≈300 字） + 材料正文（≤12KB）
      ▼
DeepSeek API（deepseek-flash，非流式，JSON 输出）
      │  { items: [{title, body, tag, evidence}] }
      ▼
POST /api/socialV2/tech-notes（console token）  →  tech-notes 落盘
      │
      ▼
日志：[oneshot] kind=github repo=owner/name ok notes=2 chars=8123 ms=4210
```

要点：
- **不带人格、不带记忆、不带工具 schema**：脚本自己调 API，不经过 `api.sessions.prompt`；
- **材料由调度器准备**：GitHub 已抓好的 README 节选直接传；视频用 `video_storyboard` 抽出的字幕/画面描述（阶段二）；
- **结果只写 tech-notes**，不给她发消息；要汇报时由调度器单独发一条系统消息（可选）；
- **可关**：`config.socialV2.oneshotLearn = { enabled: false }` 时回退到现有 `deliverPrompt` 路径。

### 2.1 脚本接口

```bash
node scripts/oneshot-learn.mjs --kind github --repo owner/name --material /tmp/readme.txt --json
node scripts/oneshot-learn.mjs --kind video --title "BVxxxx" --material /tmp/subs.txt --json
```

- 退出码：0 成功 / 2 材料为空 / 3 API 失败 / 4 JSON 解析失败（内部重试 1 次后）；
- stdout 最后一行是 JSON：`{ok, kind, notes:[...], chars, ms}`；
- 读 `DEEPSEEK_API_KEY`（从现有 config/环境取，不新增文件）；超时 90s；
- 单条 note：`title ≤40 字`、`body 80~400 字`、`tag` 取 `github` / `video`、`evidence` 必须是材料里出现过的原句或 URL，否则整条丢弃。

### 2.2 调度器改动（仅计划）

- `src/ext/github-learn.js`：把 `deliverPrompt(task, ...)` 换成
  `execFile(NODE, [scripts/oneshot-learn.mjs, '--kind','github', ...])`，失败只 log，不发 QQ；
- 视频路径（`bridge.js:13916/13942`）：阶段二再接，先只读验证 `video_storyboard` 的输出能否脱离会话拿到；
- 保留手动触发按钮/命令，但改走同一脚本。

## 3. 失败与回滚

| 情况 | 处理 |
|---|---|
| API 超时（90s） | 杀掉进程，`log('[oneshot] timeout …')`，本轮跳过，不写半条 note |
| 返回非 JSON | 用更严格的「只输出 JSON」提示重试 1 次；仍失败则丢弃本轮，记 `[oneshot] parse-fail` |
| 模型胡编 | 每条必须带 `evidence`（材料原文子串）；evidence 校验不通过就丢弃该条；全部丢弃则记 `[oneshot] fabricated` |
| tech-notes 接口失败 | 脚本退出码 5，调度器保留材料到 `state/oneshot-retry.json`，下一轮重试一次 |
| 想回退 | config 加 `oneshotLearn.enabled=false` 即走旧路径；脚本无状态，删掉即可 |

## 4. 验收（三项）

1. **她不再收到学习任务提示词**：`grep -a "这周从 GitHub 学一个项目" /var/log/surfcore-bridge.log` 在切换后为 0；
   同时能看到 `[oneshot] kind=github … notes=N`。
2. **tech-notes 有新增**：`/api/socialV2/tech-notes` 条数增加，`tag` 为 `github`/`video`，`body` 含 evidence 对应的原文线索。
3. **每轮 token 下降可测**：用 `contextTelemetry` 的 `promptChars`（`src/bridge.js:13119` 附近）对比切换前后
   同一类任务的 prompt 字符数；预期从 ≈40K 降到 0（不再进她的会话），只增加脚本侧一次 ≤12KB 的 API 调用。

## 5. 不做

- 不实现、不改人格卡、不改记忆文件；
- 不新增「她主动汇报」的消息（汇报是否保留由用户后定）；
- 阶段一只做 GitHub；视频依赖 `video_storyboard` 的输出形态，先只调研，不动那几条 `deliverPrompt`。
