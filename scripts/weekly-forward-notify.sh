#!/bin/bash
# Boat Pon Forward週次サマリー通知 — launchd から毎週月曜 09:00 JST に呼ばれる
set -euo pipefail
cd "$(dirname "$0")/.."

LOG_PREFIX="[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')]"

run_tsx() {
  if command -v node >/dev/null 2>&1 && [ -d node_modules/tsx ]; then
    node --import tsx "$@"
  elif command -v mise >/dev/null 2>&1; then
    mise exec -- node --import tsx "$@"
  else
    echo "${LOG_PREFIX} node/tsx not found (checked PATH and mise)" >&2
    return 127
  fi
}

run_tsx scripts/notify-line.ts forward || echo "${LOG_PREFIX} line forward skipped or failed"

echo "${LOG_PREFIX} weekly forward notify done"
