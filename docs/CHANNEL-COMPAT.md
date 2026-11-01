## 兼容性：SnowLuma / NapCat / 其它 OneBot v11 实现

> 一句话：**桥接本身就是 SnowLuma SDK + OneBot v11（WS 3001 / HTTP 3000）**，
> 「用 SnowLuma」和「用 NapCat」的区别只是把这两个地址指向谁，**代码不用改**。

### 配置对照

| | SnowLuma | NapCat | 其它 OneBot v11 |
|---|---|---|---|
| `snowluma.wsUrl` | `ws://127.0.0.1:3001` | `ws://127.0.0.1:3001` | 你的 WS 地址 |
| `snowluma.httpUrl` | `http://127.0.0.1:3000` | `http://127.0.0.1:3000` | 你的 HTTP 地址 |
| `snowluma.accessToken` | 你的 token | 你的 token | 你的 token |
| `snowluma.launcherPath` / `allowLaunch` | 用得上（SnowLuma 启动器） | 建议删掉 / 设 false | 删掉 |
| `snowluma.homeDir` | SnowLuma 数据目录 | 忽略 | 忽略 |

### 功能可用性

| 功能 | SnowLuma | NapCat | 说明 |
|---|---|---|---|
| 收发消息 / 群聊私聊 / @识别 | ✅ | ✅ | OneBot v11 基础能力 |
| 人格分层 / 记忆 / 学说话 / 欠事 / 印象 / 技术笔记 | ✅ | ✅ | 不依赖通道扩展 |
| 面板（13 页）/ 花费与缓存统计 / 看门狗自愈 | ✅ | ✅ | 只读本机状态 |
| 表情包「发」 | ✅ | ✅ | 走 `send_group_msg` 的消息段 |
| 表情包「收藏 / 备注 / 拉取详情」 | ⚠️ 视实现 | ✅ | 需要 `add_custom_face` / `modify_custom_face` / `fetch_custom_face_detail` |
| 读群历史 / 读好友历史 | ✅ | ✅ | 需要 `get_group_msg_history` / `get_friend_msg_history` |
| QQ 空间自动看说说 / 评论 | ⚠️ 需要 `get_cookies` | ✅ | 走网页 `emotion_cgi_*` 接口，拿不到 cookie 就自动跳过 |
| B 站动态 / 自动学技术 | ✅ | ✅ | 用本地 cookies 文件，与 QQ 通道无关 |

图例：✅ 直接可用 ｜ ⚠️ 取决于通道是否实现对应 OneBot 扩展 API，缺了会自动跳过并只记一条日志，不刷屏

### 已知坑

- `snowluma.httpUrl` 指向了 **WS 端口**：报 `HTTP 426`，错误信息里会提示你改回 HTTP 端口。
- SnowLuma 默认带 `launcherPath`（Windows 的 `launcher.bat`），NapCat 部署请把它删掉或 `allowLaunch: false`，否则桥接会尝试去启动一个不存在的程序。
- 换通道后第一次启动会重新发现端点（`followDiscoveredEndpoint: true`），如果还连旧地址，把 `state/` 里的端点缓存删掉再启动。
