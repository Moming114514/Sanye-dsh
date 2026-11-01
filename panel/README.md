# her-console —— 她的观察面板

零依赖的 Node 单文件服务（`server.mjs`）+ 一个前端单页（`public/`）。
它不写任何状态到桥接里，只做三件事：**读**桥接的接口、**读**本机状态文件、**改** `config.json` 与几个运行时开关。

```
panel/
├── server.mjs                 # 面板服务：13 个页面 + 30 多个代理接口
├── public/
│   ├── index.html             # 壳（含 #t=<口令> 免密入口）
│   └── assets/
│       ├── app.js             # 全部页面与渲染（单文件，无构建步骤）
│       └── style.css          # 深色主题
└── her-console.service        # systemd 单元示例
```

## 页面

| 页面 | 作用 |
|---|---|
| 总览 | QQ 模式、今日花费、心情、最近说的话、端口与服务 |
| 入口 | 终端 TUI / 网页入口 |
| 功能开关 | 20 多个开关（暂停、白名单为空也响应、提醒、日报、学说话…） |
| 设置 | 每日额度 / 降级线 / 唤醒次数 / 只学谁 等，改完标「待生效」 |
| 白名单 | 群与人，逐个「静音 / 学习模式」 |
| 安全 | 分群发言频率（保守/正常/活跃）+ 敏感话题四模式 |
| 花费 | 今天 / 昨天 / 7 天 / 30 天、缓存命中率、按会话、最贵 5 步、CSV |
| 记忆与情绪 | 记忆条数、心情分布、记忆卡条目 |
| 她的看法 | 印象库（增删） |
| 学说话 | 只学谁的配置、候选区、正式样本、已丢弃 |
| 记忆星海 | 3D 星图（时间轴 / 主题 / 筛选 / 钉住） |
| 记忆体检 | 近八周增长、清晰度分布 |
| 排障 | 最近的错误与调试入口 |

## 跑起来

```bash
cd panel
node server.mjs            # 默认 http://127.0.0.1:7800
```

首次运行会在**当前目录**下找 `token.txt`（没有就生成一个），浏览器打开时用
`http://127.0.0.1:7800/#t=<口令>` 免密进入，或者在「需要面板口令」页粘进去。

## 环境变量

全部有默认值，默认值假设「服务账号 home 下是 `apps/surfcore` + `.dsh/surfcore`」：

| 变量 | 默认 | 说明 |
|---|---|---|
| `HER_CONSOLE_ROOT` | 脚本所在目录 | 静态页与 token.txt 的位置 |
| `SURFCORE_DIR` | `~/apps/surfcore` | SurfCore 安装目录（读 config.json、调重启脚本） |
| `DSH_HOME` | `~/.dsh` | DSH 的数据目录（记忆卡、视频额度等） |
| `SURFCORE_STATE` | `~/.dsh/surfcore/state` | 面板读写的状态目录 |
| `HER_FEAT_PATH` | `<ROOT>/../her/features.json` | 功能注册表（没有就只显示内置项） |
| `HER_MEMCARD` | `~/…/characters/<首个角色>/memory/memory-card.json` | 记忆卡路径 |
| `HER_BACKUP_DIR` | `~/backups/her` | 配置备份目录 |
| `SURFCORE_USER` | `dsh` | 重启桥接时 `runuser` 的账号 |
| `NODE_BIN` | `process.execPath` | 重启桥接用的 node |
| `PORT` | `7800` | 监听端口 |

## systemd

```ini
[Unit]
Description=her-console (SurfCore panel)
After=network.target

[Service]
Type=simple
User=dsh
WorkingDirectory=/opt/her-console
ExecStart=/usr/bin/node /opt/her-console/server.mjs
Restart=always
RestartSec=3
Environment=HER_CONSOLE_ROOT=/opt/her-console
Environment=SURFCORE_DIR=/home/dsh/apps/surfcore
Environment=DSH_HOME=/home/dsh/.dsh
Environment=SURFCORE_STATE=/home/dsh/.dsh/surfcore/state
Environment=HER_FEAT_PATH=/opt/her/features.json

[Install]
WantedBy=multi-user.target
```

## 安全提醒

- **只监听 127.0.0.1**。想在外面看，用 SSH 隧道：`ssh -N -L 7800:127.0.0.1:7800 user@host`，
  不要把端口直接开到公网——`#t=<口令>` 是明文在地址栏里的。
- 面板能改 `config.json` 和重启桥接，请当成「管理后台」对待。
- 除 `token.txt` 外不存任何凭据；控制台令牌从 `config.json` 的 `consoleToken` 读。
