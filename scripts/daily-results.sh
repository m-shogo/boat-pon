#!/bin/bash
# 公式結果を取得する。launchd から毎日 21:30 JST に呼ばれる。
# 公式アーカイブの公開遅延と一時障害を考慮し、昨日までの14日間を補完する。
set -euo pipefail
cd "$(dirname "$0")/.."

# launchd の最小PATHでも Homebrew の unar を解決できるようにする。
export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"

FROM=$(TZ=Asia/Tokyo date -v-14d '+%Y-%m-%d')
TO=$(TZ=Asia/Tokyo date -v-1d '+%Y-%m-%d')
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

echo "${LOG_PREFIX} fetch:official-results ${FROM}..${TO}"
export BOAT_PON_SKIP_EXISTING=1
run_tsx scripts/fetch-official-results.ts "$FROM" "$TO"

# 結果取得後、直近14日で未通知のpaper-live BUY事後結果を送る。
# notification_logの専用キーで重複送信を防ぐ。
run_tsx scripts/notify-line.ts results --from "$FROM" --to "$TO" || echo "${LOG_PREFIX} line buy results skipped or failed"
