#!/usr/bin/env bash
# 清理 media-cache：先删 7 天以上的，再按最旧删到 200MB 以内
set -eu
DIR=/home/dsh/apps/surfcore/state/media-cache
[ -d "$DIR" ] || exit 0
find "$DIR" -type f -mtime +7 -delete || true
SIZE=$(du -sm "$DIR" | cut -f1)
while [ "$SIZE" -gt 200 ]; do
  OLDEST=$(find "$DIR" -type f -printf '%T@ %p\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)
  [ -n "$OLDEST" ] || break
  rm -f "$OLDEST"
  SIZE=$(du -sm "$DIR" | cut -f1)
done
echo "$(date '+%F %T') media-cache now $(du -sm "$DIR" | cut -f1)MB"
