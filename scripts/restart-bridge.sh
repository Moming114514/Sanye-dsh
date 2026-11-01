set -u
cd /home/dsh/apps/surfcore
printf '{"ts":%s}' "$(date +%s%3N)" > state/restart-quiet.json
chown dsh:dsh state/restart-quiet.json
# PATTERN_FIX：进程可能是 `src/bridge.js`（相对）也可能是绝对路径，用宽松但只匹配 bridge 的模式
PAT='bin/node .*src/bridge\.js'
pkill -f "$PAT" || true
for i in $(seq 1 20); do pgrep -f "$PAT" >/dev/null || break; sleep 1; done
# PORT_WAIT：进程退了但端口可能还没放开
for i in $(seq 1 40); do ss -lnt 2>/dev/null | grep -q '127.0.0.1:3100 ' || break; sleep 0.5; done
rm -f state/bridge.lock
runuser -l dsh -c 'cd /home/dsh/apps/surfcore && setsid nohup /opt/node-v22.23.4/bin/node src/bridge.js >> /var/log/surfcore-bridge.log 2>&1 < /dev/null &'
sleep 8
pgrep -af "$PAT" | head -3
tail -8 /var/log/surfcore-bridge.log