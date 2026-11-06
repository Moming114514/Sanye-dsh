# TASK-INPUT：输入链路（图片 / 语音 / 文件 / 动图）

> 背景：另一套机器人做过一次复盘（`D:\QQ\flat-review-report.docx`），发现三个断点，导致"发图只回在呢"。
> 我们很可能踩了同样的坑。**先证伪，再修**——每条都要拿到证据再动手。
> 规则同 W2：改 bridge 先备份；能不动运行时就不动；重启等主会话统一执行。

## 先做只读取证（不改代码，结论先给我）

对下面四条，逐条给「是否存在 / 证据 / 影响面」：

1. **媒体消息判空**：`[CQ:image,...]` / `[CQ:record,...]` / `[CQ:file,...]` 被剥标记后，文本是否变空 → 是否被判成"只是 @" 而走预设短句？
   - 查法：`grep -n "CQ:image\|CQ:record\|CQ:file" src/bridge.js`，找到"剥标记 → 判长度 → 走短句"的那段。
   - 证据：日志里"预设句/固定句"的出现次数（`grep -a "在呢\|来了来了\|什么事呀" /var/log/surfcore-bridge.log | wc -l`）。
2. **下载链路**：现在是"先直连 URL，失败再换 `get_image`"，还是反过来？
   - 查法：`grep -n "fetchOneBotImage\|get_image\|fetchMediaData" src/bridge.js | head`。
   - 证据：`grep -a "\[media\]" /var/log/surfcore-bridge.log | tail -20`（失败次数与原因）。
3. **描述被覆盖**：媒体描述拼进消息文本后，后续拼上下文时是否又被覆盖？
   - 查法：找到 `buildWakePromptV2` 里拼消息列表的那段，看媒体描述是"拼进消息本身"还是"拼进追加段"。
   - 证据：`GET /api/debug/prompt?related=0`（或 panel preview）里搜描述关键词是否存在。
4. **动图/表情包**：`mface`（表情包）是否走到了 `flattenAnimated`？还是只有 `image` 走？
   - 查法：`grep -n "flattenAnimated\|kind === 'sticker'\|mface" src/bridge.js`。

## 再修（每条一个 commit，顺序按上）

1. **媒体不透支**：带媒体的消息，剥标记后若还有媒体，**不算空**，不进预设句分支。
2. **下载顺序反转**：先 `get_image`（换新地址）→ 失败再直连原 URL → 都失败才记 `[media]` 失败。
3. **描述不被覆盖**：媒体描述与消息文本一起拼，或在 prompt 末尾单独一段「这条消息的媒体内容：…」，确保不被后续拼接冲掉。
4. **动图抽帧**：`mface` 与 `image` 都走 `flattenAnimated`（gif/apng/webp）。

## 观测（零成本，必须做）

- `state/media-stats.json`：`{day, ok, fail, lastFailAt, lastErr}`，每次媒体解析写一次；
- 面板「总览」加一张小卡：今天媒体成功/失败数，失败 >0 显示黄条 + 「看最近错误」；
- **失败要显式**，不要只写日志（这正是那份文档第 5 问）。

## 验收

| 场景 | 期望 |
|---|---|
| 只发一张图 | 她回的句子里提到图里的东西（不是"在呢"） |
| 发图 + 文字 | 两者都接住 |
| 发一张 GIF | 她描述得出画面（抽帧成功） |
| 语音 | 转写文本作为内容参与生成 |
| 图片 URL 过期 | 自动换新地址成功，日志无「3 次尝试」 |
| 媒体失败 | 面板黄条 +1，`state/media-stats.json` 有记录 |

## 不要做

- 不改人格文件（避免缓存重建）；
- 不新增模型调用（本任务全程零额外调用）；
- 不动 `attention` 打分逻辑（那是"判断层"，属另一个任务）。
