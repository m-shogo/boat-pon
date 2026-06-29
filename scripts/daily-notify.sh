#!/bin/bash
# Boat Pon 日次サマリ通知 — launchd から毎日 21:30 JST に呼ばれる
set -euo pipefail
cd "$(dirname "$0")/.."

TODAY=$(TZ=Asia/Tokyo date +%Y-%m-%d)
LOG_PREFIX="[$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S')]"

# ---------- DB から今日の数字を取得 ----------
db_query() {
  sqlite3 data/boat.sqlite "$1" 2>/dev/null || echo "0"
}

SKIP=$(db_query  "SELECT COUNT(*) FROM decision_history WHERE date='$TODAY' AND decision='SKIP' AND source='history-model';")
WATCH=$(db_query "SELECT COUNT(*) FROM decision_history WHERE date='$TODAY' AND decision='WATCH' AND source='history-model';")
BUY=$(db_query   "SELECT COUNT(*) FROM decision_history WHERE date='$TODAY' AND decision='BUY' AND source='history-model';")

WATCH_ODDS=$(db_query "SELECT COUNT(*) FROM decision_history
  WHERE date='$TODAY' AND decision='WATCH' AND current_odds IS NOT NULL AND source='history-model';")

ODDS_TOTAL=$(db_query "SELECT COUNT(*) FROM odds_snapshots
  WHERE captured_at >= '${TODAY}T00:00:00' AND captured_at < '${TODAY}T23:59:59';")

# 採用判断 n（v3-alpha15 ライブBUY 通算）
TOTAL_BUY=$(db_query "SELECT COUNT(*) FROM decision_history
  WHERE date >= '2026-05-27'
    AND decision = 'BUY'
    AND source = 'history-model'
    AND model_version = 'boatpon-v3-alpha15';")

# ---------- err.log の新規エラー件数（既知ログ除く）----------
ERR_LOG="data/logs/auto-odds-err.log"
NEW_ERRORS=0
if [ -f "$ERR_LOG" ]; then
  NEW_ERRORS=$(grep -c "^error:.*${TODAY}" "$ERR_LOG" || true)
fi

# ---------- 通知メッセージ組み立て ----------
if [ "$BUY" -gt 0 ]; then
  SUBTITLE="🎯 BUY ${BUY}件！ | $TODAY"
else
  SUBTITLE="$TODAY"
fi

BODY="BUY=${BUY} WATCH=${WATCH}(オッズ${WATCH_ODDS}/${WATCH}) SKIP=${SKIP}  |  通算n=${TOTAL_BUY}/300  |  オッズ${ODDS_TOTAL}件取得"

if [ "$NEW_ERRORS" -gt 0 ]; then
  BODY="${BODY}  ⚠️ fetch-err=${NEW_ERRORS}"
fi

# LINE Messaging API 通知（env未設定時はスキップ、送信失敗してもmacOS通知は継続）
pnpm --silent notify:line:daily --date "$TODAY" || echo "${LOG_PREFIX} line notify skipped or failed"

# macOS 通知センターへ送信
osascript -e "display notification \"${BODY}\" with title \"Boat Pon 日次サマリ\" subtitle \"${SUBTITLE}\""

echo "${LOG_PREFIX} notify sent: ${BODY}"
