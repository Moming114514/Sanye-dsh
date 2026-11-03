# MANIFEST-PLAN · 扩展清单化改造计划

- 版本：v1（待确认）
- 日期：2026-11-03
- 范围：`docs/` 新增 1 个文件、`scripts/` 新增 2 个、`src/ext/*.js` 每个文件末尾追加 1 个导出；**不改 bridge.js 里任何一处 `_PATCH`**
- 前提：A/B 结论已认可（先立清单，不先拆 bridge）；快照拆两套基准；replay-hooks 已批准

---

## 0. 一句话

把「有哪些扩展、各自声明了哪些钩子、按什么顺序注入提示词、由哪个开关控制、挂了哪些页面」从散落在
`bridge.js` / `src/ext/index.js` / `/opt/her/features.json` / `app.js PAGES` 四处的人工记忆，
收敛成**每个扩展自己导出的 `manifest`**，再用程序断言「声明 == 实现」。

顺序：**波 1 立清单 → 波 2 逐模块迁移声明 → 波 3 面板改读清单**。
本计划**不拆 bridge**，不碰 126 处 `_PATCH` 中的任何一处。

---

## 1. 为什么做（2026-11-03 实测证据）

| 指标 | 文档/印象中的值 | 实测值 | 取数命令 |
|---|---|---|---|
| `src/bridge.js` 行数 | 1.7 万 | **18091** | `wc -l src/bridge.js` |
| `_PATCH` 出现次数 | 96（D-002 记 74） | **126 处 / 66 个不同名字** | `grep -o '\w*_PATCH' src/bridge.js \| sort -u \| wc -l` |
| `src/ext/` 模块数 | — | **30**（另有 index.js） | `ls src/ext/*.js` |
| `EXTENSIONS` 注册数 | — | **17（手写数组）** | `src/ext/index.js` 数组字面量 |
| bridge 直连 import 的 ext | — | **15 个模块**（与注册重叠 2 个） | `grep -o "from '\./ext/[a-z-]*\.js'" src/bridge.js \| sort -u` |
| 双路径模块 | 未记录 | **2**：`stickers.js`、`promises.js` | 注册表 ∩ 直连 import |
| 功能开关条数 | — | **44**（`/opt/her/features.json`） | `python3 -c "import json;print(len(json.load(open('/opt/her/features.json'))['features']))"` |
| 其中 `path` 在当前 config.json 里不存在 | — | **4 条**（`greetings.morning.enabled`、`socialV2.tools.viewSticker`、`@video:quota.daily`、`@report:time`） | 见 W1-6 的 features.json 互校 |
| 面板页数 | 文档说 8000+ 行手写 | **16 页，`PAGES` 表驱动**（app.js:6），app.js 2875 行 | `sed -n '6,24p' app.js` |
| `npm run verify`（完整） | 应全绿 | **红 1 项**：结构快照三份提示词字节数漂移 9984→13568 / 7730→11883 / 8014→11975（人格卡改过） | `npm run verify` |
| `/opt/her-console` 版本化 | 未知 | **不在 git**，只有 `.bak.*` 手抄备份 | `git -C /opt/her-console rev-parse` |

### 三条推论

1. **没有任何一处能回答「有哪些功能」**。要查一个功能得先猜它叫什么 `*_PATCH`——66 个名字就是 66 个猜测起点。这是加功能最贵的一步（找接线点）。
2. **开关有三套真相**：`features.json`（44 条，面板读它）、`config.json`（运行时读它）、`bridge.js` 里的 `if`（实际生效）。已有 4 条 `path` 不存在的空开关，证明这三套会漂移，而且漂移**不会报错**——只会表现为「开关拨了没反应」。
3. **唯一的自动门（结构快照）已经红了**，原因是人格卡内容变化而不是代码坏。这意味着以后的改动只能靠 `--save-base` 盖章放行，门禁退化成橡皮章；同时它**覆盖不到**「开关是否真的生效」「钩子是否真的被调用」。

---

## 2. 不变量（判断"改坏了"的标准）

改动在通过验收命令之外，还必须满足：

- **INV-1** 三份提示词的字节数与基线逐字节一致（`private` / `group:1025377431` / `group:680787260`）。唯一例外：本次改动就是人格内容，且单独 commit、提交说明写清改了什么。
- **INV-2** 提示词注入顺序不变。`EXTENSIONS` 的数组顺序就是注入顺序，迁移时必须显式化成数值 `order`（10/20/30…），不能用「文件名字母序」或「对象 key 序」代替。
- **INV-3** 契约六条不放松：只写 `SURFCORE_STATE_DIR` 且原子 rename、不碰别人文件、失败必须吞、同步钩子 <50ms、幂等、可关。**新增任何 promptBlock 必须带 stateKey**（否则污染全局提示词缓存）。
- **INV-4** 六条不可删底线一条不动（身份称呼 / 边界 / 记忆规则 / 群聊约束 / 纠错规则 / 三个绝不）。
- **INV-5** 不使用 `--save-base`。
- **INV-6** bridge 直连 ext 的数量不增加；每新增一条必须在该模块 manifest 里登记 `directImport: true` 和理由。

---

## 3. 三波总览

| 波 | 目标 | 主要产出 | 代价 | 结束标志 | 回滚粒度 |
|---|---|---|---|---|---|
| **波 1 立清单** | 让"有哪些扩展"变成可枚举事实 | 两套基线（`snap-base/` + `snap-base-persona/`）；`docs/EXT-MANIFEST.md` 契约；loader 排序+断言；回滚演练；17 个已注册模块的 manifest；`scripts/dump-manifests.mjs`（含校验器 + `--selftest`）→ `docs/generated/manifests.json`；`scripts/replay-hooks.mjs` | ~36 步 · 约 5.5 h · **重启 0 次** | `--selftest` 全中；汇总「合格 17 / 不合格 0」；`--require-all --strict` 退出码 0 | 每个 commit 单独回滚；代码只碰 `scripts/*.mjs` 与 `src/ext/*.js` 的**文件末尾**，`bridge.js` 零改动 |
| **波 2 逐模块迁移** | 30 个模块全部有 manifest，声明与实现经程序互校 | 6 批 × 5 个模块的 `export const manifest` | ~30 步 · 约 4.5 h · 重启 ≤2 次 | 指标 M1 = 30/30，M4 = 0 漂移 | 单文件 `git checkout -- src/ext/x.js` |
| **波 3 面板改读清单** | 页面与开关不再手抄第二份真相 | her-console 版本化（git + 每日备份）；`/api/plugins` 消费；开关页与 features.json 联合渲染；4 条空开关进黄条（修/删不排期） | ~23 步 · 约 4 h · **不重启 bridge** | 指标 M3 ≥ 8 页由清单渲染 | her-console 回到上一个 commit / 上一个备份目录 |

**节奏建议**：每次坐下做 **≤15 步**，正好卡在 COST GATE 门槛以内（超过 15 步必须先报「约 N 步、¥X，做吗」）。

---

## 4. 波 1：立清单

### W1-1 固化两套基线（不做这一步，后面所有"没改坏"都无法证明）

- **做什么**（按已定的 D-3：两个输出目录，不加 `--scope` 参数）：
  1. 探测 API 端口归属（bridge 3100 / 面板 7800 谁提供 `/api/*`）——后续所有「先 curl 验后端」依赖这一条。
  2. 跑一次 `node scripts/snapshot.mjs`，拿到 live 快照（`/tmp/snap-live/snap.json`，一次性、可重跑）。
  3. **按内容切成两个持久目录**：
     - `scripts/snap-base/code.json`（**仓库内，提交进 git**）：**代码结构**——工具数/工具名、5 条路由状态码。**不含任何提示词文本或字节数。** 放仓库是因为 verify 必须在空环境/新机器上也能跑（m00399）。
     - `${SURFCORE_STATE_DIR}/snap/snap-base-persona/`：**人格内容**——三份提示词的字节数、行数、sha256、小节标题、以及正文（key 归一成 `private:#1` / `group:#1`，权限 600，**永不进 git**）。
     - **额外一条（2026-11-03 实测后补）**：正文里有一批**自己会变**的小节——`## 最近记得的`、`【群里刚在说】`、`【各群在聊什么…】`、`【<群号>】`。实测 private 正文 23 分钟内 13568B → 13621B，就是它们在变。因此每份提示词除了全文 `sha256`，再存一个**去掉这些小节后的 `stableSha256`**；`--check` 只对 `stableSha256` 报差异，易变小节的变化单独打印成「不算改变」。不做这一步，人格基准每天都会红，等于又退回橡皮章。
  4. 5 条只读接口的响应体存到 `${SURFCORE_STATE_DIR}/snap/base-routes/`（后续面板"开关是否生效"要比对）。
- **为什么放 state 目录而不是 `/tmp`**：`/tmp` 重启就没了，一个会蒸发的基准不能当基准；state 目录本身已在 `.gitignore` 的隐私范围里。
- **判定「拆完就干净了」的标准**：切分前先证明当前 verify 的红色**只来自人格侧**——把 live 的 tools/routes 与已提交的 `scripts/snap-base/code.json` 逐项比对，必须完全一致；不一致就说明有代码侧漂移，本步立即停止上报。
- **改哪里**：新增 `scripts/snap-split.mjs`（实际约 205 行：读 live 快照、切两个目录、去易变小节、`--check` 比对；无依赖、不改任何现有文件）。
- **代价**：3 步 · 约 30 分钟 · 重启 0 次
- **回滚**：`rm -rf /home/dsh/.dsh/surfcore/snap`（只删新建的基准目录）
- **验收命令**：

```bash
cd /home/dsh/apps/surfcore
# 1) 端口归属（实证，不靠记忆）
curl -s -o /dev/null -w '3100=%{http_code}\n' http://127.0.0.1:3100/api/status
curl -s -o /dev/null -w '7800=%{http_code}\n' http://127.0.0.1:7800/api/status
# 2) 取 live
node scripts/snapshot.mjs
# 3) 切分
node scripts/snap-split.mjs
# 4) 接口响应体
S=/home/dsh/.dsh/surfcore/snap/base-routes; mkdir -p "$S"
for r in status socialV2/states socialV2/mood socialV2/style-list socialV2/tech-notes; do
  f=$(echo "$r" | tr '/' '_')
  curl -s -o "$S/$f.json" -w "%{http_code} $r\n" "http://127.0.0.1:3100/api/$r"
done
```

- **验收标准**：`code.json` 里只有 tools 与 routes（`grep -c '"hint"'` = 0、`grep -c '"text"'` = 0）；`snap-base-persona/` 里三份提示词的 key 已归一成 `private:#1` / `group:#1` / `group:#2`，每份都有 `stableSha256`；两个目录都 `chown dsh:dsh`、`chmod 700`，json `chmod 600`；5 条接口全 200；`code.json` 的 tools/routes 与已提交基准完全一致（证明红的是人格侧，不是代码侧）；紧接着再跑一次 `--check` 必须 `SNAP_OK`（自洽，否则基准本身有问题）。
- **已完成（2026-11-03 20:15，未重启任何服务）**：code.json 1440B（tools 50 + 5 路由全 200，`"hint"`/`"text"` 计数均为 0）；persona.json 69820B、600；私有提示词**全文 13621B / 稳定 12718B / 排除 5 个易变小节**，两个群提示词无易变小节（11883B / 11975B）；`base-routes/` 5 个响应体（24071 / 5343 / 7502 / 11761 / 1627 B），600；`--check` = `SNAP_OK`。
- **按 m00399 调整（2026-11-03 20:3x）**：`code.json` 从 `$STATE/snap/snap-base/` 迁到仓库 `scripts/snap-base/code.json` 并提交；人格基准留在 `$STATE/snap/snap-base-persona/`，`--check` 检测到缺失时打印 `persona baseline skipped` 并以 exit 0 通过；旧 `scripts/snap-base/structure.json` 改名为 `structure.json.retired`（保留可查，不再被任何脚本读取）。

---

### W1-1b 易变小节清单（"稳定哈希"的边界，越界即基线失效）

机器可读副本只有一份：`scripts/snap-volatile.json`（`scripts/snap-split.mjs` 只读它，不再在代码里写死正则）。

| 小节 | pattern | 为什么算易变 |
|---|---|---|
| `## 最近记得的` | `^##\s*最近记得的` | 记忆检索命中结果，每几轮对话就变 |
| `【群里刚在说】` | `^【群里刚在说】` | 最近 10 分钟群消息，每分钟都可能变 |
| `【各群在聊什么…】` | `^【各群在聊什么` | 各群近况摘要，随消息滚动 |
| `【<群号>】` | `^【\d{5,12}】` | 按群生成的近况小节，条数随聊天变化 |
| `## 正在模糊的事` | `^##\s*正在模糊的事` | 情绪/模糊记忆状态，随时间衰减 |

**硬规则（三条，都是硬的）**：

1. **新增任何"随消息或时间会变"的提示词小节，必须在同一次提交里同时更新两处**：`scripts/snap-volatile.json`（机器读）与本表（人读）。只改一处 = 基线静默失效，这是本计划里最隐蔽的失败模式。
2. **清单为空直接报错**：`snap-split.mjs` 加载时若 `sections` 为空、缺 `pattern`、或正则非法，一律 `exit 2` 并打印提示，绝不"空清单就当没有易变小节"继续跑。
3. **判据**：改完跑 `node scripts/snap-split.mjs --check`；出现「只有易变小节变了（不算改变）」是正常的；只有出现「稳定正文变化」才需要一次单独的人格 commit。

**为什么这条不能省**：实测 private 正文 23 分钟里从 13568B 涨到 13621B，全部来自这 5 节。若不剥离，人格基准每天都会红，最后必然演变成"红了就 `--save` 盖章"，验收门退化成橡皮章——这正是我们在 A 里认定的结构问题之一。

**已完成（2026-11-03 20:23）**：`scripts/snap-volatile.json` 落地（812B，5 条，含 `reason`），`snap-split.mjs` 改为只从它加载。负向测试各跑一遍：清单为空 → `exit 2` + 「易变清单为空…空清单会让基准静默失效」；文件缺失 → `exit 2`；还原后 `SNAP_OK`。另外用 python 对 base 与 live 的稳定正文逐行 diff，三份提示词**均 0 行差异**——说明当前这 5 条覆盖是够的（至少这一刻）。

---

### W1-2 定契约：`docs/EXT-MANIFEST.md`

- **做什么**：写死 manifest 的字段与含义，作为后续 30 个模块的唯一模板。字段：

```js
export const manifest = {
  id: 'mute',                    // kebab-case，全仓唯一，= 文件名去 .js
  title: '禁言',                  // 面板显示名，1–24 字
  kind: 'hook',                  // core | hook | tool | panel
  enabledByDefault: true,        // 新装机器上默认开/关
  hot: true,                     // 改 config 是否立即生效（false = 要重启）
  hooks: ['routes', 'stateKey', 'wakeGate'],  // 只能是 7 个钩子之一，且必须真有实现
  order: 20,                     // 有 promptBlock 时必填 = EXTENSIONS 下标×10+10
  config: ['socialV2.mute.enabled'],          // 读的 cfg 点路径（可选）
  stateFiles: ['mute.json']                   // 写在 SURFCORE_STATE_DIR 的文件名（可选）
};
```

- **明确不放进 manifest 的东西**：开关的分组/文案/提示（仍留 `features.json`）、配置默认值（仍留 `config.json`）。manifest 只描述**代码侧事实**，避免造第二套注册表。
- **改哪里**：新增 1 个文档。
- **代价**：2 步 · 约 30 分钟 · 重启 0 次
- **回滚**：删除该文件
- **验收命令**：`grep -c '^  [a-zA-Z]*:' docs/EXT-MANIFEST.md`；人工核对字段与 W1-3 的 loader 断言一一对应（字段数 = 断言数）
- **验收标准**：字段清单与 loader 校验规则 1:1，没有"文档里有、代码不查"的字段

---

### W1-3 loader 改造（波 1 唯一动 `src/ext/index.js` 的一步）

- **做什么**：把 `EXTENSIONS` 从**手写顺序**改为**由 manifest 的 `order` 排序派生**，并做启动期断言（只告警、不抛错——加载器不能因为一份坏声明把桥接带死）。
- **改哪里**：只改 `src/ext/index.js` 的「import + 装配」段（导出钩子函数零改动）：
  1. 17 个默认导入改成 `import * as modX from './x.js'`（ESM 不能安全扫目录，保留静态导入以免改启动时序）；
  2. `const MODULES = [{name:'owner-only', mod: modOwnerOnly}, …]` 按今天的原顺序登记 17 项；三个工厂项（advice / people / utterances）带 `factory`；
  3. `assemble()`：有合法 `manifest.order` 用它，否则回退 `(i+1)*10` 并记入 `missing`；重复 `order`、非正整数记入 `problems`；排序后派生 `EXTENSIONS`；
  4. 模块加载时打印一行 `[ext:loader] N/17 个扩展还没有 manifest，按注册顺序回退：…`；`problems` 逐条 `console.error`；
  5. 新增 `export function extManifests()` → `[{id, file, order, hasManifest}]`，供 `dump-manifests --order-map` 与将来的 `/api/plugins` 对账。
- **代价**：4~6 步 · 约 1 h · 重启 0 次（用 `node --check` + `node -e import`，不重启）
- **回滚**：`git checkout -- src/ext/index.js`（单文件）
- **验收命令**：

```bash
# 顺序必须与今天逐项一致
node -e "import('./src/ext/index.js').then(m=>console.log(m.EXTENSIONS.map(x=>x.id||x.name).join(',')))" > /tmp/ext-order-after.txt
diff /tmp/ext-order-before.txt /tmp/ext-order-after.txt && echo ORDER_OK
node scripts/dump-manifests.mjs --order-map
npm run verify -- --no-api
```

- **验收标准**：`ORDER_OK` 且 `diff` 为空；`--order-map` 列出 17 行且 order 为 10…170；`verify --no-api` 全绿；故意把 loops 的 `order` 改成 150（与 style 撞）时 loader 必须 `console.error` 报 `order 重复` 且 `EXTENSIONS` 仍是 17 项（负向测试，1 分钟）
- **已完成（2026-11-03 20:36，未重启任何服务）**：`extList()` 顺序与迁移前逐项一致（`owner-only,mute,learnmode,economy,group-rate,?,advice,people,utterances,safe-talk,promises,impressions,owner-teach,tech-notes,style,loops,stickers`；`?` 是 attention 自带的旧问题——它没有 `id` 字段，日志里一直是 `[ext:undefined]`，与本次改动无关，波 2 补 manifest 时顺手修）；`extManifests()` 17 项且 loops 是唯一 `hasManifest=true`；启动告警 `[ext:loader] 16/17 个扩展还没有 manifest，按注册顺序回退：…`；`--order-map` 17 行、`--selftest` 7/7、`verify --no-api` 与 `verify` 全量均 `VERIFY_PASS`；`--check --stdin` 正常 `SNAP_OK`/`exit 0`、工具数改 51 时 `SNAP_FAIL`/`exit 1`；`--check`（含人格侧）`人格侧：一致`；W1-3b 演练删掉 loops manifest → 告警变成 `17/17` 且顺序仍为 10…170，还原后恢复 `16/17`。

---

### W1-3b 回滚演练：「坏得可见」（只验证可观测性，不是功能开发）

- **做什么**：故意把 `src/ext/loops.js` 末尾的 `manifest` 删掉 → 在一个**临时 node 进程**里 import loader → 必须看到**明确告警**（模块名 + 缺什么字段 + 用哪个兜底顺序），而不是静默跑通 → 再把文件 `git checkout` 还原，并确认 warn 消失。
- **为什么必须做**：整套计划的前提是「漏接会立刻响」。如果缺声明只是静默降级，manifest 就退化成又一份没人维护的文档——这正是要消灭的东西。演练只证明「坏得可见」，不新增任何功能。
- **改哪里**：只临时改 `src/ext/loops.js`（演练后立即还原，不留痕）。
- **代价**：2 步 · 约 15 分钟 · 重启 0 次（用 `node -e "import('./src/ext/index.js')"`，不碰运行中的桥接）
- **回滚**：`git checkout -- src/ext/loops.js`（演练的收尾动作本身）
- **验收命令**：

```bash
cd /home/dsh/apps/surfcore
cp src/ext/loops.js /tmp/loops.bak
python3 - <<'PY'
import io,re
p='src/ext/loops.js'; s=io.open(p,encoding='utf-8').read()
s=re.sub(r"export const manifest = \{[\s\S]*?\n\};\s*$", "", s)
io.open(p,'w',encoding='utf-8',newline='\n').write(s)
PY
node -e "import('./src/ext/index.js').then(()=>console.log('imported')).catch(e=>console.log('threw:',e.message))" 2>&1 | head -5
cp /tmp/loops.bak src/ext/loops.js
node -e "import('./src/ext/index.js').then(()=>console.log('imported clean'))" 2>&1 | head -3
```

- **验收标准**：删掉时输出里**出现 `loops` 字样 + 具体缺失项**（不是无输出的静默通过）；还原后输出干净；`git status --short src/ext/loops.js` 为空。
- **注意**：这一步故意让"红灯"亮一次，属于演练，不计入「同一问题 3 次迭代」；但如果删掉后**没有任何输出**，说明 W1-3 的断言写得太软，必须先修断言再往下走。

---

### W1-4 给 17 个已注册模块补 manifest —— 已完成（2026-11-03 20:49，未重启）

- **做法**：每个 `src/ext/<name>.js` **文件末尾追加** `export const manifest = {...}`（append，不重写、不动原有导出）。`loops` 在 W1-3 已加。
- **实测结果**：`dump-manifests` 汇总 **合格 17 / 不合格 0 / 未迁移 13**（未迁移的是没注册进 `EXTENSIONS` 的 13 个，波 2 才轮到）；`--strict` = `MANIFEST_OK`；`--order-map` 17 行 `10…170` 与注册位逐行一致；`--require-all --strict` = `MANIFEST_FAIL` exit 1（预期，因为还有 13 个未注册模块）；loader 启动 **零告警**（不再有「N/17 还没有 manifest」）；`npm run verify -- --no-api` = `VERIFY_PASS`。
- **顺带修掉的两个校验器缺口**：①工厂模块（默认导出是 `createX`）要**先实例化再校验钩子**，否则 `attention`/`advice-capture`/`people`/`utterances` 声明任何钩子都会被误判「声明了但没实现」；现在校验器读 `index.js` 的 `MODULES` 里有没有 `factory:`，有就 `create({ log: () => {} })` 取实例（与 loader 同一语义）。②`config` 允许顶层单段（如 `ownerQQ`）。
- **id 与文件名不一致的唯一例外**：`advice-capture.js` 的运行时实例 id 是 `advice`（历史原因，日志前缀也是 `[ext:advice]`）。契约 R1 放宽为「id 必须等于运行时实例 id；与文件名不同时校验器给**警告**并打印原因」，不再报错。
- **`stickers` 如实写** `hooks: []`、`kind: 'core'`——第一个被程序抓出来的「名义插件」。
- **回滚**：`git checkout -- src/ext/`（只撤 manifest 与 loader 改动）；只想撤 attention 实例化：见 §12 回退手册。
- **代价**：实际 4 步 · 约 25 分钟 · **0 次重启**（比原估 1.5 h / ≤1 次重启省）。

> **这轮最重要的发现**：`attention.js` 不是「缺 id」，而是**自 `d222215` 起从未被实例化**——旧 `index.js` 写的是 `import attention from './attention.js'`（默认导出是工厂 `createAttention`），又把工厂函数直接塞进 `EXTENSIONS`，所以它的 `onGroupMessage` / `wakeGate` / `promptBlock` 一次都没执行过，线上日志里 `[注意力]` 计数为 0。已在 W1-4 修复（`MODULES` 里给 attention 加 `factory: (create) => create({ log })`）。**后果：下次重启后注意力闸门第一次真正生效，她的接话行为会变（低分消息不再唤醒，`socialV2.attention.sample` 会按概率放行）**。详见 §9 风险 7。

---

### W1-5 契约 + 清单校验器（把"靠记忆"换成"靠断言"）

> 已定 D-1：**波 1 零重启、不碰 bridge**；校验器就放在 `dump-manifests.mjs` 里，不单独再起一个脚本。

- **做什么**（两件，一起交付）：
  1. `docs/EXT-MANIFEST.md` 契约：字段 schema 表（id/title/kind/enabledByDefault/hot/hooks/order/config/stateFiles，含类型、必填、示例）+ 7 个钩子白名单 + 校验规则 + **三个 ≤15 行示例**（纯函数 / 写自身 state 且原子替换 / 带 route）。`pages` 字段 v1 删除（m00399）。
  2. `scripts/dump-manifests.mjs`：扫 `src/ext/*.js`，import 每个模块 → 取 `manifest` → 校验 → 打表；`--json` 写 `docs/generated/manifests.json`。
- **校验规则（R1–R10，与契约文档一致）**：id 合法且与文件名一致 / id 唯一 / title ≤24 字 / kind 与两个布尔 / hooks ∈ 7 白名单 / 声明了必须真有实现（含 `routes`）/ 有 `promptBlock` 必有 `order`、唯一且等于 `EXTENSIONS 下标×10+10` / v1 **禁止** `pages` 字段 / `config` 是点路径、`stateFiles` 不含路径 / 缺 manifest 记为「未迁移」。
- **三档退出码语义**（这是门禁不变成橡皮章的关键）：
  - 默认：不合格只打印，退出码 0（迁移期用）；
  - `--strict`：**有不合格**就 exit 1，但「缺 manifest」仍只算未迁移（否则波 1 永远红）；
  - `--require-all --strict`：连「缺 manifest」也算失败 —— **波 2 收尾时**才切到这一档。
- **`--selftest`**：用 §3 的 3 个正例 + 4 个反例（钩子拼错 / 声明没实现 / 带 `pages` 字段 / 缺 order）自检校验器本身。0 个合格模块时，这是唯一能证明"校验器真的会咬人"的手段。
- **改哪里**：新增 `docs/EXT-MANIFEST.md`、`scripts/dump-manifests.mjs`；`docs/generated/manifests.json` 由脚本生成。
- **代价**：4 步 · 约 1 h · **重启 0 次**
- **回滚**：删两个新文件 + `rm -rf docs/generated`（不碰任何现有脚本）
- **验收命令**：

```bash
cd /home/dsh/apps/surfcore
node --check scripts/dump-manifests.mjs
node scripts/dump-manifests.mjs --selftest; echo "selftest exit=$?"     # 期望 SELFTEST_OK / 0
node scripts/dump-manifests.mjs | tail -3                              # 汇总行
node scripts/dump-manifests.mjs --require-all --strict; echo "gate exit=$?"  # 期望 MANIFEST_FAIL / 1
node scripts/dump-manifests.mjs --json && grep -ic 'token\|secret\|password' docs/generated/manifests.json
```

- **验收标准**：`SELFTEST_OK`；普通跑汇总为「合格 0 / 不合格 0 / 未迁移 30」；`--require-all --strict` 退出码 1 且打印 30 个模块名；json 里敏感词计数 0。
- **已完成（2026-11-03 20:22）**：`docs/EXT-MANIFEST.md` 6.6KB（字段表 + R1–R10 + 3 个 ≤15 行示例 + 反例）；`scripts/dump-manifests.mjs` 11.5KB；`--selftest` **7/7 命中**（3 正例 0 错、4 反例各自命中对应报错）；实跑 30 模块 = 「合格 0 / 不合格 0 / 未迁移 30」（预期：波 2 之前一个都没有）；`--require-all --strict` = `MANIFEST_FAIL` / exit 1；`docs/generated/manifests.json` 2389B，敏感词 0；`npm run verify -- --no-api` 仍 `VERIFY_PASS`。
- **桥接路由的去向**：`GET /api/plugins` 挪到 **W2-0**（见 §5），和 W2 第一次必须重启的动作合并，省掉一次重启。

---

### W1-6 接进 verify + features.json 互校（原 check-manifest 的 R5 保留在这里）

- **做什么**：
  1. 在 `scripts/verify.mjs` 里追加一行 `node scripts/dump-manifests.mjs --strict`（**只加一行**）；波 1 阶段它应当绿（0 不合格），波 2 每迁一个模块逐步收紧。
  2. features.json 互校：44 条开关里每条的 `path` 必须能在 `config.json` 里解析到；同时 `manifest.config[]` 里声明的点路径必须能在 features.json 找到对应开关（或明确标 `internal`）。输出未覆盖清单，**不**自动改任何文件。
- **为什么和第 1 条分开放**：互校依赖 `config.json`（隐私、服务器本地），不能进 CI 的默认路径；做成 `--config` 参数显式传路径，默认跳过。
- **改哪里**：`scripts/verify.mjs` 加 1 行；`dump-manifests.mjs` 加 `--config <path>` 互校分支（约 40 行）
- **代价**：3 步 · 约 45 分钟 · 重启 0 次
- **回滚**：`git checkout -- scripts/verify.mjs` + 删掉 `--config` 分支
- **验收命令**：

```bash
node scripts/dump-manifests.mjs --config ~/apps/surfcore/config.json --strict; echo "exit=$?"
# 负向测试：把某个已迁移模块的 stateKey 从 manifest 删掉（保留 promptBlock），必须 exit=1
```

- **验收标准**：当前代码下 `exit=0`；4 条空开关（`greetings.morning.enabled`、`socialV2.tools.viewSticker`、`@video:quota.daily`、`@report:time`）逐条列出；负向测试能变红；`style` 的「有 promptBlock 无 stateKey」以**警告**形式出现并被记入已知问题，不阻断波 1。

---

### W1-7 `scripts/replay-hooks.mjs`（第五层金丝雀，60~80 行）

- **做什么**：不连 QQ、不发消息、不进主链路。用**只读配置 + 固定样本**，对每个有 `promptBlock` 的模块调用一次，对每个有 `wakeGate` 的模块跑一张固定打样表（如 12 条 key × 4 种 reason），把输出**排序后**哈希，与 `scripts/snap-base/hooks.json` 比对。
- **是否确定**：`promptBlock(cfg)` 里若含时间/随机（例如按时段问候），实现上先 strip 时间戳变量再哈希；无法确定性的模块在报告里标 `nondet` 并只比对长度量级，不假装严格。
- **改哪里**：新增 `scripts/replay-hooks.mjs`；新增 `scripts/snap-base/hooks.json`（首次运行 `--save` 生成，**只此一次**，之后禁止 `--save`）
- **代价**：5 步 · 约 1.5 h · 重启 0 次
- **回滚**：删除两个新文件
- **验收命令**：

```bash
node scripts/replay-hooks.mjs --diff
# 预期首行：hooks=N diffs=0 nondet=M
```

- **验收标准**：`diffs=0`；`nondet` 数量 ≤3 且逐个在报告里写明原因；故意改一个模块的 promptBlock 文案，`--diff` 必须变红（负向测试）

---

## 5. 波 2：按清单逐模块迁移

**迁移的严格定义**：只做 **L0 声明**（加 manifest）和 **L1 断言**（dump-manifests 通过）。
**L2（把 bridge 里 126 处补丁调用改成经 ctx 注入）属于拆 bridge，本计划一律不做。**

### W2 的硬规矩（写在这里，越界即失败）

1. **除迁移 ext 的 manifest 外，W2 期间不许动 `bridge.js` 的任何其他部分。** 唯一例外是 W2-0 那一条只读路由；除此之外每批只允许改 `src/ext/<name>.js` 的文件末尾。
2. **每次重启只做一件事。** 不在一次重启里叠两处改动；重启前先记录当前 `systemctl is-active` 与日志行数，重启后只比较差值。
3. 每批开始先 `git status --short`，若出现预期外的文件（尤其是 `src/bridge.js`），先停下来报，不继续。

### W2-0 `GET /api/plugins` + 第一次重启（把波 1 省下的一次重启在这里花掉）

- **做什么**：在 `src/bridge.js` 与 `/api/status` 相邻的位置加一条只读路由，读 loader 的 `MANIFESTS`；顺带新增 1 行 import。
- **改哪里**：`src/bridge.js` 路由表（约 15 行）+ 顶部 1 行 import。**不碰任何 `_PATCH`。**
- **代价**：3 步 · 约 30 分钟 · **重启 1 次**（这是 W2 的第一次，也是唯一一次为路由而重启）
- **回滚**：`git checkout -- src/bridge.js` + `systemctl restart surfcore-bridge`
- **验收**：`curl -s -o /tmp/p.json -w '%{http_code}\n' http://127.0.0.1:3100/api/plugins` 返回 200；条数 = 17；`grep -ic 'token\|secret' /tmp/p.json` = 0；`systemctl is-active` = active。
- **门槛**：先跑完 W1-5，`docs/generated/manifests.json` 与接口返回必须逐字段一致。

每批 5 个模块，每批 4~5 步，约 40 分钟。6 批共 30 个模块。
每批固定四步：① 5 个文件末尾追加 manifest → ② `node scripts/dump-manifests.mjs` → ③ `npm run verify -- --no-api` + 快照 `--diff` → ④ `node scripts/replay-hooks.mjs --diff`
每两批重启一次 bridge 验证启动（共 2 次），不必每批都重启。

### 迁移顺序表（风险从低到高）

风险 = 四件事叠加：**写文件**（数据）／**直连 bridge**（接线改动面）／**闸门**（决定她回不回）／**对外发送**（不可撤回）。

| # | 模块 | 行 | 直连 | 注册 | 写 | 钩子 | 风险 | 为什么排在这 |
|---|---|---|---|---|---|---|---|---|
| | **批 A：纯函数 / 常量，无副作用** | | | | | | | |
| 1 | memory-card | 13 | ✓ | | | 无 | 低 | 只有 3 个常量导出，先验证 manifest 机制能跑通 |
| 2 | stickers | 15 | ✓ | ✓ | | 无 | 低 | 单函数 + 名义插件，正好验证「声明 vs 实现」告警 |
| 3 | loops | 30 | | ✓ | | routes | 低 | 单个 default 函数 |
| 4 | people | 24 | | ✓ | | routes | 低 | 单个 default 函数 |
| 5 | memory-scope | 61 | ✓ | | | 无 | 低 | 纯过滤函数（有单测，改错会立刻红） |
| | **批 B：纯解析 / 内存标记** | | | | | | | |
| 6 | sticker-frames | 71 | ✓ | | | 无 | 低 | 纯字符串/媒体 key 解析 |
| 7 | blackbox | 33 | ✓ | | | 无 | 低 | 纯内存 Set 标记，无持久化 |
| 8 | impressions | 33 | | ✓ | | promptBlock,routes,stateKey | 低中 | 有 promptBlock 但输出短、有 stateKey，快照能兜住 |
| 9 | tech-notes | 41 | | ✓ | | promptBlock,routes,stateKey | 低中 | 同上 |
| 10 | promises | 54 | ✓ | ✓ | | afterSend | 低中 | **双路径**，迁移时先查清注册与直连哪条在生效 |
| | **批 C：写自己的 state 文件，不在闸门** | | | | | | | |
| 11 | reminders | 72 | ✓ | | | 无 | 中低 | 只创建数据结构，发送不在本模块 |
| 12 | advice-capture | 51 | | ✓ | 3 | onGroupMessage,routes | 中低 | 抓取只落盘，不改回复 |
| 13 | utterances | 85 | | ✓ | 2 | routes | 中低 | 记录"她说过的话" |
| 14 | owner-teach | 121 | | ✓ | 3 | promptBlock,routes,stateKey | 中 | 影响提示词，但有 stateKey |
| 15 | style | 103 | | ✓ | | onGroupMessage,onPrivateMessage,promptBlock,routes | 中 | **无 stateKey 但用 promptBlock**，先核实再声明（触发 R4） |
| | **批 D：直连 bridge 且有持久化** | | | | | | | |
| 16 | style-learn | 106 | ✓ | | 1 | 无 | 中 | 学说话样本采集 |
| 17 | profile | 120 | ✓ | | 3 | 无 | 中 | 人群画像写入 |
| 18 | channel | 112 | ✓ | | 2 | 无 | 中 | 频道装配，写自己的文件 |
| 19 | bot-detect | 128 | ✓ | | 2 | 无 | 中 | 机器人识别，写自己的文件 |
| 20 | related-memory | 168 | ✓ | | | 无 | 中 | 纯读，但参与记忆注入，内容变了快照会红 |
| | **批 E：闸门（决定她回不回）** | | | | | | | |
| 21 | owner-only | 40 | | ✓ | | onGroupMessage,wakeGate | 中高 | 行数很小，但语义是"谁能唤醒她" |
| 22 | learnmode | 131 | | ✓ | 3 | onGroupMessage,routes,stateKey,wakeGate | 中高 | 群学习模式 |
| 23 | mute | 104 | | ✓ | 3 | routes,stateKey,wakeGate | 中高 | 禁言即静默，错了表现为"她不说话" |
| 24 | economy | 161 | | ✓ | 3 | routes,stateKey,wakeGate | 中高 | 三级省钱策略，影响是否调用模型 |
| 25 | group-rate | 178 | | ✓ | 3 | routes,stateKey,wakeGate | 中高 | 行数最多 + 闸门，放闸门组最后 |
| | **批 F：行为敏感 / 对外发送** | | | | | | | |
| 26 | attention | 130 | | ✓ | | onGroupMessage,promptBlock,routes,wakeGate | 高 | 打分决定"这条要不要理"，错一次就漏消息 |
| 27 | safe-talk | 210 | | ✓ | 5 | onGroupMessage,onPrivateMessage,routes,stateKey,wakeGate | 高 | 双钩子 + 写 5 处 + 敏感话题闸门 |
| 28 | qzone-watch | 155 | ✓ | | 1 | 无 | 高 | 读外部（QQ 空间），网络依赖 |
| 29 | github-learn | 138 | ✓ | | 3 | 无 | 高 | 外部网络 + 定时 + 写盘 |
| 30 | qzone | 138 | ✓ | | | 无 | **最高** | **会真的发 QQ 空间 / 评论 / 删除**，不可撤回，放最后 |

**为什么是这个顺序**：把"改错了没人知道"的模块放前面（纯函数、有单测、不进提示词），把"改错了表现为她行为变了"的模块放后面（闸门在 E 批，对外发送在 F 批）。每批结束都有金丝雀兜底，越往后金丝雀的样本表越要覆盖该批模块。

---

## 6. 波 3：面板改读清单

### P3-0 面板先版本化（否则没有回滚）——已定 D-2：git + 每日备份，两件都做
- **现状**：`/opt/her-console` 不在 git，只有 `server.mjs.bak.*` 手抄
- **做什么**：
  1. `git init`（本地仓库，不推远端）+ 首次 commit（`server.mjs`、`public/`、`cf-notify.sh`）。
  2. `.gitignore` **必须**包含：`token.txt`、`*.log`、`backups/`、`*.bak.*`、`node_modules/`，以及任何含密钥的文件。**提交前先 `git status --ignored` 核对一遍，确认没有密钥类文件被纳入。**
  3. 每日备份 cron：`git -C /opt/her-console commit -am "auto $(date +\%F)" --allow-empty` 到本地仓库（用 `--allow-empty` 保证每天有一个可回滚点），失败写 `*.log`（日志本身被 ignore）。
  4. 在 `docs/OPERATIONS.md` 补一节「面板回滚」，写清：回滚到上一个 commit、回滚到某天、以及"服务重启才生效"。
- **代价**：4 步 · 约 40 分钟 · 重启 0 次（只重启 her-console，若需要）
- **回滚**：`git -C /opt/her-console reset --hard <首个 commit>`（这正是要建立的能力）
- **验收**：`git -C /opt/her-console log --oneline | head -3`；`git -C /opt/her-console status --ignored --short | grep -c 'token'` = 0；`crontab -l | grep -c her-console` = 1；`grep -c '面板回滚' docs/OPERATIONS.md` ≥ 1

### P3-1 面板读 `/api/plugins`（只读列表页，先不做写操作）
- **前置**：W1-1 已确认 3100/7800 谁提供 API
- **做什么**：`PAGES` 加一页 `plugins`，表格渲染 id/title/kind/order/hooks/开关状态；**先 curl 再写 UI**
- **代价**：6 步 · 约 1 h · **不重启 bridge**（只重启 her-console）
- **回滚**：`git -C /opt/her-console reset --hard HEAD~1`
- **验收**：`curl -s 127.0.0.1:7800/api/plugins | python3 -m json.tool | head`（确认代理通了）；浏览器 7800 打开该页条目数 = 17

### P3-2 功能开关页改由清单 + features.json 联合渲染
- **做什么**：开关行 = manifest.config 提供"哪个模块有这个开关"，features.json 提供"叫什么、怎么分组"；两边对不上的项在页面顶部显示一条黄条（不是静默吞掉）
- **代价**：8 步 · 约 1.5 h
- **回滚**：同上
- **验收**：页面开关总数 = 44（不增不减）；黄条列出 4 条空开关（真实反映现状，不掩盖）

### P3-3 4 条空开关：**已移出排期**（见附录 A）
- 波 3 只要求它们**显式可见**（面板黄条逐条列出），不要求在本计划里修掉。
- 若判断为"补 path"，那是代码改动，必须单独立项并报代价；若判断为"下架"，是纯数据改动，可顺手做但不算本计划验收项。
- **验收**：`node scripts/dump-manifests.mjs --config <cfg>` 的互校输出里这 4 条仍然列着（说明没被静默吞掉），面板黄条条数 = 4。

---

## 7. 进度指标（**禁止用 bridge 行数**）

| 指标 | 定义 | 当前 | 波 1 后 | 波 2 后 | 波 3 后 | 采集命令 |
|---|---|---|---|---|---|---|
| **M1 manifest 覆盖** | 有合法 manifest 的 ext 数 / 30 | 0/30 | 17/30 | 30/30 | 30/30 | `node scripts/dump-manifests.mjs \| grep 汇总` |
| **M2 直连残留可见度** | 被 bridge 直连且已登记的模块数 / 直连总数 | 0/15 | 15/15* | 15/15 | 15/15 | 同上（`directImport:true` 计数） |
| **M3 面板清单渲染页数** | 由 `/api/plugins` 或 features.json 渲染的页数 / 16 | 1/16† | 1/16 | 1/16 | ≥8/16 | 人工核对 + 页面截图 |
| **M4 漂移断言** | 互校报出的空 path 条数 | 4 | 4 | 4 | **4 条全部显式可见**（面板黄条逐条列出，不静默；修/删不排期，见附录 A） | `node scripts/dump-manifests.mjs --config <cfg>` |
| **M5 金丝雀** | `replay-hooks --diff` 的 diff 数 | n/a | 0 | 0 | 0 | `node scripts/replay-hooks.mjs --diff` |

\* M2 波 1 就能到 15/15：因为 17 个已注册模块里有 15 个同时被直连（含重叠 2 个），加 manifest 时一并登记。
† M3 当前算 1：`features` 页已由 features.json 驱动，其余 15 页仍是手写 `render`。

> 为什么不用 bridge 行数：它会被两类操作伪造——压缩代码（删注释/合并行）和删功能。manifest 覆盖率和漂移数只能靠"真的做了"提升。

---

## 8. 这次不做（范围锁）

| 不做的事 | 原因 | 什么时候再谈 |
|---|---|---|
| 拆 `bridge.js`（L2：126 处 `_PATCH` 改成 ctx 注入） | 单独立项，改动面 ≥2000 行，与"降低加功能成本"没有直接关系 | 波 2 全部完成、M1/M4 达标之后 |
| 面板 UI 重构 / 换框架 / 重做 16 页视觉 | 与清单化无关，纯风险 | 波 3 完成、PAGES 全部吃清单之后 |
| 把 `features.json` 挪进代码仓库 | 它是活配置，挪进仓库会带来隐私与部署耦合 | 不在本计划 |
| 合并 `stickers`/`promises` 的双路径 | 属于"接线清理"，需要读懂运行期哪条生效 | 波 2 批 A 第 10 项顺便只做"标记"，不做合并 |
| 修改人格卡内容 | 会让快照红，且必须单独 commit | 任何一次都单独开 |
| 修/删 4 条指向不存在 path 的开关 | 属数据清理，不改变结构；但要先判定「补 path」还是「下架」 | **不排期**，清单见附录 A |
| 向量检索 / 免费额度自动回落 / GitHub 学习扩展 | 属于功能开发（D-005/D-007） | 与结构改造解耦 |
| 插件热加载 / 市场 / 第三方插件接入 | 契约文档里"3 种不该接"已划清 | 不在本计划 |
| 上游 sync（Mieksido/surfcore） | 会与 126 处补丁冲突 | 单独评估 |

---

## 9. 风险与止损

1. **快照变红怎么办**：先分类——人格侧红（小节标题 / 字节数）→ 只允许由一次人格 commit 解释，且 `--check` 只对 `stableSha256` 报红；代码侧红（工具名 / 路由）→ 一定是本次改动引入，**立即回滚该步**，不允许 `--save-base` / `--save-code` 盖章。
2. **同一问题最多 3 次**：第 3 次仍不绿，停下来写"现象 / 已试 / 怀疑点"三段，报告后再动。
3. **重启预算**：波 1 ≤2 次（W1-5、以及 manifest 全部落地后 1 次）；波 2 ≤2 次；波 3 = 0 次 bridge 重启（只重启 her-console）。总计 ≤4 次，超出即视为计划有误。
4. **loader 改造的风险点**：迁移期缺 manifest 的模块必须**保持原数组位置**（回退 `(i+1)*10`），否则注入顺序会变；W1-3 验收里逐项 diff `extList()` 顺序。
5. **面板没有 git 的历史包袱**：P3-0 必须最先做，否则波 3 的所有改动都无法回滚。
6. **已知风险：`src/ext/style.js` 有 `promptBlock` 但没有 `stateKey`**（契约 R7 本应报错）。本轮**不补**——补了会改变提示词缓存范围，属于行为变更，不能混在结构迁移里。契约里把它降为**警告**（不阻断波 1），波 2 迁移 style 时单独评估并记入 commit 说明。
7. **已知风险：`attention` 自 `d222215` 起从未实例化**（工厂函数被直接塞进 `EXTENSIONS`，三个钩子一次没跑；线上 `[注意力]` 计数 0）。W1-4 已修（`index.js` 加 `factory`），但**首次生效要等下一次重启**，届时她的接话行为会变：
   - 群里 `socialV2.attention.enabled !== false` 时，分数低于 `minScore`（当前 2）的消息不再唤醒；日志会出现 `[注意力] 跳过唤醒 …`。
   - 当前 config：`sample {389834620: 1%, 680787260: 0.3%, default: 0}`、`replyOnly {389834620: [1962605653]}`、`maxPerDay 40` → **群 389834620 只接这个人的话**（手动/管理员除外）。
   - **重启前的选择**：想先保持现状，把 `socialV2.attention.enabled` 改成 `false` 再重启；想让它生效，直接重启并在日志里确认 `[注意力]` 开始出现。两条路都要单独 commit 说明。

---

## 10. 已确认的三条决定（2026-11-03，不再征询）

| # | 决定 | 对计划的影响 |
|---|---|---|
| **D-1** | 波 1 **不加 bridge 路由**；改 `scripts/dump-manifests.mjs` → `docs/generated/manifests.json`，零重启。`GET /api/plugins` 挪到 W2 第一次必须重启时一起加，省一次重启。 | W1-5 重写；新增 W2-0；波 1 重启预算从 2 次降到 **0 次** |
| **D-2** | her-console **git init + 每日备份 cron 两件都做**；`.gitignore` 必须排除 `token.txt`、`*.log` 及任何含密钥文件；做完在 `docs/OPERATIONS.md` 补回滚说明。 | P3-0 重写，验收里加了"忽略项核对" |
| **D-3** | 快照拆成 **两个输出目录**：`snap-base/`（代码结构）+ `snap-base-persona/`（人格内容），**不加 `--scope` 参数**。 | W1-1 重写；§11 验收命令同步改 |
| **D-4** | 代码基准 `code.json` **提交进仓库** `scripts/snap-base/`（空环境也能跑 verify）；人格基准只在服务器，缺失时打印 `persona baseline skipped` 跳过；旧 `structure.json` 退役。 | W1-1/W1-3 重写；verify 改为 `snap-split --check --stdin` |
| **D-5** | `order` = `EXTENSIONS` 下标 ×10 + 10（10…170）写死，校验器核对。 | W1-2/W1-3 定稿，`--order-map` 可核对 |
| **D-6** | `pages` 字段 v1 删除；面板继续用 `PAGES` + `features.json`，等 `/api/plugins` 真被消费且能证明「页面只从一个来源渲染」再加。 | 契约 R8、dump-manifests、示例全部同步 |
| **D-7** | W1-4 顺手修 `attention` 未实例化（加 `factory`）；校验器支持工厂模块；`manifest.id` 以**运行时实例 id** 为准，与文件名不同时只警告。 | W1-4 重写；契约 R1/R6 同步；新增 §9 风险 7 与 §12 回退手册 |

**同时确认的两条补充（不改范围）**：① W1 增加「回滚演练」，只验证"坏得可见"（W1-3b）；② W2 期间除迁移 ext 外不许动 `bridge.js`，每次重启只做一件事（§5 硬规矩）。

---

## 11. 附录：五层验收命令（每次改动后照抄）

```bash
# 第 0 层：基线已固化（W1-1 做过就跳过，永不重跑 --save-base / --save-code）
S=/home/dsh/.dsh/surfcore/snap
ls -l scripts/snap-base/code.json $S/snap-base-persona $S/base-routes

# 第 1 层：静态
cd /home/dsh/apps/surfcore
node --check src/bridge.js
npm run verify -- --no-api
grep -c "_PATCH" src/bridge.js                 # 只观察，不作为指标
node scripts/dump-manifests.mjs                # 波 1 起
node scripts/replay-hooks.mjs --diff           # 波 1 起
node scripts/snapshot.mjs && node scripts/snap-split.mjs --check
# ↑ 代码侧（tools/routes）硬失败 exit 1；人格侧只报告 stableSha256 差异；
#   人格基准缺失时打印 "persona baseline skipped" 并以 0 通过

# 第 2 层：接口
for r in status socialV2/states socialV2/mood socialV2/style-list socialV2/tech-notes; do
  curl -s "http://127.0.0.1:3100/api/$r" | python3 -c "import sys,json;json.load(sys.stdin);print('OK $r')"
done

# 第 3 层：运行期
systemctl restart surfcore-bridge && sleep 12 && systemctl is-active surfcore-bridge
grep -a -c -iE "(error|unhandled|ECONN)" /var/log/surfcore-bridge.log   # 与重启前差值应为 0
curl -s -o /dev/null -w 'panel=%{http_code}\n' http://127.0.0.1:7800/

# 第 4 层：行为金丝雀
node scripts/replay-hooks.mjs --diff           # hooks=N diffs=0 nondet=M
```

---

## 12. 回退手册（出事照这个做，按层从轻到重）

> 原则：**先回退代码，再重启；重启只做一件事**。每层回退完都要跑一遍 §11 第 1~2 层验收命令。

| 层 | 撤什么 | 命令（在 `/home/dsh/apps/surfcore` 下） | 要不要重启 |
|---|---|---|---|
| L1 | 只撤本轮 manifest（17 个 `export const manifest`） | `git checkout HEAD -- src/ext/` （若已提交则 checkout 到提交前的 commit） | 不用（manifest 只在 import 时读） |
| L2 | 撤 loader（回到 W1-3 之前，attention 恢复「不生效」的旧状态） | `git checkout a5460a7~1 -- src/ext/index.js` | **要**：`systemctl restart surfcore-bridge` |
| L3 | 撤结构快照换代（verify / snap-split / code.json） | `git checkout a5460a7~1 -- scripts/verify.mjs scripts/snap-split.mjs` 并 `git checkout 759f3fa -- scripts/snap-base/structure.json` | 不用 |
| L4 | 撤校验器与契约文档 | `git checkout a5460a7~1 -- scripts/dump-manifests.mjs docs/EXT-MANIFEST.md` | 不用 |
| L5 | 人格内容（提示词）回退 | 人格卡在面板「设置 → 人格」里逐条改回；`characters/` 与 `state/` 不提交，靠每日备份 | 要（缓存重建 ≈¥0.1） |

**用户侧的标准回退命令（整批回到 W1-3 之前）**：

```bash
cd /home/dsh/apps/surfcore
git checkout a5460a7~1 -- src/ext/index.js
systemctl restart surfcore-bridge
sleep 12 && systemctl is-active surfcore-bridge
tail -30 /var/log/surfcore-bridge.log | grep -E "\[ext:loader\]|错误|Error|ECONN" || echo "启动无告警"
```

**回退后必验三件**（任一不绿就停手，按 §9 写三段报告）：

```bash
node scripts/dump-manifests.mjs --strict        # 期望 MANIFEST_OK（回退到旧 loader 时应报缺 manifest，属正常）
npm run verify -- --no-api                      # 期望 VERIFY_PASS
node scripts/snapshot.mjs && node scripts/snap-split.mjs --check   # 期望 SNAP_OK
```

**不要做的事**：不要 `--save-base` / `--save-code` 盖章；不要在回退的同时改人格；不要在同一个重启里既回退又加功能。

---

## 13. 附录 A：不排期的顺手活（记录在案，不做时间承诺）

4 条开关的 `path` 在当前 `config.json` 里不存在——面板能拨、没有任何人读，属于**噪声**：

| id | path | 分组 | 猜测 |
|---|---|---|---|
| `morning` | `greetings.morning.enabled` | 自动化 | 问候模块可能已改读别的字段 |
| `toolViewSticker` | `socialV2.tools.viewSticker` | QQ 工具 | 工具开关，可能已被 MCP 工具清单取代 |
| `videoQuota` | `@video:quota.daily` | 学习：B站 | 带 `@` 前缀，疑似旧配额体系残留 |
| `reportTime` | `@report:time` | 自动任务：日报 | 同上 |

处置只能二选一，不许"留着当噪声"：

- **补**：让 bridge 真的去读这个 path（属于代码改动，要单独报代价，不混进任何一批）；
- **下架**：从 `/opt/her/features.json` 删掉这一条（纯数据改动，安全，但仍要备份）。

判据（10 分钟能判完一条）：先 `grep -rn "<path 的最后一段>" src/ | head`，
**有读取点但字段名不同 = 补；一处读取点都没有 = 下架。**

这 4 条在 P3-2 之后会一直躺在面板黄条里；只要它们还在黄条里，就不算被遗忘。
