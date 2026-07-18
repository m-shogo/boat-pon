#!/bin/bash
# 公式結果を取得する。launchd から毎日 21:30 JST に呼ばれる。
# 公式アーカイブの公開遅延と一時障害を考慮し、昨日までの14日間を補完する。
set -euo pipefail
cd "$(dirname "$0")/.."

FROM=$(TZ=Asia/Tokyo date -v-14d '+%Y-%m-%d')
TO=$(TZ=Asia/Tokyo date -v-1d '+%Y-%m-%d')
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

echo "${LOG_PREFIX} fetch:official-results ${FROM}..${TO}"
export BOAT_PON_SKIP_EXISTING=1
run_pnpm --silent fetch:official-results "$FROM" "$TO"
