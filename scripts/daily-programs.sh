#!/bin/bash
# 過去14日を補完しつつ、当日の公式番組だけは毎回原子的に再取得する。
# launchd から低頻度の固定時刻で呼ばれる。
set -euo pipefail
cd "$(dirname "$0")/.."

FROM=$(TZ=Asia/Tokyo date -v-14d '+%Y-%m-%d')
TODAY=$(TZ=Asia/Tokyo date +%Y-%m-%d)
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

echo "${LOG_PREFIX} fetch:official-programs ${FROM}..${TODAY} (force current day)"
export BOAT_PON_SKIP_EXISTING=1
export BOAT_PON_FORCE_PROGRAM_REFRESH_DATES="$TODAY"
run_tsx scripts/fetch-official-programs.ts "$FROM" "$TODAY"

echo "${LOG_PREFIX} verify current-day program inventory"
export BOAT_PON_PROGRAM_READINESS_MAX_AGE_MINUTES=180
run_tsx scripts/check-official-program-live-readiness.ts "$TODAY"

echo "${LOG_PREFIX} generate private daily trifecta capture plan"
run_tsx scripts/generate-n2-trifecta-private-daily-plan.ts "$TODAY"
