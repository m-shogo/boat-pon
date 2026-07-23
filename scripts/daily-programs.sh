#!/bin/bash
# 今日までの番組表を補完する。launchd から毎朝呼ばれる。
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

echo "${LOG_PREFIX} fetch:official-programs ${FROM}..${TODAY}"
export BOAT_PON_SKIP_EXISTING=1
run_tsx scripts/fetch-official-programs.ts "$FROM" "$TODAY"
