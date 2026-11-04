# 工具描述来源调查（A-1）

> 只读调查，2026-11-04 22:0x，未改任何代码/配置，未重启，未碰 QQ。
> 结论先行：那 50 个工具描述**不是桥接写进提示词的**，而是 DSH 通过 MCP 的 `tools/list` 从
> `src/mcp-snowluma-safe.js` 拉走、注册成模型的 `tools` 参数。50 个描述+参数 schema 共
> **29,678 字符**（约 13K token），占一次私聊请求静态部分的 **57%**。

## 1. 定位：谁在构建工具描述

### 桥接侧（只有名单，没有描述）

- `src/bridge.js:6300-6375`：`toolMap` 把一串开关名映射到工具名（`sendMessage: 'qq_send_message'` …），
  `enabledTools` 只收集**名字**，随 `/api/socialV2/prompt` 返回。这是「工具开关」，不是描述。
- `/api/socialV2/prompt`（`src/bridge.js:6297` 起）返回的字段是
  `role.hint`、`memoryCard`、`enabledTools`、`recommended`、`unreadCount` 等；**没有任何工具的
  description / inputSchema**。
- 桥接全文 `qq_send_message` 只出现 6 次，全在协议说明与错误文案里（如 `bridge.js:5977` 的
  「请使用发送工具（qq_send_message / qq_reply）」），属于**名称引用**，不是定义。

### MCP 侧（定义就在这里）

- `src/mcp-snowluma-safe.js:389-400`：`const registerTool = server.tool.bind(server);` 包装后逐个注册；
  工具定义从 `:405` 起（`server.tool(...)`，描述为中文长句，参数用 zod）。
- `src/mcp-snowluma-safe.js:499`：`registerExtTools({ server, z, agentApi, cfg })`，把 `src/ext/tools/*.js`
  里 7 个自研工具（`qq_loop`、`qq_impression`、`note_tech`、`qq_person_note`、`qq_style_note`、
  `qq_read_group_recent`、`qq_learn_from_owner`）一起注册。
- 部署侧：`~/.dsh/profiles/web/cordis.patch.yml:9-35` 注册了三个 MCP 客户端：
  `mcp-snowluma`（本文件）、`mcp-snowluma-host`（`src/mcp-host-server.js`）、
  `mcp-web-search-safe`（`src/mcp-web-search-safe.js`）。

### DSH 侧（把 MCP 工具变成模型 tools）

- `@deepseek-ai/dsh-mcp-client/lib/index.js:129`：`client.listTools(..., { cacheMode: "refresh" })`；
  `:134-141` 用 `{ name: publicName, description: tool.description ?? "", inputSchema: tool.inputSchema }`
  注册到 harness 工具运行时；`:180-185` 转成 `{ parameters: inputSchema }` 的定义。
- `@deepseek-ai/dsh-agent-loop/lib/index.js:759/835`：`toolDeclarations()` 汇总后输出
  `tools: [...declarations.values()]`；`:2345` 把 `tools` 塞进模型请求。
- 安全插件 `plugins/surfcore/qq-tool-restrict.mjs` 只做两件事：用 `ctx.tools.restrict` 隐藏**全局危险工具**
  （shell/文件/派生 agent 等），用 `ctx.tools.guard` 在执行期白名单兜底；白名单前缀
  `mcp__snowluma__` 等**放行全部 MCP 工具**，不做裁剪。

## 2. 测量（2026-11-04 22:02，本机实拉）

直接对三个 MCP server 发 `initialize` + `tools/list`，统计 description 与 `inputSchema` 字符数：

| server | 工具数 | 描述字符 | schema 字符 | 合计 |
|---|---:|---:|---:|---:|
| `mcp-snowluma`（QQ） | 50 | 7,351 | 22,327 | 29,678 |
| `mcp-snowluma-host` | 1 | 103 | 85 | 188 |
| `mcp-web-search-safe` | 2 | 175 | 329 | 504 |
| **合计** | **53** | **7,629** | **22,741** | **30,370** |

- 完整 `tools` JSON **51,190 字节**；按「中文 1 字≈1 token、ASCII 4 字符≈1 token」估算 **≈13K token/次请求**。
- 单次请求的静态部分：persona preset `prefix` **11,114 字符** + 桥接 `role.hint` **8,943 字符**
  （私聊；群聊 8,062）+ `memoryCard` **2,834 字符** + 工具 **30,370 字符**。
  工具占静态部分 **≈57%**。
- 最大的几个工具（description+schema）：
  `qq_set_wake_config` 2,042、`qq_wait_for_messages` 1,264、`qq_send_message` 1,190、
  `qq_collect_sticker` 1,088、`qq_sticker_note` 1,037。
- 另：`/api/socialV2/prompt` 返回的 `enabledTools` 是 36 个「开关名→工具名」，与模型看到的 schema 无关。

## 3. 溯源结论

| 选项 | 是否 | 证据 |
|---|---|---|
| (a) 从 MCP 服务器 `tools/list` 拉 | **是** | `dsh-mcp-client/lib/index.js:129`；`cordis.patch.yml:9-35`；本机 `tools/list` 返回 50 条 |
| (b) 桥接内置静态表 | 否（定义在 MCP server 源码里，但桥接运行时不经手） | `bridge.js` 里只有工具**名字**，无 description/inputSchema |
| (c) DSH 注入提示词文字 | 否（DSH 只在模型请求里带 `tools` 参数） | `dsh-agent-loop/lib/index.js:2345` |

准确说法：**描述是 `src/mcp-snowluma-safe.js` 里的静态定义，经 MCP 协议由 DSH 拉取后作为模型
`tools` 参数发送**。改描述 = 改 MCP server；改「带哪些工具」= 改 `tools/list` 返回集合。

## 4. 可行性：只带高频工具 + 其余按需

### 方案 A（推荐）：MCP 注册期按配置过滤

- 位置：`src/mcp-snowluma-safe.js:389-405` 的 `registerTool` 包装处，按
  `config.socialV2.toolProfile`（`full` 默认 / `core`）过滤 `server.tool(...)` 的注册。
- 生效方式：DSH 重启（MCP 客户端重新 `listTools`），**不需要重启桥接**。
- 回退：配置改回 `full` + 重启 DSH；代码默认值为 `full`，不配等于现状。
- 风险：preset 提示词里点名了若干工具（看语音、转发、空间、收藏表情等），过滤后模型可能照旧调用
  不存在的工具 → 白跑一轮；需要同步裁剪/改写 preset 文案，或把被点名的保留在 core 里。

### 方案 B：在 preset 的 `qq-tool-restrict` 里 deny 掉 MCP 工具

- 位置：`plugins/surfcore/qq-tool-restrict.mjs` 的 `ctx.tools.restrict`。MCP 工具在全局层注册，
  理论上可被 restrict 隐藏，但注释写明 restrict「只影响继承的全局层」，**需要实测确认**。
- 优点：不改 MCP server；缺点：名单重复（工具名两处维护），且 require DSH 重启。

### 方案 C：动态按需（meta-tool 网关）

- 只注册 `list_tools` / `call_tool` 两个工具，其余按需拉取。MCP 协议本身不支持「同一会话内动态
  增删 schema」，要在 DSH 工具层加网关，改动面大、破坏原生工具调用，**不建议现在做**。

### 裁剪收益（实测）

| 子集 | 工具数 | 字符 | 占现状 |
|---|---:|---:|---:|
| chat-core（发送/等待/已读/看图/表情/转发/唤醒） | 13 | 11,000 | 37.1% |
| core-22（再加记忆/黑话/群列表/成员） | 22 | 14,724 | 49.6% |

即：保留 13 个高频工具可省 **18,678 字符 ≈ 8K token/次**；保留 22 个省 **14,954 字符 ≈ 6.5K token/次**。

## 5. 建议的下一步

1. 先定义 `toolProfile=core` 的 13~15 个白名单（与 preset 文案里点名的工具对齐，避免「说了却不存在」）。
2. 在 `mcp-snowluma-safe.js` 注册处加开关，默认 `full`；写一个只读脚本 `scripts/tool-list-report.mjs`
   复用本次测量口径，改前后对比字符数。
3. 重启 DSH 后在日志里核对 `tools/list` 条数与首轮 token 用量；不满意把配置改回 `full` 即回退。
4. 注意：工具集变化会**失效一次 prompt 缓存**，成本约等于一次缓存重建。

## 6. 实现（2026-11-04 22:12，已落地，默认未启用）

在 `src/mcp-snowluma-safe.js` 的注册期过滤里补了 `core` 档（原有 balanced/compact/full 不动）：

- 档位解析：`process.env.SURFCORE_TOOL_PROFILE || config.socialV2.toolProfile || balanced`
  （`socialV2.tools.getSnapshot === false` 时默认 `full`，保持原逻辑）；未知值打一行 stderr 警告并按 balanced。
- `core` 的保留名单 `CORE_TOOL_NAMES`（28 个，缺席的静默跳过）：发送/回复/等待/已读/提示词/上下文快照/状态/
  唤醒设置/看图/转发/消息详情/表情列表/发表情/看表情/看自己/黑话查与投/写记忆/查记忆/欠事/印象/群最近消息/
  群列表/群成员/结束会话/发语音/语音列表/戳一戳。
- 启动时打印一行（stderr，不影响 MCP stdout）：
  `[tool-profile] profile=core 注册 25/57 个工具，隐藏 32 个：…`

实测（同一个 MCP server，initialize → tools/list）：

| 档位 | 工具数 | 描述+schema 字符 | 相对 balanced |
|---|---:|---:|---:|
| full | 57 | — | +5,000 左右 |
| **balanced（当前默认，未改）** | **50** | **29,678** | 基准 |
| compact | 47 | 28,373 | −1,305 |
| core | 25 | 16,763 | **−12,915（−43.5%，≈5.7K token/次）** |

启用与回退：

```bash
# 启用（下次 DSH 重启后生效）：
#   config.json 里加 "socialV2": { ..., "toolProfile": "core" }
# 临时验证（不改配置，仅当前进程）：
SURFCORE_TOOL_PROFILE=core /opt/node-v22.23.4/bin/node src/mcp-snowluma-safe.js
# 回退：删掉 socialV2.toolProfile，或设成 "balanced"，重启 DSH
```

风险（开 core 前必须知道）：

- 被隐藏的 32 个里有 16 个是 preset 文案点名过的：`qq_collect_sticker`、`qq_sticker_note`、
  `qq_set_sticker_remark`、`qq_view_sticker`、`qq_send_qzone_msg`、`qq_delete_qzone_msg`、`qq_set_profile`、
  `qq_set_avatar`、`qq_list_friend_requests`、`qq_handle_friend_request`、`qq_recall_memory`、`qq_diary`、
  `qq_send_burst`、`qq_report_feedback`、`qq_send_group_message`、`qq_send_private_message`。
  模型看到文案里提了工具却拿不到 schema，会白跑一轮再改口。**建议先同步裁剪 preset 文案，或先把这几个加回白名单。**
- 工具集变化 = 一次 prompt 缓存失效（约一次缓存重建的成本）。
- 桥接里的 `enabledTools`（36 个名字）只是允许名单，不参与 schema 生成，不受本次改动影响。

## 附：测量方法

```bash
# 起一个 MCP server，initialize → notifications/initialized → tools/list，统计 description/inputSchema
node /tmp/tools-measure.mjs
# prompt 实测（token 从 config.json 的 consoleToken 取，不是 /opt/her-console/token.txt）
curl -s -H "x-console-token: $TOK" \
  "http://127.0.0.1:3100/api/socialV2/prompt?key=private:3160624852"
```

## 7. lean 档与「文案冲突」检查（2026-11-04 22:30）

按使用数据加了一个更窄的 `lean` 档（保留 20 个：看图/未读/表情/记忆/群信息/黑话/欠事/印象/上下文等）。
它同样只在注册期过滤，默认仍是 `balanced`。

实测（`SURFCORE_TOOL_PROFILE=lean`）：

| 档位 | 工具数 | 描述+schema 字符 |
|---|---:|---:|
| balanced | 50 | 29,678 |
| core | 25 | 16,763 |
| **lean** | **19** | **9,221（−69%）** |

**但 lean 会隐藏 `qq_send_message`、`qq_reply`、`qq_wait_for_messages`、`qq_get_prompt`、`qq_mark_read`、
`qq_close_conversation` 这 6 个聊天主链工具**——按现在的运行方式，模型靠这些工具收发消息，
所以 lean 目前**不能直接开**（除非确认发送走的是别的通道）。

### 冲突检查脚本

```bash
node scripts/check-tool-mentions.mjs        # 人读表格
node scripts/check-tool-mentions.mjs --json # 机器读
```

扫描范围：`src/bridge.js`、仓库 `docs/**`（含 handoff 任务文案）、`~/.dsh/surfcore/characters/**`、
`~/.dsh/profiles/*/`（preset 与插件文案，跳过 node_modules）。

输出：`工具名 | 出现位置(文件:行) | 出现次数`，附「按来源」统计，`CONFLICT_COUNT` 作为退出码依据
（0 = 无冲突，1 = 有冲突）。

当前结果：**34 个冲突**。其中 32 个来自 `bridge.js`（绝大多数是 `toolMap`/`enabledTools` 的权限名单，
不是提示词文案），角色包只有 1 个（`characters/char-mvugwthv/memory/self.md:5` 提到 `qq_diary`）。
按任务约定：**冲突数 > 0，不启 lean**；先给用户看清单。
