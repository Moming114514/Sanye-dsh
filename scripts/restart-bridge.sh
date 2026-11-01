#!/usr/bin/env bash
# 重启桥接（面板「重启桥接」按钮也调这个）
# 优先用 systemd（surfcore-bridge.service）；没有单元时退回老方式。
set -uo pipefail
APP=/home/dsh/apps/surfcore
NODE=/opt/node-v22.23.4/bin/node
UNIT=surfcore-bridge.service

# 1) 标记「这是主动重启」，避免她发「回来了，刚才断了 N 分钟」
date +%s | awk '{printf "{\"ts\":%d}\n", $1}' > "$APP/state/restart-quiet.json"
chown dsh:dsh "$APP/state/restart-quiet.json" 2>/dev/null || true

if systemctl cat "$UNIT" >/dev/null 2>&1; then
  systemctl restart "$UNIT"
  sleep 6
  systemctl is-active "$UNIT"
  exit 0
fi

# 老方式
PAT='bin/node .*src/bridge\.js'
pkill -f "$PAT" 2>/dev/null
for i in $(seq 1 30); do
  pgrep -f "$PAT" >/dev/null 2>&1 || break
  sleep 1
done
for i in $(seq 1 30); do
  ss -lnt 2>/dev/null | grep -q ':3100 ' || break
  sleep 1
done
rm -f "$APP/state/bridge.lock"
runuser -l dsh -c "cd $APP && setsid nohup $NODE src/bridge.js >> /var/log/surfcore-bridge.log 2>&1 < /dev/null &"
sleep 6
pgrep -af "$PAT" | head -2
