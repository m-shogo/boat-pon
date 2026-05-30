#!/bin/bash
# 週次ルール候補レビュー — launchd から毎週日曜 22:00 JST に呼ばれる
# 実行内容: データ検証 → 品質レポート(JSON) → ルール候補追記
# 購入・設定変更・DB書き込みは一切行わない

set -euo pipefail

# ---------- ルートディレクトリ解決 ----------
ROOT_DIR="${BOAT_PON_ROOT_DIR:-/Users/m-shogo/Developer/personal/boat-pon}"
cd "$ROOT_DIR"

# ---------- ディレクトリ確認 ----------
mkdir -p logs tmp

LOG="$ROOT_DIR/logs/weekly-rule-review.log"
JSON_OUT="$ROOT_DIR/tmp/boat-quality-weekly.json"

ts() { TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S JST'; }

{
  echo "========================================"
  echo "weekly-rule-review start: $(ts)"
  echo "ROOT_DIR: $ROOT_DIR"
  echo "========================================"

  # ---------- 1. データ検証 ----------
  echo ""
  echo "--- [1/3] validate:data $(ts) ---"
  if npm run --silent validate:data 2>&1; then
    echo "validate:data: OK"
  else
    echo "validate:data: FAILED (exit=$?) — 後続ステップは続行"
  fi

  # ---------- 2. 品質レポート (JSON をファイルへ保存) ----------
  echo ""
  echo "--- [2/3] report:quality $(ts) ---"
  if npm run --silent report:quality -- --days 30 --json > "$JSON_OUT" 2>&1; then
    echo "report:quality: OK -> $JSON_OUT"
  else
    echo "report:quality: FAILED (exit=$?) — 空JSONを保存"
    echo '{"error":"report:quality failed","timestamp":"'"$(ts)"'"}' > "$JSON_OUT"
  fi

  # ---------- 3. ルール候補追記 ----------
  echo ""
  echo "--- [3/3] append:rule-candidates $(ts) ---"
  if npm run --silent append:rule-candidates -- \
      --input "$JSON_OUT" \
      --status watch \
      --evidence report:monthly \
      --action 追加観察 \
      --next-check "next weekly" 2>&1; then
    echo "append:rule-candidates: OK"
  else
    echo "append:rule-candidates: FAILED (exit=$?)"
  fi

  echo ""
  echo "========================================"
  echo "weekly-rule-review done: $(ts)"
  echo "========================================"

} >> "$LOG" 2>&1

echo "weekly-rule-review finished: $(ts)"
