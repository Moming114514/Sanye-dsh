# src/ext —— 三叶的扩展层

这个目录是「我们自己加的功能」唯一该住的地方。`src/bridge.js` 是上游 surfcore 的文件，每次升级都要和上游做三方合并；放在这里的代码不会被动，升级时只需要确认四个钩子的接线还在。

## 四个钩子

| 钩子 | 位置 | 作用 |
| --- | --- | --- |
| `extDispatchRoute(pathname, ctx)` | 桥接 HTTP 请求体解析之后 | 扩展拥有自己的接口（`routes: [{ path, handle }]`） |
| `extPromptBlocks(cfg)` | 拼常驻提示词时 | 扩展注入自己的段落（`promptBlock(cfg)`），注册顺序 = 注入顺序 |
| `extWakeGate(ctx)` | `sendWakePromptV2()` 入口 | 决定「这次唤醒要不要发生」，返回 false 就不唤醒（不花钱） |
| `extAfterSend(ctx)` | 一条回复发出去之后 | 发送后回调（记欠事等） |
| `extOnGroupMessage(ctx)` | 群消息进来时 | 群消息入口（记录最后说话人、观察句式复用） |

另有 `extStateKey()` 把各扩展的 `stateKey()` 拼成缓存键的一部分：**扩展读了文件就必须提供 stateKey**，否则提示词缓存会拿到旧内容。

## 新增一个功能的最小步骤

1. 新建 `src/ext/<名字>.js`，`export default { id, title, promptBlock?, routes?, wakeGate?, afterSend?, onGroupMessage?, stateKey? }`。
2. 在 `src/ext/index.js` 的 `EXTENSIONS` 里加一行（顺序决定提示词顺序）。
3. 需要新工具：`src/ext/tools/` 加一个文件，再到 `src/ext/tools/index.js` 的 `TOOLS` 里加一行。
4. `node --check` + 重启桥接，比对提示词段落与接口行为。

## 现有扩展

- `owner-only.js` —— 只听主人：群会话只在他最近说过话时放行唤醒
- `promises.js` —— 欠事捕获：从她的回复里识别承诺，写进欠事清单
- `impressions.js` —— 印象库：她对人/事的看法（工具 `qq_impression`）
- `tech-notes.js` —— 技术笔记：看过的技术视频抽成资料（工具 `note_tech`）
- `style.js` —— 学说法：从指定的人身上学说话框架（工具 `qq_style_note`）
- `related-memory.js` —— 相关记忆：按当前这句话临时挑几条旧记忆（只在私聊）
- `loops.js` —— 欠事/人物接口（`/api/socialV2/loop`、`/api/socialV2/person`）
- `stickers.js` —— 表情待补提示行
- `blackbox.js` —— 黑箱任务：内部任务期间不发 QQ
- `memory-card.js` —— 记忆卡注入预算常数

## 注意

- 这里只放「我们加的」，不改上游语义；要改上游行为时在 bridge 里留最小接线 + 注释标记。
- 每个扩展的 `try/catch` 由 `index.js` 兜住：一个扩展抛错不会拖垮整轮唤醒，但会在日志里留 `[ext:<id>]`。
