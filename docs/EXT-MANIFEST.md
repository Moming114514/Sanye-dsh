# EXT-MANIFEST 契约（v1）

> 目标：让「有哪些扩展、各自挂哪些钩子、开哪些开关、亮哪些页面」变成**程序可断言的事实**，
> 而不是散落在 `bridge.js` 的 66 个补丁名和面板的 44 条 features.json 里的记忆。
>
> 这份契约只管**声明**。它不改变任何调用路径——波 2 只做「声明 + 断言」（L0/L1），
> 把 `bridge.js` 里的 126 处 `_PATCH` 改成经 ctx 注入（L2）属于拆桥接，单独立项。

## 0. 一份 manifest 长什么样

```js
// src/ext/attention.js 文件末尾
export const manifest = {
  id: 'attention',
  title: '注意力打分',
  kind: 'hook',
  order: 60,
  enabledByDefault: true,
  hot: true,
  config: ['socialV2.attention.minScore', 'socialV2.attention.weights'],
  stateFiles: [],
  hooks: ['promptBlock', 'wakeGate', 'routes'],
};
```

## 1. 字段 schema

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `id` | string | ✅ | 全仓唯一，`^[a-z][a-z0-9-]{1,31}$`，与文件名去掉 `.js` 一致 | `'group-rate'` |
| `title` | string | ✅ | 面板/文档显示用中文短名，1–24 字 | `'群聊频率'` |
| `kind` | enum | ✅ | `core` / `hook` / `tool` / `panel`，四选一 | `'hook'` |
| `enabledByDefault` | boolean | ✅ | 新装机器上默认开还是关 | `true` |
| `hot` | boolean | ✅ | 改 config 是否立即生效（false = 要重启桥接） | `true` |
| `hooks` | string[] | ✅ | 实现了哪些钩子，只能是下面 7 个；没有钩子写 `[]` | `['promptBlock','routes']` |
| `order` | number | 有 `promptBlock` 时必填 | 提示词注入顺序。**固定写成「`src/ext/index.js` 里 EXTENSIONS 的下标 ×10 + 10」**（10,20,…,170），全仓唯一，校验器会核对是否与注册位一致。**不写 = 不参与排序，回退到注册顺序** | `60` |
| `config` | string[] | 否 | 读的 cfg 点路径；用于校验 features.json 的 `path` 是否存在 | `['socialV2.mood.decay']` |
| `stateFiles` | string[] | 否 | 写在 `SURFCORE_STATE_DIR` 下的文件名（不含路径） | `['attention.json']` |

> **v1 没有 `pages` 字段**（决策 m00399）：面板继续用 `PAGES` + `/opt/her/features.json`。
> 等 `/api/plugins` 真的被面板消费、且能证明「页面只从一个来源渲染」再加；现在写了校验器直接判不合格。

**7 个钩子**（来自 `docs/PLUGIN-CONTRACT.md`，不要自创）：

`promptBlock` · `wakeGate` · `routes` · `onGroupMessage` · `onPrivateMessage` · `afterSend` · `stateKey`

> `stateKey` 不是"被调用的钩子"，而是**声明"我这块提示词按哪个 key 缓存"**。
> 有 `promptBlock` 却没 `stateKey` 的模块，会把内容拼进全局提示词、污染所有会话的缓存
> （现在 `style.js` 就是这种情况，迁移时要核实）。

## 2. 校验规则

校验器在 `scripts/dump-manifests.mjs`，跑法见 §4。规则：

| 编号 | 规则 | 不合格时报什么 |
|---|---|---|
| R1 | `id` 存在、匹配正则、与文件名一致 | `id 非法/缺失` |
| R2 | `id` 全仓唯一 | `id 重复（与 X 撞了）` |
| R3 | `title` 非空、≤24 字 | `title 缺失或过长` |
| R4 | `kind` ∈ 四选一；`enabledByDefault`/`hot` 是 boolean | `kind/布尔字段非法` |
| R5 | `hooks` 每项 ∈ 7 个白名单 | `未知钩子 X` |
| R6 | `hooks` 里声明的，模块默认导出上必须真有对应函数（`routes` 可以是数组或函数） | `声明了 X 但没实现` |
| R7 | 有 `promptBlock` 必须有 `order`；`order` 为正整数、全仓唯一，且等于 `EXTENSIONS 下标×10+10` | `缺 order / order 冲突 / order 应为 N` |
| R8 | v1 **禁止** `pages` 字段（面板仍用 PAGES + features.json） | `v1 不支持 pages 字段` |
| R9 | `config` 每项是 `a.b.c` 点路径；`stateFiles` 不含 `/`、`..` | `config/stateFiles 非法` |
| R10 | 模块没有 `manifest` 导出 | `缺 manifest`（波 2 期间这是预期失败） |

R10 在迁移期是**已知失败**：30 个模块现在都没有 manifest。校验器的价值从波 2 第一个模块开始体现。

## 3. 三个示例（都 ≤15 行）

### 3.1 纯函数（无钩子、无状态）

```js
// src/ext/memory-card.js
export const MEMV2_CARD_MAX = 32;

export const manifest = {
  id: 'memory-card',
  title: '记忆卡片上限',
  kind: 'core',
  enabledByDefault: true,
  hot: false,
  hooks: [],
};
```

### 3.2 写自身 state（原子替换）

```js
// src/ext/group-rate.js
import fs from 'node:fs';
import path from 'node:path';

export const manifest = {
  id: 'group-rate', title: '群聊频率', kind: 'hook',
  enabledByDefault: true, hot: true, order: 50,
  config: ['socialV2.groupRate'], stateFiles: ['group-rate.json'],
  hooks: ['promptBlock', 'routes', 'stateKey'],
};

export function saveRates(dir, data) {
  const tmp = path.join(dir, `group-rate.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, path.join(dir, 'group-rate.json')); // 原子替换，绝不原地写
}
```

> 反例（校验器会拦住，别这么写）：
> `hooks: ['promptBlock', 'route']` → `未知钩子 route`（白名单是复数 `routes`）；
> `hooks: ['afterSend']` 但没导出 `afterSend` → `声明了 afterSend 但没实现`。

### 3.3 带 route（`loops.js` 的真实写法）

```js
// src/ext/loops.js —— 真实文件只加了这一段，默认导出没动
export const manifest = {
  id: 'loops',
  title: '欠事与人物',
  kind: 'hook',
  enabledByDefault: true,
  hot: true,
  order: 160, // index.js 里第 16 位（下标 15）×10+10
  stateFiles: ['loops.json', 'people.json'],
  hooks: ['routes'],
};
```

## 4. 怎么跑

```bash
cd /home/dsh/apps/surfcore
node scripts/dump-manifests.mjs              # 表格 + 汇总（全部模块，含失败原因）
node scripts/dump-manifests.mjs --strict     # 有失败就 exit 1（给 CI/verify 用）
node scripts/dump-manifests.mjs --require-all --strict   # 连「未迁移」也算失败（波 2 收尾用）
node scripts/dump-manifests.mjs --order-map  # 打印「EXTENSIONS 第几位 → 该给的 order」
node scripts/dump-manifests.mjs --json       # 写 docs/generated/manifests.json（可提交）
node scripts/dump-manifests.mjs --selftest   # 用 §3 的三个示例 + 4 个反例自检校验器
```

- 不知道某个模块该写多少 `order`：先跑 `--order-map`，把对应行原样抄进 manifest。

- `--json` 产物是**代码侧事实**，可以进 git；不包含任何会话 key、token、人格正文。
- 校验器**不修改任何模块**，只 import + 读导出。import 失败的模块会被记为 `import 失败：<错误>`，
  不会中断整轮扫描。

## 5. 迁移（波 2，每个模块 3 行）

1. 在文件末尾加 `export const manifest = {…}`（只加，不改现有导出）。
2. `node scripts/dump-manifests.mjs` 确认该模块通过。
3. 勾掉 `docs/MANIFEST-PLAN.md` §5 表格里对应行。

**L2（把 bridge 里的 `_PATCH` 改成经 ctx 注入）不在本契约范围**，见计划 §8「这次不做」。
