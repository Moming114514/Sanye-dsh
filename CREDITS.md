# 致谢与来源（CREDITS）

这个仓库是**整合 + 改造**，不是从零写的。下面按「上游 / 直接依赖 / 参考过的项目」列清楚。

## 上游（代码基础）

| 项目 | 说明 | 许可 |
|---|---|---|
| [SurfCore](https://github.com/Mieksido/surfcore) | 本项目的底座（v0.8.1）；人格分层、记忆卡、学说法、群策略、成本账本等核心能力来自它 | 见上游仓库 LICENSE |
| [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) | 运行宿主：agent 运行时、会话与工具调度 | 见上游仓库 LICENSE |

## 直接依赖

| 项目 | 用途 |
|---|---|
| [NapCatQQ](https://github.com/NapNeko/NapCatQQ) | QQ 协议端（Docker 部署），提供 OneBot v11 接口 |
| Node.js 22 / systemd / ffmpeg | 运行时、进程托管、媒体抽帧 |

## 参考过 / 借鉴过思路的项目

> 只借鉴设计思路与公开文档，未直接拷贝代码；如后续引入了代码，会在此标注文件与许可。

| 项目 | 借鉴的点 |
|---|---|
| [AstrBot](https://github.com/Soulter/AstrBot) | 插件化组织方式、多平台适配的分层思路 |
| AuraBot | 人格/语气分层的组织方式（链接待补） |
| `dsh-pond`、`four-point-hooks`（社区 PR） | 「钩子最少化」与「取消订阅要清干净」的思路 |
| MiniMax / WorkBuddy 相关讨论 | 仅作为「廉价模型支线」的备选方案记录，未接入代码 |

## 我自己的部分

- 面板（`panel/`）：布局、页面、自检卡、情绪曲线/气泡、花费页、白名单名字解析等；
- `src/ext/*` 里的扩展（attention、economy、safe-talk、learnmode、group-rate、mute、owner-teach、qzone…）：把上游打散在 `bridge.js` 里的逻辑抽成可插拔模块；
- 记忆与人格的工程化：`ABS` 时间归一、`displayOnly`、关联召回、注入预算对齐；
- 文档：`docs/` 下除上游自带的以外全部。

## 许可态度

- 上游是 MIT/Apache 类许可：保留版权声明即可商用/分发；
- 若引入 **GPL** 代码，会单独标注，并且**不会**混进主链路（避免许可证传染）；
- 你基于本仓库二次开发，请同样保留本文件与上游声明。
