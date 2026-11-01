# src/ext 扩展体系

surfcore 上游是单文件桥接（`src/bridge.js`，一万七千行）。我们对它的改造原先是一层层内联补丁（`// XXX_PATCH` 标记最多时有 106 处），升级上游时只能手工三方合并。

M2 之后，**功能进扩展、策略留桥接**：bridge 只保留「接线」——鉴权、模式闸门、MCP 进程引导——其余都通过钩子调用 `src/ext/` 里的模块。

## 六个钩子

| 钩子 | 调用位置 | 用途 | 返回值 |
| --- | --- | --- | --- |
| `extPromptBlocks(cfg)` | 组装唤醒提示词时 | 各个提示词块（记忆、印象、技术笔记、学说话…） | 字符串数组 |
| `extStateKey()` | 提示词缓存键 | 参与缓存键的状态指纹，扩展改了状态要让缓存失效 | 字符串 |
| `extWakeGate(ctx)` | `sendWakePromptV2()` 入口 | 唤醒闸门（例如只听主人模式下拦群唤醒） | `true` = 拦住 |
| `extOnGroupMessage(ctx)` | 群消息入口 | 观察型钩子（记最后说话人、样本复用计数） | 无 |
| `extOnPrivateMessage(ctx)` | 私聊消息入口 | 私聊指令（例如「学一下亚托莉」触发手动作业） | `true` = 已处理 |
| `extAfterSend(ctx)` | 消息发出之后 | 发送后回调（欠事捕获） | 无 |

另外两条装配路径：

- `extDispatchRoute(pathname, ctx)`：扩展自带的 HTTP 路由，在 bridge 鉴权之后调用，返回 `true` 表示已经响应。
- `registerExtTools({ server, z, agentApi, cfg })`：把 MCP 工具定义从 bridge 搬到 `src/ext/tools/`，按 `cfg.socialV2.tools.<flag>` 决定注册。

## 扩展的生命周期

长驻服务型扩展用工厂函数，依赖靠注入（**不要在扩展里 import bridge**）：

```js
export default function createFoo({ getCfg, log, stateDir, sendToQQ, getBot }) {
  return { tick() { /* ... */ } };
}
```

- `getCfg()` / `getBot()` 用**函数**而不是值：bridge 里 `const bot = ...` 可能比工厂调用晚初始化，传值会撞 TDZ（`Cannot access 'bot' before initialization`）。
- 状态文件一律放 `~/.dsh/surfcore/state/<name>.json`，`stateDir` 由 bridge 注入。
- 每写一个状态文件，就要在 `extStateKey()` 里加指纹，否则提示词缓存不会失效。

## 状态文件约定

| 文件 | 归属扩展 | 内容 |
| --- | --- | --- |
| `impressions.json` | `impressions.js` | 她对他的看法（最多 50 条） |
| `tech-notes.json` | `tech-notes.js` | B 站技术笔记（同步生成 `docs/TECH-NOTES.md`） |
| `style-samples.json` | `style-lib.js` / `style.js` | 学来的说话框架（candidate / active / retired） |
| `loops.json` | `loops.js` | 欠事与循环 |
| `qzone-seen.json` | `qzone-watch.js` | 说说已读位 |
| `friend-requests.json` / `avatar-pending.json` / `friend-notify.json` | `profile.js` | 好友申请与通知冷却 |
| `reminders` 相关 | `reminders.js` | 提醒 / 告警 / 日报去重 |
| `restart-quiet.json` | `blackbox.js` | 重启后静默标记 |
| `stickers.json` | 上游（`sticker-*`） | 表情库，扩展只读 |

## 加一个新扩展（20 行例子）

```js
// src/ext/ping.js
export default {
  id: 'ping',
  stateKey: () => '',
  routes: [{
    path: '/api/socialV2/ping',
    handle: ({ body, sendJson }) => sendJson({ ok: true, pong: Date.now(), echo: body?.text ?? '' }),
  }],
};
```

在 `src/ext/index.js` 的 `EXTS` 数组里加一行 `ping`，重启桥接即生效。需要提示词就加 `promptBlock(cfg)`，需要定时就导出厂函数 `createXxx({ getCfg, log })` 并在 `bridge.js` 的定时器区调用一次——**定时器只留在 bridge**，扩展负责逻辑。

## 什么不搬

- 鉴权（`isLiveAgentToken`、console token、agent token）：每个入口都要用，搬出去反而绕圈。
- 模式闸门（`reserved2` / `owneronly` / `paused`）：策略层，属于 bridge。
- MCP 进程引导、`dsh-web` 会话桥：进程级，与业务无关。
- 发送节流、分条、去重：所有发送都经过 `sendToQQ`，在 bridge 里做一次就够。

## 验收方式

每次迁移都跑 `scripts/snapshot.mjs`：

```bash
node scripts/snapshot.mjs --save-base   # 迁移前存基准
node scripts/snapshot.mjs --diff        # 迁移后对比
```

对比三份提示词（私聊 + 两个群）的逐行 diff、MCP 工具清单（名字/描述/inputSchema）以及五个只读接口的状态码。**提示词的差异只允许是数据漂移**（新增记忆、说话人排序），一旦出现区块增删就是搬错了。
