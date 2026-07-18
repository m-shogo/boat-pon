#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

TODAY=$(TZ=Asia/Tokyo date +%Y-%m-%d)
LOG_PREFIX="[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')]"

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  elif command -v mise >/dev/null 2>&1; then
    mise exec -- pnpm "$@"
  else
    echo "${LOG_PREFIX} pnpm not found (checked PATH and mise)" >&2
    return 127
  fi
}

run_pnpm --silent exec tsx scripts/notify-line-scheduled-summary.ts --date "$TODAY" || echo "${LOG_PREFIX} line scheduled summary skipped or failed"
echo "${LOG_PREFIX} line scheduled summary attempted: ${TODAY}"
