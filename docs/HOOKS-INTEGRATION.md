# 把六处/七处装配点收成四处

这份文档是给 Sanye-dsh 用的接入说明。不引入任何依赖，只放一个文件：`src/ext/four-point-hooks.js`（约 10KB，零 import，同步执行）。

## 一、为什么要收

Sanye 现在的 `src/ext/index.js` 有七个入口：

| 现有函数 | 干什么 |
|---|---|
| `extOnGroupMessage` | 群消息进来 |
| `extOnPrivateMessage` | 私聊消息进来 |
| `extWakeGate` | 要不要醒 |
| `extPromptBlocks` | 提示词塞什么 |
| `extAfterSend` | 发完之后 |
| `extStateKey` | 拼缓存指纹 |
| `extDispatchRoute` | 路由分发 |

七个入口本身没错，问题在于「加一个功能要同时改三处」：注册一个扩展要同时决定它挂在哪个入口、顺序排第几、要不要算进缓存指纹、失败要不要隔离。入口越多，这些约定越容易漏。四个孔的意思不是功能变少，而是**同一类事情只走一个门**：

| 四个孔 | 收谁 | 说明 |
|---|---|---|
| `incoming` | `extOnGroupMessage` + `extOnPrivateMessage` | `ctx.kind` 区分群/私聊，一个扩展可以同时看两种 |
| `gate` | `extWakeGate` | 返回 `{allow:false}` 就拦下 |
| `context` | `extPromptBlocks` + `extStateKey` | 提示词块；`cache:true` 的扩展参与指纹，关掉即让缓存失效 |
| `outbound` | `extAfterSend` + 发送前清理 | `phase:'before'` 清理正文，`phase:'after'` 发送后记账 |

`extDispatchRoute`（路由）不在四个孔里——它是接入层的分支选择，归 `incoming` 那一段，不该单独开一个孔。

## 二、怎么接（三步）

1. 把 `src/ext/four-point-hooks.js` 放进项目。
2. 建一个自己的 `src/ext/registry.js`，把所有扩展在这里登记：

```js
import { createHooks } from './four-point-hooks.js';

export const hooks = createHooks();

// gate：静音时段命中就不唤醒
hooks.add('gate', 'quiet-hours', (ctx) => ({ allow: !insideQuietHours(ctx.now) }), {
  order: 10, access: 'read',
});

// context：记忆块（影响缓存 → 要声明 cache 和 stateKey）
hooks.add('context', 'memory', (ctx) => buildMemoryBlock(ctx), {
  order: 20, access: 'read', cache: true,
  stateKey: (ctx) => `mem:${ctx.key}:${memoryRevision()}`,
});

// outbound：发送前清掉多余空白
hooks.add('outbound', 'trim', (ctx) => ctx.text.trim(), { phase: 'before' });

// outbound：发送后记账
hooks.add('outbound', 'send-log', (ctx) => appendLog(ctx.key, ctx.text), { phase: 'after' });
```

3. 在主干原来的七个调用点各自换成对应的一个调用（只有四处要改）：

```js
// 收到消息（原 extOnGroupMessage / extOnPrivateMessage）
hooks.run('incoming', { kind, key, text, at });

// 要不要醒（原 extWakeGate）
const ok = hooks.veto('gate', { key, text, now });
if (!ok) return;

// 拼提示词（原 extPromptBlocks）
const blocks = hooks.collect('context', { key });

// 发送（原 before / after）
const text = hooks.transform('outbound', { key, phase: 'before' }, raw);
hooks.run('outbound', { key, text, phase: 'after' });
```

## 三、四条约定（照做就不会互相踩）

1. **只吃入参**：扩展拿到的 `ctx` 是拷进去的值，不改主干的闭包变量。
2. **失败隔离**：每个扩展单独 try/catch，一个抛错不影响别的，也不会中断发送。
3. **有状态的东西留在模块里**：登记表、计数、开关都在这个文件内，不往主干挂。
4. **只读的不算缓存**：`access:'read'` 且 `cache:false` 的扩展改了什么，都不影响 `stateKey()`。

## 四、一条验收线

一个扩展都不注册时，行为必须和没接这个文件一模一样：`gate` 放行、`context` 返回空数组、`outbound` 原样返回、`stateKey()` 为空字符串。这条有单测，改完跑一次 `node --test`。

## 五、可视化（可选）

`panel/server.mjs` 是同一个包里的零依赖面板，起一个本机端口就能看到「登记了哪些扩展、哪些开着、谁在报错、缓存指纹是什么」。不想开就不开，主干不受影响。
