# GAPS 调研（2026-11-06）

> 只调研，不落地。star/推送/license 均于 2026-11-06 通过 GitHub API 核对；README 以 API 方式读取（服务器到 raw.githubusercontent 不通，故未整篇抓取）。
> 我们的现状：Node 单进程 bridge + JSON 状态 + DeepSeek API；记忆是 CJK 二元组倒排（590 条/0.34ms）；群里有 attention 打分与 group-rate 闸门；有决策回放与"人味指标"；工具已裁剪到 core-min 30 个；上下文只做截断。

## GAP 总览

| GAP | 难度 | 我们是否已部分覆盖 | 推荐先做 |
|---|---|---|---|
| G1 长期记忆检索 | 中 | 是（倒排关键词，无向量/无同义） | 本地小模型 embedding + 双路融合 |
| G2 群聊多话题选址 | 中 | 是（attention 分数 + 频率闸门） | 显式"回谁"规则与每群状态，不上模型做话题分割 |
| G3 人格一致性评测 | 低 | 部分（人味指标，非"像不像她"） | 30 条人工金标 + rubric 判官 |
| G4 工具调用可靠性 | 低 | 是（core-min 30 工具 + 硬规则提示） | 参数校验 + 错误回传重试 |
| G5 低成本上下文压缩 | 中 | 否（只截断） | 分段 token 预算 + 滚动摘要 |

---

## G1 长期记忆检索

**现状**：只有倒排关键词（CJK 二元组），换一种说法就查不到；没有向量、没有同义/跨语言召回。

**候选**
1. `mem0ai/mem0` — 68,511★ · Apache-2.0 · 2026-11-06 · https://github.com/mem0ai/mem0
   - 怎么做的：多信号检索（语义、BM25 关键词、实体匹配并行打分后融合）；实体抽取+链接参与召回；带时间感知的排序（当前状态/过去事件/未来计划分别排）。
   - 可抄：①三路信号融合而不是单路；②"写入时抽实体"（她记住的人/群/话题作为可检索键）。
   - 成本：只抄思路 ≈ 150 行（改 `memory` 检索）；引入 embedding 才有意义。
2. `MemTensor/MemOS` — 12,300★ · Apache-2.0 · 2026-11-04 · https://github.com/MemTensor/MemOS
   - 怎么做的：把记忆做成可检查的图（MemCube），统一 store/retrieve/manage；README 明确写了 hybrid retrieval，并已提供 DeepSeek Harness 的接入说明。
   - 可抄：①记忆"可看可改"的 viewer 形式（我们已有星海/体检，可对齐字段）；②热/冷分层（近期在线、旧记忆落盘）。
   - 成本：整套接入重（Python 服务）；只抄数据结构 ≈ 100 行。
3. `topoteretes/cognee` — 33,112★ · Apache-2.0 · 2026-11-06 · https://github.com/topoteretes/cognee
   - 怎么做的：文档/对话走 "抽取-构建知识图-载入" 流水线，图 + 向量双存；强调本体（ontology）约束实体关系。
   - 可抄：①先定实体/关系 schema 再入库；②把"会话教训"蒸馏成持久知识（memify 思路）。
   - 成本：Python 依赖重；只借 schema 设计 ≈ 50 行文档。
- **我的推荐：先做"本地小 embedding + 双路融合"**，因为它是唯一能直接解决"换个说法查不到"的最小改动（fastembed/bge-small-zh 走 ONNX，CPU 可跑，无 API 费），且能复用现有 590 条记忆做离线评测。

## G2 群聊多话题选址

**现状**：用 attention 分数决定"要不要理"，但没有显式回答"这一句该回谁、回哪个话题"。

**候选**
1. `wechaty/wechaty` — 23,519★ · Apache-2.0 · 2026-11-06 · https://github.com/wechaty/wechaty
   - 怎么做的：群消息事件里带 `room`/`mention`/`self` 标记，典型 bot 用"被 @ 或叫名字"作为触发；房间对象提供 topic 变化事件。
   - 可抄：①把"@我/叫我/引用我"做成显式枚举而不是打分副产物；②用 room topic 做会话边界（换话题=换上下文）。
   - 成本：≈ 80 行（我们已有 at/name 信号）。
2. `nonebot/nonebot2` — 7,778★ · MIT · 2026-11-04 · https://github.com/nonebot/nonebot2
   - 怎么做的：matcher 用 `rule` + `permission` + `priority` 组合决定谁响应，多个 matcher 可竞争，先命中先处理。
   - 可抄：①"回谁"写成有序规则表（私聊>@我>叫名字>提问>抽样），②每条规则可单测（我们已有 speak-policy 的先例）。
   - 成本：≈ 120 行，无新依赖。
3. `langbot-app/LangBot` — 18,756★ · Apache-2.0 · 2026-11-06 · https://github.com/langbot-app/LangBot
   - 怎么做的：多 pipeline 架构，按场景（不同群/不同用途）配不同处理链；强调监控与异常处理。
   - 可抄：①"一个群一条 pipeline"的配置形态（对应我们的群规则表）；②异常不拖垮主链。
   - 成本：只借形态，≈ 60 行配置映射。
- **我的推荐：先抄 nonebot 的"有序规则 + 可单测"**，因为我们现在已有 speak-policy 纯函数骨架，扩成"回谁"规则成本最低，且可 shadow 运行不改变行为。

## G3 人格一致性评测

**现状**：有"人味指标"（句长/标点/总结句/重合度）与决策回放，但没有"像不像她"的判据。

**候选**
1. `confident-ai/deepeval` — 19,331★ · Apache-2.0 · 2026-11-06 · https://github.com/confident-ai/deepeval
   - 怎么做的：LLM-as-judge 指标化（GEval 用 rubric + 思维链打分），支持阈值断言、批量数据集。
   - 可抄：①rubric 写成"称呼/口癖/边界/不列要点"四项分维；②judge 输出必须带理由与分数，便于抽查。
   - 成本：脚本 ≈ 150 行；每次评测 30 条 × 1 次调用，约 ¥0.05。
2. `openai/evals` — 19,710★ · NOASSERTION（自定义） · 2026-04-14 · https://github.com/openai/evals
   - 怎么做的：YAML 注册表 + 模型评分（model-graded）与精确匹配混合；评测与实现解耦。
   - 可抄：①"金标问答对"文件格式（我们可直接用她真实回复做金标）；②同一评测可换模型跑，做回归对照。
   - 成本：只借数据格式 ≈ 30 行。
3. `SillyTavern/SillyTavern` — 35,339★ · AGPL-3.0 · 2026-10-02 · https://github.com/SillyTavern/SillyTavern
   - 怎么做的：角色卡（描述/性格/示例对话）+ world info 注入；社区靠人读判断像不像，没有自动评测。
   - 可抄：①角色卡字段作为 rubric 的来源（我们的 persona.tone 已有）；②示例对话作为 few-shot 金标。
   - 成本：只借结构；AGPL 代码不可抄。
- **我的推荐：先建 30 条人工金标 + rubric 判官脚本**，因为评测的价值在"能重复跑"，框架本身可后补；先证明我们的提示词改动不会让"像她"变差。

## G4 工具调用可靠性

**现状**：已裁到 core-min 30 个工具、提示词有"先看图"硬规则；仍会出现该调不调、参数错。

**候选**
1. `ShishirPatil/gorilla` — 13,064★ · Apache-2.0 · 2026-10-17 · https://github.com/ShishirPatil/gorilla
   - 怎么做的：BFCL 基准用 AST 匹配判断调用是否正确，覆盖多轮/多步/并行调用；强调"可执行校验"而非文本相似。
   - 可抄：①把"该调哪个工具"做成可回归的用例集（输入→期望工具+参数）；②错误分类（选错/参数错/漏调）分别统计。
   - 成本：评测脚本 ≈ 120 行；不引入依赖。
2. `jxnl/instructor` — 14,099★ · MIT · 2026-11-05 · https://github.com/jxnl/instructor
   - 怎么做的：Pydantic schema 强约束输出；校验失败把错误信息回传模型自动重试。
   - 可抄：①"错误回传重试"（最多 2 次），②schema 收紧到最小必填字段。
   - 成本：包一层 ≈ 100 行（在 MCP 工具入口校验参数，失败回结构化错误）；无重启风险可控。
3. `OpenBMB/ToolBench` — 5,768★ · Apache-2.0 · 2025-05-21 · https://github.com/OpenBMB/ToolBench
   - 怎么做的：工具检索（先选相关 API 子集）+ DFSDT 搜索式求解，降低"工具太多选错"。
   - 可抄：①按会话意图先做工具子集；②失败后枚举替代工具。
   - 成本：≈ 150 行；与我们 core-min 思路重叠。
- **我的推荐：先做"参数校验 + 错误回传重试"**（instructor 思路），因为它不依赖模型能力提升、当天可验证，且能直接减少"参数错"这一类失败。

## G5 低成本上下文压缩

**现状**：只做截断（消息 200 字、记忆卡限条），历史长了就丢信息。

**候选**
1. `microsoft/LLMLingua` — 6,806★ · MIT · 2026-11-06 · https://github.com/microsoft/LLMLingua
   - 怎么做的：用小 LM 做 token 级压缩（保留关键 token），支持预算控制器；LongLLMLingua 处理长上下文。
   - 可抄：①按预算压缩而不是按长度截断；②压缩前先分块（问题相关块保留原文）。
   - 成本：Python/ONNX 依赖 + CPU 推理；桥接内嵌不现实，落成"离线预处理"才划算。
2. `langchain-ai/langchain` — 149,122★ · MIT · 2026-11-06 · https://github.com/langchain-ai/langchain
   - 怎么做的：ConversationSummaryBufferMemory 等模式——近期原文 + 旧对话摘要，按 token 上限触发摘要。
   - 可抄：①"原文窗口 + 滚动摘要"双层；②摘要触发条件用 token 数而非条数。
   - 成本：≈ 200 行（`buildWakePromptV2` 组装段）；摘要调用走便宜模型。
3. `run-llama/llama_index` — 52,829★ · MIT · 2026-11-05 · https://github.com/run-llama/llama_index
   - 怎么做的：Memory 模块把对话切成 block，块内摘要、块间保留事实；可与检索结合。
   - 可抄：①结构化"事实槽"（她在意的人/事/承诺）不参与压缩；②按 block 而非按消息压缩。
   - 成本：只抄结构 ≈ 100 行。
- **我的推荐：先做"分段 token 预算 + 滚动摘要"**（langchain 模式），因为不必上新依赖、可只对"已读历史"生效，成本可控；LLMLingua 留到确实需要极限压缩时再评估。

---

## 落地顺序建议（若只能做两件）

1. **G4 参数校验+重试**（1 天、无新依赖、可回归）；
2. **G1 本地 embedding 双路检索**（2–3 天、需一次索引重建、CPU 可跑）。

其余三项建议在 G1/G4 有数据后再排期：G3 可以先写金标（不写代码），G5 与 G2 都需要一次 bridge 重启窗口。
