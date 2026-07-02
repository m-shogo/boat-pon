#!/bin/bash
# Boat Pon Forward週次サマリー通知 — launchd から毎週月曜 09:00 JST に呼ばれる
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_PREFIX="[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')]"

pnpm --silent notify:line:forward || echo "${LOG_PREFIX} line forward skipped or failed"

echo "${LOG_PREFIX} weekly forward notify done"
