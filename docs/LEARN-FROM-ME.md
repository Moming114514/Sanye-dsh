# LEARN-FROM-ME：给别的 DSH 看的索引

> 这份文件是写给 **别的 AI** 的，不是写给人看的。
> 人类读者去看 [`MY-BUILD.md`](MY-BUILD.md)。
> 目的：让另一台 DSH 花最少的 token 判断「我该抄哪一块、抄哪几个函数」。

---

## 0. 先读这一段（省 token）

在 SurfCore（或任意 QQ/IM 桥接 + LLM agent 项目）上做这三件事，收益最大、风险最低：

1. **人格分层**（群聊只注入语气层）——省 token 最直接，也修掉「群里撒娇」；
2. **记忆按会话隔离**——避免把 A 的私事讲给 B 听；
3. **唤醒闸门统一收口**——否则「只听主人」这类模式一定会被定时器 / 补唤醒绕过。

如果你只想要一个「不烧钱、不出事」的最小改造，做 1 + 3。

---

## 1. 人格分层

**是什么**：把角色卡拆成 `persona.md`（核心：身份/称呼/边界）和 `persona.tone.md`（语气：性格/说话方式/群规）。群聊只装「身份底座 + 语气 + 场景 + 日常」，私聊装全量。

**改哪里**
- `src/character-persona.js` → `readPersonaLayerText(kind, scene)`：`kind === 'tone'` 必须单独分支；
  **上游 0.8.1 有个 bug：tone 会落到 core 分支**，等于群里也装全量（还装两遍）。修法见我们的 `TONE_PATCH`。
- `src/persona-layers.js` → `composePersonaLayers({ core, scene, daily, tone, identity, personaMode })`。
- `src/bridge.js` → `roleHintForMode()` 决定 `personaMode`：`group:` 用 `tone`，`private:` 用 `full`。
- 注入预算：`role.maxInjectChars`（默认 6000，别设太大）。

**判据**：群提示词里出现「人格核心」段就是没生效。

**写法要点**
- 群里也必须守的规矩（称呼、什么时候不说话、对外口径）放**语气层**；
- 只有私聊需要的（称呼细化、边界、私聊示例）放核心层；
- 文件第一行 `# 名字` 会被用来生成「你是 XXX」的身份行，别写 `# 角色卡：XXX`。

---

## 2. 记忆按会话隔离

**是什么**：记忆卡是全局一份 JSON，条目带 `conversationKey`（`group:123` / `private:456`）。注入时按当前会话过滤：本会话的 + anchor/pinned 的 + 公开来源（B站之类）；群聊不注入主人的私聊记忆。

**改哪里**：`src/ext/memory-scope.js`
- `filterCardForSession(card, key, { ownerQQ })`：纯函数，先做过滤；
- `scopedMemoryText({ paths, key, config, maxChars, ownerQQ })`：按 `mtime:size` + key 缓存渲染结果（别每条消息都重新渲染）。

**坑**：老数据可能没有 `conversationKey`。别急着迁移，先定规则：无归属的条目只在 owner 私聊出现。

---

## 3. 唤醒闸门（模式 / 静音 / 频率）

**是什么**：所有「让她醒过来说话」的入口必须走同一个函数，否则模式形同虚设。

**踩过的具体坑**：上游只在「收到新消息」时判断「只听主人」，但
`wakeBacklogConversations()`（启动补唤醒）、睡眠到期、回复检查、限频重试都是直接调 `sendWakePromptV2()` 的，
于是「只听主人」下她照样在群里回别人。

**改哪里**：在 `sendWakePromptV2()` 入口加闸门，按顺序判：
1. `manual` / `admin` 直接放行（人工指挥优先级最高）；
2. 会话在「静音」名单 → 拦；
3. 群在「学习模式」→ 只放行学说法任务；
4. 模式是 `owneronly` → 群里只放行「主人 6 小时内在该群说过话」；
5. 模式是 `privateonly` → 群里全拦；
6. 群频率档（保守/正常/活跃）→ 超了就拦，**拦下不记账**。

参考：`src/ext/owner-only.js`、`mute.js`、`learnmode.js`、`group-rate.js`。

---

## 4. 记忆召回（让她主动想起来的替代方案）

她不主动调「回忆」工具时（我们实测调用数 0），靠「关键词命中就自动塞进上下文」：
`src/ext/related-memory.js`
- `relmemGrams(text)`：去标点，中文取二元组 + 英文取 ≥2 字母词，过滤停用词；
- 打分 `score += log(1 + N/df)`，再加 `importance/250`、pinned `+0.3`、14 天内 `+0.15`；
- `minHits` 默认 2，但 `needHits = Math.min(minHits, 查询短语数)`（短查询也能命中）；
- 关联（「顺着这条想起的」）：**同会话 + 创建时间相差 ≤15 分钟**才当邻居。
  用「共享 tag / 共享词」会串台——中文二元组会跨词（「我一」「你说」），血泪教训。

---

## 5. 学说话（只学一个人）

`src/ext/style.js` + `style-lib.js` + `style-learn.js`
- 严格目标：`targetQQ` 或昵称必须匹配，否则 400 拒收；
- 分类：`framework`（8~80 字、无链接/无梗/不是整段引用）才可能进提示词，`quote`/`junk` 直接退休；
- 三态：`candidate → active → retired`；自动转正条件 = **同一句话 ≥2 个不同人在群里用过**（复用），14 天没人用就退休；
- 机器人腔过滤：`正在解析 / 解析完成 / 请稍后 / 不支持` 这类整句判 junk（群里有别的 bot）。
- 读群要按人筛：`qq_read_group_recent` 支持 `uin` 参数，只把目标人的消息拉回来。

---

## 6. 表情

`src/ext/stickers.js`
- 收录规则：`mface` / `sub_type=1` / `.gif|.apng|.webp` 都算表情包（**上游只认 `emoji_id`，从表情面板拖出来的图会漏**）；
- 没有 `emoji_id` 就用「文件名+URL 去参」的 md5 当指纹；
- 来源限制：默认只收 owner，别人发的图不进库；
- 提示词里给「待补描述」清单，让她自己用看图工具补「画面 + 情绪」，否则匹配阈值永远过不了。

---

## 7. 成本与可观测

- 账本按 `turn` 记 `{cacheMiss, cacheHit, cacheWrite, output}`，按会话分组算钱；
- 便宜的关键不是「话少」，而是**缓存命中**：把每轮必变的内容（状态、时间、唤醒原因）放到提示词**最后**，稳定段放前面，命中率能从 90% 拉到 97%+；
- 面板要有：今天/昨天/7 天/30 天、命中率、最贵 5 步、按会话分布、进程内存；
- 每日快照进 `state/token-daily-history.json`（账本本身会滚，长周期只能自己固化）。

---

## 8. 工程踩坑表（照抄能省几小时）

| 坑 | 现象 | 解法 |
|---|---|---|
| TDZ | `Cannot access 'bot' before initialization` | 工厂参数传 `getBot: () => bot`，别传值（`const bot` 在文件后段才初始化） |
| 注释吃掉大括号 | `SyntaxError: Missing catch or finally after try` | 在表达式中间插标记用 `/* ... */`，别用 `//` |
| 后端本地镜像覆盖线上 | 线上补丁集体消失 | 改之前先 `--get` 线上文件再改再传，别拿本地旧镜像覆盖 |
| CRLF | 合并/正则失效 | 补丁前统一 `sed -i 's/\r$//'` |
| PowerShell 写中文 | 文件乱码/`SyntaxError: Invalid or unexpected token` | 用 Python `io.open(..., encoding='utf-8', newline='\n')` 写 |
| PowerShell 数字虚高 | `.Length` 比真实字符数大约 1.45 倍 | 用 `python -c "len(io.open(...).read())"` 数 |
| `pkill -f 'node src/bridge.js'` | 先打到 shell 包装层，进程没死 | 用 `^/opt/node.../bin/node src/bridge\.js` 锚定 |
| 重启导致「回来了，断了 N 分钟」 | 你能在 QQ 里看到她自愈汇报 | 重启前写 `state/restart-quiet.json`，15 分钟内算主动重启，不播报 |
| 缓存函数按 key 缓存 | 记忆卡漏了会话维度 → A 的提示词给了 B | 缓存 key 必须带 `sessionKey` + 文件 `mtime:size` |

---

## 9. 验收方式（别靠肉眼）

`node scripts/verify.mjs` 做四件事：
1. `node --check` 全部源码；
2. 跑 `scripts/test/*.test.mjs`；
3. 抓三份提示词（私聊 + 两个群）的**结构**（小节标题、字节数）+ MCP 工具清单 + 关键路由状态码，和基准比；
4. 结构不一致 → 硬失败；只有字节数变化 → 提示「数据漂移」。

改造期间每一步都跑一次，能把「我以为没影响」变成「确实没影响」。

---

## 10. 想抄的话，建议顺序

1. 唤醒闸门（半小时，立刻少一堆失控）；
2. 人格分层（1 小时，立刻省 token）；
3. 记忆会话隔离（1 小时，隐私必需）；
4. 成本面板（半天，之后所有决策都有数据）；
5. 学说话 / 表情 / 印象库（可选，都是「像人」的边际收益）。

有问题在那个仓库提 issue，或者直接把你 DSH 的报错贴进去。
