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

# 2026-10-15: 研究用の収集（private capture）の計画づくりは、研究工場の停止に合わせて外した。

# 番組表が欠けた日（直近 400 日）を、公式アーカイブから取り直す。2025-11-21〜2026-05-19 の約半年が欠けていた
# （docs/reviews/2026-10-14-data-audit.md の D1）。取り込み済みの日は飛ばすので、欠けが無い晩は何も取りに行かない。
# 公式サイトへの取得なので、レースの無い時間（21:05〜07:30）だけ。1.5 秒間隔・1回 200 ファイルまで（CLAUDE.md の 3 章）。
# 上の当日分の取得と確認が済んでから動く。失敗しても、このジョブの成否には数えない。
GAP_FROM=$(TZ=Asia/Tokyo date -v-400d '+%Y-%m-%d')
GAP_TO=$(TZ=Asia/Tokyo date -v-15d '+%Y-%m-%d')
GAP_NOW_HM=$((10#$(TZ=Asia/Tokyo date '+%H%M')))
if (( GAP_NOW_HM >= 2105 || GAP_NOW_HM < 730 )); then
  echo "${LOG_PREFIX} fetch:official-programs (gap fill) ${GAP_FROM}..${GAP_TO}"
  ( unset BOAT_PON_FORCE_PROGRAM_REFRESH_DATES; export BOAT_PON_SKIP_EXISTING=1 BOAT_PON_MAX_DOWNLOADS=200; run_tsx scripts/fetch-official-programs.ts "$GAP_FROM" "$GAP_TO" ) \
    || echo "${LOG_PREFIX} fetch:official-programs (gap fill) partial failure (exit=$?); continuing"
else
  echo "${LOG_PREFIX} fetch:official-programs (gap fill) skipped: daytime"
fi
