#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

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

# 成長ループ（登録済みのこのジョブで回す）: 週1回の改善処理 → スコアカード（履歴とイベントに記録）。
# どちらが失敗しても日次まとめは送る。スコアカードの注意は日次まとめに載る。
mkdir -p data/reports/scorecard
run_tsx scripts/run-accuracy-growth.ts --state-dir data/reports/scorecard || echo "${LOG_PREFIX} accuracy growth skipped or failed"
run_tsx scripts/report-accuracy-scorecard.ts --state-dir data/reports/scorecard --output data/reports/scorecard/latest.md --json-output data/reports/scorecard/latest.json || echo "${LOG_PREFIX} accuracy scorecard skipped or failed"

run_tsx scripts/notify-line.ts daily --date "$TODAY" || echo "${LOG_PREFIX} line daily skipped or failed"
echo "${LOG_PREFIX} line daily attempted: ${TODAY}"
