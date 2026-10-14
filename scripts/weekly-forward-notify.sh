#!/bin/bash
# Boat Pon 週次の成長まとめ — launchd から毎週月曜 09:00 JST に呼ばれる
# 先週（月〜日）とその前の週を比べた1通を LINE に送る。ファイル名は launchd の登録に合わせて旧名のまま。
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

GROWTH_DIR="data/reports/scorecard"
mkdir -p "${GROWTH_DIR}"
run_tsx scripts/report-growth.ts --no-months --output "${GROWTH_DIR}/growth-weekly.md" --json-output "${GROWTH_DIR}/growth-weekly.json" \
  || echo "${LOG_PREFIX} growth report failed"
run_tsx scripts/notify-line.ts weekly --growth-json "${GROWTH_DIR}/growth-weekly.json" || echo "${LOG_PREFIX} line weekly skipped or failed"

echo "${LOG_PREFIX} weekly growth notify done"
