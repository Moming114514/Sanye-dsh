# 功能索引（自动生成）

> 由 `node scripts/gen-index.mjs` 生成，别手改。查东西先看这里，再去对应文件。

> 相关：架构取舍看 `docs/DECISIONS.md`；按天改动看 `docs/CHANGES-BY-DAY.md`。

## 扩展模块（src/ext/*.js）

| 模块 | 说明（首行注释） |
|---|---|
| attention.js | 注意力判定（一级，纯本地零成本）：群消息在叫醒她接话之前先算一个分， |
| blackbox.js | 黑箱模式：某些内部任务（比如学说法）不希望她的回复发到 QQ |
| channel.js | channel.js —— QQ 通道能力探测（NapCat / SnowLuma / 其它 OneBot v11 实现 |
| economy.js | 省钱模式：少说话、只回 @，可以全局也可精确到群。 |
| group-rate.js | 群发言频率：每个群单独一档（保守 / 正常 / 活跃），控成本和话痨程度。 |
| impressions.js | 印象库：她对他/对世界的看法（自己攒的，不是设定） |
| learnmode.js | 学习模式：对某个群「只看不聊」——她自己不接话，学说法照样能进去学。 |
| loops.js | 欠事（loops）与人物备注（people）：从 bridge.js 的 LOOPS_PATCH / NEXT_PATC |
| memory-card.js | 记忆卡预算：从 bridge.js 的 MEMCARD_ALIGN_PATCH 迁出（M2 第七步） |
| memory-scope.js | MEMSCOPE_PATCH：按会话给记忆卡分权限。 |
| mute.js | 静音名单：面板上「先不跟这个群/这个人聊」，不删白名单，随时恢复。 |
| owner-only.js | 只听主人：群里只在他说话之后才醒（补唤醒/主动机会/定时一律不吵模型） |
| owner-teach.js | 主人教的说法：他在私聊里纠正/示范时，让她自己记下「原来怎么说 → 该怎么说」， |
| profile.js | 好友申请 / 头像待确认的状态与通知（M2 第十六步从 bridge 的 PROFILE_PATCH 搬出）。 |
| promises.js | 欠事捕获：从她自己刚发的话里认出「欠下的事」，自动进 loops（欠事层） |
| qzone-watch.js | src/ext/qzone-watch.js —— QQ 空间自动看他/她的说说（从 bridge.js 迁出，M2） |
| qzone.js | QQ 空间：读说说 / 评论 / 发说说 / 删说说。 |
| related-memory.js | 相关记忆：按「这一句」挑最相关的几条旧记忆，临时挂在私聊 roleHint 后面 |
| reminders.js | 提醒 / 告警 / 日报：从 bridge 内联块迁出（M2 第十一步） |
| safe-talk.js | 敏感话题守门：有人反复试探（AI/模型/钱/住址/账号…）时按你选的策略处理。 |
| sticker-frames.js | 看表情/动图：从最近的聊天记录里挑出最后一张图，抽 3 帧拼成横排图给模型看。 |
| stickers.js | 表情库：从 bridge.js 的 STICKER_TODO_PATCH 迁出（M2 第六步） |
| style-learn.js | 学说法：每天固定轮次让她去群里「学别人的说话框架」（只记句式，不改人格卡）。 |
| style.js | 学说法：只学目标的人怎么说话（框架），进提示词当参考 |
| tech-notes.js | src/ext/tech-notes.js |

## HTTP 路由（bridge.js 里注册的）

- `/`
- `/api/authorize/read`
- `/api/bili/dynamics/poll`
- `/api/bili/memory/refresh`
- `/api/bili/prompt-preview`
- `/api/bili/share-now`
- `/api/bili/status`
- `/api/console/notify-ai`
- `/api/console/token`
- `/api/debug/frames`
- `/api/debug/guard`
- `/api/debug/promise`
- `/api/debug/prompt`
- `/api/debug/related`
- `/api/debug/sticker-prune`
- `/api/debug/stylelearn`
- `/api/dsh/effort`
- `/api/dsh/model`
- `/api/greeting/test`
- `/api/images/message`
- `/api/memory-card/notify`
- `/api/mode`
- `/api/owner-audit`
- `/api/pending`
- `/api/preset/sim-prompt`
- `/api/preset/sim-prompt/backups`
- `/api/preset/sim-prompt/restore`
- `/api/presets`
- `/api/purpose/preview`
- `/api/purpose/run`
- `/api/purpose/status`
- `/api/restart`
- `/api/role`
- `/api/role-mode`
- `/api/roles`
- `/api/roles/content`
- `/api/roles/create`
- `/api/roles/delete`
- `/api/roles/limit`
- `/api/roles/rename`
- `/api/roles/update`
- `/api/security`
- `/api/send/group`
- `/api/send/private`
- `/api/send/reply`
- `/api/send/voice`
- `/api/session/reset`
- `/api/sessions`
- `/api/slang`
- `/api/slang/batch-confirm`
- `/api/slang/batch-delete`
- `/api/slang/batch-reject`
- `/api/slang/clear`
- `/api/slang/config`
- `/api/slang/extract`
- `/api/slang/research`
- `/api/social`
- `/api/social/flush`
- `/api/social/state`
- `/api/socialV2/active-members`
- `/api/socialV2/activity`
- `/api/socialV2/attention`
- `/api/socialV2/check-send`
- `/api/socialV2/close`
- `/api/socialV2/collect-sticker`
- `/api/socialV2/config`
- `/api/socialV2/diary`
- `/api/socialV2/economy`
- `/api/socialV2/feedback`
- `/api/socialV2/feedback-clear`
- `/api/socialV2/forward-media`
- `/api/socialV2/forward-message`
- `/api/socialV2/group-policy`
- `/api/socialV2/group-recent`
- `/api/socialV2/grouprate`
- `/api/socialV2/history-catchup`
- `/api/socialV2/impression`
- `/api/socialV2/initial-prompt`
- `/api/socialV2/learnmode`
- `/api/socialV2/limit-mute`
- `/api/socialV2/loop`
- `/api/socialV2/mark-read`
- `/api/socialV2/memory`
- `/api/socialV2/memory-append`
- `/api/socialV2/memory-clear`
- `/api/socialV2/memory-remove`
- `/api/socialV2/memory-update`
- `/api/socialV2/message-detail`
- `/api/socialV2/mood`
- `/api/socialV2/mute`
- `/api/socialV2/my-recent`
- `/api/socialV2/names`
- `/api/socialV2/owner-teach`
- `/api/socialV2/person`
- `/api/socialV2/prompt`
- `/api/socialV2/qzone-comment`
- `/api/socialV2/qzone-feed`
- `/api/socialV2/recall`
- `/api/socialV2/recent`
- `/api/socialV2/record-sent`
- `/api/socialV2/reset`
- `/api/socialV2/safetalk`
- `/api/socialV2/self-image`
- `/api/socialV2/send-burst`
- `/api/socialV2/send-message`
- `/api/socialV2/send-poke`
- `/api/socialV2/send-sticker`
- `/api/socialV2/send-voice`
- `/api/socialV2/slang/query`
- `/api/socialV2/slang/submit`
- `/api/socialV2/snapshot`
- `/api/socialV2/state`
- `/api/socialV2/states`
- `/api/socialV2/sticker-frames`
- `/api/socialV2/sticker-image`
- `/api/socialV2/sticker-list`
- `/api/socialV2/sticker-note`
- `/api/socialV2/sticker-remark`
- `/api/socialV2/style-candidate`
- `/api/socialV2/style-list`
- `/api/socialV2/style-note`
- `/api/socialV2/tech-notes`
- `/api/socialV2/tool-log`
- `/api/socialV2/tool-log/clear`
- `/api/socialV2/unread`
- `/api/socialV2/voices`
- `/api/socialV2/wait`
- `/api/socialV2/wake`
- `/api/socialV2/wake-config`
- `/api/status`
- `/api/stickers`
- `/api/stickers/note`
- `/api/stickers/remark`
- `/api/stickers/sync`
- `/api/test-send`
- `/api/tokens/daily`
- `/api/tokens/recent`
- `/api/tokens/reset`
- `/api/tokens/series`
- `/api/tokens/summary`
- `/api/tokens/turns`
- `/api/voice/list`
- `/api/voice/packs`
- `/api/voice/packs/activate`
- `/api/voice/packs/cancel`
- `/api/voice/packs/clean`
- `/api/voice/packs/cloud-config`
- `/api/voice/packs/cloud-stats`
- `/api/voice/packs/enable`
- `/api/voice/packs/import`
- `/api/voice/packs/import-cancel`
- `/api/voice/packs/import-delete-backup`
- `/api/voice/packs/import-delete-source`
- `/api/voice/packs/import-inspect`
- `/api/voice/packs/install`
- `/api/voice/packs/remove`
- `/api/voice/packs/sample`
- `/api/voice/packs/start`
- `/api/voice/packs/stop`
- `/api/voice/packs/test`
- `/api/voice/rules`
- `/api/voice/send`
- `/api/voice/tts-check`
- `/api/whitelist`
- `/api/workspace/reset`
- `/apple-touch-icon.png`
- `/favicon.ico`

## 聊天命令（管理员/主人可用）

- `/active`
- `/cost`
- `/half`
- `/help`
- `/mood`
- `/new`
- `/off`
- `/offpeak`
- `/on`
- `/open`
- `/quiet`
- `/reset`
- `/restart`
- `/role`
- `/silent`
- `/speak`
- `/status`
- `/study`
- `/study-status`
- `/不同意头像`
- `/主人`
- `/全开`
- `/关机`
- `/加油`
- `/只听主人`
- `/同意头像`
- `/命令`
- `/好友`
- `/好友列表`
- `/好友申请`
- `/学`
- `/学习`
- `/学习一个`
- `/帮助`
- `/开机`
- `/心情`
- `/正常`
- `/花费`
- `/谷价`
- `/重启`

## 脚本（scripts/）

- `scripts/apply-update.mjs`
- `scripts/audit-bridge-harness.mjs`
- `scripts/bili-memory-sync.mjs`
- `scripts/billing-report.mjs`
- `scripts/bug-reminder.mjs`
- `scripts/build-agent-preset-patches.mjs`
- `scripts/check-onebot-status.mjs`
- `scripts/check-session-integrity.mjs`
- `scripts/clean-dead-workspaces.mjs`
- `scripts/console-ui-fixture.mjs`
- `scripts/context-call-chain-report.mjs`
- `scripts/context-telemetry-report.mjs`
- `scripts/daily-changes.mjs`
- `scripts/daily-cost-snapshot.mjs`
- `scripts/daily-stats.mjs`
- `scripts/detect-profile.mjs`
- `scripts/diagnose-acl.mjs`
- `scripts/dsh-modules.mjs`
- `scripts/dsh-tool-names.mjs`
- `scripts/gen-index.mjs`
- `scripts/harden-state-acl.mjs`
- `scripts/install-session-guard.mjs`
- `scripts/make-manifest.mjs`
- `scripts/patch-dsh-session-guard.mjs`
- `scripts/patch-snowluma-sdk.mjs`
- `scripts/privacy-rules-lib.mjs`
- `scripts/privacy-scan.mjs`
- `scripts/probe-020-protocol.mjs`
- `scripts/probe-020-settings.mjs`
- `scripts/probe-auth.mjs`
- `scripts/probe-bili-card-formats.mjs`
- `scripts/probe-events.mjs`
- `scripts/probe-models.mjs`
- `scripts/probe-rpc-compat.mjs`
- `scripts/probe-snowluma-heartbeat.mjs`
- `scripts/probe-tools.mjs`
- `scripts/probe-workspace.mjs`
- `scripts/publish-via-api.mjs`
- `scripts/publish.sh`
- `scripts/purpose-inspect.mjs`
- `scripts/release-manifest.mjs`
- `scripts/restart-bridge.sh`
- `scripts/scan-dsh-tool-names.mjs`
- `scripts/selfcheck.mjs`
- `scripts/send-test-group.mjs`
- `scripts/send-voice.mjs`
- `scripts/setup-dsh.mjs`
- `scripts/snapshot.mjs`
- `scripts/sync-dsh-port.mjs`
- `scripts/tag-stickers.mjs`
- `scripts/test-action-planner.mjs`
- `scripts/test-admin-identity.mjs`
- `scripts/test-admin-prompt-wiring.mjs`
- `scripts/test-agent-preset-patches.mjs`
- `scripts/test-allowlist.mjs`
- `scripts/test-audit-bridge.mjs`
- `scripts/test-audit-protocol-helpers.mjs`
- `scripts/test-audit-protocol.mjs`
- `scripts/test-audit-regressions.mjs`
- `scripts/test-audit-security-mcp.mjs`
- `scripts/test-audit-security.mjs`
- `scripts/test-audit-setup-guards.mjs`
- `scripts/test-audit-setup.mjs`
- `scripts/test-audit.mjs`
- `scripts/test-backlog-cap.mjs`
- `scripts/test-bili-card-ark.mjs`
- `scripts/test-bili-card.mjs`
- `scripts/test-bili-dynamics.mjs`
- `scripts/test-bili-memory.mjs`
- `scripts/test-bili-qr-login.mjs`
- `scripts/test-bili-share-dedup.mjs`
- `scripts/test-bili-state-paths.mjs`
- `scripts/test-billing-report.mjs`
- `scripts/test-billing-service.mjs`
- `scripts/test-blacklist.mjs`
- `scripts/test-callname.mjs`
- `scripts/test-character-store.mjs`
- `scripts/test-closure-wiring.mjs`
- `scripts/test-console-encoding.mjs`
- `scripts/test-console-static.mjs`
- `scripts/test-console-ui.mjs`
- `scripts/test-console.mjs`
- `scripts/test-context-call-chain.mjs`
- `scripts/test-context-snapshot.mjs`
- `scripts/test-context-telemetry.mjs`
- `scripts/test-conversation-closure.mjs`
- `scripts/test-core-rev-sync.mjs`
- `scripts/test-dsh-auth.mjs`
- `scripts/test-dsh-inbox-projection.mjs`
- `scripts/test-dsh-port.mjs`
- `scripts/test-dsh-session-retire.mjs`
- `scripts/test-dsh-v2-wait.mjs`
- `scripts/test-encoding.mjs`
- `scripts/test-feed-core.mjs`
- `scripts/test-fish-guard.mjs`
- `scripts/test-forward.mjs`
- `scripts/test-gate-events.mjs`
- `scripts/test-greeting.mjs`
- `scripts/test-group-policy.mjs`
- `scripts/test-hardening.mjs`
- `scripts/test-history-catchup.mjs`
- `scripts/test-identity-guard.mjs`
- `scripts/test-issue-regressions.mjs`
- `scripts/test-launch-components.mjs`
- `scripts/test-limit-report.mjs`
- `scripts/test-mcp-exec.mjs`
- `scripts/test-mcp-host.mjs`
- `scripts/test-mcp-safe.mjs`
- `scripts/test-mcp-servers-stdio.mjs`
- `scripts/test-mcp-web-search.mjs`
- `scripts/test-md-to-plain.mjs`
- `scripts/test-media-search.mjs`
- `scripts/test-memory-card-act.mjs`
- `scripts/test-memory-card-wiring.mjs`
- `scripts/test-memory-card.mjs`
- `scripts/test-mux-reconnect.mjs`
- `scripts/test-night-schedule.mjs`
- `scripts/test-onebot-connection.mjs`
- `scripts/test-owner-audit.mjs`
- `scripts/test-persona-classify.mjs`
- `scripts/test-persona-layers.mjs`
- `scripts/test-platform-start.mjs`
- `scripts/test-plugin-compat.mjs`
- `scripts/test-pref-scan.mjs`
- `scripts/test-preset-local-tools.mjs`
- `scripts/test-preset-prompt.mjs`
- `scripts/test-privacy-scan.mjs`
- `scripts/test-purpose-engine.mjs`
- `scripts/test-purpose-wiring.mjs`
- `scripts/test-qq-fish-guard.mjs`
- `scripts/test-qq-mode-plugin.mjs`
- `scripts/test-qq-model-view.mjs`
- `scripts/test-qq-preset-contract.mjs`
- `scripts/test-question-answers.mjs`
- `scripts/test-release-manifest.mjs`
- `scripts/test-reply-wait.mjs`
- `scripts/test-role-card.mjs`
- `scripts/test-scheduler-permission.mjs`
- `scripts/test-self-identity.mjs`
- `scripts/test-session-map.mjs`
- `scripts/test-setup-dsh-idempotent.mjs`
- `scripts/test-share-dynamic.mjs`
- `scripts/test-slang-learn.mjs`
- `scripts/test-snowluma-channel-gate.mjs`
- `scripts/test-snowluma-conn.mjs`
- `scripts/test-snowluma-startup-warning.mjs`
- `scripts/test-snowluma-upstream-health.mjs`
- `scripts/test-sticker-semantics.mjs`
- `scripts/test-stickers.mjs`
- `scripts/test-token-budget-bridge.mjs`
- `scripts/test-token-budget-service.mjs`
- `scripts/test-token-budget.mjs`
- `scripts/test-token-economy.mjs`
- `scripts/test-token-guard.mjs`
- `scripts/test-token-usage.mjs`
- `scripts/test-update-apply-result.mjs`
- `scripts/test-update-version-fallback.mjs`
- `scripts/test-v2-initial-prompt.mjs`
- `scripts/test-v2-wait.mjs`
- `scripts/test-version.mjs`
- `scripts/test-vision-media.mjs`
- `scripts/test-voice-cloud-credentials.mjs`
- `scripts/test-voice-diagnostics.mjs`
- `scripts/test-voice-edge.mjs`
- `scripts/test-voice-gates.mjs`
- `scripts/test-voice-gui.mjs`
- `scripts/test-voice-pack-import.mjs`
- `scripts/test-voice-packs-default.mjs`
- `scripts/test-voice-preview.mjs`
- `scripts/test-voice-route.mjs`
- `scripts/test-voice-system.mjs`
- `scripts/test-voice-tts.mjs`
- `scripts/test-voice-volume.mjs`
- `scripts/test-voice.mjs`
- `scripts/test-wake-policy.mjs`
- `scripts/test-watch-actions.mjs`
- `scripts/test-watch-history.mjs`
- `scripts/uninstall.mjs`
- `scripts/upgrade.mjs`
- `scripts/verify-agent-presets-017.mjs`
- `scripts/verify-dsh-020-adaptation.mjs`
- `scripts/verify-persona-config.mjs`
- `scripts/verify-remote-manifest.mjs`
- `scripts/verify.mjs`
- `scripts/version.mjs`
- `scripts/voice-activate.mjs`
- `scripts/voice-e2e.mjs`
- `scripts/voice-live-check.mjs`
- `scripts/voice-send-test.mjs`
- `scripts/voice-tool-locator.mjs`

## 定时器

- `sanye-selfcheck.service`
- `sanye-stats.service`
- `sanye-bug-reminder.service`

## 补丁标记（出现次数）

| 标记 | 次数 |
|---|---|
| `NEXT_PATCH` | 11 |
| `STYLE_PATCH` | 11 |
| `EXT_PATCH` | 8 |
| `PROFILE_PATCH` | 8 |
| `MEMSCOPE_PATCH` | 7 |
| `LOOPS_PATCH` | 7 |
| `VIEW_STICKER_PATCH` | 6 |
| `CHANNEL_CAPS_PATCH` | 5 |
| `GROUPRATE_PATCH` | 5 |
| `VOICE_PATCH` | 4 |
| `BILISTUDY_PATCH` | 4 |
| `RELATEDMEM_PATCH` | 4 |
| `QZONE_FEED_PATCH` | 4 |
| `STYLE_GATE_PATCH` | 4 |
| `IMPR_PATCH` | 4 |
| `QUIET_PATCH` | 3 |
| `STICKER_CAP_PATCH` | 3 |
| `EXTAUTH_PATCH` | 3 |
| `NAMES_PATCH` | 3 |
| `ECONOMY_PATCH` | 3 |
| `PROMISE_PATCH` | 3 |
| `BOOST_PATCH` | 3 |
| `GROUPSUM_PATCH` | 3 |
| `FAVBYBV_PATCH` | 2 |
| `RECALL_FUZZY_PATCH` | 2 |
| `PRIVATEONLY_PATCH` | 2 |
| `CHANNEL_ALIAS_PATCH` | 2 |
| `FACE_NAME_PATCH` | 2 |
| `QZONE_PATCH` | 2 |
| `STICKER_AUTOADD_PATCH` | 2 |
| `LEARNMODE_PATCH` | 2 |
| `ATTENTION_PATCH` | 2 |
| `OWNERTEACH_PATCH` | 2 |
| `TECHNOTES_PATCH` | 2 |
| `ANIM_STILL_PATCH` | 2 |
| `TOOLJSON_RETRY_PATCH` | 2 |
| `STUDYNOTE_PATCH` | 2 |
| `STYLE_TRIGGER_PATCH` | 2 |
| `INVERTED_INDEX_PATCH` | 2 |
| `MID_FALLBACK_PATCH` | 1 |
| `DEDE_COOKIE_PATCH` | 1 |
| `PENDING_STATE_PATCH` | 1 |
| `HASWATCHED_PATCH` | 1 |
| `ALLOW_HOT_PATCH` | 1 |
| `STICKER_TMPPATH_PATCH` | 1 |
| `STICKER_KIND_PATCH` | 1 |
| `BACKLOG_PRIVATE_ONLY_PATCH` | 1 |
| `DBGPROMPT_PATCH` | 1 |
| `RECALL_TOUCH_PATCH` | 1 |
| `MUTE_PATCH` | 1 |
| `WIDEWINDOW_PATCH` | 1 |
| `OWNER_RELABEL_PATCH` | 1 |
| `RECALL_RULE_PATCH` | 1 |
| `TELLOWNER_PATCH` | 1 |
| `WALLET_PATCH` | 1 |
| `CACHEORDER_PATCH` | 1 |
| `COSTTEXT_PATCH` | 1 |
| `GAPQUIET_PATCH` | 1 |
| `BILILINK_PATCH` | 1 |
| `CMD_LINE_PATCH` | 1 |
| `CFGSNAP_PATCH` | 1 |
| `TONE_PATCH` | 1 |
| `QZONE_REPLY_PATCH` | 1 |
| `ABSTIME_PATCH` | 1 |
| `DISPLAYONLY_PATCH` | 1 |
| `MOODV2_PATCH` | 1 |
| `IDENTITY_RELABEL_PATCH` | 1 |
| `STICKER_W_PATCH` | 1 |
| `MEMCARD_ALIGN_PATCH` | 1 |
| `OWNERONLY_GATE_PATCH` | 1 |
| `FRIEND_BATCH_PATCH` | 1 |
| `QZONE_WATCH_PATCH` | 1 |
| `ASSOC_PATCH` | 1 |
| `STICKER_TODO_PATCH` | 1 |
| `STYLE_NOW_PATCH` | 1 |
| `STYLE_EXEMPT_PATCH` | 1 |
| `STYLE_INJECT_PATCH` | 1 |
| `STYLE_STRICT_PATCH` | 1 |
