# 改动日志（按天，自动生成）

> 由 `node scripts/daily-changes.mjs` 生成；给人展示时直接看这一页。

共 3 天、68 次提交。

## 2026-11-02（16 次）

- `4a702b6` docs: 撤掉致谢（等真用了再加），V2 参考只留已核实条目
- `a878276` feat: 私聊带群聊最近摘要 + 记忆时间绝对化 + CREDITS/V2 参考清单
- `a091a5a` docs: 记录模型路由待做（非官方优先、回落官方、最后做）
- `7d8efca` panel: 花费明细按一次回复聚合，可展开看每步（新内容 token）
- `935f483` feat: 看完视频要不要汇报做成开关（biliStudy.tellOwner）
- `9f298f5` fix: 空间看说说 isPeakNow 未定义 + 欠事 afterSend 缺 log；roadmap 记下 B站场景卡暂缓
- `535e361` feat: 补齐人格分层日常层与场景层（补丁）
- `e410cb5` feat: 学样豁免省钱模式 + 宽窗口读群 + 语气层补三个毛病
- `3df47a1` test(verify): 基线加上 qq_learn_from_owner 与新小节
- `0850da4` feat(owner-teach): 主人纠正时她自己记说法（qq_learn_from_owner）+ 白名单热更新键不再算待生效
- `d6539a3` panel: 修花费页 h 遮蔽崩溃、心情缺字段/缺中文名、欠事时间显示；merge-auto 加 confirm 保护
- `62ffc8d` chore: dev/main 双分支 + scripts/publish.sh（只在用户同意时发布）
- `c8422f7` docs: 标注线上版本 v1.0-20261102
- `5f8f342` docs: 新增 docs/CHANGES.md（每次改动都记）+ AGENTS.md 记录规矩
- `31b06b8` fix(allowlist): 面板加白名单被 GET 分支吞掉 + 桥接改为热读 config.json
- `bc1dfce` docs(roadmap): 记下记忆瘦身（4+2 条）与 afterTurn/afterMemoryWrite 两个钩子

## 2026-11-01（51 次）

- `d5fa9fd` feat(learnmode): 学习模式里主人 @ 她照常回，别人 @ 仍拦
- `4ccc97c` feat(economy): 省钱时「还回 @ / 完全不发」总开关
- `16396ff` feat(economy): 省钱模式开关（自动/一直省/不省）+ 可按群覆盖
- `ce4d432` docs(roadmap): 增加 10 条零/低成本候选（配置审计、记忆浏览器、每周合并、话题雷达等）
- `eb442e2` docs: README 文档索引加 FAQ 入口
- `ef54dc7` docs: 新增 FAQ（12 问：能不能用/隐私/成本/SnowLuma/质量/更新）
- `3378a58` docs: 改成真实时长（一周多，2026-10-30 起）
- `aebdef8` docs: README 顶部写明「参考实现 / Linux 优先 / 非开箱即用」
- `40f5e85` feat(memory): 归一到倒排索引（590 条 6.93ms -> 0.34ms）+ 新增 V2 待做清单
- `c03bd0d` docs: 说明 channel / snowluma 两段配置的关系
- `2b85a52` docs: README 加三张面板截图（群号已替换）+ 通道别名 channel
- `03b29fd` docs: 运维手册 + README 文档索引/已验证环境
- `9ee4e3a` feat(channel): 探测 OneBot 实现能力，QQ 空间/表情收藏在缺失时自动降级
- `9f1c376` feat(panel): 面板源码随仓库发布（panel/）
- `77e4078` docs: README 顶部改成本项目的功能介绍（5 个问题 / 6 组能力 / 13 个面板页 / 工程结构），上游原文保留在后
- `aaf6856` test: 私聊钩子用例改用「看看她」触发（不依赖第三方 bot 名）
- `03ca15a` docs: 仓库地址改成相对写法（改名不失效）+ 测试里的第三方 bot 名中性化
- `9abb46b` docs: 把项目定位前置（README 横幅 + docs/MY-BUILD + docs/LEARN-FROM-ME）
- `11ce1c9` chore(privacy): 脱敏——QQ 号/IP/会话 key 改占位符，备份文件不再入库
- `1100671` chore(v1): 结构基准对齐语气第十三节
- `6927e3e` chore(v1): 桥接 systemd 化 + 看门狗探活 + 通道健康卡文档 + V1 基线
- `4289cae` fix(sticker): 接收图片型表情包（无 emoji_id 时用文件指纹）
- `ad3328a` chore: 同步技术笔记文档与结构基准（语气第十二节）
- `da05a0d` feat: 关联召回（同一次交流里顺带想起）+ 只展示不进上下文的记忆区
- `fd804f4` fix(ext): 语气别播报语音频观感 + 修 note_tech 未授权与空间 selfUserId
- `c1137f4` feat(memory): 记忆卡按会话分权（群只看本群、私聊只看本人）+ 修学说法调度 targetQQ bug
- `7d42fb3` feat(safety): 分群发言频率 + 敏感话题守门
- `a4e8296` chore: 线上 config.json 不入库（含令牌）
- `297e5e7` feat(style): 学习模式（某群只看不聊）+ 机器人自动输出不进样本
- `5d168ab` feat(style): 读群工具支持按 QQ 号筛人，学说法只拉她一个人的消息
- `31d6709` feat(ext): 静音名单 + 面板待生效提示
- `bdc0b72` chore(m2): 收尾——一条命令验收 + 升级脚本化
- `f73ad08` feat(qq): 新增「只跟我私聊」模式（PRIVATEONLY_PATCH）
- `eb73768` docs(ext): M2 收尾——架构文档 + 全量回归
- `5bf0fc9` refactor(ext): M2 第十六步——好友申请/头像状态迁入 src/ext/profile.js
- `9e9a464` refactor(ext): M2 第十五步——看表情抽帧迁入 src/ext/sticker-frames.js
- `6e2a024` refactor(ext): M2 第十四步——QQ 空间四个路由迁入 src/ext/qzone.js
- `4449373` refactor(ext): M2 第十三步——学说法定时学习与 style-list 路由迁入 src/ext
- `0b60c83` refactor(ext): M2 第十二步——学说法私聊触发迁入 ext/style.js，新增 onPrivateMessage 钩子 + 快照工具
- `12488cf` refactor(ext): M2 第十一步——提醒/告警/日报迁入 src/ext/reminders.js + B 站 mid 回退
- `d5fc6c6` refactor(ext): M2 第十步——QQ 空间自动看说说迁入 src/ext/qzone-watch.js
- `a1e9ae2` docs(ext): M2 第九步——扩展层文档（README + index 头部注释）
- `ac44b96` refactor(ext): M2 第八步——MCP 工具收成注册表（tools/list 哈希不变）
- `600b998` refactor(ext): M2 第七步——黑箱发送抑制与记忆卡预算迁入 ext
- `a463f06` refactor(ext): M2 第六步——欠事/人物接口与表情待补提示迁入 ext
- `1b0cbf4` refactor(ext): M2 第五步——相关记忆注入迁入 ext/related-memory.js
- `63bda05` refactor(ext): M2 第四步——学说法迁入 ext（提示词块 / 群观察 / 两个接口）
- `fde54bb` refactor(ext): M2 第三步——三个钩子 + 只听主人 / 欠事捕获迁入 ext
- `b81015c` refactor(ext): M2 第二步——印象库迁移为 ext 模块
- `ba33e67` refactor(ext): M2 第一步——抽出扩展装配点，技术笔记改为 ext 模块
- `7008fcc` feat: 本地改造（人格分层/记忆/印象/技术笔记/学说法/表情/运行控制）

## 2026-10-31（1 次）

- `1e97dc6` upstream: surfcore v0.8.1 (Mieksido/surfcore @ 004712a)
