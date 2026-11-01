# 运维手册（给自己看的）

> 目标：**任何一天出事，5 分钟内能判断是「等它自己好」还是「必须动手」。**
> 所有命令都在服务器上以 root 执行；跑她本人的脚本时用 `runuser -l dsh -c '...'`。

---

## 一、每天（0 分钟，只看一处）

面板首页顶部那排药丸就是全部状态：

| 显示 | 正常 | 不对时怎么办 |
|---|---|---|
| QQ 已连接 | 绿 | 灰 → 看第三节「QQ 掉线」 |
| 桥接 pid | 有数字、且在变（不是 0） | 空/0 → 看第二节 |
| 今天花费 | < 上限的 80% | 超 80% 面板会红条，她会收到【钱包提醒】 |
| NapCat Up | 时间在涨 | 不涨 → `docker restart napcat` |

---

## 二、桥接挂了（最常见）

```bash
systemctl status surfcore-bridge --no-pager | head -5
tail -30 /var/log/surfcore-bridge.log
```

- 如果是 `EADDRINUSE`：旧进程没死干净 →
  ```bash
  pkill -f '^/opt/node-v22.23.4/bin/node src/bridge\.js'
  rm -f /home/dsh/apps/surfcore/state/bridge.lock
  systemctl restart surfcore-bridge
  ```
- 如果是 `SyntaxError`：说明刚改的代码有语法错误 →
  ```bash
  cd /home/dsh/apps/surfcore && node --check src/bridge.js
  ```
  再用 `git log --oneline -3` 找到最后一次提交，`git revert` 或手工修。
- 如果是 `配置里没有 self.mid` 之类配置错：先 `node --check config.json`（其实用 `python3 -m json.tool config.json`），再改回。
- **看门狗**（`surfcore-bridge-watch.timer`，每 2 分钟）会自动做：3001 没连上 / 3100 没在听 → 杀掉重拉 → 还不行 → 重启 dsh-web。日志 `/var/log/surfcore-bridge-watch.log`，看到 `recovered` 就说明它救过一次。

---

## 三、QQ 掉线（必须人工，唯一需要扫码的场景）

```bash
docker logs --tail 30 napcat | grep -iE 'offline|kicked|login'
```

- 被踢 / 需要重新登录 → 打开 NapCat WebUI（`http://<服务器IP>:6099`，只建议走 SSH 隧道），用手机 QQ 扫码。
- 扫码后桥接会自动重连（不用重启 bridge）。

---

## 四、她说错话 / 不回话

按顺序查（每一步都能独立定位）：

1. **模式**：面板顶栏「QQ 模式」是不是切成了「只跟我私聊 / 只听主人 / 关机」；
2. **静音**：白名单页那个会话有没有被点「静音」；
3. **学习模式**：那个群是不是被设成「只看不聊」；
4. **频率**：安全页该群的档位，今天是不是已经用满（`今天 40/40 次`）；
5. **预算**：花费页今天是否到了上限（到了她会降级，只回私聊、不回群）；
6. **桥接日志**：`grep '\[只听主人\]\|\[静音\]\|\[学习模式\]\|\[群频率\]' /var/log/surfcore-bridge.log | tail`

---

## 五、每周（2 分钟）

- 花费页看「近 7 天」和「最贵 5 步」：如果某一步特别贵（> ¥0.2），多半是缓存整段失效，检查是不是有新的易变内容被插到了提示词中间；
- `记忆体检` 页看清晰度分布：模糊条目暴涨说明「忘记」在加速，可以调 `memoryCard.clarify`；
- `学说话` 页清一次「已丢弃」，偶尔翻回候选区看有没有误杀。

---

## 六、每月（10 分钟）

```bash
# 1) 备份（含 state，别只备代码）
cd /home/dsh && tar czf ~/backups/surfcore-$(date +%Y%m%d).tar.gz \
  --exclude=node_modules apps/surfcore .dsh/surfcore

# 2) 升级上游（脚本会做三分支合并，冲突要人工）
cd /home/dsh/apps/surfcore && node scripts/upgrade.mjs v0.9.0   # 版本号照上游 tag 填

# 3) 合并后必跑
node scripts/verify.mjs          # 语法 + 单测 + 结构快照 + 路由
```

`verify` 里「结构不一致」是硬失败（说明提示词结构变了，通常是合错了）；只有「字节数变化」是数据漂移，可以忽略。

---

## 七、常见故障速查

| 症状 | 多半是 | 一步定位 |
|---|---|---|
| 她完全不回 | 桥接没起来 | `systemctl status surfcore-bridge` |
| 只在群里不回私聊 | 私聊白名单 / 模式 | 面板白名单页 |
| 回得很慢 | 高峰时段 + 降级区间 | 花费页「现在是否高峰」 |
| 提示词里没有记忆 | 记忆卡预算被打满 | `grep MEMV2_CARD_MAX src/bridge.js` |
| 面板打不开 | her-console 挂了 | `systemctl status her-console` |
| 面板全是 401 | 控制台令牌不一致 | `grep consoleToken config.json` 对比面板输入的口令 |
| QQ 空间不看了 | 通道没有 `get_cookies` | `cat state/channel-caps.json` |
| 表情永远不匹配 | 库里没有描述 | 面板「表情库」看有多少条「待补」 |

---

## 八、成本预算（按现在的用法）

| 项目 | 量级 |
|---|---|
| 她本人 QQ | ¥3~7 / 天（上限由 `tokenGuard.maxDailyCostCNY` 控制） |
| B 站自动看视频 | ¥0.1~0.5 / 天（10 条视频，贵在抽帧） |
| 服务器 | 固定成本，与用量无关 |
| 缓存命中率 | 目标 ≥95%（低于 90% 说明提示词里混进了易变内容） |

**省钱的正确做法不是「少说话」，而是「别让缓存失效」**：状态、时间、唤醒原因这类每轮都变的内容，一律放到提示词最后。

---

## 九、日志位置

| 文件 | 内容 |
|---|---|
| `/var/log/surfcore-bridge.log` | 桥接主日志（聊天、唤醒、学说法、通道探测） |
| `/var/log/surfcore-bridge-watch.log` | 看门狗自愈记录 |
| `/var/log/her-console.log` | 面板服务 |
| `docker logs napcat` | QQ 侧收发与登录状态 |
| `state/token-usage.jsonl` | 按轮记账（面板花费页的数据源） |

---

## 十、出大事时的止损顺序

1. **先停嘴**：面板 → QQ 状态 → 关机（停止一切主动发言）；
2. **再保状态**：备份 `state/` 与 `characters/`；
3. **然后才改代码**；
4. 改完跑 `node scripts/verify.mjs`，过了再重启；
5. 恢复顺序反过来：先起桥接，确认 QQ 已连接，再放开模式。
