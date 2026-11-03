# 任务：2C4G 内存瘦身（目标常驻 ≤1.5G，峰值 <3G）

> 背景：2026-11-03 21:05 dsh-web 被 OOM 杀掉（code=killed 9/KILL），连锁导致 bridge 重启、164 条消息被丢弃。
> 机器 2 核 4G（实际 3622MB），swap 2G 已开且 `vm.swappiness` 已改为 60（我做的，不用重做）。
> 现状常驻 ≈1.8G：系统 300M / dsh-web 610M / NapCat 250M / bridge 160M / ASR 400M / 面板+隧道 80M。

## 硬约束（违反即回滚）

1. **不要重启 `surfcore-bridge`**——重启窗口会丢消息、还要重建提示词缓存（约 ¥0.1）。W1-7 的改动继续走"改完不重启，由用户择机重启"。
2. **不要重启 `dsh-web`**——会打断正在对话的两个会话。第 5 项留到最后，由用户批准窗口。
3. 任何一项做完都**先验证再进下一项**，每项独立可回滚，回滚命令写进 `docs/handoff/MEM-LOG.md`。
4. 不用 `systemctl edit`（要交互），一律写 drop-in 文件 + `daemon-reload`。

## 任务（按顺序，互不阻塞）

### T1 zram 1G（无需重启任何服务，收益最大）
- 目的：用 CPU 换内存，压缩比约 1:3，等效 +600M~1G。
- 做法：装 `zram-tools` 或 `systemd-zram-generator`（如果源里没有则用 `zramctl` + swap 脚本），配置 `ALGO=lz4`、`SIZE=1024`、`PRIORITY=100`（高于 /swapfile 的 -1）。
- 验证：`zramctl` 有设备、`swapon --show` 出现 `zram0 1G`、`free -m` 的 Swap 总量 3G。
- 回滚：`swapoff /dev/zram0 && systemctl disable --now zram-swap`。
- 预期：可用内存 +500M 以上。

### T2 定时器错峰（无需重启）
- 现状：`sanye-digest`（15 分钟）、`sanye-selfcheck`（30 分钟）常在整点附近撞车，叠加峰值 200M。
- 做法：给 selfcheck 加 `RandomizedDelaySec=180`，digest 改 `OnUnitActiveSec=17min`；跑 `systemctl daemon-reload`。
- 验证：`systemctl list-timers` 显示下次触发时间已错开。
- 回滚：删掉 drop-in。

### T3 ASR 改按需（重启 `asr-shim` 可以，不影响 bridge）
- 现状：`asr-shim.service` 常驻，sherpa-onnx 峰值 400M+，实测被 OOM 杀过三次。
- 做法（二选一，优先 A）：
  - A. systemd socket activation：`asr-shim.socket` + `asr-shim@.service`，首次连接才拉起；`asr-shim.service` 保留但 `Idle` 由 systemd 不管，需在 handler 里加 `--idle-exit 300`。
  - B. 简单版：`asr-shim.service` 加 `ExecStartPre=/bin/sleep 0` 之外，用 wrapper 进程在 5 分钟无请求时 `exit 0`，并设 `Restart=always`。
- 验证：`systemctl stop asr-shim` 后发一条语音 → 自动起来并转出文字；5 分钟无请求后进程退出。
- 回滚：`cp /tmp/asr-shim.service.bak /etc/systemd/system/ && systemctl daemon-reload && systemctl restart asr-shim`。
- 注意：她听语音会有 1~2 秒启动延迟，属于可接受。

### T4 dsh-web 插件瘦身（需要重启 dsh-web，放最后，等用户批准）
- 做法：列出 `~/.dsh/profiles/*/node_modules` 里已装的插件，按"是否常用"分两类；先**只报告**不建议直接删。
- 报告格式：插件名 / 大小 / 是否常驻内存 / 你判断（保留/候选删除）/ 删除后可能失去什么。
- 用户点头后再删，删前 `npm ls` 记录，删后 `systemctl restart dsh-web` 并复查内存。

### T5 复查与结论
- 全部做完后跑一次：`free -m`、`ps -eo rss,comm --sort=-rss | head -8`、`systemctl list-units --type=service --state=running | wc -l`。
- 输出一张对照表：优化前 / 优化后（常驻、可用、swap 使用）。
- 结论写进 `docs/handoff/MEM-LOG.md`：哪几条有效、哪几条没效果、下一步建议（是否还需要升配）。

## 产出要求

1. 每完成一项，在 `docs/handoff/MEM-LOG.md` 追加一条：时间 / 做了什么 / 验证输出 / 回滚命令。
2. 全部完成后给我一份 ≤15 行的总结（常驻前后、峰值前后、结论：2C4G 够不够）。
3. **不要**顺手改 `src/bridge.js`、`src/ext/*`、面板代码——这次只动系统层。
