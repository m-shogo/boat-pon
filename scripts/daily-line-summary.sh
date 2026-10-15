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

# 後から取り直せない締切前のオッズの時系列を、1日1ファイルで書き出す（直近7日の抜けも埋める。保存先の複製は BOAT_PON_EXPORT_MIRROR_DIR）。
run_tsx scripts/export-odds-timeseries.ts --from "$(TZ=Asia/Tokyo date -v-7d +%Y-%m-%d)" --to "$TODAY" --verify || echo "${LOG_PREFIX} odds timeseries export skipped or failed"
# 取り直せない記録（判定・通知・設定）も、毎晩書き出して複製する（月の最初の回は月の控えも残す）。
run_tsx scripts/export-records.ts || echo "${LOG_PREFIX} records export skipped or failed"

# 今日の BUY の当たり外れ（公式の結果ページ。1日最大5件）。10分ごとの速報が未登録でも、結果を当日中に届けて日次まとめに載せる。
run_tsx scripts/notify-buy-results-fast.ts --catch-up || echo "${LOG_PREFIX} buy results catch-up skipped or failed"

run_tsx scripts/notify-line.ts daily --date "$TODAY" || echo "${LOG_PREFIX} line daily skipped or failed"
echo "${LOG_PREFIX} line daily attempted: ${TODAY}"
