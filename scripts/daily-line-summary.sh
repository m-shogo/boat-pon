#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

TODAY=$(TZ=Asia/Tokyo date +%Y-%m-%d)
LOG_PREFIX="[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')]"

pnpm --silent exec tsx scripts/notify-line-scheduled-summary.ts --date "$TODAY" || echo "${LOG_PREFIX} line scheduled summary skipped or failed"
echo "${LOG_PREFIX} line scheduled summary attempted: ${TODAY}"
