#!/usr/bin/env bash
# 发布：把 dev 合到 main、打 tag、生成 bundle 供本机推送。
# 日常改动只提交到 dev，别人看不到；用户说「发布/同步」时再跑这个。
# 用法：bash scripts/publish.sh [tag名]
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "dev" ] || { echo "当前不在 dev 分支（$BRANCH），先 git checkout dev"; exit 1; }
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "有未提交改动，先提交（或 git stash）"; exit 1
fi
git checkout main
git merge --no-edit dev
if [ -n "$TAG" ]; then
  git tag -a "$TAG" -m "发布 $TAG"
  echo "已打 tag：$TAG"
fi
git checkout dev
OUT=/tmp/publish.bundle
git bundle create "$OUT" --all >/dev/null
echo "bundle：$OUT"
echo "下一步（本机）：clone --bare → remote set-url → push --force main + tags"
git log --oneline -1 main
