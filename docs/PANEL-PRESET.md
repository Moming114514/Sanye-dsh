# 面板「三档总览」与 `/api/preset`（W5-E E-3）

> 只做 UI 快捷预设：把两个下拉翻译成**现有字段**，底层 7 道闸门保持不动。
> 代码位置：`/opt/her-console/server.mjs`（`/api/preset`）、`/opt/her-console/public/assets/app.js`（安全页卡片）。
> 面板不在 git 仓库里，本文件是仓库内对该接口的唯一记录。

## 接口

`GET /api/preset`（请求头 `x-her-token`）→

```json
{
  "ok": true,
  "dailyLimit": 8,
  "groups": [
    { "gid": "1025377431", "mode": "called", "activity": "active",
      "level": "active", "sample": 1, "count": 0, "maxPerDay": 33,
      "minGapMs": 540000, "lastAt": 0 }
  ]
}
```

`mode` 由状态反推：`learn-mode` 里有 → `watch`；`muted-keys` 里有 → `called`；否则 `normal`。
`activity` 由 `attention.sample[gid]` 反推：`>=1` → `active`，`>0` → `normal`，`0` → 取频率档位。

`POST /api/preset`（JSON）→

```json
{ "group": "1025377431", "mode": "called", "activity": "normal" }
```

返回 `{ ok:true, group, applied:{mode:"called",activity:"normal"} }`。

## 映射（只写现有字段）

| 操作 | 写入 | 写入位置 |
|---|---|---|
| 群模式 正常聊 | `mute unmute` + `learnmode off` | `state/muted-keys.json` / `state/learn-mode.json` |
| 群模式 只听叫我 | `mute mute` + `learnmode off` | 同上 |
| 群模式 只看不说 | `mute unmute` + `learnmode on` | 同上 |
| 活跃度 安静 | `grouprate set level=quiet` + `attention.sample[gid]` 删除 | `state/group-rate.json` / `config.json` |
| 活跃度 正常 | `grouprate set level=normal` + `attention.sample[gid]=0.3` | 同上 |
| 活跃度 热闹 | `grouprate set level=active` + `attention.sample[gid]=1` | 同上 |

写配置用面板的 `writeJsonAtomic()`（临时文件 + rename），不整文件重写、失败不动原文件。

## 验收样例（2026-11-05，群 1025377431）

```bash
TOK=$(cat /opt/her-console/token.txt)
curl -s -H "x-her-token: $TOK" -H 'content-type: application/json' \
  -d '{"group":"1025377431","mode":"watch","activity":"quiet"}' \
  http://127.0.0.1:7800/api/preset
# {"ok":true,"group":"1025377431","applied":{"mode":"watch","activity":"quiet"}}
# 回读：mute=false learn=true level=quiet sample=null
```

三种组合实测均回读一致（watch/quiet、called/normal、normal/active），测试后状态已还原。

## 已知边界

- **静音是硬拦截**：`src/ext/mute.js` 的 `wakeGate` 对所有 reason 都拦（没有 @ 例外）。所以「只听叫我」现在等于「谁叫都不回」；要让 @ 仍回，需要给 mute 加直呼例外（属于改判断逻辑，本阶段不做，留 TODO）。
- 「只看不说」只对**主人 @** 例外（`learnmode` 现有规则），不是对所有 @ 例外。
- 抽样比例的**每日上限**仍由 `attention.maxPerDay` 控制，预设不改它。
