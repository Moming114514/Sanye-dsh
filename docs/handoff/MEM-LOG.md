# MEM-LOG · 2C4G 内存瘦身（TASK-MEM-01）

机器：2 核 / 3622MB 内存；swap 2G（/swapfile，prio -1）；vm.swappiness=60（用户已设，本次未动）。

## 基线（2026-11-03 21:44，T1 前）
```
Mem:  total 3622  used 2370  free 378  buff/cache 1507  available 1251
Swap: total 2047  used 930
top RSS: node 604944(dsh-web) / node 150808 / qq 148916 / MainThread 97240 / node 68696 / MainThread 40140 / dockerd 38920
load: 0.18 0.74 10.34
```

## T1 zram 1G（✅ 2026-11-03 21:47）

做了什么：
- `apt-get install -y zram-tools`（0.3.7-1build1）
- `/etc/default/zramswap` 改为：`ALGO=lz4`、`PERCENT=`（清空，否则 PERCENT=50 会覆盖 SIZE）、`SIZE=1024`、`PRIORITY=100`
- `systemctl enable --now zramswap.service`

弯路（记录备查）：先试 `systemd-zram-generator` 1.2.1，配置 `/etc/systemd/zram-generator.conf` 为 1G/lz4/prio100；但 `--setup-device` 两次复现
`Error: Failed to configure disk size into /sys/block/zram0/disksize: Cannot allocate memory (os error 12)`，
而同一设备用 `zramctl --find --size 1G --algorithm lz4` 手工配置正常 → 判定为该内核(7.0.0-38)上 generator 的兼容问题，卸掉换 zram-tools。

验证：
```
$ zramctl
NAME       ALGORITHM DISKSIZE DATA COMPR TOTAL STREAMS MOUNTPOINT
/dev/zram0 lz4             1G   4K   64B   20K         [SWAP]

$ swapon --show
NAME       TYPE       SIZE USED PRIO
/swapfile  file         2G 1.1G   -1
/dev/zram0 partition 1024M   0B  100

$ free -m
Mem:   3622  used 2081  free 423  buff/cache 1528  available 1540
Swap:  3071  used 1148
```
对比基线：available 1251 → 1540（+289M）；used 2370 → 2081（-289M）；swap 总量 2047 → 3071。

回滚：
```
systemctl disable --now zramswap && swapoff /dev/zram0 && modprobe -r zram
# 彻底卸包：
apt-get remove -y zram-tools    # /etc/default/zramswap 原文件可用 apt-get install --reinstall zram-tools 还原
```
## T2 定时器错峰（✅ 2026-11-03 21:50）

做了什么（drop-in，未用 systemctl edit）：
- `/etc/systemd/system/sanye-digest.timer.d/override.conf`：`OnUnitActiveSec=`（清空）+ `OnUnitActiveSec=17min`
- `/etc/systemd/system/sanye-selfcheck.timer.d/override.conf`：`RandomizedDelaySec=180`
- `systemctl daemon-reload`

原因：两者都是 OnBootSec 起算，digest 15min / selfcheck 30min，每 30 分钟必然撞一次（实测下一次都是 22:16:23）。

验证：
```
改前：sanye-digest 22:01:23 | sanye-selfcheck 22:16:23
改后：sanye-digest 22:03:23 | sanye-selfcheck 22:18:44  ← 30min 周期 + 141s 随机抖动
```
`systemctl cat` 已显示两个 drop-in 生效；`systemd-analyze verify` 传 drop-in 会报 “Failed to prepare filename”，是用法问题（它只接受 unit 文件），不影响运行。

回滚：
```
rm -rf /etc/systemd/system/sanye-digest.timer.d /etc/systemd/system/sanye-selfcheck.timer.d
systemctl daemon-reload
```
## T3 ASR 改按需（✅ 2026-11-03 21:54）

做了什么（方案 A：socket activation + 空闲退出）：
1. `/opt/asr/shim/asr-shim.mjs` 末尾 + 请求入口小改（备份 `/tmp/asr-shim.mjs.bak.<时间戳>`）：
   - 有 `LISTEN_FDS` 时 `server.listen({ fd: 3 })`（接 systemd 传进来的 socket），否则退回原 `listen(8765)`；
   - 每个请求刷新 `lastActivity`，`inflight` 计数；每 15s 检查一次，空闲 `ASR_IDLE_EXIT`（默认 300s）且无进行中请求 → `server.close()` 后退出。
   - `node --check` 通过。
2. 新增 `/etc/systemd/system/asr-shim.socket`：`ListenStream=127.0.0.1:8765`、`Accept=no`、`WantedBy=sockets.target`。
3. 新增 drop-in `/etc/systemd/system/asr-shim.service.d/mem01.conf`：`Environment=ASR_IDLE_EXIT=300`、`Restart=on-failure`（原来是 always，会跟空闲退出打架）、`RestartSec=2`。
4. `systemctl disable asr-shim.service` + `systemctl enable --now asr-shim.socket`。

验证：
```
$ systemctl is-active asr-shim.socket   → active（监听 8765 的是 systemd pid 1）
$ systemctl is-active asr-shim.service  → inactive（常驻进程已消失）
$ curl /health                          → {"ok":true,...}     ← 首个连接自动拉起
$ systemctl is-active asr-shim.service  → active（MainPID 801178，RSS 59M）
$ curl -F file=@/tmp/sil.wav .../audio/transcriptions
  → {"text":"嗯","segments":[{"start":0,"end":1.5,"text":"嗯"}],"model":"paraformer-zh-int8","language":"zh"}  耗时 2.4s（含模型加载）
```
空闲退出用隔离实例验证（生产值 300s 太长，用 15s 等价验证）：
```
$ ASR_PORT=8766 ASR_IDLE_EXIT=15 node asr-shim.mjs
13:54:17 idle 15s, exiting (socket activation will wake on next request)   → 进程退出 ✓
```
效果：平时 ASR 常驻 0M（之前常驻 52M、转写峰值 444~783M，是 OOM 的头号受害者，日志里 21:16/21:19 两次被内核杀）。
代价：听语音时多 1~2s 模型加载，属可接受。

注意：8765 端在 21:53:06 还有一次真实转写请求进来（536KB→2 段），说明用户/插件正在用，空闲退出会在最后一次请求后 300s 生效。

回滚：
```
cp /tmp/asr-shim.mjs.bak.* /opt/asr/shim/asr-shim.mjs        # 还原代码（取最新那个 .bak）
cp /tmp/asr-shim.service.bak /etc/systemd/system/asr-shim.service
rm -f /etc/systemd/system/asr-shim.socket /etc/systemd/system/asr-shim.service.d/mem01.conf
systemctl disable --now asr-shim.socket
systemctl daemon-reload && systemctl enable --now asr-shim.service
```
## T4 dsh-web 插件瘦身（📋 2026-11-03 21:55，只报告未删任何东西）

profile：`/home/dsh/.dsh/profiles/web`，node_modules 共 53M；bundles 4 个（`package.json → dsh.profile.bundles`）+ 3 个 MCP 客户端（`cordis.patch.yml`）。

| 插件 | 磁盘 | Node 端是否常驻 | 作用 | 判断 / 删了会失去什么 |
|---|---|---|---|---|
| `surfcore`（link→`~/.dsh/plugins/surfcore`） | 0（链接） | 是，另起 3 个 MCP 子进程 | QQ 桥的 MCP 入口（snowluma/host/web-search） | **保留**；删了 QQ 侧工具全断 |
| `dsh-context` 0.78M（index.js 92K） | 0.78M | 是（小） | 会话概览注入 | 保留 |
| `dsh-diff-approval` 20M | 20M | 服务端只加载 `lib/index.js` 326K；**12M shiki + 2.4M shiki 全在 `lib/client.js`（浏览器端）** | 编辑待审 diff 页 | 保留；磁盘大≠内存大，删了网页端 diff 高亮/Keep-Revert 消失 |
| `dsh-video-storyboard` 2.2M | 2.2M | 是：工具定义 + ASR 客户端（`src/index.js`） | 视频分镜/转写 | **候选**：不做视频的日子可摘（从 bundles 移除，需重启 dsh-web）；删了视频分镜工具消失，ASR 入口也随之不用 |

另：3 个 MCP 子进程实测 RSS：snowluma-safe 36M / host-server 19M / web-search-safe 19M = **74M**，是插件之外最大的固定开销，但 QQ 桥依赖，保留。
结论：插件本身不是内存大头（服务端常驻估计 <100M）；大头是 dsh-web 主进程 604~744M（两个会话的上下文）和 NapCat/Electron 230M+。

## T5 复查与结论（✅ 2026-11-03 21:55）

| 指标 | 优化前 21:44 | 优化后 21:55 | 变化 |
|---|---|---|---|
| used | 2370M | 1962M | **-408M** |
| available | 1251M | 1659M | **+408M** |
| swap 总量 | 2047M | 3071M（+zram 1G） | +1024M |
| swap used | 930M | 1259M（其中 zram 121M） | +329M |
| zram 压缩 | — | data 120M → compr 94M（1.28:1） | — |
| load 1/5/15 | 0.18/0.74/10.34 | 0.25/0.35/5.04 | 低 |
| 运行中 service | 34 | 34 | — |

峰值：dsh-web peak 903M（21:05 重启后累计）、surfcore-bridge 384M、asr-shim 701M（本次实例；改造前那版峰值 1G）。
注意：dsh-web 已由用户加了 drop-in（21:27）：`MemoryHigh=1.2G`、`MemoryMax=1.8G`，`OOMPolicy=stop`——这是 21:05 事故后的保护，本次未动。
内核 OOM 记录：自启动以来 **8 次**，最近两次是 21:16/21:19 杀 `sherpa-onnx`（说明 ASR 常驻确实是被反复杀的元凶，已由 T3 解决）。

哪几条有效：
- T1 zram：**有效**。立竿见影 +289M available，且给峰值一个压缩缓冲（120M 页压到 94M）。压缩比不高是因为里面混了不可压/已压缩数据，属正常。
- T3 ASR 按需：**最有效**。常驻 52M 归零，转写时峰值 400~700M 不再常驻；代价是每次多 1~2s 模型加载。
- T2 定时器错峰：**预防性**，没有即时内存收益，但消除了每 30 分钟一次的叠加尖峰（digest 15min × selfcheck 30min 必撞）。
- T4：仅报告，无收益。

2C4G 够不够：**聊天场景够，视频/转写场景偏紧**。现在稳态 used ≈1.96G、available ≈1.66G；但 dsh-web 自身峰 903M + NapCat 230M + bridge 150M + ASR 转写 400~700M 一旦同时发生仍会逼近 3.6G，zram 只能兜底不能变出内存。建议：日常不升配；若每天用视频分镜/转写，升到 4G（或把 ASR 挪到云端）比继续抠内存划算。
补充（22:00）：T3 生产实例已在 **21:59:37** 打印 `idle 300s, exiting` 并退出，`systemctl is-active asr-shim` = inactive，8765 仍由 systemd(pid 1) 监听；此时桥接 uptime 仍是 21:16:26、dsh-web 仍是 21:05:14（全程未重启这两个服务）。