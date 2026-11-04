# 换服务器迁移手册（含 Docker 方案）

> 用在哪：换机器、重装系统、或要跑第二个实例。
> 现状：单机 systemd 托管（bridge / dsh-web / her-console / cloudflared / asr socket + 5 个 timer）。
> 原则：**先能搬，再谈优化**。容器化是“搬家时顺手做的事”，不是目的。

## 一、三条路线

| 路线 | 工作量 | 优点 | 风险 |
|---|---|---|---|
| **A. 裸搬**（重装同样的 systemd 服务） | 3~4 小时 | 最直接、最可控、内存不增加 | 环境依赖要重装一遍 |
| **B. 容器化“壳”**（bridge + NapCat + 面板进容器，DSH/timer 留宿主机） | 1~2 天 | 换机/回滚快、环境隔离 | 内存 +150~250M；QQ 登录态要挂对 |
| **C. 整机镜像/快照** | 30 分钟 | 最省事，登录态都在 | 只适合同云厂商、同规格迁移 |

**建议**：换机时先走 **A**（当天就能跑起来）；如果之后要长期维护多套，再按 **B** 逐步迁。

## 二、必须搬走的东西（A 路线清单）

```bash
# 1. 代码与配置
/home/dsh/apps/surfcore/          # 代码 + config.json（含 token，勿外传）
~/.dsh/surfcore/                  # characters/（人格）+ state/（记忆、学样、静音、频率…）
~/.dsh/surfcore/bili.config.json  # B站登录
~/.dsh/video.json                 # 视频额度/凭据（如用）

# 2. 面板
/opt/her-console/                 # server.mjs + public/ + token.txt

# 3. 语音（如果用）
/opt/asr/                         # sherpa-onnx + shim

# 4. NapCat（容器）
/home/dsh/napcat/                 # 容器 volume：QQ 登录态、onebot11 配置

# 5. 系统层
/etc/systemd/system/surfcore-bridge.service
/etc/systemd/system/her-console.service
/etc/systemd/system/asr-shim.service + .socket
/etc/systemd/system/cloudflared-panel.service
/etc/systemd/system/sanye-*.service + .timer      # digest / selfcheck / stats / memarchive / media-clean / bug-reminder
/etc/systemd/system/dsh-web.service.d/            # 内存上限 drop-in
/etc/logrotate.d/surfcore
/etc/sysctl.d/99-zz-swap.conf                     # swappiness=60
/etc/docker/daemon.json                           # 镜像加速（国内必需）
```

## 三、QQ 登录态怎么处理

- NapCat 的登录态在容器的 `/home/dsh/napcat`（volume 挂载）；
- **同一台机器换容器**：挂同一个 volume，不用重扫；
- **换机器**：把 `napcat/` 整个目录带过去；如果登录凭据与机器指纹绑定，仍需**重新扫码一次**（二维码 1~2 分钟过期，让主人自己扫，见 `docs/OPERATIONS.md`）。

## 四、B 路线（容器化“壳”）最小方案

只把三样进容器，其余留宿主机：

```yaml
# docker-compose.yml（示意，未启用）
services:
  napcat:
    image: mlikiowa/napcat-docker:latest
    network_mode: host          # 或映射 3000/3001/6099
    privileged: true
    volumes:
      - /home/dsh/napcat:/app/napcat/config
      - /home/dsh/napcat/data:/app/napcat/data
    restart: always

  bridge:
    image: surfcore-bridge:local     # 需自建：node:22 + npm ci + src/
    network_mode: host               # 它要访问 127.0.0.1:3001 / 3080
    volumes:
      - /home/dsh/apps/surfcore/config.json:/app/config.json:ro
      - /home/dsh/apps/surfcore/state:/app/state
      - /home/dsh/.dsh/surfcore:/home/dsh/.dsh/surfcore
    environment:
      - SURFCORE_DIR=/app
      - DSH_HOME=/home/dsh/.dsh
    restart: always

  panel:
    image: node:22-alpine
    command: node /app/server.mjs
    ports: ["127.0.0.1:7800:7800"]
    volumes:
      - /opt/her-console:/app:ro
      - /home/dsh/.dsh/surfcore/state:/state:ro
    restart: always
```

**内存预估**：三个容器比 systemd 多 **150~250M**（镜像层不占常驻，主要是多一层进程与日志驱动）。2C4G 机器上要先把 zram/swap 打好。

## 五、切换与回滚

1. 新机先按 A 路线跑通（systemd），**并行**与旧机隔离（不同 QQ 号或先停旧机）；
2. 验证通过后再切 QQ 登录到新机（旧机 `systemctl stop surfcore-bridge`）；
3. 回滚 = 旧机 `systemctl start` + 新机停用，5 分钟内可回；
4. DNS/域名（面板）：沿用现有的 `trycloudflare` 或自有域名，切换时只改 cloudflared 指向。

## 六、迁移后的验收清单（8 条）

- [ ] `systemctl status surfcore-bridge` active，日志出现「桥接已启动」
- [ ] QQ 在线：私聊发「在吗」，有回复
- [ ] 面板 7800 可打开，`#t=` 口令生效
- [ ] 自检 12 项全绿（面板「总览」）
- [ ] 记忆条数与旧机一致（`/api/mem` 的 total）
- [ ] 学说法样本数一致
- [ ] 定时器全部 enabled（`systemctl list-timers 'sanye-*'`）
- [ ] 花费面板能读到当天数据（3100 接口）

## 七、不建议做的事

- **整栈一键容器化**（含 DSH）：DSH 会 spawn MCP 子进程、依赖 profile 目录，容器里要额外处理，收益低；
- **在 2C4G 上常驻多个容器 + 视频转写 + 面板**：内存会不够，且已经 OOM 过一次；
- **把 `config.json` 打进镜像**：token 会随镜像泄露，必须挂载。
